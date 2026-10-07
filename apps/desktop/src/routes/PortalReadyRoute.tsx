/**
 * Portal Ready route — make a file upload-ready for college/portal
 * constraints (Master Prompt 4 §12-17).
 *
 * Uses the existing fitPdfToSize and fitImageToSize engines (which
 * take File objects + targetBytes, return bytes + real final size +
 * requirementMet flag).
 *
 * Result compliance card (§15): shows ✓ only for what was actually
 * verified. The engine's requirementMet flag is authoritative —
 * Paperu never lies about meeting a target (§16).
 *
 * V1 limitations (honest): exact-dimension matching (e.g. 200×230)
 * is NOT supported tonight — fitImageToSize doesn't take width/height
 * targets, only a byte target. That's a real engine gap. The compliance
 * card will report the actual final dimensions, not claim a target was
 * met. A4 normalization for PDFs is also not wired (the engine doesn't
 * expose it). These arrive next sprint.
 */

import { useState } from "react";
import { fitPdfToSize, type PdfFitResult } from "@/engines/pdf-engine";
import { fitImageToSize, type ImageFitResult } from "@/engines/image-engine";
import { invoke } from "@tauri-apps/api/core";

type ResultKind = PdfFitResult | ImageFitResult;

function isPdfResult(r: ResultKind): r is PdfFitResult {
  return "rasterized" in r;
}

function isImageResult(r: ResultKind): r is ImageFitResult {
  return "width" in r;
}

export function PortalReadyRoute(): React.ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [targetKb, setTargetKb] = useState(500);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultKind | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setOutputPath(null);
    setError(null);
    e.target.value = "";
  };

  const isImage = file?.type.startsWith("image/") ?? false;
  const isPdf = file?.type === "application/pdf" ||
    file?.name.toLowerCase().endsWith(".pdf");

  const onMakeReady = async () => {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (!isImage && !isPdf) {
      setError("Only PDF and image files are supported.");
      return;
    }
    setProcessing(true);
    setError(null);
    setResult(null);
    setOutputPath(null);
    try {
      const targetBytes = targetKb * 1024;
      const r: ResultKind = isPdf
        ? await fitPdfToSize(file, { targetBytes })
        : await fitImageToSize(file, { targetBytes });

      // Finalize through the canonical non-destructive path.
      const bytesBase64 = bytesToBase64(r.bytes);
      const ext = isPdf ? "pdf" : isImageResult(r) ? r.format : "bin";
      const suffix = "-portal-ready";
      const out = (await invoke<string>("finalize_output", {
        request: {
          sourcePath: file.name,
          suffix,
          extension: ext,
          bytesBase64,
        },
      })) as string;
      setOutputPath(out);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <section className="paperu-portal">
      <header className="paperu-portal__header">
        <h1 className="paperu-portal__title">Make this upload-ready</h1>
        <p className="paperu-portal__subtitle">
          Pick a target size. Paperu makes your file fit — or tells you
          it can't.
        </p>
      </header>

      <div className="paperu-portal__file">
        <label className="paperu-portal__picker">
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={onPick}
            style={{ display: "none" }}
          />
          <span className="paperu-portal__picker-label">
            {file ? file.name : "Choose a PDF or image"}
          </span>
        </label>
      </div>

      <label className="paperu-portal__target">
        <span>Target size</span>
        <select
          value={targetKb}
          onChange={(e) => setTargetKb(parseInt(e.target.value, 10))}
        >
          <option value={20}>Under 20 KB</option>
          <option value={50}>Under 50 KB</option>
          <option value={100}>Under 100 KB</option>
          <option value={500}>Under 500 KB</option>
          <option value={1024}>Under 1 MB</option>
          <option value={2048}>Under 2 MB</option>
        </select>
      </label>

      <button
        type="button"
        className="paperu-portal__make"
        onClick={onMakeReady}
        disabled={processing || !file}
      >
        {processing ? "Processing…" : "Make upload-ready"}
      </button>

      {error && (
        <div className="paperu-portal__error" role="status">
          {error}
          {!result?.requirementMet && (
            <span className="paperu-portal__hint">
              {" "}Try a larger target size.
            </span>
          )}
        </div>
      )}

      {result && (
        <ComplianceCard
          result={result}
          outputPath={outputPath}
          targetBytes={targetKb * 1024}
        />
      )}
    </section>
  );
}

function ComplianceCard({
  result,
  outputPath,
  targetBytes,
}: {
  result: ResultKind;
  outputPath: string | null;
  targetBytes: number;
}): React.ReactNode {
  const met = result.requirementMet;
  return (
    <div className="paperu-portal__compliance" role="status">
      <h2 className="paperu-portal__compliance-title">
        {met ? "Ready to upload" : "Did not meet target"}
      </h2>
      <ul className="paperu-portal__compliance-list">
        <li className={met ? "is-ok" : "is-bad"}>
          {met ? "✓" : "✗"} Final size {formatBytes(result.finalSize)} /{" "}
          {formatBytes(targetBytes)}
        </li>
        {isPdfResult(result) && (
          <li className="is-ok">✓ {result.meta.pageCount} pages</li>
        )}
        {isPdfResult(result) && result.rasterized && (
          <li className="is-warn">
            ⚠ Text became images to reach the size
          </li>
        )}
        {isImageResult(result) && (
          <>
            <li className="is-ok">
              ✓ {result.width} × {result.height}px
            </li>
            <li className="is-ok">✓ {result.format.toUpperCase()}</li>
          </>
        )}
      </ul>
      {outputPath && (
        <p className="paperu-portal__output-path">
          <code>{outputPath}</code>
        </p>
      )}
    </div>
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
