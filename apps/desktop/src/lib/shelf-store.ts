/**
 * Paperu Shelf store — session-scoped multi-file workspace state.
 *
 * This is a Zustand store. It is INTENTIONALLY in-memory only (Master
 * Prompt 3 §20): no sensitive file lists are persisted to disk until an
 * explicit privacy/storage policy is approved by Integrator + Guardian.
 *
 * The store holds safe local file REFERENCES (path + metadata), never
 * copies of file contents. Items are added by Universal Drop, by an
 * "Add to Shelf" button on result cards, or by direct API in tests.
 *
 * Each item carries a `missing` flag. The store does not actively poll
 * the filesystem — missing-state is set when a feature tries to use an
 * item and finds the file gone. Missing items are shown with a clear
 * "This file moved or was deleted" note, never silently dropped (§19).
 */

import { create } from "zustand";

/** A file reference in the shelf. */
export interface ShelfItem {
  /** Stable unique id (uuid or path+timestamp). */
  readonly id: string;
  /** Canonical absolute path. */
  readonly path: string;
  /** Display name. */
  readonly fileName: string;
  /** Coarse kind: "pdf" | "image" | "other". */
  readonly kind: "pdf" | "image" | "other";
  /** Human-readable size. */
  readonly humanReadableSize: string;
  /** Raw size in bytes. */
  readonly size: number;
  /** Set true when an operation discovers the file is gone. */
  readonly missing?: boolean;
  /** Source: "drop" | "result" | "manual". */
  readonly source: "drop" | "result" | "manual";
  /** When the item was added (ms epoch). */
  readonly timestamp: number;
}

interface ShelfState {
  readonly items: readonly ShelfItem[];
  /** Add a file to the shelf. Dedupes by path (moves to top). */
  add: (item: Omit<ShelfItem, "id" | "timestamp">) => void;
  /** Add many files at once (drop handler). Dedupes by path. */
  addMany: (items: ReadonlyArray<Omit<ShelfItem, "id" | "timestamp">>) => void;
  /** Remove a single item by id. */
  remove: (id: string) => void;
  /** Reorder: swap items at idx a and b. */
  reorder: (a: number, b: number) => void;
  /** Clear all items. */
  clear: () => void;
  /** Mark an item as missing (when an op discovers the file is gone). */
  markMissing: (id: string) => void;
  /** Clear the persisted selection state (no-op for now, hook for §19). */
  clearSelection: () => void;
}

const MAX_SHELF = 50;

function makeId(path: string, ts: number): string {
  // Stable enough for session scope; we don't need crypto uuids here.
  return `${path}::${ts}::${Math.random().toString(36).slice(2, 8)}`;
}

export const ShelfStore = create<ShelfState>((set) => ({
  items: [],

  add: (item) =>
    set((state) => {
      const ts = Date.now();
      // Dedupe by path — move existing entry to top.
      const filtered = state.items.filter((i) => i.path !== item.path);
      const next: ShelfItem = {
        ...item,
        id: makeId(item.path, ts),
        timestamp: ts,
      };
      return { items: [next, ...filtered].slice(0, MAX_SHELF) };
    }),

  addMany: (newItems) =>
    set((state) => {
      const ts = Date.now();
      // Dedupe by path; preserve first occurrence in input order.
      const seenPaths = new Set<string>();
      const additions: ShelfItem[] = [];
      for (const item of newItems) {
        if (seenPaths.has(item.path)) continue;
        seenPaths.add(item.path);
        additions.push({
          ...item,
          id: makeId(item.path, ts),
          timestamp: ts,
        });
      }
      // Remove existing entries whose paths are now being re-added (to top).
      const filtered = state.items.filter(
        (i) => !seenPaths.has(i.path),
      );
      // New items go to the top of the shelf.
      return {
        items: [...additions, ...filtered].slice(0, MAX_SHELF),
      };
    }),

  remove: (id) =>
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    })),

  reorder: (a, b) =>
    set((state) => {
      if (a === b) return {};
      if (a < 0 || b < 0 || a >= state.items.length || b >= state.items.length) {
        return {};
      }
      const next = [...state.items];
      const aItem = next[a];
      const bItem = next[b];
      if (aItem === undefined || bItem === undefined) return {};
      next[a] = bItem;
      next[b] = aItem;
      return { items: next };
    }),

  clear: () => set({ items: [] }),

  markMissing: (id) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id ? { ...i, missing: true } : i,
      ),
    })),

  clearSelection: () => set({}), // no persisted selection currently
}));
