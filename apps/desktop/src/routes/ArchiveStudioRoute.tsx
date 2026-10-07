/**
 * Archive Studio — safe ZIP create, list, and extract
 * (Feature 15, Wave D §32).
 *
 * Previously a stub that only described the safety primitives. Now
 * real create/extract/list via the `zip` crate (Rust) + typed IPC.
 *
 * Extraction safety (reuses the existing Rust guards):
 *   - ZIP Slip: every entry name validated (no `..`, no absolute);
 *   - symlink escape: every destination confirmed within the base dir;
 *   - decompression bomb: suspicious ratios reported as warnings;
 *   - never overwrites existing files (collisions reported, not fatal).
 *
 * Never auto-deletes anything. Source files for create are read-only.
 */

import { useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { CreateResult, ExtractResult, ListResult } from "@paperu/contracts";
import {
  createArchive,
  extractArchive,
  listArchive,
  revealPath,
} from "@/lib/ipc";
import { pickAndInspectFiles, type PickedFile } from "@/lib/file-picker";
import { Button, Card } from "@paperu/ui";

type Mode = "list" | "extract" | "create";

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: "list", label: "List" },
  { id: "extract", label: "Extract" },
  { id: "create", label: "Create" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ArchiveStudioRoute(): React.ReactNode {
  const [mode, setMode] = useState<Mode>("list");
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  // List state.
  const [listArchivePath, setListArchivePath] = useState<string | null>(null);
  const [listResult, setListResult] = useState<ListResult | null>(null);
  // Extract state.
  const [extractArchivePath, setExtractArchivePath] = useState<string | null>(null);
  const [extractDest, setExtractDest] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  // Create state.
  const [createFiles, setCreateFiles] = useState<readonly PickedFile[]>([]);
  const [createResult, setCreateResult] = useState<{ path: string; result: CreateResult } | null>(null);

  async function pickArchive(setter: (p: string) => void): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a ZIP archive — Paperu",
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        setter(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function pickDestFolder(setter: (p: string) => void): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Choose a destination folder — Paperu",
      });
      if (typeof selected === "string" && selected.length > 0) {
        setter(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function onList(): Promise<void> {
    if (!listArchivePath) { setError("Choose an archive first."); return; }
    setProcessing(true);
    setError(null);
    setListResult(null);
    try {
      setListResult(await listArchive(listArchivePath));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function onExtract(): Promise<void> {
    if (!extractArchivePath) { setError("Choose an archive first."); return; }
    if (!extractDest) { setError("Choose a destination folder."); return; }
    setProcessing(true);
    setError(null);
    setExtractResult(null);
    try {
      setExtractResult(await extractArchive(extractArchivePath, extractDest));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function onPickForCreate(): Promise<void> {
    setError(null);
    try {
      const picked = await pickAndInspectFiles({ multiple: true });
      if (picked.length === 0) return;
      setCreateFiles((cur) => [...cur, ...picked]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCreate(): Promise<void> {
    if (createFiles.length === 0) { setError("Add files to archive first."); return; }
    setError(null);
    setProcessing(true);
    setCreateResult(null);
    try {
      // Native save dialog for the archive destination.
      const dest = await save({
        title: "Save archive as — Paperu",
        defaultPath: "paperu-archive.zip",
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      });
      if (typeof dest !== "string" || dest.length === 0) {
        setProcessing(false);
        return; // user cancelled the save dialog
      }
      // createArchive writes the zip directly to destPath (Rust side).
      // Source files are read-only — originals are never modified.
      const result = await createArchive(dest, createFiles.map((f) => f.path));
      setCreateResult({ path: dest, result });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  const totalUncompressed = useMemo(
    () => listResult?.entries.reduce((s, e) => s + e.uncompressedSize, 0) ?? 0,
    [listResult],
  );

  return (
    <section className="paperu-section" aria-labelledby="arch-heading">
      <header className="paperu-section__header">
        <h1 id="arch-heading" className="paperu-text-display">Archive Studio</h1>
        <p className="paperu-text-lead">
          Safe ZIP create, list, and extract. ZIP-Slip + decompression-bomb guards on every entry. Never overwrites existing files.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)" }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`paperu-target__preset${mode === m.id ? " is-active" : ""}`}
                onClick={() => { setMode(m.id); setError(null); }}
                aria-pressed={mode === m.id}
                style={{ padding: "var(--paperu-space-2) var(--paperu-space-3)" }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {mode === "list" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <Button variant="accent" onClick={() => void pickArchive(setListArchivePath)} disabled={processing}>Choose a ZIP archive</Button>
            {listArchivePath && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{listArchivePath}</div>}
            {listArchivePath && (
              <Button variant="accent" onClick={onList} disabled={processing} style={{ marginTop: "var(--paperu-space-3)" }}>
                {processing ? "Listing…" : "List entries"}
              </Button>
            )}
            {listResult && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <p className="paperu-text-numeric">{listResult.entries.length} entries · {formatBytes(totalUncompressed)} total</p>
                {listResult.rejected.length > 0 && (
                  <p className="paperu-text-caption" style={{ color: "var(--paperu-text-warning)" }}>⚠ {listResult.rejected.length} unsafe entry name(s) rejected (ZIP Slip)</p>
                )}
                <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", maxHeight: "300px", overflowY: "auto" }}>
                  {listResult.entries.map((e) => (
                    <li key={e.name} className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)", marginBottom: "2px" }}>
                      {e.isDirectory ? "📁 " : "📄 "}{e.name} — {formatBytes(e.uncompressedSize)}
                      {e.compressedSize > 0 ? ` (compressed ${formatBytes(e.compressedSize)})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {mode === "extract" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "grid", gap: "var(--paperu-space-3)" }}>
              <div>
                <Button variant="outline" onClick={() => void pickArchive(setExtractArchivePath)} disabled={processing}>Choose archive</Button>
                {extractArchivePath && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{extractArchivePath}</div>}
              </div>
              <div>
                <Button variant="outline" onClick={() => void pickDestFolder(setExtractDest)} disabled={processing}>Choose destination folder</Button>
                {extractDest && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{extractDest}</div>}
              </div>
              <Button variant="accent" onClick={onExtract} disabled={processing || !extractArchivePath || !extractDest}>
                {processing ? "Extracting…" : "Extract safely"}
              </Button>
            </div>
            {extractResult && (
              <div style={{ marginTop: "var(--paperu-space-4)" }}>
                <p className="paperu-text-numeric">✓ {extractResult.extracted.length} extracted · ✗ {extractResult.skipped.length} skipped</p>
                {extractResult.warnings.length > 0 && (
                  <p className="paperu-text-caption" style={{ color: "var(--paperu-text-warning)" }}>⚠ {extractResult.warnings.length} suspicious ratio warning(s)</p>
                )}
                {extractResult.skipped.length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", maxHeight: "120px", overflowY: "auto" }}>
                    {extractResult.skipped.map((s, i) => <li key={i} className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)", color: "var(--paperu-text-warning)" }}>⊘ {s}</li>)}
                  </ul>
                )}
                {extractDest && <Button variant="outline" onClick={() => void revealPath(extractDest)} style={{ marginTop: "var(--paperu-space-3)" }}>Open destination</Button>}
              </div>
            )}
          </div>
        </Card>
      )}

      {mode === "create" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <Button variant="accent" onClick={onPickForCreate} disabled={processing}>+ Add files to archive</Button>
            {createFiles.length === 0 ? (
              <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>No files yet. Add files to archive.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-2)", maxHeight: "240px", overflowY: "auto" }}>
                {createFiles.map((f, i) => (
                  <li key={`${f.path}-${i}`} className="paperu-text-code paperu-break-all paperu-truncate" style={{ fontSize: "var(--paperu-text-xs)" }}>{f.fileName}</li>
                ))}
              </ul>
            )}
            <Button variant="accent" onClick={onCreate} disabled={processing || createFiles.length === 0} style={{ marginTop: "var(--paperu-space-3)" }}>
              {processing ? "Creating…" : `Create archive (${createFiles.length} file${createFiles.length === 1 ? "" : "s"})`}
            </Button>
            {createResult && (
              <div style={{ marginTop: "var(--paperu-space-4)" }}>
                <p className="paperu-text-numeric">✓ {createResult.result.created.length} archived{createResult.result.skipped.length > 0 ? ` · ✗ ${createResult.result.skipped.length} skipped` : ""}</p>
                <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{createResult.path}</p>
                <Button variant="outline" onClick={() => void revealPath(createResult.path)} style={{ marginTop: "var(--paperu-space-3)" }}>Open folder</Button>
              </div>
            )}
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
