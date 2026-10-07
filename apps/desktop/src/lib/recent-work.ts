/**
 * Recent work store — the bridge between the in-memory recent-files
 * store and the persistent SQLite-backed recent_work table.
 *
 * Strategy (Master Prompt 3 §30):
 *   - On app launch: load from Rust (listRecentWork).
 *   - On any successful operation: add to both the in-memory
 *     recent-files store (for Command Center quick access) AND the
 *     persistent recent_work table (for the History view).
 *   - On clear: clear both.
 *   - On remove: remove from both.
 *
 * If Rust is unavailable (running outside Tauri, e.g. unit tests),
 * the store falls back to in-memory only. The UI never crashes just
 * because the backend is absent.
 */

import { create } from "zustand";
import type { RecentWorkEntry, AddRecentWorkRequest } from "@paperu/contracts";
import {
  addRecentWork,
  listRecentWork,
  removeRecentWork,
  clearRecentWork,
} from "@/lib/ipc";
import { useRecentFiles, type RecentFile } from "@/lib/recent-files";

/** The persistent recent-work store. */
interface RecentWorkState {
  /** Most-recent-first list, loaded from Rust. */
  readonly entries: readonly RecentWorkEntry[];
  /** True while the initial load is in flight. */
  readonly loading: boolean;
  /** Set if the initial load failed (Rust unavailable, DB error). */
  readonly error: string | null;
  /** Load entries from Rust. Call on app mount. */
  load: () => Promise<void>;
  /** Add a new entry to the persistent store AND the in-memory store. */
  add: (request: AddRecentWorkRequest) => Promise<void>;
  /** Remove a single entry by id. */
  remove: (id: string) => Promise<void>;
  /** Clear all entries (persistent + in-memory). */
  clear: () => Promise<void>;
}

export const useRecentWork = create<RecentWorkState>((set) => ({
  entries: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const list = await listRecentWork(200);
      set({ entries: list, loading: false });
    } catch (err) {
      // Rust unavailable or DB error — fall back silently.
      // The in-memory store remains usable for the session.
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
    }
  },

  add: async (request) => {
    // 1. Try to persist to Rust.
    try {
      const entry = await addRecentWork(request);
      set((state) => ({
        entries: [entry, ...state.entries].slice(0, 200),
      }));
    } catch {
      // Rust unavailable — fall back to in-memory only.
    }
    // 2. ALWAYS mirror to the in-memory recent-files store so the
    //    Command Center can find it instantly.
    const inMemory: RecentFile = {
      path: request.outputPath ?? request.sourcePath,
      fileName: request.outputFileName ?? request.sourceFileName,
      kind: request.fileKind,
      humanReadableSize:
        request.humanReadableSizeAfter ?? request.humanReadableSizeBefore ?? "—",
      operation: request.operationLabel,
      timestamp: Date.now(),
    };
    useRecentFiles.getState().add(inMemory);
  },

  remove: async (id) => {
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    }));
    try {
      await removeRecentWork(id);
    } catch {
      // Rust unavailable — already removed from in-memory list.
    }
  },

  clear: async () => {
    set({ entries: [] });
    try {
      await clearRecentWork();
    } catch {
      // Rust unavailable — already cleared in-memory.
    }
    useRecentFiles.getState().clear();
  },
}));

/** Convenience selector: the most recent N entries. */
export function useRecentWorkEntries(
  limit: number = 50,
): readonly RecentWorkEntry[] {
  return useRecentWork((s) => s.entries.slice(0, limit));
}
