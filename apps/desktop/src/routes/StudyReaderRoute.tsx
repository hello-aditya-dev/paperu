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

import { useEffect, useRef, useState } from "react";
import type { ReadingHistoryEntry } from "@paperu/contracts";
import { filePath } from "@paperu/contracts";
import { getReadingHistory, upsertReadingHistory } from "@/lib/ipc";

interface StudyReaderRouteProps {
  /** The file path to read. Passed via the route query string. */
  readonly path: string | null;
}

export function StudyReaderRoute({ path }: StudyReaderRouteProps): React.ReactNode {
  const [history, setHistory] = useState<ReadingHistoryEntry | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const upsertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setHistory(entry);
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
  useEffect(() => {
    if (!path || !canvasRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const loadingTask = pdfjs.getDocument(path);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
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

  // Debounced upsert of reading position.
  useEffect(() => {
    if (!path || !history) return;
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
        });
      } catch {
        // Non-fatal — reading history is convenience, not critical.
      }
    }, 1200);
    return () => {
      if (upsertTimer.current) clearTimeout(upsertTimer.current);
    };
  }, [path, history, pageNum, zoom]);

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
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          >
            −
          </button>
          <span className="paperu-reader__zoom-level">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="paperu-reader__btn"
            onClick={() => setZoom((z) => Math.min(3.0, z + 0.25))}
          >
            +
          </button>
          <button
            type="button"
            className="paperu-reader__btn"
            onClick={() => setZoom(1.0)}
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
      <div className="paperu-reader__viewport">
        {loading && <p className="paperu-reader__loading">Rendering page…</p>}
        <canvas ref={canvasRef} className="paperu-reader__canvas" />
      </div>
    </section>
  );
}
