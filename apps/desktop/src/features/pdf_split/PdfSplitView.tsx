/**
 * PdfSplitView — extract selected pages or split a PDF into one file per page.
 *
 * Range syntax: "1-3, 5, 8-10". Validated strictly; invalid ranges are
 * rejected, never silently ignored. Outputs finalized to disk via the
 * canonical atomic-finalization path.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { Card, Button } from "@paperu/ui";
import {
  parsePageRanges,
  extractPages,
  splitEveryPage,
  type PdfFitProgress,
} from "@/engines/pdf-engine";

type Mode = "extract" | "split-all";

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse }
  | { kind: "running"; progress: PdfFitProgress }
  | { kind: "done"; outputs: string[]; mode: Mode }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

export function PdfSplitView(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [mode, setMode] = useState<Mode>("extract");
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

  // Live-parse ranges.
  const parsedIndices: number[] | null = (() => {
    if (mode !== "extract" || !rangeText.trim() || state.kind !== "ready") return null;
    try {
      return parsePageRanges(rangeText, 9999); // We don't know page count without reading; use a high bound.
    } catch {
      return null;
    }
  })();

  function validateRange(): number[] | null {
    if (mode !== "extract") return null;
    if (!rangeText.trim()) {
      setRangeError("Enter a page range like 1-3, 5.");
      return null;
    }
    try {
      const indices = parsePageRanges(rangeText, 9999);
      setRangeError(null);
      return indices;
    } catch (e) {
      setRangeError(e instanceof Error ? e.message : "Invalid range.");
      return null;
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

      if (mode === "extract") {
        const indices = validateRange();
        if (!indices) {
          setState({ kind: "ready", file: state.file });
          return;
        }
        const out = await extractPages(file, indices, {
          signal: controller.signal,
          onProgress: (p) => setState({ kind: "running", progress: p }),
        });
        const finalized = await finalizeOutput(state.file.path, "-extracted", "pdf", out);
        setState({ kind: "done", outputs: [finalized.outputPath], mode });
      } else {
        const parts = await splitEveryPage(file, {
          signal: controller.signal,
          onProgress: (p) => setState({ kind: "running", progress: p }),
        });
        const outputs: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          const finalized = await finalizeOutput(
            state.file.path,
            `-page-${i + 1}`,
            "pdf",
            parts[i]!,
          );
          outputs.push(finalized.outputPath);
        }
        setState({ kind: "done", outputs, mode });
      }
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
    <section className="paperu-section" aria-labelledby="split-heading">
      <header className="paperu-section__header">
        <h1 id="split-heading" className="paperu-text-display">Split / Extract</h1>
        <p className="paperu-text-lead">
          Extract selected pages by range, or split a PDF into one file per
          page. Ranges are validated strictly — invalid input is rejected,
          never silently ignored.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div
            className="paperu-dropzone"
            role="region"
            aria-label="Drop a PDF here or choose one"
          >
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
              <p className="paperu-dropzone__title">Drop a PDF here</p>
              <p className="paperu-dropzone__hint">
                {state.kind === "error" ? state.error.message : "Extract pages or split into individual files."}
              </p>
              <Button variant="accent" onClick={handlePick}>Choose a PDF</Button>
            </div>
          </div>
          {state.kind === "error" && (
            <Card className="paperu-error" role="alert">
              <div className="paperu-error__head">
                <span className="paperu-error__badge" aria-hidden="true">!</span>
                <h2 className="paperu-error__title">{state.error.message}</h2>
              </div>
              <Button variant="ghost" onClick={reset} style={{ marginTop: "var(--paperu-space-3)" }}>
                Try again
              </Button>
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
                <div className="paperu-staged__name" title={state.file.path}>
                  {state.file.fileName}
                </div>
                <div className="paperu-staged__sub">
                  <span className="paperu-staged__kind">PDF</span>
                  <span className="paperu-staged__size">{state.file.size.humanReadable}</span>
                </div>
              </div>
              <button type="button" className="paperu-staged__remove" onClick={reset} aria-label="Remove file">✕</button>
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginBottom: "var(--paperu-space-4)" }}>
                <button
                  type="button"
                  className={`paperu-target__preset${mode === "extract" ? " is-active" : ""}`}
                  onClick={() => setMode("extract")}
                  aria-pressed={mode === "extract"}
                >Extract pages</button>
                <button
                  type="button"
                  className={`paperu-target__preset${mode === "split-all" ? " is-active" : ""}`}
                  onClick={() => setMode("split-all")}
                  aria-pressed={mode === "split-all"}
                >Split every page</button>
              </div>

              {mode === "extract" ? (
                <>
                  <label className="paperu-target__label" htmlFor="ranges">Pages to extract</label>
                  <input
                    id="ranges"
                    className="paperu-target__input"
                    placeholder="e.g. 1-3, 5, 8-10"
                    value={rangeText}
                    onChange={(e) => { setRangeText(e.target.value); setRangeError(null); }}
                    aria-invalid={!!rangeError}
                  />
                  {rangeError && <p className="paperu-target__error">{rangeError}</p>}
                  {parsedIndices && !rangeError && (
                    <p className="paperu-target__hint">
                      Will extract <strong>{parsedIndices.length}</strong> page{parsedIndices.length === 1 ? "" : "s"}.
                    </p>
                  )}
                  {!rangeError && !parsedIndices && (
                    <p className="paperu-target__hint">Use formats like 1-3, 5, 8-10.</p>
                  )}
                </>
              ) : (
                <p className="paperu-target__hint">
                  Creates one PDF per page, each named page-1.pdf, page-2.pdf, …
                </p>
              )}

              <Button
                variant="accent"
                onClick={run}
                disabled={mode === "extract" && !rangeText.trim()}
                style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}
              >
                {mode === "extract" ? "Extract pages" : "Split every page"}
              </Button>
            </div>
          </Card>
        </>
      )}

      {state.kind === "running" && (
        <Card className="paperu-progress" aria-live="polite">
          <div className="paperu-progress__head">
            <span className="paperu-progress__stage">{state.progress.stage}</span>
            <span className="paperu-progress__pct">
              {state.progress.fraction == null ? "…" : `${Math.round(state.progress.fraction * 100)}%`}
            </span>
          </div>
          <div className="paperu-progress__bar" role="progressbar">
            <div
              className={state.progress.fraction == null
                ? "paperu-progress__fill paperu-progress__fill--indeterminate"
                : "paperu-progress__fill"}
              style={state.progress.fraction != null
                ? { width: `${state.progress.fraction * 100}%` }
                : undefined}
            />
          </div>
          <Button variant="outline" onClick={() => abortRef.current?.abort()} style={{ marginTop: "var(--paperu-space-4)", width: "100%" }}>
            Cancel
          </Button>
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
          <ul style={{ marginTop: "var(--paperu-space-3)", fontSize: "var(--paperu-text-xs)", wordBreak: "break-all", color: "var(--paperu-text-muted)", listStyle: "none", padding: 0 }}>
            {state.outputs.map((p) => (
              <li key={p} style={{ fontFamily: "var(--paperu-font-mono)", marginBottom: "4px" }}>{p}</li>
            ))}
          </ul>
          <div className="paperu-fitresult__actions">
            <Button
              variant="accent"
              onClick={() => void openPath(state.outputs[0]!)}
              disabled={state.outputs.length === 0}
            >
              Open first file
            </Button>
            <Button
              variant="outline"
              onClick={() => void revealPath(state.outputs[0]!)}
              disabled={state.outputs.length === 0}
            >
              Open folder
            </Button>
            <Button variant="ghost" onClick={reset}>Split another</Button>
          </div>
        </Card>
      )}
    </section>
  );
}
