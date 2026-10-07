/**
 * ImagesToPdfView — combine images into a single PDF.
 *
 * Select images → reorder → choose layout (fit/A4/original) → Build PDF →
 * output finalized to disk via canonical atomic-finalization. Each image
 * becomes one page. Respects orientation; never stretches.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { Card, Button } from "@paperu/ui";
import { imagesToPdf, type ImagePdfLayout, type PdfFitProgress } from "@/engines/pdf-engine";

interface StagedImage {
  path: string;
  result: InspectFileResponse;
}

type State =
  | { kind: "idle" }
  | { kind: "running"; progress: PdfFitProgress }
  | { kind: "done"; outputPath: string; outputSize: number; imageCount: number }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

const LAYOUTS: { id: ImagePdfLayout; label: string; desc: string }[] = [
  { id: "fit", label: "Fit page", desc: "Each image on its own page, capped size" },
  { id: "a4", label: "A4", desc: "Centered on A4 with margins" },
  { id: "original", label: "Original size", desc: "Page = image pixel size (in points)" },
];

export function ImagesToPdfView(): React.ReactNode {
  const [images, setImages] = useState<StagedImage[]>([]);
  const [layout, setLayout] = useState<ImagePdfLayout>("fit");
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen<DragDropEvent>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths ?? [];
      if (paths.length > 0 && !cancelled) void addPaths(paths);
    })
      .then((un) => {
        if (cancelled) un();
        else unlistenRef.current = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPaths = useCallback(async (paths: readonly string[]) => {
    for (const path of paths) {
      try {
        const result = await inspectFile(path);
        if (result.kind !== "image") continue;
        setImages((prev) => {
          if (prev.some((f) => f.path === path)) return prev;
          return [...prev, { path, result }];
        });
      } catch {
        // Skip files that can't be inspected.
      }
    }
  }, []);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Choose images — Paperu",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }],
      });
      if (selected === null) return;
      const paths: string[] = Array.isArray(selected)
        ? selected.filter((s): s is string => typeof s === "string")
        : typeof selected === "string" ? [selected] : [];
      await addPaths(paths);
    } catch {
      // Dialog dismissed.
    }
  }

  function removeAt(idx: number): void {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1): void {
    setImages((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }

  async function run(): Promise<void> {
    if (images.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", progress: { fraction: 0, stage: "Starting…" } });
    try {
      const fileObjs: File[] = [];
      for (const img of images) {
        const bytes = await readFileBytes(img.path);
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        fileObjs.push(new File([ab], img.result.fileName, { type: img.result.mimeType ?? "image/jpeg" }));
      }
      const pdfBytes = await imagesToPdf(fileObjs, {
        layout,
        signal: controller.signal,
        onProgress: (p) => setState({ kind: "running", progress: p }),
      });
      const finalized = await finalizeOutput(images[0]!.path, "-paperu", "pdf", pdfBytes);
      setState({
        kind: "done",
        outputPath: finalized.outputPath,
        outputSize: finalized.output.size.bytes,
        imageCount: images.length,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setState({ kind: "idle" });
      } else {
        setState({ kind: "error", error: err as AppError });
      }
    } finally {
      abortRef.current = null;
    }
  }

  function reset(): void {
    setImages([]);
    setState({ kind: "idle" });
  }

  return (
    <section className="paperu-section" aria-labelledby="i2p-heading">
      <header className="paperu-section__header">
        <h1 id="i2p-heading" className="paperu-text-display">Images → PDF</h1>
        <p className="paperu-text-lead">
          Turn scanned pages, receipts, or photos into a single PDF. Reorder,
          choose a layout, build locally.
        </p>
      </header>

      {images.length === 0 && state.kind === "idle" && (
        <div className="paperu-dropzone" role="region" aria-label="Drop images here or choose files">
          <div className="paperu-dropzone__inner">
            <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
            <p className="paperu-dropzone__title">Drop images here</p>
            <p className="paperu-dropzone__hint">JPEG, PNG, WebP, GIF, BMP — combine into one PDF.</p>
            <Button variant="accent" onClick={handlePick}>Choose images</Button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <>
          <Card className="paperu-staged">
            <div className="paperu-staged__head">
              <h2 className="paperu-text-heading">{images.length} image{images.length === 1 ? "" : "s"} · reorder below</h2>
              <button type="button" className="paperu-staged__clear" onClick={reset}>Clear</button>
            </div>
            <ol className="paperu-staged__list" style={{ listStyle: "none" }}>
              {images.map((img, i) => (
                <li key={img.path} className="paperu-staged__item">
                  <div className="paperu-staged__row">
                    <span className="paperu-staged__icon" aria-hidden="true">{i + 1}</span>
                    <span className="paperu-staged__icon" aria-hidden="true">🖼</span>
                    <div className="paperu-staged__meta">
                      <div className="paperu-staged__name paperu-truncate" title={img.path}>{img.result.fileName}</div>
                      <div className="paperu-staged__sub">
                        <span className="paperu-staged__size paperu-text-numeric">{img.result.size.humanReadable}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button type="button" className="paperu-staged__remove" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move up`} style={{ opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                      <button type="button" className="paperu-staged__remove" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label={`Move down`} style={{ opacity: i === images.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button type="button" className="paperu-staged__remove" onClick={() => removeAt(i)} aria-label={`Remove ${img.result.fileName}`}>✕</button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <div style={{ marginTop: "var(--paperu-space-4)", display: "flex", gap: "var(--paperu-space-3)" }}>
              <Button variant="outline" onClick={handlePick}>Add more</Button>
              <Button variant="accent" onClick={run} disabled={state.kind === "running"} style={{ flex: 1 }}>
                Build PDF from {images.length} image{images.length === 1 ? "" : "s"}
              </Button>
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Page layout</span>
              <div style={{ display: "grid", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }} className="paperu-layout-grid">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`paperu-target__preset${layout === l.id ? " is-active" : ""}`}
                    onClick={() => setLayout(l.id)}
                    aria-pressed={layout === l.id}
                    style={{ flexDirection: "column", alignItems: "flex-start", padding: "var(--paperu-space-3)", textAlign: "left" }}
                  >
                    <span style={{ fontWeight: 600 }}>{l.label}</span>
                    <span className="paperu-text-caption" style={{ opacity: 0.8 }}>{l.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}

      {state.kind === "running" && (
        <Card className="paperu-progress" aria-live="polite">
          <div className="paperu-progress__head">
            <span className="paperu-progress__stage">{state.progress.stage}</span>
            <span className="paperu-progress__pct">{state.progress.fraction == null ? "…" : `${Math.round(state.progress.fraction * 100)}%`}</span>
          </div>
          <div className="paperu-progress__bar" role="progressbar">
            <div
              className={state.progress.fraction == null ? "paperu-progress__fill paperu-progress__fill--indeterminate" : "paperu-progress__fill"}
              style={state.progress.fraction != null ? { width: `${state.progress.fraction * 100}%` } : undefined}
            />
          </div>
          <Button variant="outline" onClick={() => abortRef.current?.abort()} style={{ marginTop: "var(--paperu-space-4)", width: "100%" }}>Cancel</Button>
        </Card>
      )}

      {state.kind === "done" && (
        <Card className="paperu-fitresult" aria-live="polite">
          <div className="paperu-fitresult__stamps">
            <span className="paperu-stamp paperu-stamp--success">✓ Done</span>
            <span className="paperu-stamp paperu-stamp--accent">🔒 Processed locally</span>
          </div>
          <div className="paperu-fitresult__grid">
            <div>
              <div className="paperu-fitresult__stat-label">Images</div>
              <div className="paperu-fitresult__stat-value">{state.imageCount}</div>
            </div>
            <div>
              <div className="paperu-fitresult__stat-label">Result</div>
              <div className="paperu-fitresult__stat-value">{formatBytes(state.outputSize)}</div>
            </div>
          </div>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · Output saved next to the first image
          </p>
          <p className="paperu-section__privacy paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>
            <code className="paperu-text-code">{state.outputPath}</code>
          </p>
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={() => void openPath(state.outputPath)}>Open file</Button>
            <Button variant="outline" onClick={() => void revealPath(state.outputPath)}>Open folder</Button>
            <Button variant="ghost" onClick={reset}>Build another</Button>
          </div>
        </Card>
      )}

      {state.kind === "error" && (
        <Card className="paperu-error" role="alert">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{state.error.message}</h2>
          </div>
          <Button variant="ghost" onClick={reset} style={{ marginTop: "var(--paperu-space-3)" }}>Try again</Button>
        </Card>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
