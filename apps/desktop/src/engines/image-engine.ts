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

// ── Image adjustments (90% §32, Wave 3) — Canvas pixel manipulation ─

export interface AdjustOptions {
  /** Brightness: -100 (dark) to +100 (bright), 0 = unchanged. */
  brightness?: number;
  /** Contrast: -100 to +100, 0 = unchanged. */
  contrast?: number;
  /** Saturation: -100 (grayscale) to +100 (oversaturated), 0 = unchanged. */
  saturation?: number;
  /** If true, convert to grayscale (luminance). */
  grayscale?: boolean;
  /** If true, threshold to pure black & white (1-bit). */
  blackAndWhite?: boolean;
}

/**
 * Apply brightness/contrast/saturation/grayscale/B&W adjustments via
 * per-pixel manipulation. All local — no uploads. Returns the modified
 * bytes as JPEG (re-encoded; the original is never touched, source-safety §22).
 */
export async function adjustImage(
  file: File,
  opts: AdjustOptions,
): Promise<{ bytes: Uint8Array; format: string }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for adjustments.");
  ctx.drawImage(bmp, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  // Normalize adjustments to the [-1, 1] or multiplier range.
  const b = (opts.brightness ?? 0) / 100; // -1..1, added to each channel
  const c = (opts.contrast ?? 0) / 100; // -1..1
  const contrastFactor = (1.0 + c) / (1.0 + (1.0 - c) * c); // tanh-like
  const sat = 1.0 + (opts.saturation ?? 0) / 100; // 0..2
  const gray = opts.grayscale ?? false;
  const bw = opts.blackAndWhite ?? false;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]!;
    let g = data[i + 1]!;
    let bl = data[i + 2]!;
    // Brightness: add a constant.
    r += b * 255;
    g += b * 255;
    bl += b * 255;
    // Contrast: scale around 128.
    r = (r - 128) * contrastFactor + 128;
    g = (g - 128) * contrastFactor + 128;
    bl = (bl - 128) * contrastFactor + 128;
    // Saturation: interpolate toward grayscale (luminance).
    const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = lum + (r - lum) * sat;
    g = lum + (g - lum) * sat;
    bl = lum + (bl - lum) * sat;
    // Grayscale: collapse to luminance.
    if (gray) {
      r = g = bl = lum;
    }
    // Black & white: threshold the luminance.
    if (bw) {
      const v = lum > 128 ? 255 : 0;
      r = g = bl = v;
    }
    // Clamp.
    data[i] = Math.min(255, Math.max(0, r));
    data[i + 1] = Math.min(255, Math.max(0, g));
    data[i + 2] = Math.min(255, Math.max(0, bl));
    // Alpha unchanged.
  }
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvasToBlob(canvas, "jpeg", 0.92);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, format: "jpeg" };
}

/**
 * Flip an image horizontally and/or vertically. Returns PNG (lossless).
 */
export async function flipImage(
  file: File,
  opts: { horizontal?: boolean; vertical?: boolean },
): Promise<{ bytes: Uint8Array; format: string }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for flipping.");
  // Flip via transform: move to center, scale -1, draw back.
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(opts.horizontal ? -1 : 1, opts.vertical ? -1 : 1);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  const blob = await canvasToBlob(canvas, "png", 1.0);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, format: "png" };
}

export interface WatermarkOptions {
  text: string;
  /** Opacity 0..1 (default 0.3). */
  opacity?: number;
  /** Font size in pixels (default 48). */
  fontSize?: number;
  /** Position: center (default), bottom-right, etc. */
  position?: "center" | "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

/**
 * Burn a text watermark into the image. Re-encodes as JPEG (the watermark
 * is permanent; the original is never touched, source-safety §22).
 */
export async function watermarkImage(
  file: File,
  opts: WatermarkOptions,
): Promise<{ bytes: Uint8Array; format: string }> {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Paperu couldn't get a canvas context for watermarking.");
  ctx.drawImage(bmp, 0, 0);
  const fontSize = opts.fontSize ?? 48;
  const opacity = opts.opacity ?? 0.3;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(opts.text);
  const pad = fontSize;
  const { x, y } = watermarkPosition(opts.position ?? "center", canvas.width, canvas.height, metrics.width, pad);
  ctx.lineWidth = 2;
  ctx.strokeText(opts.text, x, y);
  ctx.fillText(opts.text, x, y);
  const blob = await canvasToBlob(canvas, "jpeg", 0.92);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, format: "jpeg" };
}

function watermarkPosition(
  pos: "center" | "bottom-right" | "bottom-left" | "top-right" | "top-left",
  canvasW: number,
  canvasH: number,
  textWidth: number,
  pad: number,
): { x: number; y: number } {
  switch (pos) {
    case "bottom-right":
      return { x: canvasW - textWidth / 2 - pad, y: canvasH - pad };
    case "bottom-left":
      return { x: textWidth / 2 + pad, y: canvasH - pad };
    case "top-right":
      return { x: canvasW - textWidth / 2 - pad, y: pad };
    case "top-left":
      return { x: textWidth / 2 + pad, y: pad };
    default:
      return { x: canvasW / 2, y: canvasH / 2 };
  }
}

export interface ImageMetadata {
  width: number;
  height: number;
  hasExif: boolean;
  hasGps: boolean;
  format: string;
}

/**
 * Lightweight JPEG EXIF GPS detector — no external dependency.
 *
 * EXIF is carried in a JPEG APP1 segment (marker 0xFFE1) whose payload
 * begins with the signature "Exif\0\0", followed by a TIFF header. The
 * TIFF header declares byte order (II = little-endian, MM = big-endian),
 * a magic (0x002A), and an offset to IFD0. IFD0 entries are 12 bytes
 * each: tag(2) + type(2) + count(4) + value/offset(4). The GPS IFD is
 * pointed to by tag 0x8825 (GPSInfoIFDPointer) in IFD0; if that tag is
 * present and its value is a non-zero offset, the image carries real
 * GPS coordinates. EXIF presence alone does NOT prove GPS presence.
 *
 * Returns { hasExif, hasGps } based on what is actually in the bytes.
 * For non-JPEG formats (PNG, WebP, etc.) this returns false unless we
 * can positively detect EXIF — we never claim GPS that isn't there.
 */
export function detectJpegExifGps(buf: Uint8Array): { hasExif: boolean; hasGps: boolean } {
  // A JPEG starts with SOI (FF D8). Each segment is FF <marker> <len:2 BE> <data>.
  if (buf.length < 4 || buf[0]! !== 0xff || buf[1]! !== 0xd8) {
    return { hasExif: false, hasGps: false };
  }
  let offset = 2;
  // Walk segments until we find an APP1 (0xE1) carrying "Exif\0\0".
  while (offset + 4 <= buf.length) {
    if (buf[offset]! !== 0xff) break; // malformed — bail out.
    const marker = buf[offset + 1]!;
    offset += 2;
    // Standalone markers (no length): RSTn, SOI, EOI, TEM.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buf.length) break;
    const segLen = (buf[offset]! << 8) | buf[offset + 1]!;
    if (segLen < 2 || offset + segLen > buf.length) break;
    const segDataStart = offset + 2;
    if (marker === 0xe1) {
      // APP1 — check for EXIF signature.
      const EXIF_SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
      let isExif = true;
      for (let i = 0; i < EXIF_SIG.length; i++) {
        if (buf[segDataStart + i]! !== EXIF_SIG[i]!) { isExif = false; break; }
      }
      if (isExif) {
        const tiffStart = segDataStart + 6;
        return parseTiffForGps(buf, tiffStart, segDataStart + segLen - 2);
      }
    }
    offset += segLen;
  }
  return { hasExif: false, hasGps: false };
}

/** Parse the TIFF header + IFD0 to determine whether a GPS IFD is pointed to. */
function parseTiffForGps(buf: Uint8Array, tiffStart: number, segEnd: number): { hasExif: true; hasGps: boolean } {
  if (tiffStart + 8 > segEnd) return { hasExif: true, hasGps: false };
  const byteOrder = (buf[tiffStart]! << 8) | buf[tiffStart + 1]!;
  const little = byteOrder === 0x4949; // "II" little-endian. "MM" = 0x4D4D big-endian.
  const readU16 = (off: number): number =>
    little ? (buf[off]! | (buf[off + 1]! << 8)) : ((buf[off]! << 8) | buf[off + 1]!);
  const readU32 = (off: number): number =>
    little
      ? (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0
      : (((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0);
  const magic = readU16(tiffStart + 2);
  if (magic !== 0x002a) return { hasExif: true, hasGps: false };
  const ifd0Offset = readU32(tiffStart + 4);
  const ifd0Start = tiffStart + ifd0Offset;
  if (ifd0Start + 2 > segEnd) return { hasExif: true, hasGps: false };
  const entryCount = readU16(ifd0Start);
  const GPS_TAG = 0x8825; // GPSInfoIFDPointer
  for (let i = 0; i < entryCount; i++) {
    const entry = ifd0Start + 2 + i * 12;
    if (entry + 12 > segEnd) break;
    const tag = readU16(entry);
    if (tag === GPS_TAG) {
      const valueOffset = readU32(entry + 8);
      // Non-zero offset means a real GPS IFD follows.
      if (valueOffset !== 0) return { hasExif: true, hasGps: true };
    }
  }
  // EXIF segment exists but no GPS IFD pointer.
  return { hasExif: true, hasGps: false };
}

export async function inspectImageMetadata(file: File): Promise<ImageMetadata> {
  const bmp = await loadBitmap(file);
  const buf = new Uint8Array(await file.arrayBuffer());
  const { hasExif, hasGps } = detectJpegExifGps(buf);
  return {
    width: bmp.width,
    height: bmp.height,
    hasExif,
    hasGps,
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
  // Truthful report: only claim we removed metadata that was ACTUALLY there.
  const meta = await inspectImageMetadata(file);
  const removed: string[] = [];
  if (meta.hasExif) removed.push("EXIF camera metadata");
  if (meta.hasGps) removed.push("GPS location data");
  return { bytes, format: "jpeg", removed };
}
