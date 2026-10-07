/**
 * Assignment Studio route — orchestrate photos/PDFs into one PDF
 * (Master Prompt 4 §8-11).
 *
 * V1 implementation (honest):
 *   - Add photos + PDFs via file picker
 *   - Reorder up/down
 *   - Build one merged PDF (images→PDF + PDF merge)
 *   - Final size shown truthfully
 *
 * Not yet V1 (deferred per §0 — don't ship half-built):
 *   - Cover page (needs pdf-lib A4 cover generator)
 *   - Page numbers
 *   - A4 normalization of mixed page sizes
 *   - Target-size fit (existing fitPdfToSize takes File, not bytes)
 *   - Signature overlay (existing signPdf takes File)
 *   - Rotate/straighten/crop (deterministic impl needs careful work)
 *
 * Source safety (§11): inputs are read-only File objects. Output goes
 * through the canonical finalize_output path.
 */

import { useState } from "react";
import { mergePdfs, imagesToPdf } from "@/engines/pdf-engine";
import { invoke } from "@tauri-apps/api/core";

interface AssignmentFile {
  readonly file: File;
  readonly fileName: string;
  readonly kind: "image" | "pdf";
}

function detectKind(file: File): "image" | "pdf" | "other" {
  const t = file.type.toLowerCase();
  if (t === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  if (t.startsWith("image/")) return "image";
  return "other";
}

export function AssignmentStudioRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly AssignmentFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState<number | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    const valid = picked
      .map((file) => ({ file, kind: detectKind(file) }))
      .filter((x): x is { file: File; kind: "image" | "pdf" } =>
        x.kind === "image" || x.kind === "pdf",
      );
    setFiles((cur) => [
      ...cur,
      ...valid.map((v) => ({
        file: v.file,
        fileName: v.file.name,
        kind: v.kind,
      })),
    ]);
    e.target.value = ""; // allow re-pick of same files
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
      // 1. Convert images to a single intermediate PDF (existing engine).
      const images = files.filter((f) => f.kind === "image");
      const pdfs = files.filter((f) => f.kind === "pdf");
      const inputFiles: File[] = [];
      if (images.length > 0) {
        const imagePdfBytes = await imagesToPdf(images.map((f) => f.file), {
          layout: "a4",
        });
        // Wrap in a File so mergePdfs (which takes File[]) can read it.
        const imagePdfBlob = new Blob([imagePdfBytes.slice()], {
          type: "application/pdf",
        });
        const imagePdfFile = new File([imagePdfBlob], "paperu-assignment-pages.pdf", {
          type: "application/pdf",
        });
        inputFiles.push(imagePdfFile);
      }
      inputFiles.push(...pdfs.map((f) => f.file));

      // 2. Merge all PDFs into one (existing engine). mergePdfs internally
      //    validates the output parses and throws if it doesn't.
      const firstFile = inputFiles[0];
      const mergedBytes: Uint8Array =
        inputFiles.length === 1 && firstFile
          ? new Uint8Array(await firstFile.arrayBuffer())
          : await mergePdfs(inputFiles);

      // 3. Finalize through the canonical non-destructive path.
      //    (Tauri finalize_output command — atomic, source untouched.)
      const bytesBase64 = bytesToBase64(mergedBytes);
      const suffix = "-paperu-assignment";
      const firstUserFile = files[0];
      const outputPath = (await invoke<string>("finalize_output", {
        request: {
          sourcePath: firstUserFile?.fileName ?? "assignment",
          suffix,
          extension: "pdf",
          bytesBase64,
        },
      })) as string;
      setResultPath(outputPath);
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
        V1: merges photos + PDFs into one PDF. Cover page, page numbers,
        and A4 normalization arrive next sprint — don't ship half-built.
      </div>

      <section className="paperu-assignment__files">
        <label className="paperu-assignment__picker">
          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            onChange={onPick}
            style={{ display: "none" }}
          />
          <span className="paperu-assignment__picker-label">
            + Add photos or PDFs
          </span>
        </label>
        {files.length === 0 ? (
          <p className="paperu-assignment__empty">
            No files yet. Pick photos or PDFs to start.
          </p>
        ) : (
          <ul className="paperu-assignment__file-list">
            {files.map((f, idx) => (
              <li key={`${f.fileName}-${idx}`} className="paperu-assignment__file">
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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(bin);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
