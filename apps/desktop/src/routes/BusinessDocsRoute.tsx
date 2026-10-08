/**
 * Business Documents route — invoices, quotes, receipts (P0-D).
 *
 * A real, money-safe workflow on top of `@/engines/business-docs`:
 *   - Integer-cents arithmetic (no parseFloat on currency anywhere).
 *   - Per-prefix document numbering (INV-0001, QUO-0001, REC-0001)
 *     persisted in localStorage.
 *   - Named presets (from/to/tax/currency) saved to localStorage.
 *   - Recent drafts list — reopen any of the last 20 generated docs.
 *   - Pagination + word-wrap + repeated column header per page.
 *   - Invalid-input highlighting: a field that can't parse to a number
 *     is shown with a red border and disables Generate. No silent
 *     NaN→0 coercion.
 *   - Currency selection (USD/EUR/GBP/INR/JPY/…), with JPY = 0 decimals.
 *   - Optional discount (percent or flat), applied before tax.
 *
 * Pure frontend. pdf-lib is lazy-imported by the engine (the heavy
 * ~200 KB bundle is only fetched on the first Generate click). No
 * network. Output goes through `saveFileAs` (canonical Rust write,
 * atomic finalization).
 */

import { useEffect, useMemo, useState } from "react";
import { saveFileAs } from "@/lib/save-as";
import { openPath, revealPath } from "@/lib/ipc";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";
import {
  advanceSeqNumber,
  computeTotals,
  CURRENCIES,
  deleteDraft,
  deletePreset,
  formatDocNumber,
  formatMoney,
  generateBusinessPdf,
  getCurrency,
  getDocType,
  getSeqNumber,
  loadDrafts,
  loadPresets,
  parseMoney,
  parseQuantity,
  saveDraft,
  savePreset,
  setSeqNumber,
  DOC_TYPES,
  type CurrencyCode,
  type DiscountMode,
  type DiscountSpec,
  type DocType,
  type Draft,
  type Preset,
  type ValidatedLineItem,
} from "@/engines/business-docs";

interface ItemInput {
  description: string;
  quantity: string;
  price: string;
}

function emptyItem(): ItemInput {
  return { description: "", quantity: "1", price: "0.00" };
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface FieldErrors {
  readonly items: readonly (readonly [boolean, boolean])[];
  readonly taxRate: boolean;
  readonly discountValue: boolean;
  readonly seqNumber: boolean;
}

export function BusinessDocsRoute(): React.ReactNode {
  // ── Form state ──
  const [docType, setDocType] = useState<DocType>("invoice");
  const [docTypeDef, setDocTypeDef] = useState(getDocType("invoice"));
  const [seqNumberInput, setSeqNumberInput] = useState<string>(
    String(getSeqNumber("INV")),
  );
  const [title, setTitle] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [toName, setToName] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>("USD");
  const [items, setItems] = useState<ItemInput[]>([emptyItem()]);
  const [taxRate, setTaxRate] = useState("0");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("none");
  const [discountValue, setDiscountValue] = useState("0");

  // ── Persistence state (mirrored from localStorage) ──
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts());
  const [presetName, setPresetName] = useState("");

  // ── Async / outcome state ──
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [successStamp, setSuccessStamp] = useState<string | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  const currency = useMemo(() => getCurrency(currencyCode), [currencyCode]);

  // When the doc type changes, swap the prefix and reset the
  // sequence-number input to the new prefix's next sequence.
  useEffect(() => {
    const def = getDocType(docType);
    setDocTypeDef(def);
    setSeqNumberInput(String(getSeqNumber(def.prefix)));
  }, [docType]);

  function addItem(): void {
    setItems((cur) => [...cur, emptyItem()]);
  }
  function removeItem(idx: number): void {
    setItems((cur) => cur.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, patch: Partial<ItemInput>): void {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  // ── Validation: per-field "is this a valid number?" ──
  // A field is invalid when it has content we can't parse. An empty
  // optional field is fine; an empty *required* field is handled by
  // the form-level required check, not here.
  const fieldErrors: FieldErrors = useMemo(() => {
    const itemErrs = items.map((it) => {
      const qtyErr = it.quantity.trim() !== "" && parseQuantity(it.quantity) === null;
      const priceErr = it.price.trim() !== "" && parseMoney(it.price, currency.decimals) === null;
      return [qtyErr, priceErr] as const;
    });
    const taxErr = taxRate.trim() !== "" && parseQuantity(taxRate) === null;
    const discErr =
      discountMode !== "none" &&
      discountValue.trim() !== "" &&
      parseMoney(discountValue, currency.decimals) === null;
    const seqErr =
      seqNumberInput.trim() !== "" &&
      !/^\d+$/.test(seqNumberInput.trim());
    return {
      items: itemErrs,
      taxRate: taxErr,
      discountValue: discErr,
      seqNumber: seqErr,
    } as const;
  }, [items, taxRate, discountMode, discountValue, seqNumberInput, currency.decimals]);

  const hasInvalidFields =
    fieldErrors.taxRate ||
    fieldErrors.discountValue ||
    fieldErrors.seqNumber ||
    fieldErrors.items.some(([q, p]) => q || p);

  // ── Parsed line items (for totals + PDF). Invalid items contribute 0. ──
  const validatedItems: ValidatedLineItem[] = useMemo(() => {
    return items.map((it) => {
      const qty = parseQuantity(it.quantity) ?? 0;
      const price = parseMoney(it.price, currency.decimals) ?? 0;
      return { description: it.description, quantity: qty, priceCents: price };
    });
  }, [items, currency.decimals]);

  const parsedTaxRate = parseQuantity(taxRate) ?? 0;
  const parsedDiscountValue = parseMoney(discountValue, currency.decimals) ?? 0;
  const discount: DiscountSpec | null = useMemo(() => {
    if (discountMode === "none" || parsedDiscountValue <= 0) return null;
    if (discountMode === "percent") {
      // Percent is integer-only in V1 (parseMoney on "15" with 0
      // decimals). For percent we use parseIntField semantics; the
      // field value parsed through parseMoney with currency.decimals
      // is the wrong tool. Re-parse as integer.
      const n = parseMoney(discountValue, 0);
      return n === null ? null : { mode: "percent", valueCents: n };
    }
    return { mode: "flat", valueCents: parsedDiscountValue };
  }, [discountMode, discountValue, parsedDiscountValue]);

  const totals = useMemo(
    () => computeTotals(validatedItems, parsedTaxRate, discount),
    [validatedItems, parsedTaxRate, discount],
  );

  const displayDocNumber = useMemo(() => {
    const n = parseInt(seqNumberInput, 10);
    if (!Number.isFinite(n) || n < 1) return formatDocNumber(docTypeDef.prefix, 1);
    return formatDocNumber(docTypeDef.prefix, n);
  }, [seqNumberInput, docTypeDef.prefix]);

  // ── Presets ──
  function onPresetSave(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const p: Preset = {
      id: genId(),
      name: trimmed,
      docType,
      fromName,
      fromAddress,
      toName,
      toAddress,
      taxRate,
      currency: currencyCode,
      discountMode,
      discountValue,
    };
    setPresets(savePreset(p));
    setPresetName("");
  }
  function onPresetLoad(p: Preset): void {
    setDocType(p.docType);
    setFromName(p.fromName);
    setFromAddress(p.fromAddress);
    setToName(p.toName);
    setToAddress(p.toAddress);
    setTaxRate(p.taxRate);
    setCurrencyCode(p.currency);
    setDiscountMode(p.discountMode);
    setDiscountValue(p.discountValue);
  }
  function onPresetDelete(id: string): void {
    setPresets(deletePreset(id));
  }

  // ── Drafts: save on generate, reopen on click ──
  function snapshotDraft(): Draft {
    return {
      id: genId(),
      docType,
      docNumber: displayDocNumber,
      title,
      fromName,
      fromAddress,
      toName,
      toAddress,
      date,
      currency: currencyCode,
      items: items.map((it) => ({ ...it })),
      taxRate,
      discountMode,
      discountValue,
      savedAt: Date.now(),
    };
  }
  function onReopenDraft(d: Draft): void {
    setDocType(d.docType);
    setSeqNumberInput(seqNumberFromDisplay(d.docNumber));
    setTitle(d.title);
    setFromName(d.fromName);
    setFromAddress(d.fromAddress);
    setToName(d.toName);
    setToAddress(d.toAddress);
    setDate(d.date);
    setCurrencyCode(d.currency);
    setItems(d.items.length > 0 ? d.items.map((it) => ({ ...it })) : [emptyItem()]);
    setTaxRate(d.taxRate);
    setDiscountMode(d.discountMode);
    setDiscountValue(d.discountValue);
    setOutputPath(null);
    setError(null);
    setSuccessStamp(null);
  }
  function onDraftDelete(id: string): void {
    setDrafts(deleteDraft(id));
  }

  // ── Generate ──
  async function onGenerate(): Promise<void> {
    if (!fromName.trim() || !toName.trim()) {
      setError("Enter 'From' and 'To' names.");
      return;
    }
    if (hasInvalidFields) {
      setError("Fix the highlighted fields before generating.");
      return;
    }
    if (items.every((it) => !it.description.trim() && !it.quantity.trim() && !it.price.trim())) {
      setError("Add at least one line item.");
      return;
    }
    setProcessing(true);
    setError(null);
    setOutputPath(null);
    setSuccessStamp(null);
    try {
      // Persist the user's sequence-number override before generation.
      const n = parseInt(seqNumberInput, 10);
      const seqN = Number.isFinite(n) && n >= 1 ? n : getSeqNumber(docTypeDef.prefix);
      setSeqNumber(docTypeDef.prefix, seqN);

      const draft = snapshotDraft();
      const bytes = await generateBusinessPdf({
        docType: docTypeDef,
        docNumber: formatDocNumber(docTypeDef.prefix, seqN),
        title,
        fromName,
        fromAddress,
        toName,
        toAddress,
        date,
        currency,
        items: validatedItems,
        taxRatePct: parsedTaxRate,
        discount,
        totals,
      });
      // Use the canonical saveFileAs path — no suffix appended, the
      // user picks the exact destination.
      const result = await saveFileAs(
        bytes,
        `${docTypeDef.prefix.toLowerCase()}-${date}.pdf`,
        [{ name: "PDF", extensions: ["pdf"] }],
      );
      if (!result) return; // user cancelled the save dialog
      setOutputPath(result.outputPath);
      setSuccessStamp(formatDocNumber(docTypeDef.prefix, seqN));
      // Persist draft + advance the sequence for the next generation.
      setDrafts(saveDraft(draft));
      const nextN = advanceSeqNumber(docTypeDef.prefix);
      setSeqNumberInput(String(nextN));
      addRecent({
        path: result.outputPath,
        fileName: result.output.fileName,
        kind: result.output.kind,
        humanReadableSize: result.output.size.humanReadable,
        operation: `Business ${docType}`,
        timestamp: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  const fieldClass = (invalid: boolean): string =>
    invalid
      ? "paperu-target__input paperu-bizdocs__invalid"
      : "paperu-target__input";

  return (
    <section className="paperu-section" aria-labelledby="biz-heading">
      <header className="paperu-section__header">
        <h1 id="biz-heading" className="paperu-text-display">Business Documents</h1>
        <p className="paperu-text-lead">
          Create invoices, quotes, and receipts as PDFs. Money-safe integer
          cents, document numbering, presets, drafts, pagination, text wrapping.
          Local-only — no accounting suite, no ERP, no network.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          {/* Doc type selector */}
          <div className="paperu-target__presets" style={{ marginBottom: 0 }}>
            {DOC_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`paperu-target__preset${docType === t.id ? " is-active" : ""}`}
                onClick={() => setDocType(t.id)}
                aria-pressed={docType === t.id}
                style={{ padding: "var(--paperu-space-3)" }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
            <input className="paperu-target__input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="paperu-target__input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <select
              className="paperu-target__input"
              aria-label="Currency"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value as CurrencyCode)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol}, {c.decimals} dp)
                </option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
              <span className="paperu-text-label">Next #</span>
              <input
                className={fieldClass(fieldErrors.seqNumber)}
                inputMode="numeric"
                value={seqNumberInput}
                onChange={(e) => setSeqNumberInput(e.target.value.replace(/[^0-9]/g, ""))}
                style={{ width: "80px" }}
                aria-label="Next sequence number"
              />
              <span className="paperu-text-code" style={{ color: "var(--paperu-text-muted)" }}>
                → {displayDocNumber}
              </span>
            </label>
            <input className="paperu-target__input" placeholder="From (your name)" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            <input className="paperu-target__input" placeholder="From address (optional)" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
            <input className="paperu-target__input" placeholder="To (client name)" value={toName} onChange={(e) => setToName(e.target.value)} />
            <input className="paperu-target__input" placeholder="To address (optional)" value={toAddress} onChange={(e) => setToAddress(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Line items</span>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-2)" }}>
            {items.map((it, idx) => {
              const [qtyErr, priceErr] = fieldErrors.items[idx] ?? [false, false];
              return (
                <li key={idx} style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "flex-start" }}>
                  <textarea
                    className="paperu-target__input"
                    placeholder="Description (long text wraps)"
                    value={it.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                    rows={1}
                    style={{ flex: 1, minHeight: "40px", resize: "vertical" }}
                  />
                  <input
                    className={fieldClass(qtyErr)}
                    placeholder="Qty"
                    inputMode="decimal"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    style={{ width: "80px" }}
                    aria-label={`Item ${idx + 1} quantity`}
                  />
                  <input
                    className={fieldClass(priceErr)}
                    placeholder="Price"
                    inputMode="decimal"
                    value={it.price}
                    onChange={(e) => updateItem(idx, { price: e.target.value })}
                    style={{ width: "100px" }}
                    aria-label={`Item ${idx + 1} price`}
                  />
                  <button type="button" className="paperu-btn paperu-btn--ghost" onClick={() => removeItem(idx)} aria-label="Remove item">×</button>
                </li>
              );
            })}
          </ul>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)", alignItems: "flex-end" }}>
            <Button variant="outline" onClick={addItem}>+ Add item</Button>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
              <span className="paperu-text-label">Tax %</span>
              <input
                className={fieldClass(fieldErrors.taxRate)}
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                style={{ width: "80px" }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
              <span className="paperu-text-label">Discount</span>
              <select
                className="paperu-target__input"
                value={discountMode}
                onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}
                style={{ width: "auto" }}
              >
                <option value="none">None</option>
                <option value="percent">% off</option>
                <option value="flat">Flat amount</option>
              </select>
              <input
                className={fieldClass(fieldErrors.discountValue)}
                inputMode="decimal"
                placeholder={discountMode === "percent" ? "e.g. 10" : "e.g. 5.00"}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                style={{ width: "100px" }}
                disabled={discountMode === "none"}
              />
            </label>
          </div>

          {/* Live totals — money-safe integer cents, formatted with
              the currency's symbol and decimal precision. */}
          <div style={{ marginTop: "var(--paperu-space-3)" }}>
            <span className="paperu-text-label">Subtotal: </span>
            <span className="paperu-text-numeric">{formatMoney(totals.subtotal, currency)}</span>
            {totals.discountAmount > 0 && (
              <>
                <span className="paperu-text-label" style={{ marginLeft: "var(--paperu-space-3)" }}>Discount: </span>
                <span className="paperu-text-numeric" style={{ color: "var(--paperu-destructive)" }}>
                  −{formatMoney(totals.discountAmount, currency)}
                </span>
              </>
            )}
            {parsedTaxRate > 0 && (
              <>
                <span className="paperu-text-label" style={{ marginLeft: "var(--paperu-space-3)" }}>Tax: </span>
                <span className="paperu-text-numeric">{formatMoney(totals.taxAmount, currency)}</span>
              </>
            )}
            <span className="paperu-text-label" style={{ marginLeft: "var(--paperu-space-3)" }}>Total: </span>
            <span className="paperu-text-numeric" style={{ fontWeight: 700 }}>{formatMoney(totals.total, currency)}</span>
          </div>

          {hasInvalidFields && (
            <p className="paperu-target__error" role="status">
              Fix the highlighted fields before generating. (Invalid fields are outlined in red — they are not silently coerced to 0.)
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Presets</span>
          <p className="paperu-target__hint">Save the current From/To/Tax/Currency/Discount as a named preset. Stored locally (no network).</p>
          <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="paperu-target__input"
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              style={{ flex: "1 1 200px" }}
            />
            <Button variant="outline" onClick={() => onPresetSave(presetName)} disabled={!presetName.trim()}>
              Save as preset
            </Button>
            {presets.length > 0 && (
              <select
                className="paperu-target__input"
                aria-label="Load preset"
                value=""
                onChange={(e) => {
                  const p = presets.find((pp) => pp.id === e.target.value);
                  if (p) onPresetLoad(p);
                }}
                style={{ width: "auto" }}
              >
                <option value="">Load preset…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          {presets.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-1)" }}>
              {presets.map((p) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                  <button
                    type="button"
                    className="paperu-btn paperu-btn--ghost"
                    onClick={() => onPresetLoad(p)}
                    style={{ flex: 1, textAlign: "left" }}
                  >
                    <strong>{p.name}</strong>
                    <span className="paperu-text-code" style={{ marginLeft: "var(--paperu-space-2)", color: "var(--paperu-text-muted)" }}>
                      {p.docType} · {p.currency} · tax {p.taxRate || "0"}%
                    </span>
                  </button>
                  <button
                    type="button"
                    className="paperu-btn paperu-btn--ghost"
                    onClick={() => onPresetDelete(p.id)}
                    aria-label={`Delete preset ${p.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Recent drafts (last 20)</span>
          {drafts.length === 0 ? (
            <p className="paperu-target__hint">No drafts yet. Generating a document saves it here so you can reopen and edit it.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-1)" }}>
              {drafts.map((d) => (
                <li key={d.id} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                  <button
                    type="button"
                    className="paperu-btn paperu-btn--ghost"
                    onClick={() => onReopenDraft(d)}
                    style={{ flex: 1, textAlign: "left" }}
                  >
                    <strong>{d.docNumber}</strong>
                    <span className="paperu-text-code" style={{ marginLeft: "var(--paperu-space-2)", color: "var(--paperu-text-muted)" }}>
                      {d.docType} · {d.date} · {formatMoney(0, getCurrency(d.currency)).slice(0, 1)}{d.currency} · {new Date(d.savedAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="paperu-btn paperu-btn--ghost"
                    onClick={() => onDraftDelete(d.id)}
                    aria-label={`Delete draft ${d.docNumber}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Button
        variant="accent"
        onClick={onGenerate}
        disabled={processing || hasInvalidFields}
        style={{ width: "100%" }}
      >
        {processing ? "Generating…" : `Generate ${docTypeDef.label} ${displayDocNumber}`}
      </Button>

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ {successStamp} generated</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{outputPath}</p>
            <div className="paperu-fitresult__actions">
              <Button variant="accent" onClick={() => void openPath(outputPath)}>Open</Button>
              <Button variant="outline" onClick={() => void revealPath(outputPath)}>Open folder</Button>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}

/** Parse the integer out of a formatted doc-number like "INV-0007". */
function seqNumberFromDisplay(display: string): string {
  const m = display.match(/-(\d+)$/);
  return m ? m[1]! : "1";
}
