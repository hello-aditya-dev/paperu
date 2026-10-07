/**
 * Batch Studio route — queue many files through one operation
 * (Master Prompt 4 §41-43, Wave A §8-10 P1-C+D repair).
 *
 * CANONICAL NATIVE-PATH ARCHITECTURE (no basename):
 *   native Tauri multi-picker → absolute validated paths
 *   → inspectFile(path) per file → real kind (magic-byte, not extension)
 *   → BatchItem carries `path` (absolute) + `fileName` (display)
 *   → readFileBytes(item.path) → bytes → in-memory File for engine
 *   → finalizeOutput(item.path, …) with REAL ABSOLUTE PATH
 *
 * The original absolute path survives the whole queue. The old code
 * stored `file: File` + `fileName` and called finalizeOutput(item.fileName)
 * — passing a basename as sourcePath. That broken architecture (master
 * prompt §8) is gone.
 *
 * REAL CANCELLATION (§10 P1-D): an AbortController backs the whole
 * batch. Cancel:
 *   - stops scheduling the next item;
 *   - the active item's supported operation cooperatively aborts on
 *     its signal (fitImageToSize checks the signal); imagesToPdf
 *     cannot abort mid-item, so the current conversion completes
 *     before cancellation takes effect (documented inline);
 *   - remaining queued items are marked `cancelled`, NOT `failed`.
 *
 * Batch states: queued · processing · done · failed · cancelled.
 * The queue is in-memory for V1 (not persisted).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { fitPdfToSize } from "@/engines/pdf-engine";
import { fitImageToSize } from "@/engines/image-engine";
import {
  finalizeOutput,
  inspectFile,
  openPath,
  readFileBytes,
  revealPath,
} from "@/lib/ipc";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

type BatchOp = "pdf-fit" | "image-fit" | "images-to-pdf";

interface BatchItem {
  readonly id: string;
  /** Canonical absolute native path — survives the whole queue. */
  readonly path: string;
  /** Display name (basename). */
  readonly fileName: string;
  readonly kind: "pdf" | "image";
  status: "queued" | "processing" | "done" | "failed" | "cancelled";
  resultPath?: string;
  resultSize?: number;
  error?: string;
  originalSize: number;
}

const OPS: ReadonlyArray<{ id: BatchOp; label: string; accept: string; extensions: string[] }> = [
  { id: "pdf-fit", label: "Make PDFs fit", accept: "application/pdf", extensions: ["pdf"] },
  { id: "image-fit", label: "Make images fit", accept: "image/*", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] },
  { id: "images-to-pdf", label: "Convert images to PDF", accept: "image/*", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] },
];

const TARGET_KB = 500;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function BatchStudioRoute(): React.ReactNode {
  const [op, setOp] = useState<BatchOp>("pdf-fit");
  const [items, setItems] = useState<readonly BatchItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  const updateItem = useCallback((id: string, patch: Partial<BatchItem>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  // Auto-cancel the in-flight batch if the route unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handlePick(): Promise<void> {
    const opDef = OPS.find((o) => o.id === op)!;
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Add files — Paperu",
        filters: [{ name: opDef.label, extensions: opDef.extensions }],
      });
      // dialog.open with multiple:true returns string[] | null.
      const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      if (paths.length === 0) return;

      // Inspect each picked path to get real metadata + magic-byte kind.
      // Files that fail inspection are skipped (caller surfaces count).
      const newItems: BatchItem[] = [];
      for (const path of paths) {
        try {
          const meta: InspectFileResponse = await inspectFile(path);
          const kind: "pdf" | "image" =
            meta.kind === "pdf" || meta.kind === "image" ? meta.kind : "pdf";
          newItems.push({
            id: `${path}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            path,
            fileName: meta.fileName,
            kind,
            status: "queued",
            originalSize: meta.size.bytes,
          });
        } catch {
          // Skip files that fail inspection.
        }
      }
      if (newItems.length > 0) {
        setItems((cur) => [...cur, ...newItems]);
      }
      if (newItems.length < paths.length) {
        setError(`${paths.length - newItems.length} file(s) couldn't be read and were skipped.`);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  function removeItem(id: string): void {
    setItems((cur) => cur.filter((i) => i.id !== id));
  }
  function clearAll(): void {
    setItems([]);
    setError(null);
  }

  async function onRun(): Promise<void> {
    if (items.length === 0) {
      setError("Add files to the queue first.");
      return;
    }
    setProcessing(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const targetBytes = TARGET_KB * 1024;
      for (const item of items) {
        // Stop scheduling future items if cancelled.
        if (controller.signal.aborted) {
          // Mark any remaining queued items as cancelled (not failed).
          setItems((cur) => cur.map((i) =>
            i.id === item.id && (i.status === "queued" || i.status === "processing")
              ? { ...i, status: "cancelled" }
              : i,
          ));
          continue;
        }
        if (item.status === "done" || item.status === "cancelled") continue;
        updateItem(item.id, { status: "processing" });
        try {
          // Canonical native read — bytes come from the real absolute path.
          const rawBytes = await readFileBytes(item.path);
          const ab = new ArrayBuffer(rawBytes.byteLength);
          new Uint8Array(ab).set(rawBytes);
          const mime = item.kind === "pdf" ? "application/pdf" : "application/octet-stream";
          const memFile = new File([ab], item.fileName, { type: mime });

          let outBytes: Uint8Array;
          let ext: string;
          let finalSize: number;
          if (op === "pdf-fit" && item.kind === "pdf") {
            const r = await fitPdfToSize(memFile, { targetBytes });
            outBytes = r.bytes;
            finalSize = r.finalSize;
            ext = "pdf";
          } else if (op === "image-fit" && item.kind === "image") {
            const r = await fitImageToSize(memFile, { targetBytes, signal: controller.signal });
            outBytes = r.bytes;
            finalSize = r.finalSize;
            ext = r.format === "jpeg" ? "jpg" : r.format;
          } else if (op === "images-to-pdf" && item.kind === "image") {
            // imagesToPdf cannot abort mid-item — the current conversion
            // completes before cancellation takes effect (documented).
            // We still check the signal between items.
            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
            const { imagesToPdf } = await import("@/engines/pdf-engine");
            outBytes = await imagesToPdf([memFile], { layout: "a4" });
            finalSize = outBytes.byteLength;
            ext = "pdf";
          } else {
            throw new Error(`Operation ${op} doesn't support ${item.kind} files.`);
          }
          // Canonical finalization — pass the REAL absolute source path.
          const suffix = op === "pdf-fit" || op === "image-fit" ? "-fit" : "-paperu";
          const out = await finalizeOutput(item.path, suffix, ext, outBytes);
          updateItem(item.id, {
            status: "done",
            resultPath: out.outputPath,
            resultSize: finalSize,
          });
          addRecent({
            path: out.outputPath,
            fileName: out.output.fileName,
            kind: out.output.kind,
            humanReadableSize: out.output.size.humanReadable,
            operation: op === "pdf-fit" ? "Made PDF fit" : op === "image-fit" ? "Made image fit" : "Images → PDF",
            timestamp: Date.now(),
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            updateItem(item.id, { status: "cancelled" });
          } else {
            updateItem(item.id, {
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  }

  function cancelBatch(): void {
    abortRef.current?.abort();
    // Mark remaining queued items as cancelled immediately (the active
    // item will flip to cancelled when its operation returns).
    setItems((cur) => cur.map((i) => (i.status === "queued" ? { ...i, status: "cancelled" } : i)));
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const cancelledCount = items.filter((i) => i.status === "cancelled").length;
  const firstDone = items.find((i) => i.status === "done" && i.resultPath);

  return (
    <section className="paperu-section" aria-labelledby="batch-heading">
      <header className="paperu-section__header">
        <h1 id="batch-heading" className="paperu-text-display">Batch Studio</h1>
        <p className="paperu-text-lead">
          Run one operation across many files. Failures don't stop the queue. Cancellable — remaining items show as cancelled, not failed.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">Operation</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            {OPS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`paperu-target__preset${op === o.id ? " is-active" : ""}`}
                onClick={() => { setOp(o.id); setItems([]); setError(null); }}
                aria-pressed={op === o.id}
                style={{ padding: "var(--paperu-space-3)", textAlign: "left" }}
              >
                <span style={{ fontWeight: 600 }}>{o.label}</span>
              </button>
            ))}
          </div>
          <Button variant="accent" onClick={handlePick} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
            + Add files
          </Button>
        </div>
      </Card>

      {items.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <header className="paperu-batch__queue-header">
              <span className="paperu-text-numeric">
                {items.length} file{items.length === 1 ? "" : "s"} · {doneCount} done · {failedCount} failed{cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ""}
              </span>
              <button type="button" onClick={clearAll} disabled={processing} className="paperu-btn paperu-btn--ghost">Clear all</button>
            </header>
            <ul className="paperu-batch__items" style={{ maxHeight: "380px", overflowY: "auto" }}>
              {items.map((item) => (
                <li key={item.id} className={`paperu-batch__item is-${item.status}`}>
                  <span className="paperu-batch__item-name paperu-truncate" title={item.path}>{item.fileName}</span>
                  <span className="paperu-batch__item-meta paperu-text-numeric">
                    {formatBytes(item.originalSize)}
                    {item.resultSize !== undefined && ` → ${formatBytes(item.resultSize)}`}
                  </span>
                  <span className="paperu-batch__item-status">
                    {item.status === "queued" && "Queued"}
                    {item.status === "processing" && "Processing…"}
                    {item.status === "done" && "✓"}
                    {item.status === "failed" && `✗ ${item.error ?? ""}`}
                    {item.status === "cancelled" && "⊘ cancelled"}
                  </span>
                  {item.status === "queued" && (
                    <button type="button" onClick={() => removeItem(item.id)} aria-label="Remove">×</button>
                  )}
                </li>
              ))}
            </ul>
            {processing ? (
              <Button variant="outline" onClick={cancelBatch} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
                Cancel batch
              </Button>
            ) : (
              <Button variant="accent" onClick={onRun} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
                Run {items.length} file{items.length === 1 ? "" : "s"}
              </Button>
            )}
            {firstDone && (
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
                <Button variant="outline" onClick={() => void openPath(firstDone.resultPath!)}>Open first result</Button>
                <Button variant="outline" onClick={() => void revealPath(firstDone.resultPath!)}>Open folder</Button>
              </div>
            )}
          </div>
        </Card>
      )}

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
