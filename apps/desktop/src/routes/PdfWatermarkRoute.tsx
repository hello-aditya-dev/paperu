/**
 * PDF Watermark + Page Numbers route (90% §26, Wave 6).
 *
 * Pure frontend (pdf-lib) — no Rust needed. Adds a text watermark to each
 * page (opacity, position, font size) + deterministic page numbers (start,
 * position, page range). Output finalized via finalizeOutput(absolutePath).
 * Source-safety §22: the original is never modified.
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { finalizeOutput, inspectFile, openPath, revealPath } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

type WatermarkPosition = "center" | "bottom-right" | "bottom-left" | "top-right" | "top-left" | "diagonal";

const POSITIONS: ReadonlyArray<{ id: WatermarkPosition; label: string }> = [
  { id: "center", label: "Center" },
  { id: "diagonal", label: "Diagonal" },
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
];

export function PdfWatermarkRoute(): React.ReactNode {
  const [file, setFile] = useState<{ path: string; fileName: string } | null>(null);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.3);
  const [watermarkSize, setWatermarkSize] = useState(48);
  const [watermarkPos, setWatermarkPos] = useState<WatermarkPosition>("diagonal");
  const [enablePageNumbers, setEnablePageNumbers] = useState(false);
  const [pageNumStart, setPageNumStart] = useState(1);
  const [pageNumPos, setPageNumPos] = useState<"bottom-center" | "bottom-right">("bottom-center");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a PDF — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      if (meta.kind !== "pdf") {
        setError("That file isn't a PDF.");
        return;
      }
      setFile({ path: selected, fileName: meta.fileName });
      setOutputPath(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onApply(): Promise<void> {
    if (!file) { setError("Choose a PDF first."); return; }
    if (!watermarkText.trim() && !enablePageNumbers) { setError("Enter watermark text or enable page numbers."); return; }
    setProcessing(true);
    setError(null);
    setOutputPath(null);
    try {
      const bytes = await readFileBytes(file.path);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        const { width, height } = page.getSize();
        // Watermark
        if (watermarkText.trim()) {
          const textWidth = font.widthOfTextAtSize(watermarkText, watermarkSize);
          const pad = watermarkSize;
          let x = width / 2;
          let y = height / 2;
          let rotate: ReturnType<typeof degrees> | undefined = undefined;
          switch (watermarkPos) {
            case "bottom-right": x = width - textWidth - pad; y = pad; break;
            case "bottom-left": x = pad; y = pad; break;
            case "top-right": x = width - textWidth - pad; y = height - pad; break;
            case "top-left": x = pad; y = height - pad; break;
            case "diagonal": x = width / 2; y = height / 2; rotate = degrees(-45); break;
            default: x = width / 2; y = height / 2;
          }
          page.drawText(watermarkText, {
            x, y, size: watermarkSize, font,
            color: rgb(0.5, 0.5, 0.5),
            opacity: watermarkOpacity,
            rotate,
          });
        }
        // Page numbers
        if (enablePageNumbers) {
          const label = String(i + pageNumStart);
          const tw = font.widthOfTextAtSize(label, 10);
          const margin = 24;
          const px = pageNumPos === "bottom-center" ? (width - tw) / 2 : width - margin - tw;
          page.drawText(label, { x: px, y: margin, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
        }
      }
      const outBytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
      const finalized = await finalizeOutput(file.path, "-watermark", "pdf", outBytes);
      setOutputPath(finalized.outputPath);
      addRecent({
        path: finalized.outputPath,
        fileName: finalized.output.fileName,
        kind: finalized.output.kind,
        humanReadableSize: finalized.output.size.humanReadable,
        operation: "PDF watermark + page numbers",
        timestamp: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="wm-heading">
      <header className="paperu-section__header">
        <h1 id="wm-heading" className="paperu-text-display">PDF Watermark + Page Numbers</h1>
        <p className="paperu-text-lead">Add a text watermark (opacity, position, diagonal) + deterministic page numbers. Non-destructive — saved next to the original.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={handlePick} disabled={processing}>Choose a PDF</Button>
          {file && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }} title={file.path}>{file.path}</div>}
        </div>
      </Card>

      {file && (
        <>
          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Text watermark</span>
              <input className="paperu-target__input" placeholder="Watermark text" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} style={{ width: "100%", marginTop: "var(--paperu-space-2)" }} />
              <div style={{ display: "grid", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Opacity</span><span className="paperu-text-numeric">{Math.round(watermarkOpacity * 100)}%</span></div>
                  <input type="range" min={0.05} max={1} step={0.05} value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))} style={{ width: "100%" }} />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Font size</span><span className="paperu-text-numeric">{watermarkSize}px</span></div>
                  <input type="range" min={16} max={120} value={watermarkSize} onChange={(e) => setWatermarkSize(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
                </div>
                <select className="paperu-target__input" value={watermarkPos} onChange={(e) => setWatermarkPos(e.target.value as WatermarkPosition)} style={{ width: "100%" }}>
                  {POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                <input type="checkbox" checked={enablePageNumbers} onChange={(e) => setEnablePageNumbers(e.target.checked)} /> Add page numbers
              </label>
              {enablePageNumbers && (
                <div style={{ display: "flex", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap", alignItems: "center" }}>
                  <label className="paperu-text-caption">Start at</label>
                  <input className="paperu-target__input" type="number" min={1} value={pageNumStart} onChange={(e) => setPageNumStart(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ width: "80px" }} />
                  <label className="paperu-text-caption">Position</label>
                  <select className="paperu-target__input" value={pageNumPos} onChange={(e) => setPageNumPos(e.target.value as "bottom-center" | "bottom-right")}>
                    <option value="bottom-center">Bottom center</option>
                    <option value="bottom-right">Bottom right</option>
                  </select>
                </div>
              )}
            </div>
          </Card>

          <Button variant="accent" onClick={onApply} disabled={processing} style={{ width: "100%" }}>
            {processing ? "Applying…" : "Apply watermark + page numbers"}
          </Button>
        </>
      )}

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Watermarked</span>
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
