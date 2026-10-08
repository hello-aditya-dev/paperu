/**
 * PDF Compare route — compare two PDFs (90% §30, Wave 6, PDF-22/File-14).
 * Pure frontend (pdf-lib + pdfjs-dist lazy). Compares page count + renders
 * corresponding pages side-by-side. No AI.
 */

import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse } from "@paperu/contracts";
import { inspectFile, openPath } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { Button, Card } from "@paperu/ui";

interface PdfInfo {
  meta: InspectFileResponse;
  pageCount: number;
}

export function PdfCompareRoute(): React.ReactNode {
  const [pdfA, setPdfA] = useState<PdfInfo | null>(null);
  const [pdfB, setPdfB] = useState<PdfInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);

  async function pickPdf(setter: (info: PdfInfo) => void): Promise<void> {
    try {
      const selected = await open({
        multiple: false, directory: false,
        title: "Choose a PDF — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      if (meta.kind !== "pdf") { setError("That file isn't a PDF."); return; }
      const bytes = await readFileBytes(selected);
      const pdfjs = await import("pdfjs-dist");
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      setter({ meta, pageCount: pdf.numPages });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Render the first page of each PDF side-by-side for visual comparison.
  useEffect(() => {
    (async () => {
      if (!pdfA || !pdfB || !canvasARef.current || !canvasBRef.current) return;
      setLoading(true);
      try {
        const pdfjs = await import("pdfjs-dist");
        const bytesA = await readFileBytes(pdfA.meta.path);
        const bytesB = await readFileBytes(pdfB.meta.path);
        const docA = await pdfjs.getDocument({ data: bytesA.slice() }).promise;
        const docB = await pdfjs.getDocument({ data: bytesB.slice() }).promise;
        const pageA = await docA.getPage(1);
        const pageB = await docB.getPage(1);
        const va = pageA.getViewport({ scale: 0.5 });
        const vb = pageB.getViewport({ scale: 0.5 });
        const cA = canvasARef.current!;
        const cB = canvasBRef.current!;
        cA.width = va.width; cA.height = va.height;
        cB.width = vb.width; cB.height = vb.height;
        await pageA.render({ canvasContext: cA.getContext("2d")!, viewport: va }).promise;
        await pageB.render({ canvasContext: cB.getContext("2d")!, viewport: vb }).promise;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [pdfA, pdfB]);

  const pageCountMatches = pdfA && pdfB ? pdfA.pageCount === pdfB.pageCount : null;

  return (
    <section className="paperu-section" aria-labelledby="cmp-heading">
      <header className="paperu-section__header">
        <h1 id="cmp-heading" className="paperu-text-display">PDF Compare</h1>
        <p className="paperu-text-lead">Compare two PDFs: page count + side-by-side first-page preview. No AI — deterministic visual comparison.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-3)" }}>
            <div>
              <Button variant="accent" onClick={() => void pickPdf(setPdfA)}>Choose PDF A</Button>
              {pdfA && (
                <div style={{ marginTop: "var(--paperu-space-2)" }}>
                  <div className="paperu-text-code paperu-truncate" title={pdfA.meta.path}>{pdfA.meta.fileName}</div>
                  <div className="paperu-text-caption paperu-text-numeric">{pdfA.pageCount} pages · {pdfA.meta.size.humanReadable}</div>
                </div>
              )}
            </div>
            <div>
              <Button variant="accent" onClick={() => void pickPdf(setPdfB)}>Choose PDF B</Button>
              {pdfB && (
                <div style={{ marginTop: "var(--paperu-space-2)" }}>
                  <div className="paperu-text-code paperu-truncate" title={pdfB.meta.path}>{pdfB.meta.fileName}</div>
                  <div className="paperu-text-caption paperu-text-numeric">{pdfB.pageCount} pages · {pdfB.meta.size.humanReadable}</div>
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
                <span className="paperu-stamp paperu-stamp--success">✓ Page count matches ({pdfA.pageCount})</span>
              ) : (
                <span className="paperu-stamp paperu-stamp--warn">⚠ Page count differs (A: {pdfA.pageCount}, B: {pdfB.pageCount})</span>
              )}
            </div>
            {loading && <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>Rendering first pages…</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-4)" }}>
              <div>
                <div className="paperu-text-label">Page 1 (A)</div>
                <canvas ref={canvasARef} style={{ maxWidth: "100%", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }} />
              </div>
              <div>
                <div className="paperu-text-label">Page 1 (B)</div>
                <canvas ref={canvasBRef} style={{ maxWidth: "100%", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
              <Button variant="outline" onClick={() => void openPath(pdfA.meta.path)}>Open A</Button>
              <Button variant="outline" onClick={() => void openPath(pdfB.meta.path)}>Open B</Button>
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
