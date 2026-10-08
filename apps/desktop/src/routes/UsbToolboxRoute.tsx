/**
 * USB / Drive Toolbox route — copy with SHA-256 verification (90% §52-53).
 *
 * Uses the shared copy_and_verify primitive (src/filesystem/copy_verify.rs):
 *   source → temp → stream copy → SHA-256 source + temp → compare → atomic rename.
 * Conflict-safe (default Rename, never overwrites). Source is never modified.
 *
 * V1 synchronous (progress/cancel arrive with the task-engine integration).
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { CopyVerifyResult } from "@paperu/contracts";
import { inspectFile, copyAndVerifyFile, revealPath } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function UsbToolboxRoute(): React.ReactNode {
  const [source, setSource] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<number | null>(null);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<"rename" | "skip">("rename");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopyVerifyResult | null>(null);

  async function pickSource(): Promise<void> {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a file to copy — Paperu",
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      setSource(selected);
      setSourceName(meta.fileName);
      setSourceSize(meta.size.bytes);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pickDestDir(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Choose a destination folder — Paperu",
      });
      if (typeof selected === "string" && selected.length > 0) {
        setDestDir(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function onCopy(): Promise<void> {
    if (!source || !sourceName || !destDir) {
      setError("Choose a source file and a destination folder.");
      return;
    }
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      const res = await copyAndVerifyFile({
        source,
        destDir: destDir,
        fileName: sourceName,
        conflictPolicy,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="usb-heading">
      <header className="paperu-section__header">
        <h1 id="usb-heading" className="paperu-text-display">USB / Drive Toolbox</h1>
        <p className="paperu-text-lead">
          Copy a file to any drive or folder with SHA-256 verification. Conflict-safe (never overwrites by default). The source is never modified.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pickSource} disabled={processing}>Choose source file</Button>
          {source && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={source}>{source}</div>
              <div className="paperu-text-caption paperu-text-numeric">{sourceName}{sourceSize != null ? ` · ${formatBytes(sourceSize)}` : ""}</div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="outline" onClick={pickDestDir} disabled={processing}>Choose destination folder</Button>
          {destDir && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{destDir}</div>}
          <div style={{ marginTop: "var(--paperu-space-3)" }}>
            <span className="paperu-text-label">If a file with the same name exists</span>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
              <button type="button" className={`paperu-target__preset${conflictPolicy === "rename" ? " is-active" : ""}`} onClick={() => setConflictPolicy("rename")} aria-pressed={conflictPolicy === "rename"} style={{ padding: "var(--paperu-space-3)" }}>Rename (safe)</button>
              <button type="button" className={`paperu-target__preset${conflictPolicy === "skip" ? " is-active" : ""}`} onClick={() => setConflictPolicy("skip")} aria-pressed={conflictPolicy === "skip"} style={{ padding: "var(--paperu-space-3)" }}>Skip</button>
            </div>
          </div>
        </div>
      </Card>

      <Button variant="accent" onClick={onCopy} disabled={processing || !source || !destDir} style={{ width: "100%" }}>
        {processing ? "Copying + verifying…" : "Copy + verify"}
      </Button>

      {result && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className={`paperu-stamp ${result.verified ? "paperu-stamp--success" : "paperu-stamp--warn"}`}>
                {result.verified ? "✓ Verified" : "⚠ Mismatch"}
              </span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-1)" }}>
              <li>Copied: {formatBytes(result.bytesCopied)}</li>
              <li className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)" }}>Source SHA-256: {result.sourceHash}</li>
              <li className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)" }}>Dest SHA-256: {result.destHash}</li>
            </ul>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{result.destination}</p>
            <Button variant="outline" onClick={() => void revealPath(result.destination)} style={{ marginTop: "var(--paperu-space-3)" }}>Open destination</Button>
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
