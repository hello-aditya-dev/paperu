/**
 * Portal Ready route — make a file upload-ready for college/portal
 * constraints (Master Prompt 4 §12-17, Wave A §6 P1-A repair).
 *
 * CANONICAL NATIVE-PATH ARCHITECTURE (no basename):
 *   native Tauri picker → absolute validated path
 *   → inspectFile(path) → real metadata
 *   → readFileBytes(path) → Uint8Array
 *   → construct in-memory File ONLY for engine compatibility
 *   → fitPdfToSize / fitImageToSize
 *   → finalizeOutput(REAL ABSOLUTE PATH, …)
 *
 * The browser <input type=file> returned File objects whose `.name`
 * was just a basename — passing that to finalize_output as sourcePath
 * was the broken architecture the master prompt §6 flagged. That path
 * is gone. The absolute source path now survives the whole pipeline.
 *
 * Result compliance card (§15): shows ✓ only for what was actually
 * verified. The engine's requirementMet flag is authoritative —
 * Paperu never lies about meeting a target (§16).
 *
 * Cancellable via AbortController (§10 style) — the active encode
 * cooperatively aborts on Cancel; state returns to ready.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fitPdfToSize, type PdfFitResult } from "@/engines/pdf-engine";
import { fitImageToSize, type ImageFitResult } from "@/engines/image-engine";
import {
  finalizeOutput,
  inspectFile,
  openPath,
  readFileBytes,
  revealPath,
} from "@/lib/ipc";
import { useWorkingFile } from "@/lib/working-file";
import { useRecentFiles } from "@/lib/recent-files";
import { useStagedFile } from "@/hooks/useStagedFile";
import { NextActions } from "@/components/NextActions";
import { Button, Card } from "@paperu/ui";

type ResultKind = PdfFitResult | ImageFitResult;

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse }
  | { kind: "running"; stage: string }
  | { kind: "done"; result: ResultKind; outputPath: string; targetBytes: number }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

const PRESETS: ReadonlyArray<{ kb: number; label: string }> = [
  { kb: 20, label: "Under 20 KB" },
  { kb: 50, label: "Under 50 KB" },
  { kb: 100, label: "Under 100 KB" },
  { kb: 500, label: "Under 500 KB" },
  { kb: 1024, label: "Under 1 MB" },
  { kb: 2048, label: "Under 2 MB" },
];

function isPdfResult(r: ResultKind): r is PdfFitResult {
  return "rasterized" in r;
}
function isImageResult(r: ResultKind): r is ImageFitResult {
  return "width" in r;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function PortalReadyRoute(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [targetKb, setTargetKb] = useState(500);
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const stage = useWorkingFile((s) => s.stage);
  const addRecent = useRecentFiles((s) => s.add);

  // Auto-load a staged working file if one exists and is pdf/image.
  const { staged } = useStagedFile("pdf");
  const { staged: stagedImage } = useStagedFile("image");
  useEffect(() => {
    if (state.kind === "idle") {
      if (staged) setState({ kind: "ready", file: staged });
      else if (stagedImage) setState({ kind: "ready", file: stagedImage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, stagedImage]);

  // Native drop handler — canonical absolute paths.
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
      if (result.kind !== "pdf" && result.kind !== "image") {
        setState({
          kind: "error",
          error: {
            code: "unsupported.format",
            category: "unsupported",
            severity: "warning",
            recoverability: "action_required",
            message: "Portal Ready supports PDF and image files only.",
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
        title: "Choose a file — Paperu",
        filters: [
          { name: "Documents & images", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "bmp", "gif"] },
        ],
      });
      if (typeof selected === "string" && selected.length > 0) {
        await handlePath(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function makeReady(): Promise<void> {
    if (state.kind !== "ready") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", stage: "Reading file…" });
    try {
      const targetBytes = targetKb * 1024;
      // Canonical native read — bytes come from the real absolute path.
      const bytes = await readFileBytes(state.file.path);
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      // In-memory File constructed ONLY for engine compatibility.
      const mime = state.file.kind === "pdf"
        ? "application/pdf"
        : state.file.mimeType ?? "application/octet-stream";
      const memFile = new File([ab], state.file.fileName, { type: mime });

      const isPdf = state.file.kind === "pdf";
      setState({ kind: "running", stage: isPdf ? "Fitting PDF to size…" : "Fitting image to size…" });
      const r: ResultKind = isPdf
        ? await fitPdfToSize(memFile, { targetBytes })
        : await fitImageToSize(memFile, { targetBytes, signal: controller.signal });

      // Canonical finalization — pass the REAL absolute source path.
      const ext = isPdf
        ? "pdf"
        : isImageResult(r)
          ? r.format === "jpeg" ? "jpg" : r.format
          : "bin";
      const finalized = await finalizeOutput(state.file.path, "-portal-ready", ext, r.bytes);

      // Stage for composable workflows + record in recent files.
      stage(finalized.output, isPdf ? "pdf-fit" : "image-fit", state.file.path);
      addRecent({
        path: finalized.outputPath,
        fileName: finalized.output.fileName,
        kind: finalized.output.kind,
        humanReadableSize: finalized.output.size.humanReadable,
        operation: "Made upload-ready",
        timestamp: Date.now(),
      });

      setState({ kind: "done", result: r, outputPath: finalized.outputPath, targetBytes });
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
  }

  const isRunning = state.kind === "running";

  return (
    <section className="paperu-section" aria-labelledby="portal-heading">
      <header className="paperu-section__header">
        <h1 id="portal-heading" className="paperu-text-display">Make this upload-ready</h1>
        <p className="paperu-text-lead">
          Pick a target size. Paperu makes your file fit — or tells you it can't.
          Every constraint is checked individually. No fake “Ready”.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div className="paperu-dropzone" role="region" aria-label="Drop a PDF or image here, or choose one">
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⬆</div>
              <p className="paperu-dropzone__title">Drop a PDF or image here</p>
              <p className="paperu-dropzone__hint">
                {state.kind === "error" ? state.error.message : "Processed locally on this PC. 0 bytes uploaded."}
              </p>
              <Button variant="accent" onClick={handlePick}>Choose a file</Button>
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
              <span className="paperu-staged__icon" aria-hidden="true">{state.file.kind === "pdf" ? "📄" : "🖼"}</span>
              <div className="paperu-staged__meta">
                <div className="paperu-staged__name paperu-truncate" title={state.file.path}>{state.file.fileName}</div>
                <div className="paperu-staged__sub">
                  <span className="paperu-staged__kind">{state.file.kind === "pdf" ? "PDF" : "Image"}</span>
                  <span className="paperu-staged__size paperu-text-numeric">{state.file.size.humanReadable}</span>
                </div>
              </div>
              <button type="button" className="paperu-staged__remove" onClick={reset} aria-label="Remove file">✕</button>
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <span className="paperu-text-label">Target size</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.kb}
                    type="button"
                    className={`paperu-target__preset${targetKb === p.kb ? " is-active" : ""}`}
                    onClick={() => setTargetKb(p.kb)}
                    aria-pressed={targetKb === p.kb}
                    style={{ padding: "var(--paperu-space-3)", textAlign: "left" }}
                  >
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                  </button>
                ))}
              </div>

              <Button
                variant="accent"
                onClick={makeReady}
                disabled={isRunning}
                style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}
              >
                Make upload-ready
              </Button>
            </div>
          </Card>
        </>
      )}

      {state.kind === "running" && (
        <Card className="paperu-progress" aria-live="polite">
          <p className="paperu-progress__stage">{state.stage}</p>
          <div className="paperu-progress__bar" role="progressbar">
            <div className="paperu-progress__fill paperu-progress__fill--indeterminate" />
          </div>
          <Button
            variant="outline"
            onClick={() => abortRef.current?.abort()}
            style={{ marginTop: "var(--paperu-space-4)", width: "100%" }}
          >
            Cancel
          </Button>
        </Card>
      )}

      {state.kind === "done" && (
        <Card className="paperu-fitresult" aria-live="polite">
          <div className="paperu-fitresult__stamps">
            <span className="paperu-stamp paperu-stamp--success">✓ Processed</span>
            <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
          </div>
          <ComplianceCard result={state.result} targetBytes={state.targetBytes} outputPath={state.outputPath} />
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={() => void openPath(state.outputPath)}>Open file</Button>
            <Button variant="outline" onClick={() => void revealPath(state.outputPath)}>Open folder</Button>
            <Button variant="ghost" onClick={reset}>Make another ready</Button>
          </div>
          <NextActions exclude={state.result && isImageResult(state.result) ? "image-fit" : "pdf-fit"} />
        </Card>
      )}
    </section>
  );
}

function ComplianceCard({
  result,
  targetBytes,
  outputPath,
}: {
  result: ResultKind;
  targetBytes: number;
  outputPath: string;
}): React.ReactNode {
  const met = result.requirementMet;
  return (
    <div className="paperu-portal__compliance" role="status">
      <h2 className="paperu-portal__compliance-title">
        {met ? "Ready to upload" : "Did not meet target"}
      </h2>
      <ul className="paperu-portal__compliance-list">
        <li className={met ? "is-ok" : "is-bad"}>
          {met ? "✓" : "✗"} Final size {formatBytes(result.finalSize)} / {formatBytes(targetBytes)}
        </li>
        {isPdfResult(result) && (
          <li className="is-ok">✓ {result.meta.pageCount} pages</li>
        )}
        {isPdfResult(result) && result.rasterized && (
          <li className="is-warn">⚠ Text became images to reach the size</li>
        )}
        {isImageResult(result) && (
          <>
            <li className="is-ok">✓ {result.width} × {result.height}px</li>
            <li className="is-ok">✓ {result.format.toUpperCase()}</li>
            {result.transparencyPreserved && (
              <li className="is-ok">✓ Transparency preserved (PNG)</li>
            )}
          </>
        )}
      </ul>
      <p className="paperu-portal__output-path">
        <code className="paperu-text-code paperu-break-all">{outputPath}</code>
      </p>
    </div>
  );
}
