/**
 * PDF Notebook route — generate blank/ruled/grid/dotted PDF notebooks (90% §31, Wave 6).
 *
 * Pure frontend (pdf-lib) — no Rust needed. Generates a multi-page PDF with
 * the chosen template (blank, ruled, grid, or dotted), page size (A4/Letter),
 * + page count. Output finalized via finalizeOutput with a Save As flow.
 */

import { useState } from "react";
import { saveFileAs } from "@/lib/save-as";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { openPath, revealPath } from "@/lib/ipc";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

type Template = "blank" | "ruled" | "grid" | "dotted";
type PageSize = "a4" | "letter";

const TEMPLATES: ReadonlyArray<{ id: Template; label: string }> = [
  { id: "blank", label: "Blank" },
  { id: "ruled", label: "Ruled (lines)" },
  { id: "grid", label: "Grid" },
  { id: "dotted", label: "Dotted" },
];

const SIZES: Record<PageSize, { w: number; h: number; label: string }> = {
  a4: { w: 595.28, h: 841.89, label: "A4" },
  letter: { w: 612, h: 792, label: "Letter" },
};

export function PdfNotebookRoute(): React.ReactNode {
  const [template, setTemplate] = useState<Template>("ruled");
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [pageCount, setPageCount] = useState(10);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  async function onGenerate(): Promise<void> {
    setError(null);
    setOutputPath(null);
    setProcessing(true);
    try {
      const { w, h } = SIZES[pageSize];
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const margin = 36;
      const lineSpacing = 24;
      for (let p = 0; p < pageCount; p++) {
        const page = doc.addPage([w, h]);
        if (template === "ruled") {
          for (let y = margin; y < h - margin; y += lineSpacing) {
            page.drawLine({ start: { x: margin, y }, end: { x: w - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
          }
        } else if (template === "grid") {
          // Vertical lines.
          for (let x = margin; x < w - margin; x += lineSpacing) {
            page.drawLine({ start: { x, y: margin }, end: { x, y: h - margin }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
          }
          // Horizontal lines.
          for (let y = margin; y < h - margin; y += lineSpacing) {
            page.drawLine({ start: { x: margin, y }, end: { x: w - margin, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
          }
        } else if (template === "dotted") {
          for (let y = margin; y < h - margin; y += lineSpacing) {
            for (let x = margin; x < w - margin; x += lineSpacing) {
              page.drawCircle({ x, y, color: rgb(0.7, 0.7, 0.7), size: 0.8 });
            }
          }
        }
        // Page number (small, bottom center).
        const label = String(p + 1);
        const tw = font.widthOfTextAtSize(label, 9);
        page.drawText(label, { x: (w - tw) / 2, y: 18, size: 9, font, color: rgb(0.6, 0.6, 0.6) });
      }
      const outBytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
      // P0-A fix: use saveFileAs (writes to the EXACT user-chosen path)
      // instead of finalizeOutput (which appends a suffix).
      const result = await saveFileAs(outBytes, "paperu-notebook.pdf", [{ name: "PDF", extensions: ["pdf"] }]);
      if (!result) { return; } // user cancelled
      setOutputPath(result.outputPath);
      addRecent({
        path: result.outputPath,
        fileName: result.output.fileName,
        kind: result.output.kind,
        humanReadableSize: result.output.size.humanReadable,
        operation: `Notebook (${template}, ${SIZES[pageSize].label}, ${pageCount}p)`,
        timestamp: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="nb-heading">
      <header className="paperu-section__header">
        <h1 id="nb-heading" className="paperu-text-display">PDF Notebook</h1>
        <p className="paperu-text-lead">Generate a blank, ruled, grid, or dotted PDF notebook. Choose the page size + page count. Save As a fresh PDF.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Template</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className={`paperu-target__preset${template === t.id ? " is-active" : ""}`} onClick={() => setTemplate(t.id)} aria-pressed={template === t.id} style={{ padding: "var(--paperu-space-3)" }}>{t.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <label className="paperu-text-label">Page size</label>
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                {(["a4", "letter"] as const).map((s) => (
                  <button key={s} type="button" className={`paperu-target__preset${pageSize === s ? " is-active" : ""}`} onClick={() => setPageSize(s)} aria-pressed={pageSize === s} style={{ padding: "var(--paperu-space-3)" }}>{SIZES[s].label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="paperu-text-label" htmlFor="nb-count">Pages</label>
              <input id="nb-count" className="paperu-target__input" type="number" min={1} max={500} value={pageCount} onChange={(e) => setPageCount(Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 1)))} style={{ width: "100px", marginTop: "var(--paperu-space-2)" }} />
            </div>
          </div>
          <Button variant="accent" onClick={onGenerate} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
            {processing ? "Generating…" : `Generate ${pageCount}-page ${TEMPLATES.find((t) => t.id === template)?.label} notebook`}
          </Button>
        </div>
      </Card>

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Generated ({pageCount} pages)</span>
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
