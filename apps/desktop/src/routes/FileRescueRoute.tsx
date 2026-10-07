/**
 * File Rescue — diagnose damaged files + real conservative recovery
 * (Feature, deepened Wave C §27).
 *
 * Previously: raw invoke() for diagnosis only, no recovery action.
 * Now: typed IPC (diagnoseFile), and a REAL recovery action —
 * "Save a fresh copy" which re-encodes the file to produce a clean
 * version next to the original (original untouched, source-safety §22).
 *
 * Recovery strategy by kind:
 *   image — re-encode via canvas (stripExif path produces a clean JPEG)
 *   pdf   — load + re-save via pdf-lib (can repair broken xref tables)
 *   other — re-save the raw bytes (best-effort)
 *
 * Conservative: if recovery can't help, the diagnosis says so honestly.
 */

import { useState } from "react";
import type { RescueDiagnosis } from "@paperu/contracts";
import { PDFDocument } from "pdf-lib";
import { pickAndInspectFiles, readFileBytes, type PickedFile } from "@/lib/file-picker";
import { diagnoseFile, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { stripExif } from "@/engines/image-engine";
import { Button, Card } from "@paperu/ui";

interface RecoveryResult {
  outputPath: string;
  strategy: string;
}

export function FileRescueRoute(): React.ReactNode {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [diagnosis, setDiagnosis] = useState<RescueDiagnosis | null>(null);
  const [processing, setProcessing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null);

  async function pick(): Promise<void> {
    setError(null);
    setRecovery(null);
    try {
      const picked = await pickAndInspectFiles({ multiple: false });
      if (picked.length === 0) return;
      const p = picked[0]!;
      setFile(p);
      setDiagnosis(null);
      setProcessing(true);
      try {
        const d = await diagnoseFile(p.path);
        setDiagnosis(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setProcessing(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function attemptRecovery(): Promise<void> {
    if (!file || !diagnosis) return;
    setRecovering(true);
    setError(null);
    setRecovery(null);
    try {
      const bytes = await readFileBytes(file.path);
      let outBytes: Uint8Array;
      let ext: string;
      let strategy: string;
      if (diagnosis.fileKind === "image" || file.kind === "image") {
        // Re-encode via canvas — often salvages truncated EXIF.
        const memFile = new File([new Blob([bytes.slice()])], file.fileName, { type: file.mimeType ?? "image/*" });
        const res = await stripExif(memFile);
        outBytes = res.bytes;
        ext = "jpg";
        strategy = "re-encoded image (canvas)";
      } else if (diagnosis.fileKind === "pdf" || file.kind === "pdf") {
        // pdf-lib load + save can repair broken xref tables.
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        outBytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
        ext = "pdf";
        strategy = "re-saved PDF (pdf-lib)";
      } else {
        // Best-effort: re-save the raw bytes.
        outBytes = bytes;
        ext = file.fileName.split(".").pop() ?? "bin";
        strategy = "re-saved raw bytes";
      }
      const out = await finalizeOutput(file.path, "-rescued", ext, outBytes);
      setRecovery({ outputPath: out.outputPath, strategy });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecovering(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="fr-heading">
      <header className="paperu-section__header">
        <h1 id="fr-heading" className="paperu-text-display">File Rescue</h1>
        <p className="paperu-text-lead">
          Diagnose a damaged file, then save a fresh re-encoded copy next to it. The original is never modified.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pick} disabled={processing || recovering}>
            {processing ? "Diagnosing…" : "Choose a file to diagnose"}
          </Button>
          {file && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={file.path}>{file.path}</div>
              <div className="paperu-text-caption">{file.kind.toUpperCase()} · {file.size} bytes</div>
            </div>
          )}
        </div>
      </Card>

      {diagnosis && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Diagnosis</span>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-2)" }}>
              <li>Detected kind: <strong>{diagnosis.fileKind}</strong></li>
              <li>Status: <strong>{diagnosis.status}</strong></li>
              <li>{diagnosis.message}</li>
            </ul>
            {diagnosis.recoverable ? (
              <div style={{ marginTop: "var(--paperu-space-4)" }}>
                <Button variant="accent" onClick={attemptRecovery} disabled={recovering}>
                  {recovering ? "Recovering…" : "Save a fresh copy"}
                </Button>
                <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
                  Paperu re-encodes the file and saves a clean copy next to the original. The original stays untouched.
                </p>
              </div>
            ) : (
              <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>
                This file type can't be recovered by re-encoding. The original is preserved.
              </p>
            )}
          </div>
        </Card>
      )}

      {recovery && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Fresh copy saved</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>Strategy: {recovery.strategy}</p>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{recovery.outputPath}</p>
            <div className="paperu-fitresult__actions">
              <Button variant="accent" onClick={() => void openPath(recovery.outputPath)}>Open</Button>
              <Button variant="outline" onClick={() => void revealPath(recovery.outputPath)}>Open folder</Button>
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
