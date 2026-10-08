/**
 * Study Packs route — organize files + notes into named packs (90% §41).
 * Pack CRUD + item management (file refs + note links). Local-only.
 */
import { useCallback, useEffect, useState } from "react";
import type { StudyPack, StudyPackItem } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { inspectFile, createStudyPack, listStudyPacks, deleteStudyPack, addStudyPackItem, listStudyPackItems, removeStudyPackItem, openPath, revealPath } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

export function StudyPacksRoute(): React.ReactNode {
  const [packs, setPacks] = useState<readonly StudyPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<StudyPack | null>(null);
  const [items, setItems] = useState<readonly StudyPackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newPackName, setNewPackName] = useState("");
  const [newPackSubject, setNewPackSubject] = useState("");
  const [newItemLabel, setNewItemLabel] = useState("");

  const loadPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPacks(await listStudyPacks());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  async function selectPack(p: StudyPack): Promise<void> {
    setSelectedPack(p);
    try {
      setItems(await listStudyPackItems(p.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCreatePack(): Promise<void> {
    if (!newPackName.trim()) { setError("Enter a pack name."); return; }
    try {
      const p = await createStudyPack({ name: newPackName.trim(), subject: newPackSubject.trim() || null });
      setNewPackName(""); setNewPackSubject("");
      await loadPacks();
      await selectPack(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeletePack(id: string): Promise<void> {
    try {
      await deleteStudyPack(id);
      if (selectedPack?.id === id) { setSelectedPack(null); setItems([]); }
      await loadPacks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onAddFileItem(): Promise<void> {
    if (!selectedPack || !newItemLabel.trim()) { setError("Enter an item label."); return; }
    try {
      const selected = await open({ multiple: false, directory: false, title: "Choose a file — Paperu" });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      await addStudyPackItem({
        packId: selectedPack.id,
        filePath: meta.path,
        fileName: meta.fileName,
        fileKind: meta.kind,
        label: newItemLabel.trim(),
      });
      setNewItemLabel("");
      setItems(await listStudyPackItems(selectedPack.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRemoveItem(id: string): Promise<void> {
    if (!selectedPack) return;
    try {
      await removeStudyPackItem(id);
      setItems(await listStudyPackItems(selectedPack.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="sp-heading">
      <header className="paperu-section__header">
        <h1 id="sp-heading" className="paperu-text-display">Study Packs</h1>
        <p className="paperu-text-lead">Organize files + notes into named packs by subject + semester. Local-only.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">New pack</span>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            <input className="paperu-target__input" placeholder="Pack name" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} />
            <input className="paperu-target__input" placeholder="Subject (optional)" value={newPackSubject} onChange={(e) => setNewPackSubject(e.target.value)} />
            <Button variant="accent" onClick={onCreatePack}>Create</Button>
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--paperu-space-4)" }}>
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Packs ({packs.length})</span>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-2)" }}>
              {packs.map((p) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", padding: "var(--paperu-space-2)", border: `1px solid ${selectedPack?.id === p.id ? "var(--paperu-accent)" : "var(--paperu-border-subtle)"}`, borderRadius: "var(--paperu-radius-2)" }}>
                  <button type="button" onClick={() => void selectPack(p)} style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }} className="paperu-truncate">{p.name}</div>
                    {p.subject && <div className="paperu-text-caption">{p.subject}{p.semester ? ` · Sem ${p.semester}` : ""}</div>}
                  </button>
                  <button type="button" onClick={() => void onDeletePack(p.id)} aria-label="Delete" className="paperu-btn paperu-btn--ghost">×</button>
                </li>
              ))}
            </ul>
            {packs.length === 0 && !loading && <p className="paperu-text-caption">No packs yet.</p>}
          </div>
        </Card>

        {selectedPack && (
          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">{selectedPack.name} — items ({items.length})</span>
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                <input className="paperu-target__input" placeholder="Item label" value={newItemLabel} onChange={(e) => setNewItemLabel(e.target.value)} style={{ flex: 1 }} />
                <Button variant="accent" onClick={onAddFileItem}>+ Add file</Button>
              </div>
              <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-2)", maxHeight: "400px", overflowY: "auto" }}>
                {items.map((item) => (
                  <li key={item.id} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", padding: "var(--paperu-space-2)", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }} className="paperu-truncate">{item.label}</div>
                      {item.fileName && <div className="paperu-text-code paperu-truncate paperu-text-caption" title={item.filePath ?? ""}>{item.fileName}</div>}
                    </div>
                    {item.filePath && <Button variant="outline" onClick={() => void openPath(item.filePath!)}>Open</Button>}
                    {item.filePath && <Button variant="ghost" onClick={() => void revealPath(item.filePath!)}>Reveal</Button>}
                    <Button variant="ghost" onClick={() => void onRemoveItem(item.id)} aria-label="Remove">×</Button>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
      </div>

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
