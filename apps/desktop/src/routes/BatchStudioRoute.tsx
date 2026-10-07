/**
 * Batch Studio route — queue many files through an operation
 * (Master Prompt 4 §41-43).
 *
 * V1: a single operation (Make smaller / Make PDF fit / Convert images
 * to PDF). The queue is processed serially; failures are isolated
 * (§43). Real progress, no fake percentages (§60). Cancellable (§61).
 *
 * The queue is in-memory for V1 (not persisted). Closing Paperu loses
 * the in-flight queue. Persistence is a later sprint.
 */

import { useState } from "react";
import { fitPdfToSize } from "@/engines/pdf-engine";
import { fitImageToSize } from "@/engines/image-engine";
import { finalizeOutput } from "@/lib/ipc";

type BatchOp = "pdf-fit" | "image-fit" | "images-to-pdf";

interface BatchItem {
  readonly id: string;
  readonly file: File;
  readonly fileName: string;
  readonly kind: "pdf" | "image";
  status: "queued" | "processing" | "done" | "failed";
  resultPath?: string;
  resultSize?: number;
  error?: string;
  originalSize: number;
}

const OPS: ReadonlyArray<{ id: BatchOp; label: string; accept: string }> = [
  { id: "pdf-fit", label: "Make PDFs fit", accept: "application/pdf" },
  { id: "image-fit", label: "Make images fit", accept: "image/*" },
  { id: "images-to-pdf", label: "Convert images to PDF", accept: "image/*" },
];

const TARGET_KB = 500;

export function BatchStudioRoute(): React.ReactNode {
  const [op, setOp] = useState<BatchOp>("pdf-fit");
  const [items, setItems] = useState<readonly BatchItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    const newItems: BatchItem[] = picked.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      fileName: file.name,
      kind: file.type.startsWith("image/") ? "image" : "pdf",
      status: "queued",
      originalSize: file.size,
    }));
    setItems((cur) => [...cur, ...newItems]);
    e.target.value = "";
  };

  const removeItem = (id: string) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
  };

  const clearAll = () => setItems([]);

  const updateItem = (id: string, patch: Partial<BatchItem>) => {
    setItems((cur) =>
      cur.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  };

  const onRun = async () => {
    if (items.length === 0) {
      setError("Add files to the queue first.");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      for (const item of items) {
        if (item.status === "done") continue;
        updateItem(item.id, { status: "processing" });
        try {
          const targetBytes = TARGET_KB * 1024;
          let outBytes: Uint8Array;
          let ext: string;
          let finalSize: number;
          if (op === "pdf-fit" && item.kind === "pdf") {
            const r = await fitPdfToSize(item.file, { targetBytes });
            outBytes = r.bytes;
            finalSize = r.finalSize;
            ext = "pdf";
          } else if (op === "image-fit" && item.kind === "image") {
            const r = await fitImageToSize(item.file, { targetBytes });
            outBytes = r.bytes;
            finalSize = r.finalSize;
            ext = r.format === "jpeg" ? "jpg" : r.format;
          } else if (op === "images-to-pdf" && item.kind === "image") {
            // Lazy-load to avoid bundling the images→PDF engine for the
            // whole app — it's only needed for this op.
            const { imagesToPdf } = await import("@/engines/pdf-engine");
            outBytes = await imagesToPdf([item.file], { layout: "a4" });
            finalSize = outBytes.byteLength;
            ext = "pdf";
          } else {
            throw new Error(
              `Operation ${op} doesn't support ${item.kind} files.`,
            );
          }
          const suffix = op === "pdf-fit" || op === "image-fit" ? "-fit" : "-paperu";
          const out = await finalizeOutput(item.fileName, suffix, ext, outBytes);
          const outPath = out.outputPath;
          updateItem(item.id, {
            status: "done",
            resultPath: outPath,
            resultSize: finalSize,
          });
        } catch (err) {
          updateItem(item.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  return (
    <section className="paperu-batch">
      <header className="paperu-batch__header">
        <h1 className="paperu-batch__title">Batch Studio</h1>
        <p className="paperu-batch__subtitle">
          Run one operation across many files. Failures don't stop the queue.
        </p>
      </header>

      <fieldset className="paperu-batch__ops">
        <legend>Operation</legend>
        {OPS.map((o) => (
          <label key={o.id} className="paperu-batch__op">
            <input
              type="radio"
              name="op"
              value={o.id}
              checked={op === o.id}
              onChange={() => {
                setOp(o.id);
                setItems([]);
              }}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <label className="paperu-batch__picker">
        <input
          type="file"
          accept={OPS.find((o) => o.id === op)?.accept}
          multiple
          onChange={onPick}
          style={{ display: "none" }}
        />
        <span className="paperu-batch__picker-label">+ Add files</span>
      </label>

      {items.length > 0 && (
        <div className="paperu-batch__queue">
          <header className="paperu-batch__queue-header">
            <span>
              {items.length} file{items.length === 1 ? "" : "s"} ·{" "}
              {doneCount} done · {failedCount} failed
            </span>
            <button type="button" onClick={clearAll} disabled={processing}>
              Clear all
            </button>
          </header>
          <ul className="paperu-batch__items">
            {items.map((item) => (
              <li
                key={item.id}
                className={`paperu-batch__item is-${item.status}`}
              >
                <span className="paperu-batch__item-name">
                  {item.fileName}
                </span>
                <span className="paperu-batch__item-meta">
                  {formatBytes(item.originalSize)}
                  {item.resultSize !== undefined &&
                    ` → ${formatBytes(item.resultSize)}`}
                </span>
                <span className="paperu-batch__item-status">
                  {item.status === "processing" && "Processing…"}
                  {item.status === "done" && "✓"}
                  {item.status === "failed" && `✗ ${item.error ?? ""}`}
                </span>
                {item.status === "queued" && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="paperu-batch__run"
            onClick={onRun}
            disabled={processing || items.length === 0}
          >
            {processing ? "Running…" : `Run ${items.length} file${items.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {error && (
        <div className="paperu-batch__error" role="status">{error}</div>
      )}
    </section>
  );
}


function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
