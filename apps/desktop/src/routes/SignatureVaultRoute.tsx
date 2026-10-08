/**
 * Signature Vault route — local-only signature file references (90% §37).
 *
 * Stores ONLY file references + metadata (never signature image bytes).
 * Variants: full / initials / guardian / work. The user adds a signature
 * image (drawn elsewhere or uploaded via the native picker), Paperu stores
 * the reference so Sign PDF / Assignment Studio / Application Kit can reuse it.
 *
 * CRUD: Add (native picker → inspect → variant + label) / Edit (label + notes) /
 * Replace (atomic, preserves id) / Open / Reveal / Remove. Search + variant filter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InspectFileResponse } from "@paperu/contracts";
import type { SignatureItem, SignatureVariant } from "@paperu/contracts";
import { filePath } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addSignatureItem,
  inspectFile,
  listSignatureItems,
  openPath,
  removeSignatureItem,
  replaceSignatureItem,
  revealPath,
  updateSignatureItem,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

const VARIANTS: ReadonlyArray<{ id: SignatureVariant; label: string }> = [
  { id: "full", label: "Full signature" },
  { id: "initials", label: "Initials" },
  { id: "guardian", label: "Guardian" },
  { id: "work", label: "Work" },
];

const VARIANT_EXTENSIONS: Partial<Record<SignatureVariant, string[]>> = {
  full: ["png", "jpg", "jpeg", "pdf"],
  initials: ["png", "jpg", "jpeg", "pdf"],
  guardian: ["png", "jpg", "jpeg", "pdf"],
  work: ["png", "jpg", "jpeg", "pdf"],
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function SignatureVaultRoute(): React.ReactNode {
  const [items, setItems] = useState<readonly SignatureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterVariant, setFilterVariant] = useState<SignatureVariant | "all">("all");
  const [addDraft, setAddDraft] = useState<{ meta: InspectFileResponse; variant: SignatureVariant; label: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listSignatureItems());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickForAdd(variant: SignatureVariant): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Choose a ${variant} signature — Paperu`,
        filters: [{ name: "Signature", extensions: VARIANT_EXTENSIONS[variant] ?? ["png", "jpg", "pdf"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      setAddDraft({
        meta,
        variant,
        label: meta.fileName.replace(/\.[^.]+$/, ""),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmAdd(): Promise<void> {
    if (!addDraft || !addDraft.label.trim()) {
      setError("Give this signature a label.");
      return;
    }
    try {
      await addSignatureItem({
        label: addDraft.label.trim(),
        variant: addDraft.variant,
        filePath: filePath(addDraft.meta.path),
        fileName: addDraft.meta.fileName,
        fileKind: addDraft.meta.kind === "pdf" || addDraft.meta.kind === "image" ? addDraft.meta.kind : "other",
        mimeType: addDraft.meta.mimeType ?? null,
        sizeBytes: addDraft.meta.size.bytes,
      });
      setAddDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function replace(item: SignatureItem): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Replace ${item.label} — Paperu`,
        filters: [{ name: "Signature", extensions: VARIANT_EXTENSIONS[item.variant] ?? ["png", "jpg", "pdf"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      await replaceSignatureItem(item.id, {
        label: item.label,
        variant: item.variant,
        filePath: meta.path,
        fileName: meta.fileName,
        fileKind: meta.kind === "pdf" || meta.kind === "image" ? meta.kind : "other",
        mimeType: meta.mimeType ?? null,
        sizeBytes: meta.size.bytes,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startEdit(item: SignatureItem): void {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditNotes(item.notes ?? "");
  }

  async function saveEdit(id: string): Promise<void> {
    try {
      await updateSignatureItem({ id, label: editLabel.trim(), notes: editNotes.trim() || null });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRemove(id: string): Promise<void> {
    try {
      await removeSignatureItem(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filterVariant !== "all" && i.variant !== filterVariant) return false;
      if (!q) return true;
      return i.label.toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q);
    });
  }, [items, search, filterVariant]);

  return (
    <section className="paperu-section" aria-labelledby="sig-heading">
      <header className="paperu-section__header">
        <h1 id="sig-heading" className="paperu-text-display">Signature Vault</h1>
        <p className="paperu-text-lead">
          Your local-only signature references. Stored on this PC — never uploaded. Reusable in Sign PDF, Assignment Studio, and Application Kit.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Add a signature</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            {VARIANTS.map((v) => (
              <Button key={v.id} variant="outline" onClick={() => void pickForAdd(v.id)} disabled={loading}>{`+ ${v.label}`}</Button>
            ))}
          </div>
        </div>
      </Card>

      {items.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
              <input className="paperu-target__input" placeholder="Search by label or filename…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: "200px" }} aria-label="Search signatures" />
              <select className="paperu-target__input" value={filterVariant} onChange={(e) => setFilterVariant(e.target.value as SignatureVariant | "all")} aria-label="Filter by variant">
                <option value="all">All variants</option>
                {VARIANTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
          </div>
        </Card>
      )}

      {filtered.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-3)" }}>
              {filtered.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <li key={item.id} style={{ border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)", padding: "var(--paperu-space-3)" }}>
                    {isEditing ? (
                      <div style={{ display: "grid", gap: "var(--paperu-space-2)" }}>
                        <input className="paperu-target__input" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" style={{ width: "100%" }} />
                        <textarea className="paperu-target__input" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes" rows={2} style={{ width: "100%" }} />
                        <div style={{ display: "flex", gap: "var(--paperu-space-2)" }}>
                          <Button variant="accent" onClick={() => void saveEdit(item.id)}>Save</Button>
                          <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--paperu-space-3)" }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600 }} className="paperu-truncate">{item.label}</div>
                            <div className="paperu-text-code paperu-break-all paperu-text-caption" title={item.filePath}>{item.filePath}</div>
                            <div className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)" }}>
                              {VARIANTS.find((v) => v.id === item.variant)?.label ?? item.variant} · {item.fileKind.toUpperCase()}{item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}
                            </div>
                            {item.notes && <div className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)" }}>{item.notes}</div>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap" }}>
                          <Button variant="outline" onClick={() => void openPath(item.filePath)}>Open</Button>
                          <Button variant="outline" onClick={() => void revealPath(item.filePath)}>Reveal</Button>
                          <Button variant="outline" onClick={() => startEdit(item)}>Edit</Button>
                          <Button variant="outline" onClick={() => void replace(item)}>Replace file</Button>
                          <Button variant="ghost" onClick={() => void onRemove(item.id)}>Remove</Button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {loading && <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>Loading…</p></div></Card>}
      {filtered.length === 0 && !loading && items.length > 0 && (
        <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>No signatures match your search.</p></div></Card>
      )}

      {addDraft && (
        <Card role="dialog" aria-label="Add signature">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-text-label">{VARIANTS.find((v) => v.id === addDraft.variant)?.label}</h2>
            <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{addDraft.meta.path}</div>
            <div className="paperu-text-caption">{addDraft.meta.kind.toUpperCase()}{addDraft.meta.size ? ` · ${formatBytes(addDraft.meta.size.bytes)}` : ""}</div>
            <input className="paperu-target__input" value={addDraft.label} onChange={(e) => setAddDraft({ ...addDraft, label: e.target.value })} placeholder="Label" style={{ width: "100%", marginTop: "var(--paperu-space-3)" }} autoFocus />
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-4)" }}>
              <Button variant="accent" onClick={() => void confirmAdd()}>Save reference</Button>
              <Button variant="ghost" onClick={() => setAddDraft(null)}>Cancel</Button>
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
