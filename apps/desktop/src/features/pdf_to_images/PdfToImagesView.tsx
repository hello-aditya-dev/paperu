/**
 * PdfToImagesView — render PDF pages to PNG or JPEG images.
 *
 * Select PDF → choose format (PNG/JPEG) + resolution → optionally specify
 * page ranges → Render → outputs finalized to disk individually.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput } from "@/lib/ipc";
import { Card, Button } from "@paperu/ui";
import { pdfToImages, parsePageRanges, type PdfFitProgress } from "@/engines/pdf-engine";

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse }
  | { kind: "running"; progress: PdfFitProgress }
  | { kind: "done"; outputs: string[] }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

export function PdfToImagesView(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [scale, setScale] = useState(1.5);
  const [rangeText, setRangeText] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen<DragDropEvent>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths ?? [];
      if (paths.length > 0 && !cancelled) void handlePath(paths[0]!);
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

  const handlePath = useCallback(async (path: string) => {
    setState({ kind: "inspecting", path });
    try {
      const result = await inspectFile(path);
      if (result.kind !== "pdf") {
        setState({
          kind: "error",
          error: {
            code: "unsupported.format",
            category: "unsupported",
            severity: "warning",
            recoverability: "action_required",
            message: "That file is not a PDF.",
          },
        });
        return;
      }
      setState({ kind: "ready", file: result });
    } catch (err) {
      setState({ kind: "error", error: err as AppError });
    }
  }, []);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a PDF — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        await handlePath(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function run(): Promise<void> {
    if (state.kind !== "ready") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", progress: { fraction: 0, stage: "Starting…" } });
    try {
      const bytes = await readFileBytes(state.file.path);
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const file = new File([ab], state.file.fileName, { type: "application/pdf" });

      let pages: number[] | undefined;
      if (rangeText.trim()) {
        try {
          const indices = parsePageRanges(rangeText, 9999);
          pages = indices.map((i) => i + 1);
          setRangeError(null);
        } catch (e) {
          setRangeError(e instanceof Error ? e.message : "Invalid range.");
          setState({ kind: "ready", file: state.file });
          return;
        }
      }

      const outputs = await pdfToImages(file, {
        format,
        scale,
        pages,
        signal: controller.signal,
        onProgress: (p) => setState({ kind: "running", progress: p }),
      });

      const outputPaths: string[] = [];
      const ext = format === "png" ? "png" : "jpg";
      for (const o of outputs) {
        const finalized = await finalizeOutput(state.file.path, `-${o.name.replace(/\.[^.]+$/, "")}`, ext, o.bytes);
        outputPaths.push(finalized.outputPath);
      }
      setState({ kind: "done", outputs: outputPaths });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setState({ kind: "ready", file: state.file });
      } else {
        setState({ kind: "error", error: err as AppError });
      }
    } finally {
      abortRef.current = null;
    }
  }

  function reset(): void {
    setState({ kind: "idle" });
    setRangeText("");
    setRangeError(null);
  }

  return (
    <section className="paperu-section" aria-labelledby="p2i-heading">
      <header className="paperu-section__header">
        <h1 id="p2i-heading" className="paperu-text-display">PDF → Images</h1>
        <p className="paperu-text-lead">
          Render each page to PNG or JPEG, at the resolution you choose. Outputs
          saved individually next to the source.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div className="paperu-dropzone" role="region" aria-label="Drop a PDF here or choose one">
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
              <p className="paperu-dropzone__title">Drop a PDF here</p>
              <p className="paperu-dropzone__hint">{state.kind === "error" ? state.error.message : "Render pages to PNG or JPEG."}</p>
              <Button variant="accent" onClick={handlePick}>Choose a PDF</Button>
            </div>
          </div>
          {state.kind === "error" && (
            <Card className="paperu-error" role="alert">
              <div className="paperu-error__head">
                <span className="paperu-error__badge" aria-hidden="true">!</span>
                <h2 className="paperu-error__title">{state.error.message}</h2>
              </div>
              <Button variant="ghost" onClick={reset} style={{ marginTop: "var(--paperu-space-3)" }}>Try again</Button>
            </Card>
          )}
        </>
      )}

      {state.kind === "inspecting" && (
        <Card className="paperu-progress" aria-live="polite">
          <p className="paperu-progress__stage">Reading {state.path}…</p>
        </Card>
      )}

      {state.kind === "ready" && (
        <>
          <Card className="paperu-staged">
            <div className="paperu-staged__row">
              <span className="paperu-staged__icon" aria-hidden="true">📄</span>
              <div className="paperu-staged__meta">
                <div className="paperu-staged__name paperu-truncate" title={state.file.path}>{state.file.fileName}</div>
                <div className="paperu-staged__sub">
                  <span className="paperu-staged__kind">PDF</span>
                  <span className="paperu-staged__size paperu-text-numeric">{state.file.size.humanReadable}</span>
                </div>
              </div>
              <button type="button" className="paperu-staged__remove" onClick={reset} aria-label="Remove file">✕</button>
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Format</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                {(["png", "jpeg"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`paperu-target__preset${format === f ? " is-active" : ""}`}
                    onClick={() => setFormat(f)}
                    aria-pressed={format === f}
                    style={{ flexDirection: "column", alignItems: "flex-start", padding: "var(--paperu-space-3)", textAlign: "left" }}
                  >
                    <span style={{ fontWeight: 600 }}>{f.toUpperCase()}</span>
                    <span className="paperu-text-caption" style={{ opacity: 0.8 }}>{f === "jpeg" ? "Smaller file" : "Lossless"}</span>
                  </button>
                ))}
              </div>

              <div style={{ marginTop: "var(--paperu-space-4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="paperu-text-label">Resolution scale</span>
                  <span className="paperu-text-numeric">{scale.toFixed(2)}× <span className="paperu-text-caption">(~{Math.round(scale * 72)} DPI)</span></span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.25}
                  value={scale}
                  onChange={(e) => setScale(parseFloat(e.target.value))}
                  style={{ width: "100%", marginTop: "var(--paperu-space-2)" }}
                  aria-label="Resolution scale"
                />
              </div>

              <div style={{ marginTop: "var(--paperu-space-4)" }}>
                <label className="paperu-text-label" htmlFor="p2i-ranges">Pages (optional — blank = all)</label>
                <input
                  id="p2i-ranges"
                  className="paperu-target__input"
                  placeholder="e.g. 1-3, 5 (blank = all pages)"
                  value={rangeText}
                  onChange={(e) => { setRangeText(e.target.value); setRangeError(null); }}
                  aria-invalid={!!rangeError}
                  style={{ width: "100%", marginTop: "var(--paperu-space-2)" }}
                />
                {rangeError && <p className="paperu-target__error">{rangeError}</p>}
              </div>

              <Button variant="accent" onClick={run} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
                Render to {format.toUpperCase()}
              </Button>
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
              <div className="paperu-fitresult__stat-label">Outputs</div>
              <div className="paperu-fitresult__stat-value">{state.outputs.length}</div>
            </div>
          </div>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · {state.outputs.length} file{state.outputs.length === 1 ? "" : "s"} saved next to the source
          </p>
          <ul style={{ marginTop: "var(--paperu-space-3)", fontSize: "var(--paperu-text-xs)", color: "var(--paperu-text-muted)", listStyle: "none", padding: 0, maxHeight: "200px", overflowY: "auto" }}>
            {state.outputs.map((p) => (
              <li key={p} className="paperu-text-code paperu-break-all" style={{ marginBottom: "4px" }}>{p}</li>
            ))}
          </ul>
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={reset}>Render another</Button>
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
