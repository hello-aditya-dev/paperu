/**
 * Downloads Cleaner — scan, categorize, and tidy a folder
 * (Feature, deepened Wave C §25).
 *
 * Previously a bare list with manual folder typing + raw invoke().
 * Now: native folder picker, typed IPC (scanDownloadsFolder),
 * category filter, per-file reveal/open, and a summary (total size,
 * largest file, file count).
 *
 * Never auto-deletes (§0). The user chooses what to remove — Paperu
 * only reveals files in the native Explorer so the decision is theirs.
 */

import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { FileEntry } from "@paperu/contracts";
import { openPath, revealPath, scanDownloadsFolder } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function DownloadsCleanerRoute(): React.ReactNode {
  const [folder, setFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

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
    setFiles([]);
    setFilter("all");
    setSearch("");
    try {
      setFiles(await scanDownloadsFolder(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  const categories = useMemo(
    () => [...new Set(files.map((f) => f.category))].sort(),
    [files],
  );
  const totalSize = useMemo(() => files.reduce((s, f) => s + f.sizeBytes, 0), [files]);
  const largest = useMemo(
    () => files.reduce<FileEntry | null>((m, f) => (!m || f.sizeBytes > m.sizeBytes ? f : m), null),
    [files],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (filter !== "all" && f.category !== filter) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q);
    });
  }, [files, filter, search]);

  return (
    <section className="paperu-section" aria-labelledby="dc-heading">
      <header className="paperu-section__header">
        <h1 id="dc-heading" className="paperu-text-display">Downloads Cleaner</h1>
        <p className="paperu-text-lead">
          Scan a folder, see what's taking space, reveal files to decide. Never auto-deletes — you choose.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pickFolder} disabled={processing}>
            {folder ? "Choose a different folder" : "Choose a folder to scan"}
          </Button>
          {folder && (
            <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>
              {folder}
            </div>
          )}
          {folder && (
            <Button variant="outline" onClick={() => void scan(folder)} disabled={processing} style={{ marginTop: "var(--paperu-space-3)" }}>
              Re-scan
            </Button>
          )}
        </div>
      </Card>

      {files.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--paperu-space-3)" }}>
              <div>
                <div className="paperu-fitresult__stat-label">Files</div>
                <div className="paperu-fitresult__stat-value paperu-text-numeric">{files.length}</div>
              </div>
              <div>
                <div className="paperu-fitresult__stat-label">Total size</div>
                <div className="paperu-fitresult__stat-value paperu-text-numeric">{formatBytes(totalSize)}</div>
              </div>
              <div>
                <div className="paperu-fitresult__stat-label">Largest</div>
                <div className="paperu-text-code paperu-truncate" title={largest?.path ?? ""}>{largest?.name ?? "—"}</div>
                <div className="paperu-text-caption paperu-text-numeric">{largest ? formatBytes(largest.sizeBytes) : ""}</div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {files.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
              <input
                className="paperu-target__input"
                placeholder="Search by filename…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: "200px" }}
                aria-label="Search files"
              />
              <select
                className="paperu-target__input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </Card>
      )}

      {filtered.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-2)", maxHeight: "400px", overflowY: "auto" }}>
              {filtered.map((f) => (
                <li key={f.path} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", padding: "var(--paperu-space-2)", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="paperu-truncate" style={{ fontWeight: 500 }} title={f.path}>{f.name}</div>
                    <div className="paperu-text-caption paperu-text-numeric">{f.category} · {f.humanReadableSize} · {f.modifiedAt}</div>
                  </div>
                  <Button variant="outline" onClick={() => void revealPath(f.path)}>Reveal</Button>
                  <Button variant="ghost" onClick={() => void openPath(f.path)}>Open</Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {processing && (
        <Card className="paperu-progress" aria-live="polite">
          <div style={{ padding: "var(--paperu-space-5)" }}><p className="paperu-progress__stage">Scanning…</p></div>
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
