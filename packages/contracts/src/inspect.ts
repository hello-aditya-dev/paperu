/**
 * @paperu/contracts — inspect.ts
 *
 * The Local File Inspect contract.
 *
 * This is the first end-to-end real capability of Paperu and the
 * proof that the React → contract → Tauri → Rust → result pipeline
 * works against an actual file on disk.
 *
 * Privacy:
 *   - No file *content* is read or transported.
 *   - Only filesystem metadata (size, timestamps, kind) is returned.
 *   - The original file is never modified.
 */

import type { ByteSize, FileKind, FilePath, IsoTimestamp } from "./common.js";

// ── Request ───────────────────────────────────────────────────────

/**
 * Request to inspect a local file by absolute path.
 *
 * The path is resolved and validated server-side. The frontend must
 * not assume the path is trusted; the Rust layer re-validates it.
 */
export interface InspectFileRequest {
  /** Absolute path to a file on the local filesystem. */
  readonly path: FilePath;
}

// ── Response ──────────────────────────────────────────────────────

/**
 * Real metadata about a local file, gathered from the filesystem.
 * Every field is derived from the actual file on disk — none of it
 * is fabricated.
 */
export interface InspectFileResponse {
  /** Canonical absolute path that was inspected. */
  readonly path: FilePath;
  /** File name component (with extension). */
  readonly fileName: string;
  /** File stem (name without extension), where determinable. */
  readonly fileStem?: string;
  /** Lowercased extension without the leading dot, e.g. "pdf". */
  readonly extension?: string;
  /** Coarse detected file kind. */
  readonly kind: FileKind;
  /** MIME type guess, where determinable. */
  readonly mimeType?: string;
  /** Exact byte size and human-readable form. */
  readonly size: ByteSize;
  /** Last modification time (ISO-8601 UTC), where available. */
  readonly modifiedAt?: IsoTimestamp;
  /** Creation/birth time (ISO-8601 UTC), where available. */
  readonly createdAt?: IsoTimestamp;
  /** Last access time (ISO-8601 UTC), where available. */
  readonly accessedAt?: IsoTimestamp;
  /** True when the file is read-only at the OS level. */
  readonly readOnly: boolean;
  /** True when the file resides in a known synced folder (OneDrive). */
  readonly inSyncedFolder: boolean;
  /** Whether the file currently exists on disk (defensive). */
  readonly exists: boolean;
}

// ── Tauri binding ────────────────────────────────────────────────

export const InspectFileCommand = "inspect_file" as const;

/** Argument shape passed to `invoke(InspectFileCommand, ...)`. */
export interface InspectFileArgs {
  readonly request: InspectFileRequest;
}
