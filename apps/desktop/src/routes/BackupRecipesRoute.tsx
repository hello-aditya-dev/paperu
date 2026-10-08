/**
 * Backup Recipes route — persistent backup definitions + copy+verify execution (90% §54).
 * Reuses the shared copy_and_verify primitive (SHA-256, conflict-safe, source never deleted).
 */
import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { BackupRecipe, BackupRunResult } from "@paperu/contracts";
import { createBackupRecipe, listBackupRecipes, deleteBackupRecipe, runBackupRecipe, revealPath } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupRecipesRoute(): React.ReactNode {
  const [recipes, setRecipes] = useState<readonly BackupRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDest, setNewDest] = useState<string | null>(null);
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<BackupRunResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRecipes(await listBackupRecipes()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addSource(): Promise<void> {
    try {
      const selected = await open({ multiple: true, directory: false, title: "Choose source files — Paperu" });
      const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      setSourcePaths((cur) => [...cur, ...paths]);
    } catch { /* dismissed */ }
  }

  async function pickDest(): Promise<void> {
    try {
      const selected = await open({ multiple: false, directory: true, title: "Choose destination folder — Paperu" });
      if (typeof selected === "string" && selected.length > 0) setNewDest(selected);
    } catch { /* dismissed */ }
  }

  async function onCreate(): Promise<void> {
    if (!newName.trim() || sourcePaths.length === 0 || !newDest) { setError("Name, sources, and destination are required."); return; }
    try {
      await createBackupRecipe({ name: newName.trim(), sources: sourcePaths, destination: newDest });
      setNewName(""); setSourcePaths([]); setNewDest(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function onRun(id: string): Promise<void> {
    setRunning(true); setError(null); setRunResult(null);
    try {
      setRunResult(await runBackupRecipe(id));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setRunning(false); }
  }

  async function onDelete(id: string): Promise<void> {
    try { await deleteBackupRecipe(id); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <section className="paperu-section" aria-labelledby="bk-heading">
      <header className="paperu-section__header">
        <h1 id="bk-heading" className="paperu-text-display">Backup Recipes</h1>
        <p className="paperu-text-lead">Persistent backup definitions. Copy+verify (SHA-256) each source to the destination. Source is never deleted. Conflict-safe.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">New recipe</span>
          <div style={{ display: "grid", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            <input className="paperu-target__input" placeholder="Recipe name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%" }} />
            <div>
              <Button variant="outline" onClick={addSource}>+ Add source files</Button>
              {sourcePaths.length > 0 && (
                <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "2px" }}>
                  {sourcePaths.map((p, i) => <li key={i} className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)" }}>{p}</li>)}
                </ul>
              )}
            </div>
            <div>
              <Button variant="outline" onClick={pickDest}>Choose destination folder</Button>
              {newDest && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{newDest}</div>}
            </div>
            <Button variant="accent" onClick={onCreate}>Save recipe</Button>
          </div>
        </div>
      </Card>

      {recipes.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Saved recipes ({recipes.length})</span>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-3)" }}>
              {recipes.map((r) => (
                <li key={r.id} style={{ border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)", padding: "var(--paperu-space-3)" }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="paperu-text-caption">{r.sources.length} source(s) → {r.destination}</div>
                  {r.lastRun && <div className="paperu-text-caption">Last run: {r.lastRun}</div>}
                  <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
                    <Button variant="accent" onClick={() => void onRun(r.id)} disabled={running}>Run backup</Button>
                    <Button variant="outline" onClick={() => void revealPath(r.destination)}>Open dest</Button>
                    <Button variant="ghost" onClick={() => void onDelete(r.id)}>Delete</Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {runResult && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ {runResult.succeeded.length} copied</span>
              {runResult.failed.length > 0 && <span className="paperu-stamp paperu-stamp--warn">{runResult.failed.length} failed</span>}
            </div>
            <p className="paperu-text-numeric" style={{ marginTop: "var(--paperu-space-3)" }}>{formatBytes(runResult.totalBytes)} verified</p>
            {runResult.failed.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)" }}>
                {runResult.failed.map((f, i) => <li key={i} className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)", color: "var(--paperu-text-warning)" }}>✗ {f}</li>)}
              </ul>
            )}
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
