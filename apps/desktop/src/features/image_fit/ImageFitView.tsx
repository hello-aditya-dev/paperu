/**
 * ImageFitView — the "Make an image fit" experience.
 *
 * User drops/picks an image → sets a target → Paperu binary-searches
 * quality and dimensions → real result → finalized to disk via the
 * canonical atomic-finalization path. Transparency is preserved for
 * PNGs; JPEGs are used for photos.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { useWorkingFile } from "@/lib/working-file";
import { useStagedFile } from "@/hooks/useStagedFile";
import { NextActions } from "@/components/NextActions";
import { Card, Button } from "@paperu/ui";
import { TargetSizeInput, type TargetSize } from "@/components/TargetSizeInput";
import { fitImageToSize, type ImgFitProgress } from "@/engines/image-engine";

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse }
  | { kind: "running"; progress: ImgFitProgress }
  | {
      kind: "done";
      outputPath: string;
      outputSize: number;
      originalSize: number;
      targetBytes: number;
      requirementMet: boolean;
      width: number;
      height: number;
      transparencyPreserved: boolean;
      format: string;
      meta: { stepsTried: number; strategy: string };
    }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

export function ImageFitView(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [target, setTarget] = useState<TargetSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const stage = useWorkingFile((s) => s.stage);

  // Auto-load a staged working file if one exists (composable workflows).
  const { staged } = useStagedFile("image");
  useEffect(() => {
    if (staged && state.kind === "idle") {
      setState({ kind: "ready", file: staged });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged]);

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
      if (result.kind !== "image") {
        setState({
          kind: "error",
          error: {
            code: "unsupported.format",
            category: "unsupported",
            severity: "warning",
            recoverability: "action_required",
            message: "That file is not an image.",
            detail: "Make it fit works on images. Use the PDF tool for PDFs.",
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
        title: "Choose an image — Paperu",
        filters: [
          { name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] },
        ],
      });
      if (typeof selected === "string" && selected.length > 0) {
        await handlePath(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  function targetToBytes(t: TargetSize): number {
    const kb = t.unit === "KB" ? t.value : t.value * 1024;
    return Math.round(kb * 1024);
  }

  async function run(): Promise<void> {
    if (state.kind !== "ready" || !target) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const targetBytes = targetToBytes(target);
    setState({ kind: "running", progress: { fraction: 0, stage: "Starting…" } });
    try {
      const bytes = await readFileBytes(state.file.path);
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const file = new File([ab], state.file.fileName, {
        type: state.file.mimeType ?? "image/jpeg",
      });
      const result = await fitImageToSize(file, {
        targetBytes,
        signal: controller.signal,
        onProgress: (p) => setState({ kind: "running", progress: p }),
      });
      const ext = result.format === "png" ? "png" : result.format === "webp" ? "webp" : "jpg";
      const finalized = await finalizeOutput(
        state.file.path,
        "-paperu",
        ext,
        result.bytes,
      );
      // Stage the output for composable workflows (next action).
      stage(finalized.output, "image-fit", state.file.path);
      setState({
        kind: "done",
        outputPath: finalized.outputPath,
        outputSize: finalized.output.size.bytes,
        originalSize: result.originalSize,
        targetBytes: result.targetSize,
        requirementMet: result.requirementMet,
        width: result.width,
        height: result.height,
        transparencyPreserved: result.transparencyPreserved,
        format: result.format.toUpperCase(),
        meta: result.meta,
      });
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

  function cancel(): void {
    abortRef.current?.abort();
  }

  function reset(): void {
    setState({ kind: "idle" });
    setTarget(null);
  }

  // Hoisted outside the JSX so TypeScript does not narrow it inside the
  // `state.kind === "ready"` block (rapid-click defense).
  const isRunning = state.kind === "running";

  return (
    <section className="paperu-section" aria-labelledby="image-fit-heading">
      <header className="paperu-section__header">
        <h1 id="image-fit-heading" className="paperu-text-display">Make an image fit</h1>
        <p className="paperu-text-lead">
          Set a target. Paperu binary-searches quality and resolution to fit
          the limit. PNG transparency is preserved. Real bytes. No uploads.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div
            className={`paperu-dropzone${dragging ? " is-dragging" : ""}`}
            role="region"
            aria-label="Drop an image here or choose one"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer?.files?.[0];
              const path = (f as unknown as { path?: string })?.path;
              if (path) void handlePath(path);
            }}
          >
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
              <p className="paperu-dropzone__title">Drop an image here</p>
              <p className="paperu-dropzone__hint">
                {state.kind === "error" ? state.error.message : "JPEG, PNG, WebP — processed on this PC."}
              </p>
              <Button variant="accent" onClick={handlePick}>Choose an image</Button>
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
              <span className="paperu-staged__icon" aria-hidden="true">🖼</span>
              <div className="paperu-staged__meta">
                <div className="paperu-staged__name" title={state.file.path}>
                  {state.file.fileName}
                </div>
                <div className="paperu-staged__sub">
                  <span className="paperu-staged__kind">IMAGE</span>
                  <span className="paperu-staged__size">{state.file.size.humanReadable}</span>
                </div>
              </div>
              <button type="button" className="paperu-staged__remove" onClick={reset} aria-label="Remove file">
                ✕
              </button>
            </div>
          </Card>
          <Card>
            <TargetSizeInput
              sourceBytes={state.file.size.bytes}
              value={target}
              onChange={setTarget}
            />
            <div style={{ padding: "var(--paperu-space-5)", paddingTop: 0 }}>
              <Button variant="accent" onClick={run} disabled={!target || isRunning} style={{ width: "100%" }}>
                Make it fit
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
          <Button variant="outline" onClick={cancel} style={{ marginTop: "var(--paperu-space-4)", width: "100%" }}>
            Cancel
          </Button>
        </Card>
      )}

      {state.kind === "done" && (
        <Card className="paperu-fitresult" aria-live="polite">
          <div className="paperu-fitresult__stamps">
            <span className={state.requirementMet ? "paperu-stamp paperu-stamp--success" : "paperu-stamp"}>
              {state.requirementMet ? "✓ Requirement met" : "Lowest safe result"}
            </span>
            <span className="paperu-stamp paperu-stamp--accent">🔒 Processed locally</span>
          </div>
          <div className="paperu-fitresult__grid">
            <div>
              <div className="paperu-fitresult__stat-label">Original</div>
              <div className="paperu-fitresult__stat-value">{formatBytes(state.originalSize)}</div>
            </div>
            <div>
              <div className="paperu-fitresult__stat-label">Target</div>
              <div className="paperu-fitresult__stat-value">{formatBytes(state.targetBytes)}</div>
            </div>
            <div>
              <div className="paperu-fitresult__stat-label">Result</div>
              <div className={state.requirementMet
                ? "paperu-fitresult__stat-value paperu-fitresult__stat-value--accent"
                : "paperu-fitresult__stat-value"}>
                {formatBytes(state.outputSize)}
              </div>
            </div>
            <div>
              <div className="paperu-fitresult__stat-label">Reduction</div>
              <div className="paperu-fitresult__stat-value">{reductionPct(state.originalSize, state.outputSize)}%</div>
            </div>
          </div>
          <dl className="paperu-fitresult__meta">
            <div><dt>Dimensions</dt><dd>{state.width} × {state.height}px</dd></div>
            <div><dt>Format</dt><dd>{state.format}</dd></div>
            <div><dt>Steps</dt><dd>{state.meta.stepsTried}</dd></div>
            <div><dt>Strategy</dt><dd>{state.meta.strategy}</dd></div>
            {state.transparencyPreserved && <div><dt>Transparency</dt><dd>Preserved (PNG)</dd></div>}
          </dl>
          {!state.requirementMet && (
            <p className="paperu-fitresult__warning">
              Paperu couldn&apos;t safely reach the target without unacceptable quality loss.
              The file above is the smallest valid output produced.
            </p>
          )}
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={() => void openPath(state.outputPath)}>Open file</Button>
            <Button variant="outline" onClick={() => void revealPath(state.outputPath)}>Open folder</Button>
            <Button variant="ghost" onClick={reset}>Process another</Button>
          </div>
          <NextActions exclude="image-fit" />
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · Output saved next to the original
          </p>
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
function reductionPct(original: number, result: number): string {
  if (original <= 0) return "0.0";
  return ((original - result) / original * 100).toFixed(1);
}
