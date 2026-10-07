/**
 * PDF target-size engine — webview-side processing using pdf-lib + pdfjs.
 *
 * This is a feature-local engine service. It produces real, validated
 * output bytes that are finalized to disk via the canonical
 * `finalize_output` Tauri command (atomic finalization, non-destructive).
 *
 * Staged compression strategy (per the course-correction §10):
 *   Stage 1: lossless structural optimization (metadata strip, object
 *            stream re-pack via pdf-lib). Never destroys text/vector.
 *   Stage 2: rasterization (only when Stage 1 cannot meet the target).
 *            Pages are rendered to JPEG via pdfjs, then rebuilt into a
 *            new PDF via pdf-lib. Text becomes images — disclosed in UI.
 *
 * The engine never claims success unless finalSize <= targetSize. If the
 * lowest safe point still exceeds the target, requirementMet = false and
 * the UI shows "Lowest safe result".
 *
 * Privacy: all processing is local. No bytes are uploaded. The source
 * file is read read-only; the output is a new file.
 */

import { PDFDocument } from "pdf-lib";

/** Minimal typed interface for the pdfjs-dist module we use. */
interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfjsDocument>;
  };
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  destroy(): Promise<void>;
}
interface PdfjsPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas: HTMLCanvasElement;
  }): { promise: Promise<void> };
}

export interface PdfFitProgress {
  /** 0..1, or null for indeterminate. */
  fraction: number | null;
  stage: string;
}
export type PdfFitProgressCb = (p: PdfFitProgress) => void;

export interface PdfFitResult {
  /** Output PDF bytes. */
  bytes: Uint8Array;
  originalSize: number;
  targetSize: number;
  finalSize: number;
  requirementMet: boolean;
  /** True if rasterization was used (text became images). */
  rasterized: boolean;
  meta: {
    pageCount: number;
    stepsTried: number;
    strategy: string;
  };
}

export interface PdfFitOptions {
  targetBytes: number;
  signal?: AbortSignal;
  onProgress?: PdfFitProgressCb;
}

/** Read a File (from a path via Tauri) into bytes. */
async function readBytes(file: File): Promise<Uint8Array> {
  const ab = await file.arrayBuffer();
  return new Uint8Array(ab);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/**
 * Iteratively reduce a PDF to fit under the target size.
 *
 * Stage 1: lossless structural re-save (strip metadata, object streams).
 * Stage 2: rasterize pages to JPEG, binary-search quality + scale, rebuild.
 */
export async function fitPdfToSize(
  file: File,
  opts: PdfFitOptions,
): Promise<PdfFitResult> {
  const { targetBytes, signal, onProgress } = opts;
  const originalBytes = await readBytes(file);
  const originalSize = originalBytes.byteLength;

  let pageCount: number;
  try {
    const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    pageCount = doc.getPageCount();
  } catch {
    pageCount = 0;
  }

  throwIfAborted(signal);
  onProgress?.({ fraction: 0.05, stage: "Reading PDF…" });

  // ── Stage 1: lossless structural re-save ──
  let bestBytes = originalBytes;
  let bestSize = originalSize;
  let strategy = "none";
  try {
    const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
    doc.setProducer("Paperu");
    doc.setCreator("Paperu");
    const saved = await doc.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });
    if (saved.byteLength < bestSize) {
      bestBytes = saved;
      bestSize = saved.byteLength;
      strategy = "lossless-structural";
    }
  } catch {
    /* fall through to rasterization */
  }

  throwIfAborted(signal);
  if (bestSize <= targetBytes) {
    onProgress?.({ fraction: 1, stage: "Done" });
    return {
      bytes: bestBytes,
      originalSize,
      targetSize: targetBytes,
      finalSize: bestSize,
      requirementMet: true,
      rasterized: false,
      meta: { pageCount, stepsTried: 1, strategy },
    };
  }

  // ── Stage 2: rasterize + rebuild ──
  onProgress?.({ fraction: 0.15, stage: "Rendering pages…" });
  const pdfjsLib = await import("pdfjs-dist");
  configurePdfjsWorker(pdfjsLib);

  // pdfjs-dist's types are complex; cast to a minimal interface to avoid
  // `any` while staying compatible with the library's runtime API.
  const pdfjs = pdfjsLib as unknown as PdfjsModule;
  const doc = await pdfjs.getDocument({
    data: originalBytes.slice(),
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
  }).promise;

  const baseScale = 1.5;
  const pageCanvases: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    throwIfAborted(signal);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: baseScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get canvas context.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pageCanvases.push({ canvas, width: viewport.width, height: viewport.height });
    onProgress?.({
      fraction: 0.15 + 0.25 * (p / doc.numPages),
      stage: `Rendered page ${p} of ${doc.numPages}`,
    });
  }
  pageCount = doc.numPages;

  // Binary-search JPEG quality + downscale factor.
  const margin = Math.max(1024, Math.round(targetBytes * 0.02));
  const goal = targetBytes - margin;
  const scaleSteps = [1.0, 0.85, 0.7, 0.55, 0.42];
  let chosen: { bytes: Uint8Array; size: number; quality: number; scale: number } | null = null;
  let stepsTried = 0;

  outer: for (const scale of scaleSteps) {
    let lo = 0.3;
    let hi = 0.92;
    let localBest: { bytes: Uint8Array; size: number; quality: number } | null = null;
    for (let it = 0; it < 6; it++) {
      throwIfAborted(signal);
      const q = (lo + hi) / 2;
      const built = await buildPdfFromCanvases(pageCanvases, scale, q, signal, (f) =>
        onProgress?.({
          fraction: 0.45 + 0.5 * f * (1 / scaleSteps.length),
          stage: `Rebuilding at ${Math.round(q * 100)}% quality`,
        }),
      );
      stepsTried++;
      if (built.size <= goal) {
        localBest = { bytes: built.bytes, size: built.size, quality: q };
        lo = q;
      } else {
        hi = q;
        if (!localBest || built.size < localBest.size) {
          localBest = { bytes: built.bytes, size: built.size, quality: q };
        }
      }
    }
    if (localBest) {
      chosen = { ...localBest, scale };
      if (localBest.size <= goal) break outer;
    }
  }

  await doc.destroy();

  if (!chosen) {
    onProgress?.({ fraction: 1, stage: "Done (lossless only)" });
    return {
      bytes: bestBytes,
      originalSize,
      targetSize: targetBytes,
      finalSize: bestSize,
      requirementMet: bestSize <= targetBytes,
      rasterized: false,
      meta: { pageCount, stepsTried, strategy: "lossless-structural" },
    };
  }

  const requirementMet = chosen.size <= targetBytes;
  strategy = `rasterize-jpeg q=${chosen.quality.toFixed(2)} scale=${chosen.scale}`;
  onProgress?.({ fraction: 1, stage: requirementMet ? "Done" : "Lowest safe result" });

  return {
    bytes: chosen.bytes,
    originalSize,
    targetSize: targetBytes,
    finalSize: chosen.size,
    requirementMet,
    rasterized: true,
    meta: { pageCount, stepsTried, strategy },
  };
}

let workerConfigured = false;
function configurePdfjsWorker(pdfjsLib: unknown): void {
  if (workerConfigured) return;
  try {
    const mod = pdfjsLib as PdfjsModule;
    mod.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    /* worker setup failed; pdfjs will run on main thread */
  }
  workerConfigured = true;
}

async function buildPdfFromCanvases(
  pages: { canvas: HTMLCanvasElement; width: number; height: number }[],
  scale: number,
  quality: number,
  signal: AbortSignal | undefined,
  onProgress?: (fraction: number) => void,
): Promise<{ bytes: Uint8Array; size: number }> {
  const out = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    throwIfAborted(signal);
    const src = pages[i]!.canvas;
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d", { alpha: false });
    if (!octx) throw new Error("Could not get canvas context.");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);
    octx.drawImage(src, 0, 0, w, h);
    const blob = await new Promise<Blob>((resolve, reject) =>
      off.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("JPEG encode failed"))),
        "image/jpeg",
        quality,
      ),
    );
    const jpgBytes = new Uint8Array(await blob.arrayBuffer());
    const img = await out.embedJpg(jpgBytes);
    const pageW = pages[i]!.width;
    const pageH = pages[i]!.height;
    const page = out.addPage([pageW, pageH]);
    page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
    onProgress?.((i + 1) / pages.length);
  }
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, size: bytes.byteLength };
}

// ── Merge / Split engines (also webview-side, sharing pdf-lib) ──

export async function mergePdfs(
  files: File[],
  opts: { signal?: AbortSignal; onProgress?: PdfFitProgressCb } = {},
): Promise<Uint8Array> {
  const { signal, onProgress } = opts;
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    onProgress?.({ fraction: i / files.length, stage: `Merging ${i + 1}/${files.length}` });
    const bytes = await readBytes(files[i]!);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  onProgress?.({ fraction: 1, stage: "Finalizing" });
  return out.save({ useObjectStreams: true });
}

/** Parse "1-3, 5, 8-10" against a page count. Returns 0-based indices. */
export function parsePageRanges(spec: string, pageCount: number): number[] {
  const s = spec.trim();
  if (!s) throw new Error("Page range is empty.");
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("Page range is empty.");
  const set = new Set<number>();
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1]!, 10);
      const b = parseInt(m[2]!, 10);
      if (a < 1 || b < 1 || a > pageCount || b > pageCount)
        throw new Error(`Range "${part}" is out of bounds (1–${pageCount}).`);
      if (a > b) throw new Error(`Range "${part}" goes backwards.`);
      for (let i = a; i <= b; i++) set.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n < 1 || n > pageCount)
        throw new Error(`Page ${n} is out of bounds (1–${pageCount}).`);
      set.add(n - 1);
    } else {
      throw new Error(`Could not understand "${part}". Use 1-3, 5, 8-10.`);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export async function extractPages(
  file: File,
  indices: number[],
  opts: { signal?: AbortSignal; onProgress?: PdfFitProgressCb } = {},
): Promise<Uint8Array> {
  const { signal, onProgress } = opts;
  const bytes = await readBytes(file);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (let i = 0; i < indices.length; i++) {
    throwIfAborted(signal);
    onProgress?.({ fraction: (i + 1) / indices.length, stage: `Copying page ${i + 1}` });
    const [page] = await out.copyPages(src, [indices[i]!]);
    out.addPage(page);
  }
  return out.save({ useObjectStreams: true });
}

export async function splitEveryPage(
  file: File,
  opts: { signal?: AbortSignal; onProgress?: PdfFitProgressCb } = {},
): Promise<Uint8Array[]> {
  const { signal, onProgress } = opts;
  const bytes = await readBytes(file);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    throwIfAborted(signal);
    onProgress?.({ fraction: (i + 1) / total, stage: `Splitting page ${i + 1}/${total}` });
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(src, [i]);
    single.addPage(page);
    out.push(await single.save({ useObjectStreams: true }));
  }
  return out;
}

// ── Images → PDF ──────────────────────────────────────────────────

export type ImagePdfLayout = "fit" | "a4" | "original";

/**
 * Combine images into a single PDF. Each image becomes one page.
 * Layouts:
 *   fit      — page sized to image (capped to a sane max)
 *   a4       — A4 page with image centered and fit within margins
 *   original — page = image pixel dimensions in points
 */
export async function imagesToPdf(
  files: File[],
  opts: {
    layout: ImagePdfLayout;
    signal?: AbortSignal;
    onProgress?: PdfFitProgressCb;
  } = { layout: "fit" },
): Promise<Uint8Array> {
  const { layout, signal, onProgress } = opts;
  const out = await PDFDocument.create();
  const A4_W = 595.28;
  const A4_H = 841.89;

  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal);
    onProgress?.({
      fraction: (i + 1) / files.length,
      stage: `Adding image ${i + 1}/${files.length}`,
    });
    const f = files[i]!;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let img;
    // Determine format by extension/mime.
    const name = f.name.toLowerCase();
    if (name.endsWith(".png")) {
      img = await out.embedPng(bytes);
    } else {
      try {
        img = await out.embedJpg(bytes);
      } catch {
        // Maybe a PNG mislabeled, or progressive JPEG — rasterize via canvas.
        const png = await rasterizeToPng(f);
        img = await out.embedPng(png);
      }
    }
    const iw = img.width;
    const ih = img.height;

    let pageW: number;
    let pageH: number;
    let drawW: number;
    let drawH: number;
    if (layout === "a4") {
      pageW = A4_W;
      pageH = A4_H;
      const maxW = A4_W - 48;
      const maxH = A4_H - 48;
      const r = Math.min(maxW / iw, maxH / ih);
      drawW = iw * r;
      drawH = ih * r;
    } else if (layout === "original") {
      pageW = iw;
      pageH = ih;
      drawW = iw;
      drawH = ih;
    } else {
      // fit: cap to a sane max (1100pt ~ ~15in).
      const max = 1100;
      const r = Math.min(1, max / Math.max(iw, ih));
      pageW = iw * r;
      pageH = ih * r;
      drawW = pageW;
      drawH = pageH;
    }
    const page = out.addPage([pageW, pageH]);
    page.drawImage(img, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }
  return out.save({ useObjectStreams: true });
}

/** Rasterize an image File to PNG bytes via canvas (for webp/bmp/gif/fallback). */
async function rasterizeToPng(file: File): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context.");
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

// ── PDF → Images ──────────────────────────────────────────────────

export interface PdfToImageOutput {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/**
 * Render PDF pages to PNG or JPEG images.
 * @param pages 1-based page numbers to render; undefined = all pages.
 */
export async function pdfToImages(
  file: File,
  opts: {
    format: "png" | "jpeg";
    scale?: number;
    pages?: number[];
    signal?: AbortSignal;
    onProgress?: PdfFitProgressCb;
  } = { format: "png" },
): Promise<PdfToImageOutput[]> {
  const { format, scale = 1.5, pages, signal, onProgress } = opts;
  const pdfjsLib = await import("pdfjs-dist");
  configurePdfjsWorker(pdfjsLib);
  const pdfjs = pdfjsLib as unknown as PdfjsModule;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({
    data: data.slice(),
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
  }).promise;

  const total = doc.numPages;
  const want = pages && pages.length ? pages : Array.from({ length: total }, (_, i) => i + 1);
  const pad = String(total).length;
  const base = file.name.replace(/\.[^.]+$/, "") || "page";
  const out: PdfToImageOutput[] = [];

  for (let idx = 0; idx < want.length; idx++) {
    throwIfAborted(signal);
    const p = want[idx]!;
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: format === "png" });
    if (!ctx) throw new Error("Could not get canvas context.");
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
        mime,
        format === "jpeg" ? 0.92 : undefined,
      ),
    );
    out.push({
      name: `${base}-${String(p).padStart(pad, "0")}.${format === "png" ? "png" : "jpg"}`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime,
    });
    onProgress?.({
      fraction: (idx + 1) / want.length,
      stage: `Rendered page ${p}/${total}`,
    });
  }
  await doc.destroy();
  return out;
}
