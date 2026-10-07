/**
 * PdfMergeView — merge multiple PDFs into one, in the user's chosen order.
 *
 * Select PDFs → reorder → Merge → valid output finalized to disk via
 * the canonical atomic-finalization path. Merge is not compression;
 * the result card shows DONE without reduction language.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { useWorkingFile } from "@/lib/working-file";
import { useRecentFiles } from "@/lib/recent-files";
import { useStagedFile } from "@/hooks/useStagedFile";
import { NextActions } from "@/components/NextActions";
import { Card, Button } from "@paperu/ui";
import { mergePdfs, type PdfFitProgress } from "@/engines/pdf-engine";

interface StagedPdf {
  path: string;
  result: InspectFileResponse;
}

type State =
  | { kind: "idle" }
  | { kind: "running"; progress: PdfFitProgress }
  | {
      kind: "done";
      outputPath: string;
      outputSize: number;
      sourceCount: number;
    }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

export function PdfMergeView(): React.ReactNode {
  const [files, setFiles] = useState<StagedPdf[]>([]);
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const stage = useWorkingFile((s) => s.stage);
  const addRecent = useRecentFiles((s) => s.add);

  // Auto-load a staged working file if one exists (composable workflows).
  const { staged } = useStagedFile("pdf");
  useEffect(() => {
    if (staged && state.kind === "idle") {
      setFiles((prev) => {
        if (prev.some((f) => f.path === staged.path)) return prev;
        return [...prev, { path: staged.path, result: staged }];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged]);

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
        if (result.kind !== "pdf") continue;
        setFiles((prev) => {
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
        title: "Choose PDFs to merge — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
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
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1): void {
    setFiles((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }

  async function run(): Promise<void> {
    if (files.length < 2) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", progress: { fraction: 0, stage: "Starting…" } });
    try {
      const fileObjs: File[] = [];
      for (const f of files) {
        const bytes = await readFileBytes(f.path);
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        fileObjs.push(new File([ab], f.result.fileName, { type: "application/pdf" }));
      }
      const merged = await mergePdfs(fileObjs, {
        signal: controller.signal,
        onProgress: (p) => setState({ kind: "running", progress: p }),
      });
      // Finalize next to the first source file.
      const finalized = await finalizeOutput(
        files[0]!.path,
        "-merged",
        "pdf",
        merged,
      );
      // Stage the output for composable workflows (next action).
      stage(finalized.output, "pdf-merge", files[0]?.path);
      // Add to recent files.
      addRecent({
        path: finalized.outputPath,
        fileName: finalized.output.fileName,
        kind: finalized.output.kind,
        humanReadableSize: finalized.output.size.humanReadable,
        operation: "Merged PDFs",
        timestamp: Date.now(),
      });
      setState({
        kind: "done",
        outputPath: finalized.outputPath,
        outputSize: finalized.output.size.bytes,
        sourceCount: files.length,
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
    setFiles([]);
    setState({ kind: "idle" });
  }

  return (
    <section className="paperu-section" aria-labelledby="merge-heading">
      <header className="paperu-section__header">
        <h1 id="merge-heading" className="paperu-text-display">Merge PDFs</h1>
        <p className="paperu-text-lead">
          Combine multiple PDFs into one, in the order you choose. Originals
          are never touched. Merge is not compression — the result is a new
          file containing all pages.
        </p>
      </header>

      {files.length === 0 && state.kind === "idle" && (
        <div
          className="paperu-dropzone"
          role="region"
          aria-label="Drop PDFs to merge or choose files"
        >
          <div className="paperu-dropzone__inner">
            <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
            <p className="paperu-dropzone__title">Drop PDFs to merge</p>
            <p className="paperu-dropzone__hint">Add two or more PDFs.</p>
            <Button variant="accent" onClick={handlePick}>Choose PDFs</Button>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <Card className="paperu-staged">
          <div className="paperu-staged__head">
            <h2 className="paperu-staged__title">
              {files.length} PDF{files.length === 1 ? "" : "s"} · reorder below
            </h2>
            <button type="button" className="paperu-staged__clear" onClick={reset}>
              Clear
            </button>
          </div>
          <ol className="paperu-staged__list" style={{ listStyle: "none" }}>
            {files.map((f, i) => (
              <li key={f.path} className="paperu-staged__item">
                <div className="paperu-staged__row">
                  <span className="paperu-staged__icon" aria-hidden="true">{i + 1}</span>
                  <div className="paperu-staged__meta">
                    <div className="paperu-staged__name" title={f.path}>
                      {f.result.fileName}
                    </div>
                    <div className="paperu-staged__sub">
                      <span className="paperu-staged__size">{f.result.size.humanReadable}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      className="paperu-staged__remove"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${f.result.fileName} up`}
                      style={{ opacity: i === 0 ? 0.3 : 1 }}
                    >↑</button>
                    <button
                      type="button"
                      className="paperu-staged__remove"
                      onClick={() => move(i, 1)}
                      disabled={i === files.length - 1}
                      aria-label={`Move ${f.result.fileName} down`}
                      style={{ opacity: i === files.length - 1 ? 0.3 : 1 }}
                    >↓</button>
                    <button
                      type="button"
                      className="paperu-staged__remove"
                      onClick={() => removeAt(i)}
                      aria-label={`Remove ${f.result.fileName}`}
                    >✕</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div style={{ marginTop: "var(--paperu-space-4)", display: "flex", gap: "var(--paperu-space-3)" }}>
            <Button variant="outline" onClick={handlePick} disabled={state.kind === "running"}>Add more</Button>
            <Button
              variant="accent"
              onClick={run}
              disabled={files.length < 2 || state.kind === "running"}
              style={{ flex: 1 }}
            >
              {files.length < 2 ? "Add at least 2 PDFs" : `Merge ${files.length} PDFs`}
            </Button>
          </div>
        </Card>
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
              <div className="paperu-fitresult__stat-label">Sources</div>
              <div className="paperu-fitresult__stat-value">{state.sourceCount}</div>
            </div>
            <div>
              <div className="paperu-fitresult__stat-label">Result</div>
              <div className="paperu-fitresult__stat-value">{formatBytes(state.outputSize)}</div>
            </div>
          </div>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · Output saved next to the first source
          </p>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-2)", wordBreak: "break-all" }}>
            <code>{state.outputPath}</code>
          </p>
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={() => void openPath(state.outputPath)}>Open file</Button>
            <Button variant="outline" onClick={() => void revealPath(state.outputPath)}>Open folder</Button>
            <Button variant="ghost" onClick={reset}>Merge another</Button>
          </div>
          <NextActions exclude="pdf-merge" />
        </Card>
      )}

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
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
