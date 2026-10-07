/**
 * @paperu/contracts — watch.ts
 *
 * Watch Folders — debounced filesystem watching via notify (CC0) +
 * notify-debouncer-mini (MIT/Apache). Rust mirror at commands/watch.rs.
 *
 * Events are emitted to the frontend as `paperu://watch-event` payloads.
 * Paperu takes NO destructive automatic action (§22) — the frontend
 * decides what to do. Self-loop prevention filters Paperu's own output
 * files so a rule doesn't re-trigger on Paperu's finalize_output writes.
 */

/** A single debounced filesystem event, emitted to the frontend. */
export interface WatchEvent {
  /** The absolute path that changed. */
  readonly path: string;
  /** Coarse kind: create | modify | remove | access | other. */
  readonly kind: string;
}

export const WatchCommand = {
  Start: "start_watch_folder",
  Stop: "stop_watch_folder",
  Current: "current_watch_folder",
} as const;

/** The Tauri event channel name for watch events. */
export const WATCH_EVENT_CHANNEL = "paperu://watch-event";
