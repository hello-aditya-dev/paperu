/**
 * @paperu/contracts — operations.ts
 *
 * The catalogue of file operations Paperu will eventually support.
 *
 * This file intentionally defines the *shapes* of operations and
 * their results WITHOUT implementing the engines. Future agents must
 * conform to these contracts rather than inventing incompatible
 * interfaces. Engines live behind the `engines/` Rust module and are
 * wired into the task runner; the React layer only ever speaks the
 * types defined here.
 *
 * Every operation is:
 *   - Local-first (no upload).
 *   - Non-destructive (source untouched; atomic finalization).
 *   - Cancellable (through the task engine).
 */

import type { FilePath } from "./common.js";
import type { OutputMetadata } from "./progress.js";

// ── Operation kinds ──────────────────────────────────────────────
// A stable discriminator for task kinds. Adding one is a contract
// change requiring Rust + test coverage.

export const OperationKind = {
  InspectFile: "inspect_file",
  PdfCompress: "pdf.compress",
  PdfCompressToTargetSize: "pdf.compress_target_size",
  PdfMerge: "pdf.merge",
  PdfSplit: "pdf.split",
  PdfConvert: "pdf.convert",
  ImageResize: "image.resize",
  ImageCompress: "image.compress",
  ImageConvert: "image.convert",
  MetadataRemove: "metadata.remove",
  Sign: "sign.apply",
} as const;

export type OperationKind =
  (typeof OperationKind)[keyof typeof OperationKind];

// ── Conflict handling ────────────────────────────────────────────

export const ConflictStrategy = {
  /** Fail if an output already exists. */
  Fail: "fail",
  /** Append a numeric suffix to the output name. */
  Rename: "rename",
  /** Overwrite the existing output (explicit opt-in). */
  Overwrite: "overwrite",
} as const;

export type ConflictStrategy =
  (typeof ConflictStrategy)[keyof typeof ConflictStrategy];

// ── Base request ──────────────────────────────────────────────────

/** Fields common to every operation request. */
export interface OperationRequestBase {
  /** How to handle an output name collision. */
  readonly conflict?: ConflictStrategy;
  /** Optional explicit output directory (absolute). */
  readonly outputDir?: FilePath;
}

// ── Concrete request shapes (engines not yet implemented) ─────────

export interface PdfCompressRequest extends OperationRequestBase {
  readonly kind: typeof OperationKind.PdfCompress;
  readonly source: FilePath;
  /** Quality profile. Engine interprets the mapping. */
  readonly profile: "light" | "balanced" | "strong";
}

export interface PdfCompressToTargetSizeRequest
  extends OperationRequestBase {
  readonly kind: typeof OperationKind.PdfCompressToTargetSize;
  readonly source: FilePath;
  /** Target size in bytes the output must not exceed. */
  readonly targetBytes: number;
}

export interface PdfMergeRequest extends OperationRequestBase {
  readonly kind: typeof OperationKind.PdfMerge;
  readonly sources: readonly FilePath[];
  /** Optional explicit output file name. */
  readonly outputName?: string;
}

export interface PdfSplitRequest extends OperationRequestBase {
  readonly kind: typeof OperationKind.PdfSplit;
  readonly source: FilePath;
  /** Page ranges in 1-based inclusive form, e.g. ["1-3","5"]. */
  readonly ranges: readonly string[];
}

export interface ImageResizeRequest extends OperationRequestBase {
  readonly kind: typeof OperationKind.ImageResize;
  readonly source: FilePath;
  readonly width: number;
  readonly height: number;
  readonly keepAspectRatio: boolean;
}

export interface MetadataRemoveRequest extends OperationRequestBase {
  readonly kind: typeof OperationKind.MetadataRemove;
  readonly source: FilePath;
  /** Kinds of metadata to strip. */
  readonly scopes: readonly ("exif" | "gps" | "document")[];
}

/** Discriminated union of all operation requests. */
export type OperationRequest =
  | PdfCompressRequest
  | PdfCompressToTargetSizeRequest
  | PdfMergeRequest
  | PdfSplitRequest
  | ImageResizeRequest
  | MetadataRemoveRequest;

// ── Result ────────────────────────────────────────────────────────

/**
 * The result of a completed operation. Includes real output
 * metadata so the UI can show accurate before/after sizes.
 */
export interface OperationResult {
  readonly kind: OperationKind;
  /** Output files produced. Empty for read-only operations. */
  readonly outputs: readonly OutputMetadata[];
  /** Optional summary metrics (real, not fabricated). */
  readonly metrics?: OperationMetrics;
}

/** Real, measured metrics for a finished operation. */
export interface OperationMetrics {
  /** Bytes saved vs. source (negative if output grew). */
  readonly bytesDelta?: number;
  /** Duration in milliseconds. */
  readonly durationMs?: number;
  /** Number of items processed. */
  readonly itemsProcessed?: number;
}
