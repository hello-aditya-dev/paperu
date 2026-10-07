/**
 * @paperu/contracts — reading_history.ts
 *
 * Records the user's last reading position per document (Master Prompt
 * 4 §25). Local only, clearable. NEVER stores document contents.
 *
 * Rust mirror at `contracts/reading_history.rs`. JSON shapes match.
 */

import type { FilePath, IsoTimestamp } from "./common.js";

/** A reading-history entry. */
export interface ReadingHistoryEntry {
  readonly id: string;
  readonly filePath: FilePath;
  readonly fileName: string;
  readonly fileKind: string;
  readonly lastPage: number;
  readonly scrollY: number;
  readonly zoomLevel: number;
  /** Bookmarked page numbers, 1-indexed. */
  readonly bookmarks: readonly number[];
  readonly lastOpenedAt: IsoTimestamp;
}

/** Upsert request — called when a document is opened or scrolled. */
export interface UpdateReadingHistoryRequest {
  readonly filePath: FilePath;
  readonly fileName: string;
  readonly fileKind: string;
  readonly lastPage?: number;
  readonly scrollY?: number;
  readonly zoomLevel?: number;
  readonly bookmarks?: readonly number[];
}

/** Command names for the reading_history IPC boundary. */
export const ReadingHistoryCommand = {
  Upsert: "upsert_reading_history",
  Get: "get_reading_history",
  List: "list_reading_history",
  Remove: "remove_reading_history",
  Clear: "clear_reading_history",
} as const;
