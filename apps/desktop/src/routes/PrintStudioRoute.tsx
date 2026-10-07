/**
 * Print Studio route — produce a print-ready PDF (Master Prompt 4 §33-34,
 * Wave A §7 P1-B repair).
 *
 * CANONICAL NATIVE-PATH ARCHITECTURE (no basename):
 *   native Tauri picker → absolute PDF path
 *   → inspectFile(path) → validate it's really a PDF
 *   → readFileBytes(path) → bytes
 *   → pdf-lib embedPages (1-up / 2-up / 4-up on A4)
 *   → validatePdfBytes (truthful success)
 *   → finalizeOutput(REAL ABSOLUTE PATH, …)
 *
 * The browser <input type=file> returned File objects whose `.name` was
 * just a basename — passing that to finalize_output as sourcePath was
 * the broken architecture the master prompt §7 flagged. Fixed.
 *
 * V1: 1-up / 2-up / 4-up layout via pdf-lib embedPages. Direct printer
 * integration is intentionally NOT in V1 (per §0 — don't fake it);
 * the user opens the produced PDF in their OS print flow.
 *
 * Cancellable via AbortController (§10 style).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { validatePdfBytes } from "@/engines/pdf-engine";
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

type Layout = "1-up" | "2-up" | "4-up";

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse; layout: Layout }
  | { kind: "running"; stage: string }
  | { kind: "done"; outputPath: string }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

const LAYOUTS: ReadonlyArray<{ id: Layout; label: string }> = [
  { id: "1-up", label: "One per sheet" },
  { id: "2-up", label: "2 per sheet (exam style)" },
  { id: "4-up", label: "4 per sheet" },
];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export function PrintStudioRoute(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const stage = useWorkingFile((s) => s.stage);
  const addRecent = useRecentFiles((s) => s.add);

  const { staged } = useStagedFile("pdf");
  useEffect(() => {
    if (staged && state.kind === "idle") {
      setState({ kind: "ready", file: staged, layout: "2-up" });
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
      if (result.kind !== "pdf") {
        setState({
          kind: "error",
          error: {
            code: "unsupported.format",
            category: "unsupported",
            severity: "warning",
            recoverability: "action_required",
            message: "Print Studio needs a PDF.",
          },
        });
        return;
      }
      setState({ kind: "ready", file: result, layout: "2-up" });
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

  async function generate(): Promise<void> {
    if (state.kind !== "ready") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", stage: "Reading PDF…" });
    try {
      // Canonical native read — bytes come from the real absolute path.
      const bytes = await readFileBytes(state.file.path);
      throwIfAborted(controller.signal);
      const sourceBytes = new Uint8Array(bytes.byteLength);
      sourceBytes.set(bytes);

      setState({ kind: "running", stage: "Composing layout…" });
      const sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
      const sourcePageCount = sourceDoc.getPageCount();

      const outDoc = await PDFDocument.create();
      const embedded = await outDoc.embedPages(
        await outDoc.copyPages(sourceDoc, sourceDoc.getPageIndices()),
      );
      const font = await outDoc.embedFont(StandardFonts.Helvetica);

      const layout = state.layout;
      const perSheet = layout === "1-up" ? 1 : layout === "2-up" ? 2 : 4;
      const sheetCount = Math.ceil(sourcePageCount / perSheet);
      const A4_W = 595.28;
      const A4_H = 841.89;

      for (let sheetIdx = 0; sheetIdx < sheetCount; sheetIdx++) {
        throwIfAborted(controller.signal);
        const sheet = outDoc.addPage([A4_W, A4_H]);
        const margin = 18;
        const cellW = (A4_W - margin * 2) / (perSheet === 4 ? 2 : 1);
        const cellH = (A4_H - margin * 2) / (perSheet === 1 ? 1 : 2);
        for (let slot = 0; slot < perSheet; slot++) {
          const pageIdx = sheetIdx * perSheet + slot;
          if (pageIdx >= sourcePageCount) break;
          const page = embedded[pageIdx];
          if (!page) continue;
          const col = perSheet === 4 ? slot % 2 : 0;
          const row = perSheet === 1 ? 0 : perSheet === 2 ? slot : Math.floor(slot / 2);
          const cellX = margin + col * cellW;
          const cellY = A4_H - margin - (row + 1) * cellH;
          const scale = Math.min(cellW / page.width, cellH / page.height);
          const w = page.width * scale;
          const h = page.height * scale;
          const offsetX = cellX + (cellW - w) / 2;
          const offsetY = cellY + (cellH - h) / 2;
          sheet.drawPage(page, { x: offsetX, y: offsetY, xScale: scale, yScale: scale });
          sheet.drawText(String(pageIdx + 1), {
            x: cellX + 4,
            y: cellY + 4,
            size: 8,
            font,
            color: rgb(0.4, 0.4, 0.4),
          });
        }
      }

      throwIfAborted(controller.signal);
      setState({ kind: "running", stage: "Validating output…" });
      const outBytes = new Uint8Array(await outDoc.save({ useObjectStreams: true }));

      // Validate the output parses (truthful success — §47).
      const validation = await validatePdfBytes(outBytes);
      if (!validation.valid) {
        setState({
          kind: "error",
          error: {
            code: "engine.output_invalid",
            category: "internal",
            severity: "error",
            recoverability: "action_required",
            message: "Print-ready PDF didn't validate. Please report this.",
          },
        });
        return;
      }

      // Canonical finalization — pass the REAL absolute source path.
      const finalized = await finalizeOutput(state.file.path, `-print-${layout}`, "pdf", outBytes);
      stage(finalized.output, "pdf-fit", state.file.path);
      addRecent({
        path: finalized.outputPath,
        fileName: finalized.output.fileName,
        kind: finalized.output.kind,
        humanReadableSize: finalized.output.size.humanReadable,
        operation: `Print-ready ${layout}`,
        timestamp: Date.now(),
      });
      setState({ kind: "done", outputPath: finalized.outputPath });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setState({ kind: "ready", file: state.file, layout: state.layout });
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
    <section className="paperu-section" aria-labelledby="print-heading">
      <header className="paperu-section__header">
        <h1 id="print-heading" className="paperu-text-display">Print Studio</h1>
        <p className="paperu-text-lead">
          Make a print-ready PDF with 1-up, 2-up, or 4-up layout. Open it with your OS print flow.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div className="paperu-dropzone" role="region" aria-label="Drop a PDF here or choose one">
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⎙</div>
              <p className="paperu-dropzone__title">Drop a PDF here</p>
              <p className="paperu-dropzone__hint">
                {state.kind === "error" ? state.error.message : "Processed locally on this PC. 0 bytes uploaded."}
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
              <span className="paperu-text-label">Layout</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`paperu-target__preset${state.layout === l.id ? " is-active" : ""}`}
                    onClick={() => setState({ kind: "ready", file: state.file, layout: l.id })}
                    aria-pressed={state.layout === l.id}
                    style={{ padding: "var(--paperu-space-3)", textAlign: "left" }}
                  >
                    <span style={{ fontWeight: 600 }}>{l.label}</span>
                  </button>
                ))}
              </div>
              <Button
                variant="accent"
                onClick={generate}
                disabled={isRunning}
                style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}
              >
                Generate print-ready PDF
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
            <span className="paperu-stamp paperu-stamp--success">✓ Generated</span>
            <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
          </div>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · saved next to the source
          </p>
          <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>{state.outputPath}</p>
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={() => void openPath(state.outputPath)}>Open PDF</Button>
            <Button variant="outline" onClick={() => void revealPath(state.outputPath)}>Open folder</Button>
            <Button variant="ghost" onClick={reset}>Make another</Button>
          </div>
          <NextActions exclude="pdf-fit" />
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
