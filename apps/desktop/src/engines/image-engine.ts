/**
 * Image target-size engine — webview-side processing via Canvas.
 *
 * Iteratively reduces an image to fit under a target size by binary-
 * searching JPEG/WebP quality at descending resolutions. PNGs with
 * transparency stay PNG and are reduced by downscaling only.
 *
 * Privacy: all processing is local. No uploads. Source is read-only.
 */

export interface ImgFitProgress {
  fraction: number | null;
  stage: string;
}
export type ImgFitProgressCb = (p: ImgFitProgress) => void;

export type ImgFormat = "jpeg" | "png" | "webp";

export interface ImageFitResult {
  bytes: Uint8Array;
  format: ImgFormat;
  originalSize: number;
  targetSize: number;
  finalSize: number;
  requirementMet: boolean;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  transparencyPreserved: boolean;
  meta: { stepsTried: number; strategy: string };
}

export interface ImageFitOptions {
  targetBytes: number;
  signal?: AbortSignal;
  onProgress?: ImgFitProgressCb;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ImgFormat,
  quality: number,
): Promise<Blob> {
  const mime =
    format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encode failed"))),
      mime,
      quality,
    ),
  );
}

/**
 * Detect real transparency by scanning bitmap pixels for alpha < 255.
 * Only returns true if the image actually has transparent pixels,
 * not merely because Canvas ImageData has 4 channels.
 */
function detectTransparency(bmp: ImageBitmap): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(bmp.width, 64);
  canvas.height = Math.min(bmp.height, 64);
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 255) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function fitImageToSize(
  file: File,
  opts: ImageFitOptions,
): Promise<ImageFitResult> {
  const { targetBytes, signal, onProgress } = opts;
  const originalSize = file.size;
  const bmp = await loadBitmap(file);
  const originalWidth = bmp.width;
  const originalHeight = bmp.height;

  // Detect transparency: check if the image format supports alpha
  // AND if any pixel actually has alpha < 255. The old code checked
  // Canvas ImageData channel count which is always 4 (RGBA) — making
  // every image appear transparent. Now we actually scan pixels.
  const hasAlpha = detectTransparency(bmp);

  // Decide format: PNG for transparency, JPEG for photos.
  const format: ImgFormat = hasAlpha ? "png" : "jpeg";

  throwIfAborted(signal);
  onProgress?.({ fraction: 0.05, stage: "Decoding image…" });

  // If already under target, re-encode at chosen format.
  if (originalSize <= targetBytes) {
    const canvas = document.createElement("canvas");
    canvas.width = originalWidth;
    canvas.height = originalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context.");
    ctx.drawImage(bmp, 0, 0);
    const blob = await canvasToBlob(canvas, format, 0.92);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bmp.close?.();
    return {
      bytes,
      format,
      originalSize,
      targetSize: targetBytes,
      finalSize: bytes.byteLength,
      requirementMet: bytes.byteLength <= targetBytes,
      width: originalWidth,
      height: originalHeight,
      originalWidth,
      originalHeight,
      transparencyPreserved: hasAlpha && format === "png",
      meta: { stepsTried: 1, strategy: "already-under-target" },
    };
  }

  const drawAt = (scale: number): HTMLCanvasElement => {
    const w = Math.max(1, Math.round(originalWidth * scale));
    const h = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context.");
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    return canvas;
  };

  const margin = Math.max(512, Math.round(targetBytes * 0.02));
  const goal = targetBytes - margin;
  const scaleSteps = [1.0, 0.9, 0.75, 0.6, 0.5, 0.4];
  let best: { bytes: Uint8Array; size: number; w: number; h: number; quality: number; scale: number } | null = null;
  let stepsTried = 0;

  for (const scale of scaleSteps) {
    throwIfAborted(signal);
    if (format === "png") {
      // PNG is lossless — only dimensions reduce size.
      const canvas = drawAt(scale);
      const blob = await canvasToBlob(canvas, "png", 1);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      stepsTried++;
      onProgress?.({
        fraction: 0.1 + 0.8 * (scaleSteps.indexOf(scale) + 1) / scaleSteps.length,
        stage: `PNG at ${Math.round(scale * 100)}% — ${Math.round(bytes.byteLength / 1024)} KB`,
      });
      if (!best || bytes.byteLength < best.size) {
        best = { bytes, size: bytes.byteLength, w: canvas.width, h: canvas.height, quality: 1, scale };
      }
      if (bytes.byteLength <= goal) break;
      continue;
    }

    // JPEG: binary-search quality in [0.25, 0.92].
    let lo = 0.25;
    let hi = 0.92;
    let localBest: { bytes: Uint8Array; size: number; quality: number } | null = null;
    for (let it = 0; it < 6; it++) {
      throwIfAborted(signal);
      const q = (lo + hi) / 2;
      const canvas = drawAt(scale);
      const blob = await canvasToBlob(canvas, format, q);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      stepsTried++;
      onProgress?.({
        fraction: 0.1 + 0.8 * ((scaleSteps.indexOf(scale) * 6 + it + 1) / (scaleSteps.length * 6)),
        stage: `${format.toUpperCase()} ${Math.round(scale * 100)}% q${Math.round(q * 100)} — ${Math.round(bytes.byteLength / 1024)} KB`,
      });
      if (bytes.byteLength <= goal) {
        localBest = { bytes, size: bytes.byteLength, quality: q };
        lo = q;
      } else {
        hi = q;
        if (!localBest || bytes.byteLength < localBest.size) {
          localBest = { bytes, size: bytes.byteLength, quality: q };
        }
      }
    }
    if (localBest) {
      if (!best || localBest.size < best.size) {
        best = {
          bytes: localBest.bytes,
          size: localBest.size,
          w: Math.round(originalWidth * scale),
          h: Math.round(originalHeight * scale),
          quality: localBest.quality,
          scale,
        };
      }
      if (localBest.size <= goal) break;
    }
  }

  bmp.close?.();

  if (!best) throw new Error("Could not compress this image.");

  const requirementMet = best.size <= targetBytes;
  const strategy = format === "png"
    ? `png-downscale scale=${best.scale}`
    : `${format}-q${best.quality.toFixed(2)} scale=${best.scale}`;

  onProgress?.({ fraction: 1, stage: requirementMet ? "Done" : "Lowest safe result" });

  // Validate output before declaring success (doctrine §47).
  const verifyBlob = new Blob([best.bytes.slice()], { type: "image/octet-stream" });
  const verifyBmp = await createImageBitmap(verifyBlob);
  verifyBmp.close?.();

  return {
    bytes: best.bytes,
    format,
    originalSize,
    targetSize: targetBytes,
    finalSize: best.size,
    requirementMet,
    width: best.w,
    height: best.h,
    originalWidth,
    originalHeight,
    transparencyPreserved: hasAlpha && format === "png",
    meta: { stepsTried, strategy },
  };
}

// ── Image utilities (32→50 sprint: resize, crop, rotate, convert, metadata) ─

export interface ResizeOptions {
  width?: number;
  height?: number;
  preserveAspectRatio?: boolean;
}

export async function resizeImage(
  file: File,
  opts: ResizeOptions,
): Promise<{ bytes: Uint8Array; width: number; height: number; format: string }> {
  const bmp = await loadBitmap(file);
  let targetW = opts.width ?? bmp.width;
  let targetH = opts.height ?? bmp.height;
  if (opts.preserveAspectRatio ?? true) {
    const ratio = bmp.width / bmp.height;
    if (opts.width && !opts.height) {
      targetH = Math.round(opts.width / ratio);
    } else if (opts.height && !opts.width) {
      targetW = Math.round(opts.height * ratio);
    } else if (opts.width && opts.height) {
      // Fit within both dimensions preserving aspect ratio.
      const scaleW = opts.width / bmp.width;
      const scaleH = opts.height / bmp.height;
      const scale = Math.min(scaleW, scaleH);
      targetW = Math.round(bmp.width * scale);
      targetH = Math.round(bmp.height * scale);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for resizing.");
  ctx.drawImage(bmp, 0, 0, targetW, targetH);
  const blob = await canvasToBlob(canvas, "png", 1.0);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, width: targetW, height: targetH, format: "png" };
}

export async function cropImage(
  file: File,
  crop: { x: number; y: number; width: number; height: number },
): Promise<{ bytes: Uint8Array; width: number; height: number; format: string }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for cropping.");
  ctx.drawImage(
    bmp,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, crop.width, crop.height,
  );
  const blob = await canvasToBlob(canvas, "png", 1.0);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, width: crop.width, height: crop.height, format: "png" };
}

export async function rotateImage(
  file: File,
  degrees: 90 | 180 | 270,
): Promise<{ bytes: Uint8Array; width: number; height: number; format: string }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  if (degrees === 90 || degrees === 270) {
    canvas.width = bmp.height;
    canvas.height = bmp.width;
  } else {
    canvas.width = bmp.width;
    canvas.height = bmp.height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for rotation.");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  const blob = await canvasToBlob(canvas, "png", 1.0);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    width: canvas.width,
    height: canvas.height,
    format: "png",
  };
}

export async function convertImage(
  file: File,
  format: "jpeg" | "png" | "webp",
  quality = 0.92,
): Promise<{ bytes: Uint8Array; format: string }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for conversion.");
  ctx.drawImage(bmp, 0, 0);
  const blob = await canvasToBlob(canvas, format, quality);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, format };
}

export interface ImageMetadata {
  width: number;
  height: number;
  hasExif: boolean;
  hasGps: boolean;
  format: string;
}

export async function inspectImageMetadata(file: File): Promise<ImageMetadata> {
  const bmp = await loadBitmap(file);
  // Canvas re-encoding strips EXIF/GPS by default — the original file
  // may have metadata, but the re-encoded output won't.
  // For real EXIF inspection, we'd need an EXIF parser library.
  // For now, detect EXIF presence via magic bytes.
  const buf = new Uint8Array(await file.arrayBuffer());
  const hasExif = buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xE1;
  return {
    width: bmp.width,
    height: bmp.height,
    hasExif,
    hasGps: hasExif, // conservative: if EXIF exists, GPS might be there
    format: file.type || "unknown",
  };
}

export async function stripExif(file: File): Promise<{ bytes: Uint8Array; format: string; removed: string[] }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for metadata stripping.");
  ctx.drawImage(bmp, 0, 0);
  // Re-encoding via canvas strips ALL metadata (EXIF, GPS, camera info).
  // The output is a clean image with no embedded metadata.
  const blob = await canvasToBlob(canvas, "jpeg", 0.95);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const meta = await inspectImageMetadata(file);
  const removed: string[] = [];
  if (meta.hasExif) removed.push("EXIF camera metadata");
  if (meta.hasGps) removed.push("GPS location data");
  return { bytes, format: "jpeg", removed };
}
