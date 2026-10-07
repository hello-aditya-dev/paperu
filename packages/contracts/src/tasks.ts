/**
 * @paperu/contracts — tasks.ts
 *
 * The Paperu task engine contract.
 *
 * Long-running operations (compression, conversion, batch jobs) run
 * as tasks. A task has a unique id, a lifecycle state, progress, a
 * cancellation primitive and a structured result or error.
 *
 * Design rules:
 *   - The UI thread is never blocked by a native operation.
 *   - Cancellation is a first-class primitive, not an afterthought.
 *   - Progress is real, derived from the actual operation. Never
 *     fabricated.
 *   - A task always reaches a terminal state (completed | failed |
 *     cancelled), even after a crash recovery pass.
 */

import type { AppError } from "./errors.js";
import type {
  CorrelationId,
  FilePath,
  IsoTimestamp,
  TaskId,
} from "./common.js";
import type {
  OperationKind,
  OperationResult,
} from "./operations.js";

// ── Lifecycle ────────────────────────────────────────────────────

export const TaskStatus = {
  Queued: "queued",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** Terminal states a task can settle in. */
export const TerminalTaskStatus = [
  TaskStatus.Completed,
  TaskStatus.Failed,
  TaskStatus.Cancelled,
] as const;
export type TerminalTaskStatus = (typeof TerminalTaskStatus)[number];

// ── Progress ──────────────────────────────────────────────────────

/**
 * Real progress for a running task. `percent` is derived from
 * `completedUnits / totalUnits` and is `null` when the total is
 * unknown (indeterminate). It is never faked.
 */
export interface TaskProgress {
  readonly taskId: TaskId;
  /** 0..1 fractional progress, or null when indeterminate. */
  readonly fraction: number | null;
  /** Optional status message, safe for users. */
  readonly message?: string;
  /** Optional processed bytes, when meaningful. */
  readonly processedBytes?: number;
  /** Optional total bytes, when known. */
  readonly totalBytes?: number;
  /** ISO-8601 UTC timestamp of the update. */
  readonly updatedAt: IsoTimestamp;
}

// ── Task definition ───────────────────────────────────────────────

/** A snapshot of a task at a point in time. */
export interface TaskInfo {
  readonly id: TaskId;
  readonly kind: OperationKind;
  readonly status: TaskStatus;
  /** Human-readable label, safe for users. */
  readonly label: string;
  /** When the task was created (ISO-8601 UTC). */
  readonly createdAt: IsoTimestamp;
  /** When the task started running, if it has. */
  readonly startedAt?: IsoTimestamp;
  /** When the task reached a terminal state. */
  readonly completedAt?: IsoTimestamp;
  /** Source files the task operates on. */
  readonly sourceFiles: readonly FilePath[];
  /** Output files produced by the task, once available. */
  readonly outputFiles?: readonly FilePath[];
  /** Latest known progress, while running. */
  readonly progress?: TaskProgress;
  /** Structured error, when the task failed. */
  readonly error?: AppError;
  /** Correlation id for log tracing. */
  readonly correlationId: CorrelationId;
}

// ── Result ────────────────────────────────────────────────────────

/** Terminal outcome of a task. */
export type TaskOutcome =
  | { readonly status: "completed"; readonly result: OperationResult }
  | { readonly status: "failed"; readonly error: AppError }
  | { readonly status: "cancelled" };

// ── Commands & events ────────────────────────────────────────────

export const TaskCommand = {
  /** Request cancellation of a running task. Best-effort. */
  CancelTask: "cancel_task",
  /** Fetch the current snapshot of a task. */
  GetTask: "get_task",
  /** List recent tasks (history). */
  ListTasks: "list_tasks",
} as const;

export interface CancelTaskArgs {
  readonly taskId: TaskId;
}
