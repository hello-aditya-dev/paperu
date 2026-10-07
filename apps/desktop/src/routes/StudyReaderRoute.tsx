/**
 * Study Reader route — open a PDF, navigate pages, remember position
 * (Master Prompt 4 §23-26).
 *
 * Lean V1 implementation: page navigation (prev/next/jump), zoom,
 * fit-width toggle, and last-reading-position persistence via the
 * canonical reading_history table. Uses pdfjs-dist (lazy-loaded).
 *
 * NOT implemented tonight (honest, per §0): highlights, bookmarks,
 * annotations, tabs. These would be half-built; better to ship a
 * reliable reader that opens + navigates + remembers position than
 * a broken annotation layer.
 *
 * Performance (§24): pages are rendered on demand (one at a time).
 * The full 300-page PDF is not pre-rendered. Memory should stay flat.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { filePath } from "@paperu/contracts";
import { getReadingHistory, upsertReadingHistory } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";

interface StudyReaderRouteProps {
  /** The file path to read. Passed via the route query string. */
  readonly path: string | null;
}

type FitMode = "manual" | "fit-width";

// Zoom bounds shared by the manual +/− buttons and the fit-width calc.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
// Horizontal padding inside the reader viewport (both sides), so fit-width
// doesn't crop content against the edge.
const FIT_PADDING_PX = 32;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function StudyReaderRoute({ path }: StudyReaderRouteProps): React.ReactNode {
  // We track whether reading-history exists for this path (to jump to
  // the last page on first load) but we don't render it directly —
  // the upsert effect writes position changes silently.
  const [, setHistoryExists] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [fitMode, setFitMode] = useState<FitMode>("manual");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Natural page width at scale 1.0 (pdfjs user-space units ≈ 1/72").
  // Captured when a page renders so fit-width can compute a real scale.
  const naturalWidthRef = useRef<number | null>(null);
  const upsertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real fit-width: containerWidth / naturalPageWidth, with padding + bounds.
  const computeFitZoom = useCallback((): number | null => {
    const natural = naturalWidthRef.current;
    const viewport = viewportRef.current;
    if (!natural || !viewport || natural <= 0) return null;
    const containerWidth = viewport.clientWidth - FIT_PADDING_PX;
    if (containerWidth <= 0) return null;
    return clampZoom(containerWidth / natural);
  }, []);

  // Load reading history for the path; jump to last page if present.
  useEffect(() => {
    if (!path) {
      setError("No file selected.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entry = await getReadingHistory(path);
        if (cancelled) return;
        setHistoryExists(true);
        if (entry) setPageNum(entry.lastPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Render the current page to the canvas (lazy, on-demand).
  // Uses the canonical readFileBytes (Paperu FilePath → Uint8Array)
  // instead of pdfjs.getDocument(path) — repair §19. File access stays
  // under Paperu's narrow Rust path validation.
  useEffect(() => {
    if (!path || !canvasRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Canonical path: readFileBytes returns Uint8Array from the
        // Rust read_file_bytes command (validated, sandboxed).
        const bytes = await readFileBytes(path);
        if (cancelled) return;
        // pdfjs needs a fresh copy of the data (it transfers ownership).
        const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        // Capture the natural page width at scale 1.0 so the fit-width
        // button can compute a REAL scale instead of faking zoom=1.
        naturalWidthRef.current = page.getViewport({ scale: 1.0 }).width;
        const viewport = page.getViewport({ scale: zoom });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, pageNum, zoom]);

  // Recalculate fit-width zoom on viewport resize (master prompt §659).
  // When fit-mode is "fit-width", a window resize must re-fit the page
  // to the new container width. In manual mode, the user's zoom stays.
  useEffect(() => {
    if (fitMode !== "fit-width") return;
    const onResize = () => {
      const fit = computeFitZoom();
      if (fit !== null) setZoom(fit);
    };
    window.addEventListener("resize", onResize);
    // Recalculate once on entering fit-width mode (in case the container
    // changed since the last fit).
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [fitMode, computeFitZoom]);

  // If the path changes, reset fit-mode to manual so a new document
  // doesn't inherit the previous fit-width state before its natural
  // width is known.
  useEffect(() => {
    setFitMode("manual");
    naturalWidthRef.current = null;
  }, [path]);

  // Debounced upsert of reading position.
  // FIX (repair §20): the previous guard `if (!path || !history) return`
  // meant a brand-new document with NO prior history never created a
  // row. Now we write on every path + page change, creating the row
  // on first open. The Rust upsert handles INSERT-or-UPDATE correctly.
  useEffect(() => {
    if (!path) return;
    if (upsertTimer.current) clearTimeout(upsertTimer.current);
    upsertTimer.current = setTimeout(async () => {
      try {
        const fileName = path.split(/[\\/]/).pop() ?? path;
        await upsertReadingHistory({
          filePath: filePath(path),
          fileName,
          fileKind: "pdf",
          lastPage: pageNum,
          zoomLevel: zoom,
          // Intentionally omit bookmarks — None means "leave existing
          // bookmarks unchanged" (repair §21). We don't want to clobber
          // bookmarks every time the user scrolls.
        });
        setHistoryExists(true);
      } catch {
        // Non-fatal — reading history is convenience, not critical.
      }
    }, 1200);
    return () => {
      if (upsertTimer.current) clearTimeout(upsertTimer.current);
    };
  }, [path, pageNum, zoom]);

  if (!path) {
    return (
      <section className="paperu-reader">
        <p className="paperu-reader__empty">
          Open a PDF to start reading.
        </p>
      </section>
    );
  }

  return (
    <section className="paperu-reader">
      <header className="paperu-reader__header">
        <div className="paperu-reader__nav">
          <button
            type="button"
            className="paperu-reader__btn"
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
          >
            ← Prev
          </button>
          <input
            type="number"
            className="paperu-reader__page-input"
            value={pageNum}
            min={1}
            max={pageCount}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v) && v >= 1 && v <= pageCount) {
                setPageNum(v);
              }
            }}
            aria-label="Page number"
          />
          <span className="paperu-reader__page-count">/ {pageCount}</span>
          <button
            type="button"
            className="paperu-reader__btn"
            onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}
            disabled={pageNum >= pageCount}
          >
            Next →
          </button>
        </div>
        <div className="paperu-reader__zoom">
          <button
            type="button"
            className="paperu-reader__btn"
            onClick={() => {
              setFitMode("manual");
              setZoom((z) => Math.max(MIN_ZOOM, z - 0.25));
            }}
          >
            −
          </button>
          <span className="paperu-reader__zoom-level">
            {Math.round(zoom * 100)}%{fitMode === "fit-width" ? " · fit" : ""}
          </span>
          <button
            type="button"
            className="paperu-reader__btn"
            onClick={() => {
              setFitMode("manual");
              setZoom((z) => Math.min(MAX_ZOOM, z + 0.25));
            }}
          >
            +
          </button>
          <button
            type="button"
            className={`paperu-reader__btn${fitMode === "fit-width" ? " is-active" : ""}`}
            aria-pressed={fitMode === "fit-width"}
            onClick={() => {
              // TRUE fit-width (master prompt §659): compute the real scale
              // from containerWidth / naturalPageWidth. If the natural width
              // isn't known yet (page still rendering), mark fit-mode so the
              // resize effect will compute it on the next render.
              setFitMode("fit-width");
              const fit = computeFitZoom();
              if (fit !== null) setZoom(fit);
            }}
          >
            Fit width
          </button>
        </div>
      </header>
      {error && (
        <div className="paperu-reader__error" role="status">
          {error}
        </div>
      )}
      <div className="paperu-reader__viewport" ref={viewportRef}>
        {loading && <p className="paperu-reader__loading">Rendering page…</p>}
        <canvas ref={canvasRef} className="paperu-reader__canvas" />
      </div>
    </section>
  );
}
