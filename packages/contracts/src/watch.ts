/**
 * @paperu/contracts — watch.ts
 *
 * Watch Folders — debounced filesystem watching via notify (CC0) +
 * notify-debouncer-mini (MIT/Apache). Rust mirror at commands/watch.rs
 * (the live watcher) and watch_rules/mod.rs (the rule store +
 * dispatcher, gated behind `tauri-runtime`).
 *
 * Events are emitted to the frontend as `paperu://watch-event` payloads.
 * Paperu takes NO destructive automatic action (§22) — the frontend
 * decides what to do. Self-loop prevention filters Paperu's own output
 * files so a rule doesn't re-trigger on Paperu's finalize_output writes.
 *
 * Prompt 02 §9 promotes this surface from a single-folder live feed
 * into a full Watch Folders workspace: watched folders (A),
 * automation rules (B) and execution activity (C). The contracts
 * below add the `WatchRule` (mirrors the Rust struct in
 * `watch_rules/mod.rs`) + `CreateWatchRuleRequest` + a
 * `WatchExecutionHistory` row (forward-compatible type — the
 * persisted execution activity is currently derived from the
 * `lastTriggeredAt` / `lastStatus` columns on `watch_folder`; the
 * lead may add a dedicated history table later, in which case the
 * shape here is already correct).
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

/**
 * The allowlist of condition types the Rust dispatcher will accept.
 * Mirror of `watch_rules::ALLOWED_CONDITION_TYPES`.
 */
export const WATCH_CONDITION_TYPES = [
  "extension",
  "filename_contains",
  "prefix",
  "suffix",
] as const;

/** A condition type understood by the dispatcher. */
export type WatchConditionType = (typeof WATCH_CONDITION_TYPES)[number];

/**
 * The allowlist of action types. Mirror of
 * `watch_rules::ALLOWED_ACTION_TYPES`. All three are non-destructive:
 * `backup_recipe` (copy+verify), `recipe` (typed operations),
 * `organizer_rule` (move/copy via the existing organizer module).
 */
export const WATCH_ACTION_TYPES = [
  "backup_recipe",
  "recipe",
  "organizer_rule",
] as const;

/** An action type understood by the dispatcher. */
export type WatchActionType = (typeof WATCH_ACTION_TYPES)[number];

/**
 * A persisted watch rule — mirrors the Rust struct
 * `watch_rules::WatchRule` (serde `rename_all = "camelCase"`).
 *
 * `lastTriggeredAt` + `lastStatus` carry the most recent dispatch
 * result for this rule (the Rust side updates them on every match).
 * Until a dedicated execution-history table ships on the Rust side,
 * these two fields ARE the persistent activity log for a rule.
 */
export interface WatchRule {
  readonly id: string;
  /** Absolute path of the watched root. */
  readonly folderPath: string;
  /** One of WatchConditionType. */
  readonly conditionType: string;
  /** The condition value (e.g. "pdf" for extension). */
  readonly conditionValue: string;
  /** One of WatchActionType. */
  readonly actionType: string;
  /** The id of the backing backup_recipe / recipe / organizer_rule. */
  readonly actionId: string;
  /** Master switch — when false the rule never fires. */
  readonly enabled: boolean;
  /** If true, subdirectories of `folderPath` also match. */
  readonly recursive: boolean;
  /** If true, the rule is temporarily paused (still enabled). */
  readonly paused: boolean;
  /** ISO timestamp of the most recent dispatch (null if never fired). */
  readonly lastTriggeredAt: string | null;
  /** The status of the most recent dispatch: success | failure | skipped. */
  readonly lastStatus: string | null;
  /** Optional human-readable name (Rust nullable column). */
  readonly name: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/**
 * Request shape for creating a new watch rule. Mirrors the Rust
 * `CreateWatchRuleRequest` (serde `rename_all = "camelCase"`).
 *
 * `enabled` defaults to true on the Rust side when omitted.
 */
export interface CreateWatchRuleRequest {
  readonly folderPath: string;
  readonly conditionType: string;
  readonly conditionValue: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly enabled?: boolean;
  /**
   * Optional human-readable name. Forward-compat: the Rust side
   * currently ignores this field (the column exists in
   * migration 0006 but the create request doesn't bind it) —
   * the frontend still sends it so when the lead wires the
   * binding the UI is already correct.
   */
  readonly name?: string;
  /**
   * Optional recursive flag. The Rust create_rule always sets
   * recursive=1; the UI sends this so a future binding can pick
   * it up. Stored on the watch_folder row.
   */
  readonly recursive?: boolean;
}

/**
 * A row of execution activity for a watch rule.
 *
 * Forward-compatible type. The current Rust surface exposes the
 * most-recent dispatch per rule via `WatchRule.lastTriggeredAt` +
 * `WatchRule.lastStatus`; the route derives one history row per rule
 * from those two fields. When the lead adds a dedicated
 * `list_watch_rule_history` IPC, the row shape will already match
 * what the UI renders today.
 *
 * `status` follows the same vocabulary as RecipeRunStatus /
 * TimerJobHistory:
 *   - "pending"   — rule armed, no event matched yet
 *   - "running"   — dispatch in flight (UI-only intermediate state;
 *                   the Rust side doesn't currently surface this)
 *   - "success"   — last dispatch succeeded
 *   - "failure"   — last dispatch failed
 *   - "skipped"   — last dispatch was skipped (loop prevention / missing rule)
 *   - "cancelled" — UI cancelled a pending retry
 */
export interface WatchExecutionHistory {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly folderPath: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly triggeredAt: string;
  /** One of: pending | running | success | failure | skipped | cancelled. */
  readonly status: string;
  /** Optional human-readable error / message detail. */
  readonly message: string | null;
  /** The file path that triggered this execution (when known). */
  readonly triggerPath: string | null;
}

/** The Tauri command names for watch-rule CRUD. */
export const WatchRulesCommand = {
  Create: "create_watch_rule",
  List: "list_watch_rules",
  Delete: "delete_watch_rule",
  Toggle: "toggle_watch_rule",
} as const;
