/**
 * Assignment Studio route — orchestrate photos/PDFs into one PDF
 * (Master Prompt 4 §8-11).
 *
 * V1 implementation (honest):
 *   - Pick photos + PDFs via the CANONICAL Tauri file picker (returns
 *     absolute paths, not browser File objects — repair §6-8).
 *   - Inspect each picked file (real kind detection, no extension trust — §30).
 *   - Reorder up/down — order is PRESERVED through the build (repair §9).
 *   - Convert each image to a 1-page PDF, merge all in USER ORDER
 *     (NOT grouped by kind).
 *   - Final size shown truthfully.
 *   - Output finalized via canonical finalize_output with REAL absolute
 *     source path (repair §8).
 *
 * Not yet V1 (deferred per §0 — don't ship half-built):
 *   - Cover page (needs pdf-lib A4 cover generator)
 *   - Page numbers
 *   - A4 normalization of mixed page sizes
 *   - Target-size fit (existing fitPdfToSize takes File, not bytes — needs refactor)
 *   - Signature overlay (existing signPdf takes File)
 *   - Rotate/straighten/crop (deterministic impl needs careful work)
 *
 * Source safety (§11): picked files are read-only. Output goes through
 * the canonical finalize_output path (atomic, non-destructive).
 */

import { useState } from "react";
import { mergePdfs, imagesToPdf } from "@/engines/pdf-engine";
import { pickAndInspectFiles, readFileBytes, type PickedFile } from "@/lib/file-picker";
import { finalizeOutput } from "@/lib/ipc";

export function AssignmentStudioRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly PickedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState<number | null>(null);

  const onPick = async () => {
    setError(null);
    try {
      const picked = await pickAndInspectFiles({
        multiple: true,
        accept: "application/pdf,image/*",
      });
      if (picked.length === 0) return; // user cancelled or non-Tauri
      setFiles((cur) => [...cur, ...picked]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeFile = (idx: number) => {
    setFiles((cur) => cur.filter((_, i) => i !== idx));
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    setFiles((cur) => {
      const next = [...cur];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return cur;
      const a = next[idx];
      const b = next[target];
      if (!a || !b) return cur;
      next[idx] = b;
      next[target] = a;
      return next;
    });
  };

  const onBuild = async () => {
    if (files.length === 0) {
      setError("Add at least one file first.");
      return;
    }
    setProcessing(true);
    setError(null);
    setResultPath(null);
    setResultSize(null);
    try {
      // Process files IN USER ORDER (repair §9): convert each image to
      // a 1-page PDF, then merge all PDFs (image-derived + original)
      // in the order they appear in `files`. Do NOT group by kind.
      const inputFiles: File[] = [];
      for (const picked of files) {
        const bytes = await readFileBytes(picked.path);
        if (picked.kind === "image") {
          // Convert this single image to a 1-page PDF.
          const imgFile = new File([new Blob([bytes.slice()], { type: picked.mimeType ?? "image/*" })], picked.fileName, {
            type: picked.mimeType ?? "image/*",
          });
          const onePagePdfBytes = await imagesToPdf([imgFile], { layout: "a4" });
          const onePagePdfFile = new File(
            [new Blob([onePagePdfBytes.slice()], { type: "application/pdf" })],
            `${picked.fileName}.pdf`,
            { type: "application/pdf" },
          );
          inputFiles.push(onePagePdfFile);
        } else {
          // PDF — pass through as a File for mergePdfs.
          const pdfFile = new File(
            [new Blob([bytes.slice()], { type: "application/pdf" })],
            picked.fileName,
            { type: "application/pdf" },
          );
          inputFiles.push(pdfFile);
        }
      }

      // Merge all PDFs in USER ORDER (not grouped). mergePdfs internally
      // validates the output parses and throws if it doesn't.
      const mergedBytes: Uint8Array =
        inputFiles.length === 1
          ? new Uint8Array(await inputFiles[0]!.arrayBuffer())
          : await mergePdfs(inputFiles);

      // Finalize through the canonical non-destructive path with the
      // REAL absolute source path (repair §8 — was file.name, a basename).
      
      const firstSourcePath = files[0]!.path; // absolute, validated by inspect
      const result = await finalizeOutput(firstSourcePath, "-paperu-assignment", "pdf", mergedBytes);
      setResultPath(result.outputPath);
      setResultSize(mergedBytes.byteLength);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <section className="paperu-assignment">
      <header className="paperu-assignment__header">
        <h1 className="paperu-assignment__title">Assignment Studio</h1>
        <p className="paperu-assignment__subtitle">
          Add photos, screenshots, or PDFs. Build one submission PDF.
        </p>
      </header>

      <div className="paperu-assignment__v1-notice">
        V1: merges photos + PDFs into one PDF, in your chosen order.
        Cover page, page numbers, A4 normalization, and target-size
        fit arrive next sprint — don't ship half-built.
      </div>

      <section className="paperu-assignment__files">
        <button
          type="button"
          className="paperu-assignment__picker"
          onClick={onPick}
        >
          + Add photos or PDFs
        </button>
        {files.length === 0 ? (
          <p className="paperu-assignment__empty">
            No files yet. Pick photos or PDFs to start.
          </p>
        ) : (
          <ul className="paperu-assignment__file-list">
            {files.map((f, idx) => (
              <li key={`${f.path}-${idx}`} className="paperu-assignment__file">
                <span className="paperu-assignment__file-glyph" aria-hidden="true">
                  {f.kind === "image" ? "▦" : "▤"}
                </span>
                <span className="paperu-assignment__file-name">{f.fileName}</span>
                <div className="paperu-assignment__file-actions">
                  <button
                    type="button"
                    onClick={() => moveFile(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Move up"
                  >
                    ▴
                  </button>
                  <button
                    type="button"
                    onClick={() => moveFile(idx, 1)}
                    disabled={idx === files.length - 1}
                    aria-label="Move down"
                  >
                    ▾
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="paperu-assignment__build">
        <button
          type="button"
          className="paperu-assignment__build-btn"
          onClick={onBuild}
          disabled={processing || files.length === 0}
        >
          {processing ? "Building…" : "Build assignment"}
        </button>
      </div>

      {error && (
        <div className="paperu-assignment__error" role="status">
          {error}
        </div>
      )}
      {resultPath && (
        <div className="paperu-assignment__result" role="status">
          <p>Assignment built. {resultSize != null ? formatBytes(resultSize) : ""}</p>
          <code>{resultPath}</code>
        </div>
      )}
    </section>
  );
}


function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
