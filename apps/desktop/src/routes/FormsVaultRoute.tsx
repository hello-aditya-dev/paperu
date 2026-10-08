/**
 * Forms Vault route — local-only reusable personal field values (90% §38).
 *
 * Stores reusable form field VALUES (name, address, email, phone, etc.)
 * so the user can copy them into forms. Explicitly local + private —
 * Paperu never injects data into websites. The user copies a value.
 */

import { useCallback, useEffect, useState } from "react";
import type { FormField } from "@paperu/contracts";
import { STANDARD_FIELD_KEYS } from "@paperu/contracts";
import { listFormsFields, removeFormsField, upsertFormsField, clearFormsFields } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

export function FormsVaultRoute(): React.ReactNode {
  const [fields, setFields] = useState<readonly FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("name");
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFields(await listFormsFields());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpsert(): Promise<void> {
    if (!newValue.trim()) {
      setError("Enter a value.");
      return;
    }
    try {
      await upsertFormsField({
        fieldKey: newKey,
        fieldValue: newValue.trim(),
        label: newLabel.trim() || null,
      });
      setNewValue("");
      setNewLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRemove(id: string): Promise<void> {
    try {
      await removeFormsField(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onClearAll(): Promise<void> {
    try {
      await clearFormsFields();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function copyValue(value: string, id: string): void {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => setError("Couldn't copy to clipboard."));
  }

  return (
    <section className="paperu-section" aria-labelledby="fv-heading">
      <header className="paperu-section__header">
        <h1 id="fv-heading" className="paperu-text-display">Forms Vault</h1>
        <p className="paperu-text-lead">
          Your local-only reusable form field values. Copy a value when filling forms. Never uploaded. Never injected into websites.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Add or update a field</span>
          <div style={{ display: "grid", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            <select className="paperu-target__input" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ width: "100%" }}>
              {STANDARD_FIELD_KEYS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
            </select>
            <input className="paperu-target__input" placeholder="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} style={{ width: "100%" }} />
            <input className="paperu-target__input" placeholder="Custom label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ width: "100%" }} />
            <Button variant="accent" onClick={onUpsert} disabled={loading}>Save field</Button>
          </div>
        </div>
      </Card>

      {fields.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--paperu-space-3)" }}>
              <span className="paperu-text-label">Saved fields ({fields.length})</span>
              <button type="button" className="paperu-btn paperu-btn--ghost" onClick={onClearAll}>Clear all</button>
            </div>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-2)" }}>
              {fields.map((f) => (
                <li key={f.id} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", padding: "var(--paperu-space-2)", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{f.label ?? f.fieldKey.replace(/_/g, " ")}</div>
                    <div className="paperu-text-code paperu-break-all paperu-text-caption" title={f.fieldValue}>{f.fieldValue}</div>
                  </div>
                  <Button variant="outline" onClick={() => copyValue(f.fieldValue, f.id)}>{copied === f.id ? "✓ Copied" : "Copy"}</Button>
                  <Button variant="ghost" onClick={() => void onRemove(f.id)}>×</Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {loading && <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>Loading…</p></div></Card>}

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
