/**
 * @paperu/contracts — recent_work.ts
 *
 * The persistent recent-work history contract. Rust mirror:
 * `apps/desktop/src-tauri/src/contracts/recent_work.rs`. Both sides
 * MUST serialize to identical JSON.
 *
 * Stores ONLY file metadata (paths, sizes, operation id/label). NEVER
 * document contents, signature image data, or fill text. Privacy
 * doctrine §82: paths are local-only metadata.
 */

import type { FilePath, IsoTimestamp } from "./common.js";

/** A single recent-work entry. */
export interface RecentWorkEntry {
  /** Stable unique id (UUID v4). */
  readonly id: string;
  /** Canonical absolute path of the source file. */
  readonly sourcePath: FilePath;
  /** Display name of the source file. */
  readonly sourceFileName: string;
  /** Coarse kind: "pdf" | "image" | "other". */
  readonly fileKind: string;
  /** Canonical absolute path of the output (null for inspect-only ops). */
  readonly outputPath: FilePath | null;
  /** Display name of the output file. */
  readonly outputFileName: string | null;
  /** Module id, e.g. "pdf-fit". */
  readonly operationId: string;
  /** Human label, e.g. "Made PDF fit". */
  readonly operationLabel: string;
  /** "success" | "error" | "cancelled". */
  readonly status: "success" | "error" | "cancelled";
  /** Source size in bytes (null if unknown). */
  readonly sizeBefore: number | null;
  /** Output size in bytes (null for no-output ops). */
  readonly sizeAfter: number | null;
  /** Human-readable source size, e.g. "3.8 MB". */
  readonly humanReadableSizeBefore: string | null;
  /** Human-readable output size. */
  readonly humanReadableSizeAfter: string | null;
  /** ISO-8601 UTC timestamp. */
  readonly createdAt: IsoTimestamp;
  /** Correlation id. */
  readonly correlationId: string;
}

/** Request to add a new recent-work entry. */
export interface AddRecentWorkRequest {
  readonly sourcePath: FilePath;
  readonly sourceFileName: string;
  readonly fileKind: string;
  readonly outputPath: FilePath | null;
  readonly outputFileName: string | null;
  readonly operationId: string;
  readonly operationLabel: string;
  readonly status: "success" | "error" | "cancelled";
  readonly sizeBefore: number | null;
  readonly sizeAfter: number | null;
  readonly humanReadableSizeBefore: string | null;
  readonly humanReadableSizeAfter: string | null;
  /** Optional correlation id. If absent, the backend generates one. */
  readonly correlationId?: string;
}

/** Command names for the recent_work IPC boundary. */
export const RecentWorkCommand = {
  Add: "add_recent_work",
  List: "list_recent_work",
  Remove: "remove_recent_work",
  Clear: "clear_recent_work",
} as const;
