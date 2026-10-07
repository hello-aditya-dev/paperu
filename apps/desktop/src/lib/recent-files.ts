/**
 * Recent files store — tracks the last files Paperu has operated on.
 *
 * A mature application remembers what you worked on (doctrine:
 * "LOOK FOR FEATURES USERS EXPECT WITHOUT THINKING ABOUT THEM").
 * This store tracks recent files so the Home view can show them and
 * the Command Center can search them.
 *
 * The store is in-memory for now (resets on app restart). Future
 * persistence via the canonical settings/SQLite layer is a
 * straightforward extension.
 */

import { create } from "zustand";

/** A recent file entry. */
export interface RecentFile {
  /** Canonical absolute path. */
  readonly path: string;
  /** Display name (fileName). */
  readonly fileName: string;
  /** Coarse kind. */
  readonly kind: string;
  /** Human-readable size. */
  readonly humanReadableSize: string;
  /** The operation that was performed. */
  readonly operation: string;
  /** When this entry was added (ms epoch). */
  readonly timestamp: number;
}

interface RecentFilesState {
  /** Most-recent-first list, capped at 10 entries. */
  readonly files: readonly RecentFile[];
  /** Add a file to the recent list (deduplicates by path, moves to top). */
  add: (file: RecentFile) => void;
  /** Clear all recent files. */
  clear: () => void;
}

const MAX_RECENT = 10;

export const useRecentFiles = create<RecentFilesState>((set) => ({
  files: [],

  add: (file) =>
    set((state) => {
      // Remove any existing entry with the same path, then prepend.
      const filtered = state.files.filter((f) => f.path !== file.path);
      return { files: [file, ...filtered].slice(0, MAX_RECENT) };
    }),

  clear: () => set({ files: [] }),
}));
