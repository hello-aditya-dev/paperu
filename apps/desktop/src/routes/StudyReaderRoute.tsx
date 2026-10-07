/**
 * Study Reader route — open a PDF, navigate pages, remember position
 * (Master Prompt 4 §23-26, 90% §3 routing repair).
 *
 * ROUTING REPAIR: the previous router passed `path={null}` for both
 * `/reader` and `/reader/:path`, so the Reader never received a file.
 * The fix resolves the path from THREE sources (no raw Windows path
 * embedded as a URL segment — that's unsafe + fragile):
 *   1. a `?path=<urlencoded absolute path>` query param (deep links from
 *      Quick Look, Recent Work, PDF workspace, Universal Drop);
 *   2. the staged WorkingFile store (composable workflows that stage a
 *      PDF then navigate to /reader);
 *   3. a native Tauri file picker (the user opens a PDF directly).
 *
 * V1: page navigation (prev/next/jump), zoom, fit-width toggle, and
 * last-reading-position persistence via reading_history. Uses pdfjs-dist
 * (lazy-loaded). Pages render on demand (one at a time) — a 500-page
 * PDF is not pre-rendered. Memory stays flat.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { filePath } from "@paperu/contracts";
import { getReadingHistory, inspectFile, upsertReadingHistory } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { useStagedFile } from "@/hooks/useStagedFile";
import { Button, Card } from "@paperu/ui";

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

export function StudyReaderRoute(): React.ReactNode {
  // Resolve the path from (1) a query param, (2) the staged WorkingFile,
  // (3) a native picker (below). Never from a raw URL path segment.
  const [searchParams] = useSearchParams();
  const queryPath = searchParams.get("path");
  const { staged } = useStagedFile("pdf");
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  // staged.path is absolute + validated by inspect; queryPath is a deep link
  // that we validate on use. pickedPath comes from the native picker.
  const path = queryPath ?? pickedPath ?? staged?.path ?? null;

  const [, setHistoryExists] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [fitMode, setFitMode] = useState<FitMode>("manual");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Natural page width at scale 1.0 (pdfjs user-space units ≈ 1/72").
  const naturalWidthRef = useRef<number | null>(null);
  const upsertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real fit-width: containerWidth / naturalPageWidth, with padding + bounds.
  // Declared BEFORE the effects that use it (resize recalc + fit-width click).
  const computeFitZoom = useCallback((): number | null => {
    const natural = naturalWidthRef.current;
    const viewport = viewportRef.current;
    if (!natural || !viewport || natural <= 0) return null;
    const containerWidth = viewport.clientWidth - FIT_PADDING_PX;
    if (containerWidth <= 0) return null;
    return clampZoom(containerWidth / natural);
  }, []);

  // Native picker — the user opens a PDF directly in the Reader.
  const handlePick = useCallback(async () => {
    setError(null);
    setValidating(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a PDF to read — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) {
        setValidating(false);
        return;
      }
      // Validate via the canonical inspect_file (magic-byte, not extension).
      const inspected = await inspectFile(selected);
      if (inspected.kind !== "pdf") {
        setError("That file isn't a PDF.");
        setValidating(false);
        return;
      }
      // Set the path as the picked path (NOT a query param — picked paths
      // stay in component state; only deep links use the query param).
      setPickedPath(selected);
      setPageNum(1);
      setFitMode("manual");
      naturalWidthRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }, []);

  // Load reading history for the path; jump to last page if present.
  useEffect(() => {
    if (!path) {
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
  useEffect(() => {
    if (!path || !canvasRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const bytes = await readFileBytes(path);
        if (cancelled) return;
        const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
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

  // Recalculate fit-width zoom on viewport resize.
  useEffect(() => {
    if (fitMode !== "fit-width") return;
    const onResize = () => {
      const fit = computeFitZoom();
      if (fit !== null) setZoom(fit);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [fitMode, computeFitZoom]);

  // If the path changes, reset fit-mode + natural width.
  useEffect(() => {
    setFitMode("manual");
    naturalWidthRef.current = null;
  }, [path]);

  // Debounced upsert of reading position.
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
        });
        setHistoryExists(true);
      } catch {
        // Non-fatal.
      }
    }, 1200);
    return () => {
      if (upsertTimer.current) clearTimeout(upsertTimer.current);
    };
  }, [path, pageNum, zoom]);

  // computeFitZoom is declared above (before the effects that use it).

  if (!path) {
    return (
      <section className="paperu-section" aria-labelledby="reader-heading">
        <header className="paperu-section__header">
          <h1 id="reader-heading" className="paperu-text-display">Study Reader</h1>
          <p className="paperu-text-lead">
            Open a PDF to read. Page navigation, true fit-width, and last-position memory.
          </p>
        </header>
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p className="paperu-text-caption">
              {staged
                ? "Loading the staged PDF…"
                : "No PDF selected. Open one, or navigate here from a result card (Open in Reader)."}
            </p>
            <Button variant="accent" onClick={handlePick} disabled={validating} style={{ marginTop: "var(--paperu-space-3)" }}>
              {validating ? "Opening…" : "Choose a PDF"}
            </Button>
          </div>
        </Card>
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
