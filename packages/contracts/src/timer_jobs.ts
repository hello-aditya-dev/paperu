/**
 * A persisted scheduled job — mirrors the Rust struct
 * `timer_jobs::TimerJob` (serde `rename_all = "camelCase"`).
 *
 * The Rust scheduler thread (src-tauri/src/timer_jobs/scheduler.rs)
 * ticks every 30s, finds enabled jobs whose `nextRun` is due, claims
 * the occurrence atomically (exactly-once via `timer_job_occurrence`),
 * dispatches the allowlisted action, and writes a `timer_job_history`
 * row. The frontend never schedules anything itself — it only writes
 * the job definition + reads back the runtime state.
 *
 * `inputPaths` (Prompt 02 §10.2) is the explicit list of absolute
 * file paths the dispatcher passes to a `recipe` action. Null for
 * non-recipe actions (backup_recipe carries its own sources in the
 * BackupRecipe row; organizer_rule carries its own source folder).
 */
export interface TimerJob {
  readonly id: string;
  readonly name: string;
  /** One of "one_time" | "daily" | "weekly". */
  readonly scheduleKind: string;
  /**
   * Schedule expression. Format depends on `scheduleKind`:
   *   - one_time: ISO 8601 datetime (e.g. "2026-12-25T10:00:00Z")
   *   - daily: "HH:MM" (24-hour, e.g. "09:30")
   *   - weekly: "Weekday HH:MM" (e.g. "Mon 09:30")
   */
  readonly scheduleExpr: string;
  /** One of "backup_recipe" | "recipe" | "organizer_rule". */
  readonly actionType: string;
  /** The id of the referenced backup_recipe / recipe / organizer_rule. */
  readonly actionId: string;
  readonly enabled: boolean;
  /** IANA zone name (e.g. "UTC", "Asia/Kolkata"). */
  readonly timezone: string;
  /** ISO 8601 of the last claimed occurrence's `finished_at`. */
  readonly lastRun: string | null;
  /** Last failure message. Cleared on the next successful dispatch. */
  readonly lastError: string | null;
  /** ISO 8601 of the next scheduled occurrence (UTC). */
  readonly nextRun: string | null;
  /**
   * Explicit input paths used when `actionType === "recipe"`. Null
   * otherwise. The Rust dispatcher passes these to `execute_recipe`
   * verbatim. The frontend renders these read-only on existing jobs
   * (Rust `UpdateTimerRequest` does not have an `input_paths` field,
   * so editing them requires delete + recreate).
   */
  readonly inputPaths: readonly string[] | null;
  readonly createdAt: string;
}

/**
 * Request shape for creating a new timer job. Mirrors Rust
 * `CreateTimerRequest` (serde `rename_all = "camelCase"`).
 *
 * `inputPaths` is optional: present only when `actionType === "recipe"`
 * (the user picked files to feed the recipe on every scheduled run).
 */
export interface CreateTimerRequest {
  readonly name: string;
  readonly scheduleKind: string;
  readonly scheduleExpr: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
  readonly inputPaths?: readonly string[] | null;
}

/**
 * Request shape for updating an existing timer job. Mirrors Rust
 * `UpdateTimerRequest`. Every field is optional; the Rust side
 * `unwrap_or`s each one against the existing row.
 *
 * NOTE: `inputPaths` is intentionally ABSENT here — the Rust
 * `update_timer` SQL statement does not touch the `input_paths`
 * column, so passing it would be silently dropped. The frontend
 * exposes input-paths editing via the create flow only; editing
 * input paths on an existing job requires delete + recreate (the
 * UI surfaces a hint to that effect).
 */
export interface UpdateTimerRequest {
  readonly id: string;
  readonly name?: string;
  readonly scheduleKind?: string;
  readonly scheduleExpr?: string;
  readonly actionType?: string;
  readonly actionId?: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
}
export interface TimerJobHistory {
  readonly id: string;
  readonly jobId: string;
  readonly occurrenceKey: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: string;
  readonly message?: string | null;
}
export const TimerJobsCommand = {
  Create: "create_timer_job",
  List: "list_timer_jobs",
  Delete: "delete_timer_job",
  Toggle: "toggle_timer_job",
  Update: "update_timer_job",
  GetHistory: "get_timer_job_history",
  TriggerNow: "trigger_timer_job_now",
} as const;
