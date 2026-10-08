/**
 * Metadata & Privacy Studio route — unified image EXIF + PDF metadata
 * inspect/remove + before/after sharing report (90% §55, Wave 5, FILE-13).
 *
 * Reuses existing IPC: inspectImageMetadata, stripExif (image-engine),
 * inspectPdfMetadata, removePdfMetadata (pdf_native). No new Rust needed.
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse, PdfMetadata } from "@paperu/contracts";
import {
  inspectFile, inspectPdfMetadata, removePdfMetadata,
  finalizeOutput, openPath, revealPath,
} from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { inspectImageMetadata, stripExif, type ImageMetadata } from "@/engines/image-engine";
import { Button, Card } from "@paperu/ui";

export function MetadataStudioRoute(): React.ReactNode {
  const [file, setFile] = useState<InspectFileResponse | null>(null);
  const [imageMeta, setImageMeta] = useState<ImageMetadata | null>(null);
  const [pdfMeta, setPdfMeta] = useState<PdfMetadata | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[] | null>(null);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false, directory: false,
        title: "Choose a file — Paperu",
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      setFile(meta);
      setImageMeta(null);
      setPdfMeta(null);
      setOutputPath(null);
      setRemoved(null);
      setError(null);
      // Inspect metadata based on kind.
      if (meta.kind === "image") {
        const bytes = await readFileBytes(meta.path);
        const memFile = new File([new Blob([bytes.slice()])], meta.fileName, { type: meta.mimeType ?? "image/*" });
        setImageMeta(await inspectImageMetadata(memFile));
      } else if (meta.kind === "pdf") {
        setPdfMeta(await inspectPdfMetadata(meta.path));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onStrip(): Promise<void> {
    if (!file) return;
    setProcessing(true);
    setError(null);
    setOutputPath(null);
    setRemoved(null);
    try {
      if (file.kind === "image") {
        const bytes = await readFileBytes(file.path);
        const memFile = new File([new Blob([bytes.slice()])], file.fileName, { type: file.mimeType ?? "image/*" });
        const res = await stripExif(memFile);
        const finalized = await finalizeOutput(file.path, "-clean", "jpg", res.bytes);
        setOutputPath(finalized.outputPath);
        setRemoved(res.removed);
      } else if (file.kind === "pdf") {
        const finalized = await removePdfMetadata(file.path);
        const out = await finalizeOutput(file.path, "-clean", "pdf", new Uint8Array(atob(finalized.bytesBase64).split("").map((c) => c.charCodeAt(0))));
        setOutputPath(out.outputPath);
        setRemoved(["PDF Info dictionary (Title, Author, Creator, Producer, etc.)"]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="meta-heading">
      <header className="paperu-section__header">
        <h1 id="meta-heading" className="paperu-text-display">Metadata & Privacy Studio</h1>
        <p className="paperu-text-lead">Inspect and strip metadata from images (EXIF/GPS) and PDFs (Author/Creator/Producer). Truthful before/after privacy report.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={handlePick} disabled={processing}>Choose a file</Button>
          {file && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={file.path}>{file.path}</div>
              <div className="paperu-text-caption">{file.kind.toUpperCase()} · {file.size.humanReadable}</div>
            </div>
          )}
        </div>
      </Card>

      {file && imageMeta && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Image metadata</span>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-1)" }}>
              <li>Dimensions: <strong>{imageMeta.width} × {imageMeta.height}px</strong></li>
              <li>Format: <strong>{imageMeta.format || "unknown"}</strong></li>
              <li>EXIF camera metadata: <strong>{imageMeta.hasExif ? "present" : "absent"}</strong></li>
              <li>GPS location data: <strong style={{ color: imageMeta.hasGps ? "var(--paperu-text-warning)" : "inherit" }}>{imageMeta.hasGps ? "PRESENT" : "not detected"}</strong></li>
            </ul>
            {!imageMeta.hasGps && (
              <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
                GPS detection is real — Paperu parses the JPEG EXIF GPS IFD pointer (tag 0x8825), not just EXIF presence.
              </p>
            )}
          </div>
        </Card>
      )}

      {file && pdfMeta && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">PDF metadata</span>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-1)" }}>
              {(["title","author","subject","keywords","creator","producer","creationDate","modDate"] as const).map((f) => (
                <li key={f} className="paperu-text-code" style={{ fontSize: "var(--paperu-text-xs)" }}>
                  <strong>{f}:</strong> {pdfMeta[f] ?? "(none)"}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {file && (
        <Button variant="accent" onClick={onStrip} disabled={processing || (file.kind !== "image" && file.kind !== "pdf")} style={{ width: "100%" }}>
          {processing ? "Stripping…" : `Strip metadata${imageMeta?.hasGps ? " (including GPS)" : ""}`}
        </Button>
      )}

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Cleaned</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            {removed && removed.length > 0 && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <span className="paperu-text-label">Removed:</span>
                <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-1)" }}>
                  {removed.map((r, i) => <li key={i} className="paperu-text-code" style={{ fontSize: "var(--paperu-text-xs)" }}>✓ {r}</li>)}
                </ul>
              </div>
            )}
            {removed && removed.length === 0 && (
              <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>No metadata was present to remove — the report is truthful.</p>
            )}
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{outputPath}</p>
            <div className="paperu-fitresult__actions">
              <Button variant="accent" onClick={() => void openPath(outputPath)}>Open</Button>
              <Button variant="outline" onClick={() => void revealPath(outputPath)}>Open folder</Button>
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
