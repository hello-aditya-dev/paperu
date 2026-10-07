/**
 * Application Kit route — the user's reusable personal documents
 * (Master Prompt 4 §18-22, Wave A §15).
 *
 * Previously this route only listed + removed items. The backend
 * already had full CRUD (add/list/update/remove). This rewrite gives
 * the UI real capability:
 *
 *   Add    — native picker → real metadata → choose kind + label → save
 *   Edit   — label + notes (the fields the Update contract allows;
 *            kind is set at add-time, so to change kind, remove+re-add)
 *   Replace— native picker → remove old reference + add new (preserves
 *            label + notes across the swap; the Update contract doesn't
 *            expose filePath, so Replace is implemented as swap)
 *   Open   — openPath (native default application)
 *   Reveal — revealPath (native Explorer/Finder)
 *   Search — text filter on label/fileName
 *   Filter — category filter (by kind)
 *   Missing— inspect each path on load; files that disappeared show
 *            "File missing" with a Replace action, not a broken button.
 *
 * Privacy (§19, §76): NEVER stores document bytes — only file
 * references + metadata. Everything stays on this PC.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AddApplicationKitItemRequest,
  ApplicationKitItem,
  ApplicationKitItemKind,
} from "@paperu/contracts";
import { filePath } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addApplicationKitItem,
  inspectFile,
  listApplicationKitItems,
  openPath,
  removeApplicationKitItem,
  replaceApplicationKitItem,
  revealPath,
  updateApplicationKitItem,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

const KIND_LABELS: Record<ApplicationKitItemKind, string> = {
  photo: "Photo",
  signature: "Signature",
  initials: "Initials",
  resume: "Resume",
  id: "ID document",
  marksheet: "Marksheet",
  certificate: "Certificate",
  other: "Other",
};

const KIND_ORDER: ApplicationKitItemKind[] = [
  "photo", "signature", "initials", "resume", "id", "marksheet", "certificate", "other",
];

const KIND_EXTENSIONS: Record<ApplicationKitItemKind, string[]> = {
  photo: ["jpg", "jpeg", "png", "webp"],
  signature: ["jpg", "jpeg", "png", "pdf"],
  initials: ["jpg", "jpeg", "png", "pdf"],
  resume: ["pdf", "doc", "docx"],
  id: ["pdf", "jpg", "jpeg", "png"],
  marksheet: ["pdf", "jpg", "jpeg", "png"],
  certificate: ["pdf", "jpg", "jpeg", "png"],
  other: ["pdf", "jpg", "jpeg", "png", "doc", "docx"],
};

interface AddDraft {
  filePath: string;
  fileName: string;
  fileKind: "pdf" | "image" | "other";
  mimeType: string | null;
  sizeBytes: number | null;
  kind: ApplicationKitItemKind;
  label: string;
  notes: string;
}

export function ApplicationKitRoute(): React.ReactNode {
  const [items, setItems] = useState<readonly ApplicationKitItem[]>([]);
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<AddDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<ApplicationKitItemKind | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listApplicationKitItems();
      setItems(list);
      // Probe each path to detect missing files (master prompt §15).
      // inspectFile throws FileNotFound when the file is gone.
      const missing = new Set<string>();
      await Promise.all(list.map(async (item) => {
        try {
          await inspectFile(item.filePath);
        } catch {
          missing.add(item.filePath);
        }
      }));
      setMissingPaths(missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickForAdd(kind: ApplicationKitItemKind): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Choose a ${KIND_LABELS[kind].toLowerCase()} — Paperu`,
        filters: [{ name: KIND_LABELS[kind], extensions: KIND_EXTENSIONS[kind] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      // Inspect to get real metadata (magic-byte kind, size, mime).
      const meta = await inspectFile(selected);
      setAddDraft({
        filePath: selected,
        fileName: meta.fileName,
        fileKind: meta.kind === "pdf" || meta.kind === "image" ? meta.kind : "other",
        mimeType: meta.mimeType ?? null,
        sizeBytes: meta.size.bytes,
        kind,
        label: meta.fileName.replace(/\.[^.]+$/, ""),
        notes: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmAdd(): Promise<void> {
    if (!addDraft) return;
    if (!addDraft.label.trim()) {
      setError("Give this item a label.");
      return;
    }
    try {
      const req: AddApplicationKitItemRequest = {
        kind: addDraft.kind,
        label: addDraft.label.trim(),
        filePath: filePath(addDraft.filePath),
        fileName: addDraft.fileName,
        fileKind: addDraft.fileKind,
        mimeType: addDraft.mimeType,
        sizeBytes: addDraft.sizeBytes,
        notes: addDraft.notes.trim() || null,
      };
      await addApplicationKitItem(req);
      setAddDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRemove(id: string): Promise<void> {
    try {
      await removeApplicationKitItem(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function startEdit(item: ApplicationKitItem): void {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditNotes(item.notes ?? "");
  }

  async function saveEdit(id: string): Promise<void> {
    try {
      await updateApplicationKitItem({
        id,
        label: editLabel.trim(),
        notes: editNotes.trim() || null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function replace(item: ApplicationKitItem): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Replace ${item.label} — Paperu`,
        filters: [{ name: KIND_LABELS[item.kind], extensions: KIND_EXTENSIONS[item.kind] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      // ATOMIC REPLACE (90% §7): a single transactional UPDATE replaces
      // the file reference + preserves the id. No remove-then-add gap —
      // if this fails, the original item is unchanged.
      await replaceApplicationKitItem(item.id, {
        kind: item.kind,
        label: item.label,
        filePath: meta.path,
        fileName: meta.fileName,
        fileKind: meta.kind === "pdf" || meta.kind === "image" ? meta.kind : "other",
        mimeType: meta.mimeType ?? null,
        sizeBytes: meta.size.bytes,
        notes: item.notes ?? null,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filterKind !== "all" && i.kind !== filterKind) return false;
      if (!q) return true;
      return i.label.toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q);
    });
  }, [items, search, filterKind]);

  const grouped = useMemo(
    () => KIND_ORDER.map((kind) => ({
      kind,
      label: KIND_LABELS[kind],
      items: filtered.filter((i) => i.kind === kind),
    })).filter((g) => g.items.length > 0),
    [filtered],
  );

  const presentKinds = useMemo(
    () => KIND_ORDER.filter((k) => items.some((i) => i.kind === k)),
    [items],
  );

  return (
    <section className="paperu-section" aria-labelledby="kit-heading">
      <header className="paperu-section__header">
        <h1 id="kit-heading" className="paperu-text-display">My application kit</h1>
        <p className="paperu-text-lead">
          Photos, signatures, and documents you reuse. Stored as references on this PC — never copied into a database.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Add a new item</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            {KIND_ORDER.map((k) => (
              <Button key={k} variant="outline" onClick={() => void pickForAdd(k)}>+ {KIND_LABELS[k]}</Button>
            ))}
          </div>
        </div>
      </Card>

      {items.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
              <input
                className="paperu-target__input"
                placeholder="Search by label or filename…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: "200px" }}
                aria-label="Search kit items"
              />
              <select
                className="paperu-target__input"
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value as ApplicationKitItemKind | "all")}
                aria-label="Filter by category"
              >
                <option value="all">All categories</option>
                {presentKinds.map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k]}</option>
                ))}
              </select>
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

      {loading ? (
        <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>Loading…</p></div></Card>
      ) : grouped.length === 0 ? (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>{items.length === 0 ? "Add a photo, signature, or document you want to reuse. Everything stays on this computer." : "No items match your search."}</p>
          </div>
        </Card>
      ) : (
        grouped.map((g) => (
          <Card key={g.kind}>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <h2 className="paperu-text-label" style={{ marginBottom: "var(--paperu-space-3)" }}>{g.label}</h2>
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-3)" }}>
                {g.items.map((item) => {
                  const isMissing = missingPaths.has(item.filePath);
                  const isEditing = editingId === item.id;
                  return (
                    <li key={item.id} style={{ border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)", padding: "var(--paperu-space-3)" }}>
                      {isEditing ? (
                        <div style={{ display: "grid", gap: "var(--paperu-space-2)" }}>
                          <input
                            className="paperu-target__input"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Label"
                            style={{ width: "100%" }}
                          />
                          <textarea
                            className="paperu-target__input"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            rows={2}
                            style={{ width: "100%" }}
                          />
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
                              <div className="paperu-text-code paperu-break-all paperu-text-caption" style={{ marginTop: "2px" }} title={item.filePath}>{item.filePath}</div>
                              {item.notes && <div className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)" }}>{item.notes}</div>}
                              {isMissing ? (
                                <div className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)", color: "var(--paperu-text-warning)" }}>
                                  ⚠ File missing — replace it to use this item again.
                                </div>
                              ) : (
                                <div className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)" }}>
                                  {item.fileKind.toUpperCase()} · {item.sizeBytes ? formatBytes(item.sizeBytes) : "—"}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap" }}>
                            {!isMissing && <Button variant="outline" onClick={() => void openPath(item.filePath)}>Open</Button>}
                            {!isMissing && <Button variant="outline" onClick={() => void revealPath(item.filePath)}>Reveal</Button>}
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
        ))
      )}

      {addDraft && (
        <Card className="paperu-error" role="dialog" aria-label="Add kit item">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-text-label">Add {KIND_LABELS[addDraft.kind]}</h2>
            <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{addDraft.filePath}</div>
            <div className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)" }}>
              {addDraft.fileKind.toUpperCase()} · {addDraft.sizeBytes ? formatBytes(addDraft.sizeBytes) : "—"}
            </div>
            <label className="paperu-text-label" style={{ display: "block", marginTop: "var(--paperu-space-3)" }}>Label</label>
            <input
              className="paperu-target__input"
              value={addDraft.label}
              onChange={(e) => setAddDraft({ ...addDraft, label: e.target.value })}
              style={{ width: "100%", marginTop: "var(--paperu-space-1)" }}
              autoFocus
            />
            <label className="paperu-text-label" style={{ display: "block", marginTop: "var(--paperu-space-3)" }}>Notes (optional)</label>
            <textarea
              className="paperu-target__input"
              value={addDraft.notes}
              onChange={(e) => setAddDraft({ ...addDraft, notes: e.target.value })}
              rows={2}
              style={{ width: "100%", marginTop: "var(--paperu-space-1)" }}
            />
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-4)" }}>
              <Button variant="accent" onClick={() => void confirmAdd()}>Save reference</Button>
              <Button variant="ghost" onClick={() => setAddDraft(null)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
