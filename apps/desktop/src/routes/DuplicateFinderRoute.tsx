/**
 * Duplicate Finder — find exact duplicate files by content hash
 * (Feature, deepened Wave C §26).
 *
 * Previously manual folder typing + raw invoke(). Now: native folder
 * picker, typed IPC (findExactDuplicates), per-copy reveal/open,
 * per-group summary, total reclaimable space.
 *
 * Never auto-deletes (§0). The user reveals files in Explorer and
 * decides which copy to keep.
 */

import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { DuplicateGroup } from "@paperu/contracts";
import { findExactDuplicates, openPath, revealPath } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function DuplicateFinderRoute(): React.ReactNode {
  const [folder, setFolder] = useState<string | null>(null);
  const [groups, setGroups] = useState<readonly DuplicateGroup[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFolder(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Choose a folder to scan — Paperu",
      });
      if (typeof selected === "string" && selected.length > 0) {
        setFolder(selected);
        await scan(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function scan(f: string): Promise<void> {
    setProcessing(true);
    setError(null);
    setGroups([]);
    try {
      setGroups(await findExactDuplicates(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  const totalReclaimable = useMemo(
    () => groups.reduce((s, g) => s + g.potentialSpaceSaved, 0),
    [groups],
  );
  const totalDuplicateFiles = useMemo(
    () => groups.reduce((s, g) => s + g.paths.length, 0),
    [groups],
  );

  return (
    <section className="paperu-section" aria-labelledby="df-heading">
      <header className="paperu-section__header">
        <h1 id="df-heading" className="paperu-text-display">Duplicate Finder</h1>
        <p className="paperu-text-lead">
          Find exact duplicate files by content hash. Never auto-deletes — you reveal and decide which copy to keep.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pickFolder} disabled={processing}>
            {folder ? "Choose a different folder" : "Choose a folder to scan"}
          </Button>
          {folder && (
            <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{folder}</div>
          )}
        </div>
      </Card>

      {groups.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--paperu-space-3)" }}>
              <div>
                <div className="paperu-fitresult__stat-label">Duplicate groups</div>
                <div className="paperu-fitresult__stat-value paperu-text-numeric">{groups.length}</div>
              </div>
              <div>
                <div className="paperu-fitresult__stat-label">Duplicate files</div>
                <div className="paperu-fitresult__stat-value paperu-text-numeric">{totalDuplicateFiles}</div>
              </div>
              <div>
                <div className="paperu-fitresult__stat-label">Reclaimable</div>
                <div className="paperu-fitresult__stat-value paperu-text-numeric">{formatBytes(totalReclaimable)}</div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {groups.length === 0 && !processing && folder && (
        <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>No exact duplicates found in this folder.</p></div></Card>
      )}

      {groups.map((g) => (
        <Card key={g.groupId}>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--paperu-space-3)" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{g.humanReadableSize} each</div>
                <div className="paperu-text-caption paperu-text-numeric">{g.paths.length} copies · save {formatBytes(g.potentialSpaceSaved)}</div>
              </div>
            </div>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-2)" }}>
              {g.paths.map((p) => (
                <li key={p} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                  <code className="paperu-text-code paperu-break-all paperu-truncate" style={{ flex: 1, minWidth: 0 }} title={p}>{p}</code>
                  <Button variant="outline" onClick={() => void revealPath(p)}>Reveal</Button>
                  <Button variant="ghost" onClick={() => void openPath(p)}>Open</Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ))}

      {processing && (
        <Card className="paperu-progress" aria-live="polite">
          <div style={{ padding: "var(--paperu-space-5)" }}><p className="paperu-progress__stage">Hashing files…</p></div>
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
