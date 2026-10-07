/**
 * @paperu/contracts — errors.ts
 *
 * Paperu's unified, machine-readable error model.
 *
 * Every IPC failure is serialized as an `AppError`. The React layer
 * never receives an opaque string or a raw Rust panic. Errors carry
 * enough structure for the UI to decide whether to retry, recover,
 * or report — and enough detail for engineers to diagnose without
 * ever seeing private document contents.
 *
 * Privacy contract:
 *   - Error messages must never embed file *contents*.
 *   - Paths may be included (they are not secret metadata in the
 *     local-first threat model) but must be truncated if very long.
 *   - No secrets, licence keys, or tokens are ever placed in errors.
 */

import type { CorrelationId, TaskId } from "./common.js";

// ── Categories ────────────────────────────────────────────────────
// Stable, exhaustive categories. Adding a category is a contract
// change and must be mirrored in Rust + covered by a contract test.

export const ErrorCategory = {
  Filesystem: "filesystem",
  Validation: "validation",
  Unsupported: "unsupported",
  Permission: "permission",
  Processing: "processing",
  Database: "database",
  Cancellation: "cancellation",
  Resource: "resource",
  Licensing: "licensing",
  Internal: "internal",
} as const;

export type ErrorCategory =
  (typeof ErrorCategory)[keyof typeof ErrorCategory];

// ── Severity ──────────────────────────────────────────────────────

export const ErrorSeverity = {
  /** Recoverable, user can continue. */
  Info: "info",
  /** Something failed but the app is healthy. */
  Warning: "warning",
  /** Operation failed; user action likely required. */
  Error: "error",
  /** Application integrity at risk; surface prominently. */
  Critical: "critical",
} as const;

export type ErrorSeverity =
  (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

// ── Stable error codes ───────────────────────────────────────────
// Codes are stable identifiers the UI can switch on. They are
// intentionally namespaced by category. Never reuse a code.

export const ErrorCode = {
  // filesystem
  FileNotFound: "filesystem.file_not_found",
  PathInvalid: "filesystem.path_invalid",
  PathTooLong: "filesystem.path_too_long",
  ReservedName: "filesystem.reserved_name",
  AccessDenied: "filesystem.access_denied",
  AlreadyExists: "filesystem.already_exists",
  DiskFull: "filesystem.disk_full",
  IoFailure: "filesystem.io_failure",
  // validation
  InvalidInput: "validation.invalid_input",
  EmptyInput: "validation.empty_input",
  // unsupported
  UnsupportedFormat: "unsupported.format",
  UnsupportedOperation: "unsupported.operation",
  // permission
  PermissionDenied: "permission.denied",
  // processing
  ProcessingFailed: "processing.failed",
  OutputValidationFailed: "processing.output_validation_failed",
  // database
  DatabaseInitFailed: "database.init_failed",
  DatabaseMigrationFailed: "database.migration_failed",
  DatabaseUnavailable: "database.unavailable",
  // cancellation
  TaskCancelled: "cancellation.task_cancelled",
  // resource
  OutOfMemory: "resource.out_of_memory",
  Timeout: "resource.timeout",
  // licensing
  LicenceMissing: "licensing.missing",
  LicenceExpired: "licensing.expired",
  LicenceRevoked: "licensing.revoked",
  FeatureNotEntitled: "licensing.feature_not_entitled",
  // internal
  Unknown: "internal.unknown",
  NotImplemented: "internal.not_implemented",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Recoverability ───────────────────────────────────────────────

export const Recoverability = {
  /** User can retry the identical operation. */
  Retryable: "retryable",
  /** User must change something before retrying. */
  ActionRequired: "action_required",
  /** Cannot be recovered; inform and stop. */
  Fatal: "fatal",
} as const;

export type Recoverability =
  (typeof Recoverability)[keyof typeof Recoverability];

// ── The error envelope ───────────────────────────────────────────

/**
 * A structured application error. This exact shape is what Tauri
 * rejects with. The Rust side serializes an equivalent struct.
 */
export interface AppError {
  /** Stable machine-readable code (see ErrorCode). */
  readonly code: string;
  /** High-level category (see ErrorCategory). */
  readonly category: ErrorCategory;
  /** Severity for UX prioritisation. */
  readonly severity: ErrorSeverity;
  /** Whether and how the user can recover. */
  readonly recoverability: Recoverability;
  /** Safe, localised-ready message shown to users. No secrets. */
  readonly message: string;
  /** Optional longer explanation safe for users. */
  readonly detail?: string;
  /** Engineer-facing context. Never contains file contents. */
  readonly technical?: string;
  /** Optional cause chain (stringified, redacted). */
  readonly cause?: string;
  /** Correlation id linking logs across the operation. */
  readonly correlationId?: CorrelationId;
  /** Task id, if the error relates to a background task. */
  readonly taskId?: TaskId;
}

// ── Constructors ─────────────────────────────────────────────────
// Convenience builders so the React layer (and tests) can construct
// expected errors without repeating field defaults.

export interface AppErrorInit {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly severity?: ErrorSeverity;
  readonly recoverability?: Recoverability;
  readonly message: string;
  readonly detail?: string;
  readonly technical?: string;
  readonly cause?: string;
  readonly correlationId?: CorrelationId;
  readonly taskId?: TaskId;
}

export function appError(init: AppErrorInit): AppError {
  return {
    code: init.code,
    category: init.category,
    severity: init.severity ?? ErrorSeverity.Error,
    recoverability: init.recoverability ?? Recoverability.ActionRequired,
    message: init.message,
    ...(init.detail !== undefined ? { detail: init.detail } : {}),
    ...(init.technical !== undefined ? { technical: init.technical } : {}),
    ...(init.cause !== undefined ? { cause: init.cause } : {}),
    ...(init.correlationId !== undefined
      ? { correlationId: init.correlationId }
      : {}),
    ...(init.taskId !== undefined ? { taskId: init.taskId } : {}),
  };
}

/**
 * Guard used by the typed IPC client. Tauri rejects with an
 * arbitrary value; we narrow it to `AppError` and, if it does not
 * match the contract, wrap it as a structured `internal.unknown`.
 */
export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    typeof v.category === "string" &&
    typeof v.severity === "string" &&
    typeof v.recoverability === "string" &&
    typeof v.message === "string"
  );
}
