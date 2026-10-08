/**
 * Passport / College Photo Studio route (90% §35, Wave 4).
 *
 * Reuses image-engine primitives (cropImage, resizeImage, convertImage) +
 * pdf-lib (A4 print sheet with multiple copies). No AI background.
 * No fake official presets. Generic descriptive presets only.
 *
 * Pipeline: image input → crop to aspect → resize to exact dimensions →
 * convert to JPG → optional A4 print sheet (2×3, 3×4, 4×6 grid) →
 * finalizeOutput(absoluteSourcePath).
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse } from "@paperu/contracts";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { inspectFile, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { cropImage, resizeImage, convertImage } from "@/engines/image-engine";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

interface Preset {
  id: string;
  label: string;
  width: number;
  height: number;
}

const PRESETS: Preset[] = [
  { id: "passport-35x45", label: "Passport 35×45mm (≈138×177px @100dpi)", width: 138, height: 177 },
  { id: "passport-2x2", label: "US Passport 2×2 inch (600×600px @300dpi)", width: 600, height: 600 },
  { id: "college-photo", label: "College photo 200×230px", width: 200, height: 230 },
  { id: "stamp-size", label: "Stamp size 150×200px", width: 150, height: 200 },
  { id: "custom", label: "Custom", width: 0, height: 0 },
];

const SHEET_LAYOUTS = [
  { id: "none", label: "Single image", cols: 1, rows: 1 },
  { id: "2x3", label: "2×3 sheet (6 copies)", cols: 2, rows: 3 },
  { id: "3x4", label: "3×4 sheet (12 copies)", cols: 3, rows: 4 },
  { id: "4x6", label: "4×6 sheet (24 copies)", cols: 4, rows: 6 },
];

export function PassportPhotoRoute(): React.ReactNode {
  const [file, setFile] = useState<InspectFileResponse | null>(null);
  const [preset, setPreset] = useState<Preset>(PRESETS[0]!);
  const [customW, setCustomW] = useState("200");
  const [customH, setCustomH] = useState("230");
  const [sheetLayout, setSheetLayout] = useState(SHEET_LAYOUTS[1]);
  const [cropX, setCropX] = useState("0");
  const [cropY, setCropY] = useState("0");
  const [cropW, setCropW] = useState("");
  const [cropH, setCropH] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false, directory: false,
        title: "Choose a photo — Paperu",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      if (meta.kind !== "image") { setError("That file isn't an image."); return; }
      setFile(meta); setError(null); setOutputPath(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function onGenerate(): Promise<void> {
    if (!file) { setError("Choose a photo first."); return; }
    setProcessing(true); setError(null); setOutputPath(null);
    try {
      const bytes = await readFileBytes(file.path);
      let memFile = new File([new Blob([bytes.slice()])], file.fileName, { type: file.mimeType ?? "image/*" });

      // Crop if dimensions provided.
      const cw = parseInt(cropW, 10);
      const ch = parseInt(cropH, 10);
      if (cw > 0 && ch > 0) {
        const x = parseInt(cropX, 10) || 0;
        const y = parseInt(cropY, 10) || 0;
        const res = await cropImage(memFile, { x, y, width: cw, height: ch });
        memFile = new File([new Blob([res.bytes.slice()])], file.fileName, { type: "image/png" });
      }

      // Resize to exact dimensions.
      const targetW = preset.id === "custom" ? parseInt(customW, 10) : preset.width;
      const targetH = preset.id === "custom" ? parseInt(customH, 10) : preset.height;
      if (!targetW || !targetH) { setError("Enter valid dimensions."); return; }
      const resized = await resizeImage(memFile, { width: targetW, height: targetH, preserveAspectRatio: false });
      memFile = new File([new Blob([resized.bytes.slice()])], file.fileName, { type: "image/png" });

      // Convert to JPEG.
      const converted = await convertImage(memFile, "jpeg", 0.92);
      const finalBytes = converted.bytes;

      if (sheetLayout!.id === "none") {
        // Single image — finalize as JPEG.
        const finalized = await finalizeOutput(file.path, "-passport", "jpg", finalBytes);
        setOutputPath(finalized.outputPath);
        addRecent({ path: finalized.outputPath, fileName: finalized.output.fileName, kind: finalized.output.kind, humanReadableSize: finalized.output.size.humanReadable, operation: "Passport photo", timestamp: Date.now() });
      } else {
        // A4 print sheet — embed the JPEG image multiple times.
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const A4_W = 595.28;
        const A4_H = 841.89;
        const page = doc.addPage([A4_W, A4_H]);
        const embedded = await doc.embedJpg(finalBytes);
        const margin = 18;
        const gap = 6;
        const cols = sheetLayout!.cols;
        const rows = sheetLayout!.rows;
        const cellW = (A4_W - margin * 2 - gap * (cols - 1)) / cols;
        const cellH = (A4_H - margin * 2 - gap * (rows - 1) - 30) / rows; // 30 for title
        page.drawText(`Passport photo sheet — ${cols}×${rows} (${cols * rows} copies)`, { x: margin, y: A4_H - 20, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const x = margin + col * (cellW + gap);
            const y = A4_H - margin - 30 - (row + 1) * cellH - row * gap;
            // Fit the image into the cell preserving aspect ratio.
            const imgAspect = targetW / targetH;
            const cellAspect = cellW / cellH;
            let drawW, drawH;
            if (imgAspect > cellAspect) {
              drawW = cellW;
              drawH = cellW / imgAspect;
            } else {
              drawH = cellH;
              drawW = cellH * imgAspect;
            }
            const drawX = x + (cellW - drawW) / 2;
            const drawY = y + (cellH - drawH) / 2;
            page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH });
          }
        }
        const pdfBytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
        const finalized = await finalizeOutput(file.path, "-passport-sheet", "pdf", pdfBytes);
        setOutputPath(finalized.outputPath);
        addRecent({ path: finalized.outputPath, fileName: finalized.output.fileName, kind: finalized.output.kind, humanReadableSize: finalized.output.size.humanReadable, operation: `Passport sheet (${sheetLayout!.id})`, timestamp: Date.now() });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="pp-heading">
      <header className="paperu-section__header">
        <h1 id="pp-heading" className="paperu-text-display">Passport / College Photo Studio</h1>
        <p className="paperu-text-lead">Crop + resize to exact dimensions + optional A4 print sheet with multiple copies. No AI background. No fake official presets.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={handlePick} disabled={processing}>Choose a photo</Button>
          {file && <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }} title={file.path}>{file.path}</div>}
        </div>
      </Card>

      {file && (
        <>
          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Preset</span>
              <select className="paperu-target__input" value={preset.id} onChange={(e) => setPreset(PRESETS.find((p) => p.id === e.target.value) ?? PRESETS[0]!)} style={{ width: "100%", marginTop: "var(--paperu-space-2)" }}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {preset.id === "custom" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                  <input className="paperu-target__input" placeholder="Width (px)" value={customW} onChange={(e) => setCustomW(e.target.value.replace(/[^0-9]/g, ""))} />
                  <input className="paperu-target__input" placeholder="Height (px)" value={customH} onChange={(e) => setCustomH(e.target.value.replace(/[^0-9]/g, ""))} />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Crop (optional)</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                <input className="paperu-target__input" placeholder="X" value={cropX} onChange={(e) => setCropX(e.target.value.replace(/[^0-9]/g, ""))} />
                <input className="paperu-target__input" placeholder="Y" value={cropY} onChange={(e) => setCropY(e.target.value.replace(/[^0-9]/g, ""))} />
                <input className="paperu-target__input" placeholder="Width (px)" value={cropW} onChange={(e) => setCropW(e.target.value.replace(/[^0-9]/g, ""))} />
                <input className="paperu-target__input" placeholder="Height (px)" value={cropH} onChange={(e) => setCropH(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Print sheet</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                {SHEET_LAYOUTS.map((l) => (
                  <button key={l.id} type="button" className={`paperu-target__preset${sheetLayout!.id === l.id ? " is-active" : ""}`} onClick={() => setSheetLayout(l)} aria-pressed={sheetLayout!.id === l.id} style={{ padding: "var(--paperu-space-3)" }}>{l.label}</button>
                ))}
              </div>
            </div>
          </Card>

          <Button variant="accent" onClick={onGenerate} disabled={processing} style={{ width: "100%" }}>
            {processing ? "Generating…" : "Generate photo" + (sheetLayout!.id !== "none" ? " + sheet" : "")}
          </Button>
        </>
      )}

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Generated</span>
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
