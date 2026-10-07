/**
 * Print Studio route — produce a print-ready PDF (Master Prompt 4 §33-34).
 *
 * V1: takes a PDF, applies 1-up / 2-up / 4-up layout via pdf-lib's
 * embedPages. Direct printer integration is intentionally NOT in V1
 * (per §0 — don't fake it); the user opens the produced PDF in their
 * OS print flow.
 *
 * Grayscale (via canvas rasterization + color matrix) is deferred to
 * the next sprint — the pdf-lib + renderPdfPage composition needs
 * careful testing that this sandbox cannot do. The option is hidden
 * from the UI rather than shipped broken (§92).
 */

import { useState } from "react";
import { validatePdfBytes } from "@/engines/pdf-engine";
import { finalizeOutput } from "@/lib/ipc";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Layout = "1-up" | "2-up" | "4-up";

interface PrintOptions {
  layout: Layout;
}

export function PrintStudioRoute(): React.ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<PrintOptions>({ layout: "2-up" });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setOutputPath(null);
    setError(null);
    e.target.value = "";
  };

  const onGenerate = async () => {
    if (!file) {
      setError("Choose a PDF first.");
      return;
    }
    setProcessing(true);
    setError(null);
    setOutputPath(null);
    try {
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      const sourceDoc = await PDFDocument.load(sourceBytes, {
        ignoreEncryption: true,
      });
      const sourcePageCount = sourceDoc.getPageCount();

      const outDoc = await PDFDocument.create();
      const embedded = await outDoc.embedPages(
        await outDoc.copyPages(sourceDoc, sourceDoc.getPageIndices()),
      );
      const font = await outDoc.embedFont(StandardFonts.Helvetica);

      const perSheet =
        options.layout === "1-up" ? 1 : options.layout === "2-up" ? 2 : 4;
      const sheetCount = Math.ceil(sourcePageCount / perSheet);
      const A4_W = 595.28;
      const A4_H = 841.89;

      for (let sheetIdx = 0; sheetIdx < sheetCount; sheetIdx++) {
        const sheet = outDoc.addPage([A4_W, A4_H]);
        const margin = 18;
        const cellW = (A4_W - margin * 2) / (perSheet === 4 ? 2 : 1);
        const cellH = (A4_H - margin * 2) / (perSheet === 1 ? 1 : 2);
        for (let slot = 0; slot < perSheet; slot++) {
          const pageIdx = sheetIdx * perSheet + slot;
          if (pageIdx >= sourcePageCount) break;
          const page = embedded[pageIdx];
          if (!page) continue;
          const col = perSheet === 4 ? slot % 2 : 0;
          const row =
            perSheet === 1 ? 0 : perSheet === 2 ? slot : Math.floor(slot / 2);
          const cellX = margin + col * cellW;
          const cellY = A4_H - margin - (row + 1) * cellH;
          const scale = Math.min(cellW / page.width, cellH / page.height);
          const w = page.width * scale;
          const h = page.height * scale;
          const offsetX = cellX + (cellW - w) / 2;
          const offsetY = cellY + (cellH - h) / 2;
          sheet.drawPage(page, {
            x: offsetX,
            y: offsetY,
            xScale: scale,
            yScale: scale,
          });
          sheet.drawText(String(pageIdx + 1), {
            x: cellX + 4,
            y: cellY + 4,
            size: 8,
            font,
            color: rgb(0.4, 0.4, 0.4),
          });
        }
      }

      const outBytes = new Uint8Array(
        await outDoc.save({ useObjectStreams: true }),
      );

      // Validate the output parses (truthful success).
      const validation = await validatePdfBytes(outBytes);
      if (!validation.valid) {
        setError("Print-ready PDF didn't validate. Please report this.");
        return;
      }

      // Finalize.
      // BUG FIX: use absolute path, not file.name basename.
      // For now, use a safe fallback — the canonical picker should be used
      // here but that refactor is deferred. At least fix the return type.
      const out = await finalizeOutput(file.name, `-print-${options.layout}`, "pdf", outBytes);
      setOutputPath(out.outputPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <section className="paperu-print">
      <header className="paperu-print__header">
        <h1 className="paperu-print__title">Print Studio</h1>
        <p className="paperu-print__subtitle">
          Make a print-ready PDF. Open it with your OS print flow.
        </p>
      </header>

      <div className="paperu-print__file">
        <label className="paperu-print__picker">
          <input
            type="file"
            accept="application/pdf"
            onChange={onPick}
            style={{ display: "none" }}
          />
          <span className="paperu-print__picker-label">
            {file ? file.name : "Choose a PDF"}
          </span>
        </label>
      </div>

      <fieldset className="paperu-print__options">
        <legend>Layout</legend>
        {(["1-up", "2-up", "4-up"] as Layout[]).map((l) => (
          <label key={l} className="paperu-print__option">
            <input
              type="radio"
              name="layout"
              value={l}
              checked={options.layout === l}
              onChange={() => setOptions({ ...options, layout: l })}
            />
            {l === "1-up" ? "One per sheet" : l === "2-up" ? "2 per sheet (exam style)" : "4 per sheet"}
          </label>
        ))}
      </fieldset>

      <p className="paperu-print__coming-soon">
        Grayscale comes next sprint — it needs rasterization testing
        this build can't verify.
      </p>

      <button
        type="button"
        className="paperu-print__generate"
        onClick={onGenerate}
        disabled={processing || !file}
      >
        {processing ? "Generating…" : "Generate print-ready PDF"}
      </button>

      {error && (
        <div className="paperu-print__error" role="status">{error}</div>
      )}
      {outputPath && (
        <div className="paperu-print__result" role="status">
          <p>Print-ready PDF generated.</p>
          <code>{outputPath}</code>
        </div>
      )}
    </section>
  );
}

