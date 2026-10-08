/**
 * Document Scanner route — turn phone photos into clean PDFs (90% §39, Wave 4).
 *
 * Reuses the existing image-engine primitives (adjustImage for brightness/
 * contrast/grayscale/B&W, rotateImage, cropImage) + pdf-lib (merge to PDF).
 * No AI. No edge detection. Deterministic per-page adjustments.
 *
 * Pipeline: multi-image input → per-page crop/rotate/adjust → A4 PDF merge →
 * finalizeOutput(absoluteSourcePath). Source-safety §22: originals untouched.
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse } from "@paperu/contracts";
import { inspectFile, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { adjustImage, rotateImage } from "@/engines/image-engine";
import { imagesToPdf } from "@/engines/pdf-engine";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

interface ScanPage {
  meta: InspectFileResponse;
  brightness: number;
  contrast: number;
  grayscale: boolean;
  blackAndWhite: boolean;
  rotation: 0 | 90 | 180 | 270;
}

export function DocumentScannerRoute(): React.ReactNode {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  async function pickImages(): Promise<void> {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Choose document photos — Paperu",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }],
      });
      const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      if (paths.length === 0) return;
      const newPages: ScanPage[] = [];
      for (const p of paths) {
        const meta = await inspectFile(p);
        if (meta.kind === "image") {
          newPages.push({ meta, brightness: 0, contrast: 0, grayscale: false, blackAndWhite: false, rotation: 0 });
        }
      }
      setPages((cur) => [...cur, ...newPages]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updatePage(idx: number, patch: Partial<ScanPage>): void {
    setPages((cur) => cur.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function removePage(idx: number): void {
    setPages((cur) => cur.filter((_, i) => i !== idx));
  }

  async function onScan(): Promise<void> {
    if (pages.length === 0) { setError("Add photos first."); return; }
    setProcessing(true);
    setError(null);
    setOutputPath(null);
    try {
      // Process each page: read bytes → rotate → adjust → collect processed File.
      const processedFiles: File[] = [];
      for (const page of pages) {
        const bytes = await readFileBytes(page.meta.path);
        let memFile = new File([new Blob([bytes.slice()])], page.meta.fileName, { type: page.meta.mimeType ?? "image/*" });
        if (page.rotation !== 0) {
          const res = await rotateImage(memFile, page.rotation);
          memFile = new File([new Blob([res.bytes.slice()])], page.meta.fileName, { type: "image/png" });
        }
        if (page.brightness !== 0 || page.contrast !== 0 || page.grayscale || page.blackAndWhite) {
          const res = await adjustImage(memFile, {
            brightness: page.brightness,
            contrast: page.contrast,
            grayscale: page.grayscale,
            blackAndWhite: page.blackAndWhite,
          });
          memFile = new File([new Blob([res.bytes.slice()])], page.meta.fileName, { type: "image/jpeg" });
        }
        processedFiles.push(memFile);
      }
      // Merge to A4 PDF using the existing imagesToPdf engine.
      const pdfBytes = await imagesToPdf(processedFiles, { layout: "a4" });
      const firstPath = pages[0]!.meta.path;
      const finalized = await finalizeOutput(firstPath, "-scanned", "pdf", pdfBytes);
      setOutputPath(finalized.outputPath);
      addRecent({
        path: finalized.outputPath,
        fileName: finalized.output.fileName,
        kind: finalized.output.kind,
        humanReadableSize: finalized.output.size.humanReadable,
        operation: `Document scan (${pages.length} pages)`,
        timestamp: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="scan-heading">
      <header className="paperu-section__header">
        <h1 id="scan-heading" className="paperu-text-display">Document Scanner</h1>
        <p className="paperu-text-lead">Turn phone photos of documents into a clean A4 PDF. Per-page rotate + brightness/contrast/grayscale/B&W. No AI. Deterministic.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pickImages} disabled={processing}>+ Add photos</Button>
          {pages.length > 0 && <span className="paperu-text-caption" style={{ marginLeft: "var(--paperu-space-3)" }}>{pages.length} page{pages.length === 1 ? "" : "s"}</span>}
        </div>
      </Card>

      {pages.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-3)" }}>
              {pages.map((page, idx) => (
                <li key={`${page.meta.path}-${idx}`} style={{ border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)", padding: "var(--paperu-space-3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--paperu-space-2)" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }} className="paperu-truncate">{idx + 1}. {page.meta.fileName}</div>
                      <div className="paperu-text-caption">{page.meta.size.humanReadable}</div>
                    </div>
                    <button type="button" className="paperu-btn paperu-btn--ghost" onClick={() => removePage(idx)} aria-label="Remove">×</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--paperu-space-3)" }}>
                    <div>
                      <label className="paperu-text-caption">Rotate</label>
                      <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-1)" }}>
                        {([0, 90, 180, 270] as const).map((r) => (
                          <button key={r} type="button" className={`paperu-target__preset${page.rotation === r ? " is-active" : ""}`} onClick={() => updatePage(idx, { rotation: r })} aria-pressed={page.rotation === r} style={{ padding: "var(--paperu-space-2)", fontSize: "var(--paperu-text-xs)" }}>{r === 0 ? "0°" : `${r}°`}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "var(--paperu-space-3)", alignItems: "flex-end" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-1)" }}>
                        <input type="checkbox" checked={page.grayscale} onChange={(e) => updatePage(idx, { grayscale: e.target.checked })} /> <span className="paperu-text-caption">Gray</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-1)" }}>
                        <input type="checkbox" checked={page.blackAndWhite} onChange={(e) => updatePage(idx, { blackAndWhite: e.target.checked })} /> <span className="paperu-text-caption">B&W</span>
                      </label>
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span className="paperu-text-caption">Brightness</span><span className="paperu-text-numeric">{page.brightness > 0 ? `+${page.brightness}` : page.brightness}</span></div>
                      <input type="range" min={-100} max={100} value={page.brightness} onChange={(e) => updatePage(idx, { brightness: parseInt(e.target.value, 10) })} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span className="paperu-text-caption">Contrast</span><span className="paperu-text-numeric">{page.contrast > 0 ? `+${page.contrast}` : page.contrast}</span></div>
                      <input type="range" min={-100} max={100} value={page.contrast} onChange={(e) => updatePage(idx, { contrast: parseInt(e.target.value, 10) })} style={{ width: "100%" }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="accent" onClick={onScan} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
              {processing ? "Scanning…" : `Scan to PDF (${pages.length} page${pages.length === 1 ? "" : "s"})`}
            </Button>
          </div>
        </Card>
      )}

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Scanned</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
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
