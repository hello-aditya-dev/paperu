/**
 * PDF Compare route — full multipage visual comparison (P0-C).
 *
 * Compares two PDFs page-by-page. For each page pair: renders A and B
 * to offscreen canvases at scale 1.0, computes a per-pixel diff
 * (count + percentage of differing pixels), marks the page identical /
 * minor diff / major diff, and shows a side-by-side preview with a
 * red-tint overlay on B's differing pixels.
 *
 * - Multipage navigation: Prev/Next, page-number input, sync mode
 *   (A+B move together) + independent mode toggle.
 * - Handles different page counts (inserted/deleted pages flagged).
 * - Cancel button aborts an in-progress comparison via a ref flag.
 * - Comparison report: builds a small PDF (pdf-lib) summarizing the
 *   per-page results + writes it via `saveFileAs` (canonical Rust
 *   write, no silent overwrite).
 * - Encrypted PDFs surface a clear PasswordException error.
 *
 * Pure frontend. No AI. No network. Deterministic.
 */

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse } from "@paperu/contracts";
import { inspectFile, openPath } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { saveFileAs } from "@/lib/save-as";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

interface PdfInfo {
  meta: InspectFileResponse;
  pageCount: number;
  bytes: Uint8Array;
}

interface PageDiff {
  pageNum: number;
  status: "identical" | "minor" | "major" | "unmatched-a" | "unmatched-b";
  diffPercent: number; // 0..100 (0 for identical/unmatched)
  diffPixels: number;
}

const MINOR_THRESHOLD = 0.5; // <0.5% diff → minor
const MAJOR_THRESHOLD = 5.0; // >5% → major

export function PdfCompareRoute(): React.ReactNode {
  const [pdfA, setPdfA] = useState<PdfInfo | null>(null);
  const [pdfB, setPdfB] = useState<PdfInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareProgress, setCompareProgress] = useState<string>("");
  const [diffs, setDiffs] = useState<readonly PageDiff[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [syncMode, setSyncMode] = useState(true);
  const [sideAOnly, setSideAOnly] = useState(false);
  const [sideBOnly, setSideBOnly] = useState(false);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);
  const addRecent = useRecentFiles((s) => s.add);

  async function pickPdf(setter: (info: PdfInfo) => void): Promise<void> {
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
      const bytes = await readFileBytes(selected);
      const pdfjs = await import("pdfjs-dist");
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      setter({ meta, pageCount: doc.numPages, bytes });
      setDiffs([]);
      setError(null);
    } catch (e) {
      setError(formatPdfError(e));
    }
  }

  // Compare button: walk page pairs sequentially, compute pixel diff.
  async function onCompare(): Promise<void> {
    if (!pdfA || !pdfB) return;
    setComparing(true);
    setCompareProgress("Starting…");
    setError(null);
    setDiffs([]);
    cancelRef.current = false;
    try {
      const pdfjs = await import("pdfjs-dist");
      const docA = await pdfjs.getDocument({ data: pdfA.bytes.slice() }).promise;
      const docB = await pdfjs.getDocument({ data: pdfB.bytes.slice() }).promise;
      const maxPages = Math.max(docA.numPages, docB.numPages);
      const results: PageDiff[] = [];
      for (let p = 1; p <= maxPages; p++) {
        if (cancelRef.current) break;
        setCompareProgress(`Comparing page ${p} of ${maxPages}…`);
        const hasA = p <= docA.numPages;
        const hasB = p <= docB.numPages;
        if (hasA && !hasB) {
          results.push({
            pageNum: p,
            status: "unmatched-a",
            diffPercent: 100,
            diffPixels: 0,
          });
          continue;
        }
        if (!hasA && hasB) {
          results.push({
            pageNum: p,
            status: "unmatched-b",
            diffPercent: 100,
            diffPixels: 0,
          });
          continue;
        }
        // Render both pages at scale 1.0 to offscreen canvases.
        const pageA = await docA.getPage(p);
        const pageB = await docB.getPage(p);
        const vpA = pageA.getViewport({ scale: 1.0 });
        const vpB = pageB.getViewport({ scale: 1.0 });
        const offA = new OffscreenCanvasLike(vpA.width, vpA.height);
        const offB = new OffscreenCanvasLike(vpB.width, vpB.height);
        await pageA.render({
          canvasContext: offA.getContext("2d")!,
          viewport: vpA,
        }).promise;
        await pageB.render({
          canvasContext: offB.getContext("2d")!,
          viewport: vpB,
        }).promise;
        const diff = computePixelDiff(offA.canvas, offB.canvas);
        const status =
          diff.diffPixels === 0
            ? "identical"
            : diff.diffPercent < MINOR_THRESHOLD
              ? "minor"
              : diff.diffPercent < MAJOR_THRESHOLD
                ? "minor"
                : "major";
        results.push({ pageNum: p, status, diffPercent: diff.diffPercent, diffPixels: diff.diffPixels });
      }
      setDiffs(results);
      setCompareProgress(cancelRef.current ? "Cancelled." : "Comparison complete.");
      setCurrentPage(1);
    } catch (e) {
      setError(formatPdfError(e));
    } finally {
      setComparing(false);
    }
  }

  // Render the visible preview for the current page (with diff overlay on B).
  useEffect(() => {
    if (!pdfA || !pdfB) return;
    if (syncMode && sideAOnly && sideBOnly) {
      // Both toggled — reset to standard sync.
      setSideAOnly(false);
      setSideBOnly(false);
    }
    (async () => {
      const cA = canvasARef.current;
      const cB = canvasBRef.current;
      if (!cA || !cB) return;
      setLoading(true);
      try {
        const pdfjs = await import("pdfjs-dist");
        const docA = await pdfjs.getDocument({ data: pdfA.bytes.slice() }).promise;
        const docB = await pdfjs.getDocument({ data: pdfB.bytes.slice() }).promise;
        const showA = pdfA && currentPage <= docA.numPages && !sideBOnly;
        const showB = pdfB && currentPage <= docB.numPages && !sideAOnly;
        if (showA) {
          const pageA = await docA.getPage(currentPage);
          const vpA = pageA.getViewport({ scale: 0.75 });
          cA.width = vpA.width;
          cA.height = vpA.height;
          await pageA.render({
            canvasContext: cA.getContext("2d")!,
            viewport: vpA,
          }).promise;
        } else {
          cA.width = 1;
          cA.height = 1;
          cA.getContext("2d")!.clearRect(0, 0, 1, 1);
        }
        if (showB) {
          const pageB = await docB.getPage(currentPage);
          const vpB = pageB.getViewport({ scale: 0.75 });
          cB.width = vpB.width;
          cB.height = vpB.height;
          await pageB.render({
            canvasContext: cB.getContext("2d")!,
            viewport: vpB,
          }).promise;
          // If this page has a diff, render the diff overlay on B.
          const diff = diffs.find((d) => d.pageNum === currentPage);
          if (diff && diff.diffPixels > 0) {
            const overlay = await renderDiffOverlay(
              pdfA,
              pdfB,
              currentPage,
            );
            if (overlay) {
              const ctx = cB.getContext("2d")!;
              ctx.globalAlpha = 0.4;
              ctx.drawImage(overlay, 0, 0, cB.width, cB.height);
              ctx.globalAlpha = 1.0;
            }
          }
        } else {
          cB.width = 1;
          cB.height = 1;
          cB.getContext("2d")!.clearRect(0, 0, 1, 1);
        }
      } catch (e) {
        setError(formatPdfError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [pdfA, pdfB, currentPage, syncMode, sideAOnly, sideBOnly, diffs]);

  async function renderDiffOverlay(
    a: PdfInfo,
    b: PdfInfo,
    page: number,
  ): Promise<HTMLCanvasElement | null> {
    try {
      const pdfjs = await import("pdfjs-dist");
      const docA = await pdfjs.getDocument({ data: a.bytes.slice() }).promise;
      const docB = await pdfjs.getDocument({ data: b.bytes.slice() }).promise;
      if (page > docA.numPages || page > docB.numPages) return null;
      const pageA = await docA.getPage(page);
      const pageB = await docB.getPage(page);
      const vpA = pageA.getViewport({ scale: 0.75 });
      const vpB = pageB.getViewport({ scale: 0.75 });
      const w = Math.max(vpA.width, vpB.width);
      const h = Math.max(vpA.height, vpB.height);
      const offA = new OffscreenCanvasLike(w, h);
      const offB = new OffscreenCanvasLike(w, h);
      await pageA.render({
        canvasContext: offA.getContext("2d")!,
        viewport: pageA.getViewport({ scale: 0.75 }),
      }).promise;
      await pageB.render({
        canvasContext: offB.getContext("2d")!,
        viewport: pageB.getViewport({ scale: 0.75 }),
      }).promise;
      const overlay = document.createElement("canvas");
      overlay.width = w;
      overlay.height = h;
      const octx = overlay.getContext("2d")!;
      const dataA = offA.getContext("2d")!.getImageData(0, 0, w, h).data;
      const dataB = offB.getContext("2d")!.getImageData(0, 0, w, h).data;
      const out = octx.createImageData(w, h);
      for (let i = 0; i < dataA.length; i += 4) {
        const dr = Math.abs((dataA[i] ?? 0) - (dataB[i] ?? 0));
        const dg = Math.abs((dataA[i + 1] ?? 0) - (dataB[i + 1] ?? 0));
        const db = Math.abs((dataA[i + 2] ?? 0) - (dataB[i + 2] ?? 0));
        if (dr + dg + db > 30) {
          out.data[i] = 255;
          out.data[i + 1] = 0;
          out.data[i + 2] = 0;
          out.data[i + 3] = 255;
        } else {
          out.data[i + 3] = 0;
        }
      }
      octx.putImageData(out, 0, 0);
      return overlay;
    } catch (e) {
      setError(formatPdfError(e));
      return null;
    }
  }

  async function onExportReport(): Promise<void> {
    if (!pdfA || !pdfB) return;
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const A4_W = 595.28;
      const A4_H = 841.89;
      const page = doc.addPage([A4_W, A4_H]);
      let y = A4_H - 50;
      page.drawText("PDF Comparison Report", { x: 50, y, size: 18, font: bold, color: rgb(0.18, 0.31, 0.45) });
      y -= 30;
      page.drawText(`A: ${pdfA.meta.fileName} (${pdfA.pageCount} pages)`, { x: 50, y, size: 10, font });
      y -= 14;
      page.drawText(`B: ${pdfB.meta.fileName} (${pdfB.pageCount} pages)`, { x: 50, y, size: 10, font });
      y -= 14;
      const identical = diffs.filter((d) => d.status === "identical").length;
      const minor = diffs.filter((d) => d.status === "minor").length;
      const major = diffs.filter((d) => d.status === "major").length;
      const unmatched = diffs.filter((d) => d.status === "unmatched-a" || d.status === "unmatched-b").length;
      page.drawText(`Identical: ${identical} · Minor: ${minor} · Major: ${major} · Unmatched: ${unmatched}`, {
        x: 50,
        y,
        size: 10,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 14;
      page.drawText(`Generated: ${new Date().toISOString()}`, {
        x: 50,
        y,
        size: 9,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= 24;
      page.drawText("Per-page results:", { x: 50, y, size: 11, font: bold });
      y -= 16;
      for (const d of diffs) {
        if (y < 80) {
          const p2 = doc.addPage([A4_W, A4_H]);
          y = A4_H - 50;
          page.drawText("Page   Status        Diff%", { x: 50, y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.4) });
          y -= 14;
          void p2;
        }
        const line = `${String(d.pageNum).padStart(4, " ")}   ${d.status.padEnd(14, " ")}   ${d.diffPercent.toFixed(2)}%`;
        page.drawText(line, { x: 50, y, size: 9, font });
        y -= 14;
      }
      page.drawText("Generated locally by Paperu — 0 bytes uploaded.", {
        x: 50,
        y: 30,
        size: 8,
        font,
        color: rgb(0.55, 0.55, 0.55),
      });
      const bytes = new Uint8Array(await doc.save({ useObjectStreams: true }));
      const result = await saveFileAs(bytes, "pdf-comparison-report.pdf", [
        { name: "PDF", extensions: ["pdf"] },
      ]);
      if (!result) return;
      setReportPath(result.outputPath);
      addRecent({
        path: result.outputPath,
        fileName: result.output.fileName,
        kind: result.output.kind,
        humanReadableSize: result.output.size.humanReadable,
        operation: "PDF Compare report",
        timestamp: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function gotoPage(p: number): void {
    const max = Math.max(pdfA?.pageCount ?? 1, pdfB?.pageCount ?? 1);
    const clamped = Math.max(1, Math.min(max, p));
    setCurrentPage(clamped);
  }

  const changedCount = diffs.filter((d) => d.status !== "identical").length;
  const pageCountMatches = pdfA && pdfB ? pdfA.pageCount === pdfB.pageCount : null;
  const maxPage = Math.max(pdfA?.pageCount ?? 1, pdfB?.pageCount ?? 1);

  return (
    <section className="paperu-section" aria-labelledby="cmp-heading">
      <header className="paperu-section__header">
        <h1 id="cmp-heading" className="paperu-text-display">
          PDF Compare
        </h1>
        <p className="paperu-text-lead">
          Compare two PDFs page-by-page. Real per-pixel diff detection, multipage
          navigation, visual diff overlay (red), and a comparison report. No AI,
          no network — deterministic.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-3)" }}>
            <div>
              <Button variant="accent" onClick={() => void pickPdf(setPdfA)}>
                Choose PDF A
              </Button>
              {pdfA && (
                <div style={{ marginTop: "var(--paperu-space-2)" }}>
                  <div className="paperu-text-code paperu-truncate" title={pdfA.meta.path}>
                    {pdfA.meta.fileName}
                  </div>
                  <div className="paperu-text-caption paperu-text-numeric">
                    {pdfA.pageCount} pages · {pdfA.meta.size.humanReadable}
                  </div>
                </div>
              )}
            </div>
            <div>
              <Button variant="accent" onClick={() => void pickPdf(setPdfB)}>
                Choose PDF B
              </Button>
              {pdfB && (
                <div style={{ marginTop: "var(--paperu-space-2)" }}>
                  <div className="paperu-text-code paperu-truncate" title={pdfB.meta.path}>
                    {pdfB.meta.fileName}
                  </div>
                  <div className="paperu-text-caption paperu-text-numeric">
                    {pdfB.pageCount} pages · {pdfB.meta.size.humanReadable}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {pdfA && pdfB && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              {pageCountMatches ? (
                <span className="paperu-stamp paperu-stamp--success">
                  ✓ Page count matches ({pdfA.pageCount})
                </span>
              ) : (
                <span className="paperu-stamp paperu-stamp--warn">
                  ⚠ Page count differs (A: {pdfA.pageCount}, B: {pdfB.pageCount})
                </span>
              )}
              {diffs.length > 0 && (
                <span className="paperu-stamp paperu-stamp--accent">
                  {changedCount} changed of {diffs.length} pages
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap" }}>
              <Button variant="accent" onClick={onCompare} disabled={comparing}>
                {comparing ? "Comparing…" : "Compare all pages"}
              </Button>
              {comparing && (
                <Button
                  variant="outline"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Cancel
                </Button>
              )}
              {diffs.length > 0 && (
                <Button variant="outline" onClick={() => void onExportReport()}>
                  Export report
                </Button>
              )}
            </div>
            {compareProgress && (
              <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
                {compareProgress}
              </p>
            )}
          </div>
        </Card>
      )}

      {pdfA && pdfB && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "center", marginBottom: "var(--paperu-space-3)", flexWrap: "wrap" }}>
              <Button variant="outline" onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1}>
                ← Prev
              </Button>
              <input
                className="paperu-target__input"
                type="number"
                min={1}
                max={maxPage}
                value={currentPage}
                onChange={(e) => gotoPage(parseInt(e.target.value, 10) || 1)}
                style={{ width: "80px" }}
                aria-label="Page number"
              />
              <span className="paperu-text-caption">/ {maxPage}</span>
              <Button variant="outline" onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= maxPage}>
                Next →
              </Button>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-1)", marginLeft: "var(--paperu-space-3)" }}>
                <input
                  type="checkbox"
                  checked={syncMode}
                  onChange={(e) => setSyncMode(e.target.checked)}
                />
                <span className="paperu-text-caption">Sync A+B</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-1)" }}>
                <input
                  type="checkbox"
                  checked={sideAOnly}
                  onChange={(e) => setSideAOnly(e.target.checked)}
                  disabled={!syncMode}
                />
                <span className="paperu-text-caption">A only</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-1)" }}>
                <input
                  type="checkbox"
                  checked={sideBOnly}
                  onChange={(e) => setSideBOnly(e.target.checked)}
                  disabled={!syncMode}
                />
                <span className="paperu-text-caption">B only</span>
              </label>
            </div>
            {loading && <p className="paperu-text-caption">Rendering preview…</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-3)" }}>
              <div>
                <div className="paperu-text-label">
                  Page {currentPage} (A){sideAOnly ? " — hidden" : ""}
                </div>
                <canvas
                  ref={canvasARef}
                  style={{
                    maxWidth: "100%",
                    border: "1px solid var(--paperu-border-subtle)",
                    borderRadius: "var(--paperu-radius-2)",
                  }}
                />
              </div>
              <div>
                <div className="paperu-text-label">
                  Page {currentPage} (B){sideBOnly ? " — hidden" : ""}
                  {(() => {
                    const d = diffs.find((x) => x.pageNum === currentPage);
                    if (!d) return null;
                    return ` · ${d.status} (${d.diffPercent.toFixed(2)}% diff)`;
                  })()}
                </div>
                <canvas
                  ref={canvasBRef}
                  style={{
                    maxWidth: "100%",
                    border: "1px solid var(--paperu-border-subtle)",
                    borderRadius: "var(--paperu-radius-2)",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
              <Button variant="outline" onClick={() => void openPath(pdfA.meta.path)}>
                Open A
              </Button>
              <Button variant="outline" onClick={() => void openPath(pdfB.meta.path)}>
                Open B
              </Button>
            </div>
          </div>
        </Card>
      )}

      {diffs.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Per-page results ({diffs.length})</span>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                marginTop: "var(--paperu-space-2)",
                display: "grid",
                gap: "var(--paperu-space-1)",
                maxHeight: "16rem",
                overflowY: "auto",
              }}
            >
              {diffs.map((d) => (
                <li key={d.pageNum}>
                  <button
                    type="button"
                    className="paperu-btn paperu-btn--ghost"
                    onClick={() => gotoPage(d.pageNum)}
                    style={{
                      width: "100%",
                      justifyContent: "space-between",
                      display: "flex",
                      padding: "var(--paperu-space-1) var(--paperu-space-2)",
                    }}
                  >
                    <span className="paperu-text-caption paperu-text-numeric">
                      Page {d.pageNum}
                    </span>
                    <span className="paperu-text-caption">
                      {d.status === "identical"
                        ? "✓ identical"
                        : d.status === "minor"
                          ? `◐ minor (${d.diffPercent.toFixed(2)}%)`
                          : d.status === "major"
                            ? `✗ major (${d.diffPercent.toFixed(2)}%)`
                            : d.status === "unmatched-a"
                              ? "⚠ only in A"
                              : "⚠ only in B"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {reportPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Report saved</span>
            </div>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>
              {reportPath}
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">
              !
            </span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Compute the per-pixel diff between two canvases. Returns the count
 * of differing pixels + the percentage. Two pixels are "different"
 * if any of R/G/B differs by more than a small tolerance (to ignore
 * anti-aliasing noise).
 */
function computePixelDiff(
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
): { diffPixels: number; diffPercent: number } {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  if (w === 0 || h === 0) return { diffPixels: 0, diffPercent: 0 };
  const ctxA = a.getContext("2d")!;
  const ctxB = b.getContext("2d")!;
  const dataA = ctxA.getImageData(0, 0, w, h).data;
  const dataB = ctxB.getImageData(0, 0, w, h).data;
  let diff = 0;
  const totalPixels = w * h;
  const tolerance = 10;
  for (let i = 0; i < dataA.length; i += 4) {
    const dr = Math.abs((dataA[i] ?? 0) - (dataB[i] ?? 0));
    const dg = Math.abs((dataA[i + 1] ?? 0) - (dataB[i + 1] ?? 0));
    const db = Math.abs((dataA[i + 2] ?? 0) - (dataB[i + 2] ?? 0));
    if (dr > tolerance || dg > tolerance || db > tolerance) diff++;
  }
  return {
    diffPixels: diff,
    diffPercent: (diff / totalPixels) * 100,
  };
}

/**
 * A minimal HTMLCanvasElement-like wrapper for offscreen rendering.
 * pdfjs needs a canvas-like with `width`, `height`, `getContext('2d')`
 * returning a ctx that supports `drawImage`/`getImageData`/`putImageData`.
 * We just use a real <canvas> element (works in the webview).
 */
class OffscreenCanvasLike {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(1, Math.floor(w));
    this.canvas.height = Math.max(1, Math.floor(h));
    this.width = this.canvas.width;
    this.height = this.canvas.height;
  }
  getContext(type: "2d"): CanvasRenderingContext2D | null {
    return this.canvas.getContext(type);
  }
}

function formatPdfError(e: unknown): string {
  if (e && typeof e === "object" && "name" in e) {
    const name = (e as { name: string }).name;
    if (name === "PasswordException") {
      return "That PDF is password-protected. Unlock it first (PDF tools → Unlock).";
    }
    if (name === "InvalidPDFException") {
      return "That PDF is corrupt or unsupported.";
    }
  }
  return e instanceof Error ? e.message : String(e);
}
