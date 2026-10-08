/**
 * Business Documents route — invoices, quotes, receipts (90% §63, Wave 10).
 * Pure frontend (pdf-lib). Local-only. No ERP. No accounting suite.
 * Templates: invoice, quote, receipt. Fields: title, from, to, date,
 * line items (description, qty, price), tax. Decimal totals.
 */

import { useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { saveFileAs } from "@/lib/save-as";
import { openPath, revealPath } from "@/lib/ipc";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

type DocType = "invoice" | "quote" | "receipt";

const TYPES: ReadonlyArray<{ id: DocType; label: string }> = [
  { id: "invoice", label: "Invoice" },
  { id: "quote", label: "Quote" },
  { id: "receipt", label: "Receipt" },
];

interface LineItem {
  description: string;
  quantity: string;
  price: string;
}

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BusinessDocsRoute(): React.ReactNode {
  const [docType, setDocType] = useState<DocType>("invoice");
  const [title, setTitle] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [toName, setToName] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<LineItem[]>([
    { description: "", quantity: "1", price: "0.00" },
  ]);
  const [taxRate, setTaxRate] = useState("0");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  function addItem(): void {
    setItems((cur) => [...cur, { description: "", quantity: "1", price: "0.00" }]);
  }
  function removeItem(idx: number): void {
    setItems((cur) => cur.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, patch: Partial<LineItem>): void {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const subtotal = items.reduce((sum, it) => {
    const qty = parseFloat(it.quantity) || 0;
    const price = parseFloat(it.price) || 0;
    return sum + qty * price;
  }, 0);
  const tax = subtotal * (parseFloat(taxRate) || 0) / 100;
  const total = subtotal + tax;

  async function onGenerate(): Promise<void> {
    if (!fromName.trim() || !toName.trim()) { setError("Enter 'From' and 'To' names."); return; }
    setProcessing(true);
    setError(null);
    setOutputPath(null);
    try {

      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const A4_W = 595.28;
      const A4_H = 841.89;
      const page = doc.addPage([A4_W, A4_H]);
      const margin = 50;
      let y = A4_H - margin;

      // Header
      page.drawText(docType.toUpperCase(), { x: margin, y, size: 24, font: bold, color: rgb(0.18, 0.31, 0.45) });
      y -= 30;
      page.drawText(title || `${docType} ${date}`, { x: margin, y, size: 12, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 20;

      // From / To
      page.drawText("From:", { x: margin, y, size: 10, font: bold, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(fromName, { x: margin + 40, y, size: 10, font });
      y -= 14;
      if (fromAddress) { page.drawText(fromAddress, { x: margin + 40, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) }); y -= 12; }
      y -= 10;
      page.drawText("To:", { x: margin, y, size: 10, font: bold, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(toName, { x: margin + 40, y, size: 10, font });
      y -= 14;
      if (toAddress) { page.drawText(toAddress, { x: margin + 40, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) }); y -= 12; }
      y -= 10;
      page.drawText(`Date: ${date}`, { x: margin, y, size: 10, font });
      y -= 30;

      // Line items header
      const descX = margin;
      const qtyX = margin + 300;
      const priceX = margin + 380;
      const totalX = margin + 460;
      page.drawText("Description", { x: descX, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
      page.drawText("Qty", { x: qtyX, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
      page.drawText("Price", { x: priceX, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
      page.drawText("Total", { x: totalX, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
      y -= 14;
      page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      y -= 14;

      for (const it of items) {
        const qty = parseFloat(it.quantity) || 0;
        const price = parseFloat(it.price) || 0;
        const lineTotal = qty * price;
        page.drawText(it.description || "", { x: descX, y, size: 9, font });
        page.drawText(it.quantity, { x: qtyX, y, size: 9, font });
        page.drawText(formatCurrency(price), { x: priceX, y, size: 9, font });
        page.drawText(formatCurrency(lineTotal), { x: totalX, y, size: 9, font });
        y -= 14;
      }
      y -= 10;
      page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      y -= 16;

      // Totals
      page.drawText("Subtotal:", { x: totalX - 80, y, size: 9, font });
      page.drawText(formatCurrency(subtotal), { x: totalX, y, size: 9, font });
      y -= 12;
      page.drawText(`Tax (${taxRate}%):`, { x: totalX - 80, y, size: 9, font });
      page.drawText(formatCurrency(tax), { x: totalX, y, size: 9, font });
      y -= 14;
      page.drawText("Total:", { x: totalX - 80, y, size: 10, font: bold });
      page.drawText(formatCurrency(total), { x: totalX, y, size: 10, font: bold });
      y -= 30;

      // Footer
      page.drawText("Generated locally by Paperu — 0 bytes uploaded.", { x: margin, y: 30, size: 8, font, color: rgb(0.55, 0.55, 0.55) });

      const pdfBytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
      // P0-A fix: use saveFileAs (writes to the EXACT user-chosen path,
      // no suffix appended) instead of finalizeOutput (which derives the
      // destination from a source path + appends a suffix).
      const result = await saveFileAs(pdfBytes, `${docType}-${date}.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
      if (!result) { return; } // user cancelled the save dialog
      setOutputPath(result.outputPath);
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

  return (
    <section className="paperu-section" aria-labelledby="biz-heading">
      <header className="paperu-section__header">
        <h1 id="biz-heading" className="paperu-text-display">Business Documents</h1>
        <p className="paperu-text-lead">Create invoices, quotes, and receipts as PDFs. Line items, tax, decimal totals. Local-only — no accounting suite, no ERP.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)" }}>
            {TYPES.map((t) => (
              <button key={t.id} type="button" className={`paperu-target__preset${docType === t.id ? " is-active" : ""}`} onClick={() => setDocType(t.id)} aria-pressed={docType === t.id} style={{ padding: "var(--paperu-space-3)" }}>{t.label}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
            <input className="paperu-target__input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="paperu-target__input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            {items.map((it, idx) => (
              <li key={idx} style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "center" }}>
                <input className="paperu-target__input" placeholder="Description" value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} style={{ flex: 1 }} />
                <input className="paperu-target__input" placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} style={{ width: "80px" }} />
                <input className="paperu-target__input" placeholder="Price" value={it.price} onChange={(e) => updateItem(idx, { price: e.target.value.replace(/[^0-9.]/g, "") })} style={{ width: "100px" }} />
                <button type="button" className="paperu-btn paperu-btn--ghost" onClick={() => removeItem(idx)} aria-label="Remove">×</button>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)" }}>
            <Button variant="outline" onClick={addItem}>+ Add item</Button>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
              <span className="paperu-text-label">Tax %</span>
              <input className="paperu-target__input" value={taxRate} onChange={(e) => setTaxRate(e.target.value.replace(/[^0-9.]/g, ""))} style={{ width: "80px" }} />
            </label>
          </div>
          <div style={{ marginTop: "var(--paperu-space-3)" }}>
            <span className="paperu-text-label">Subtotal: </span><span className="paperu-text-numeric">{formatCurrency(subtotal)}</span>
            <span className="paperu-text-label" style={{ marginLeft: "var(--paperu-space-3)" }}>Tax: </span><span className="paperu-text-numeric">{formatCurrency(tax)}</span>
            <span className="paperu-text-label" style={{ marginLeft: "var(--paperu-space-3)" }}>Total: </span><span className="paperu-text-numeric" style={{ fontWeight: 700 }}>{formatCurrency(total)}</span>
          </div>
        </div>
      </Card>

      <Button variant="accent" onClick={onGenerate} disabled={processing} style={{ width: "100%" }}>
        {processing ? "Generating…" : `Generate ${docType}`}
      </Button>

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ {docType} generated</span>
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
