/**
 * @paperu/contracts — common.ts
 *
 * Shared primitive types used across the Paperu IPC boundary.
 * These exist so that the React layer and the Rust layer never
 * disagree about what a "path", "byte size" or "timestamp" is.
 *
 * Every type here MUST have a mirroring Rust type in
 * `apps/desktop/src-tauri/src/contracts/`. Contract tests assert
 * the JSON shape stays identical on both sides.
 *
 * Rules:
 *  - No `any`. No `unknown` unless explicitly bounded.
 *  - No loosely typed blobs. Strings are branded where they carry
 *    domain meaning.
 *  - Timestamps are always ISO-8601 UTC strings (RFC 3339).
 */

// ── Branded primitives ──────────────────────────────────────────
// Branding prevents accidentally mixing a raw string with a path,
// a task id, etc. At runtime these are plain strings; the brand is
// compile-time only.

/** A filesystem path as observed on the host OS. Always absolute. */
export type FilePath = string & { readonly __brand: "FilePath" };

/** A unique task identifier (UUID v4 string). */
export type TaskId = string & { readonly __brand: "TaskId" };

/** A correlation id for tracing a single user-initiated operation. */
export type CorrelationId = string & { readonly __brand: "CorrelationId" };

/** An edition identifier (free / personal / business). */
export type EditionId = string & { readonly __brand: "EditionId" };

// ── Helper factories ─────────────────────────────────────────────
// Branded types can only be constructed through these factories so
// we never accidentally treat untrusted input as a path.

export const filePath = (value: string): FilePath => value as FilePath;
export const taskId = (value: string): TaskId => value as TaskId;
export const correlationId = (value: string): CorrelationId =>
  value as CorrelationId;
export const editionId = (value: string): EditionId => value as EditionId;

// ── Size & time ──────────────────────────────────────────────────

/** An exact file/content size in bytes. Always non-negative. */
export interface ByteSize {
  /** Exact number of bytes. */
  readonly bytes: number;
  /** Human-readable rounded representation, e.g. "1.4 MB". */
  readonly humanReadable: string;
}

/** An instant, encoded as an ISO-8601 UTC string (RFC 3339). */
export type IsoTimestamp = string;

// ── Result envelope ──────────────────────────────────────────────
// Tauri IPC rejects with a serialized `AppError` (see errors.ts).
// Successful commands return the payload directly. The `Result`
// helper below is used by the typed client wrapper, not by the
// Tauri transport itself.

import type { AppError } from "./errors.js";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AppError };

// ── File kind detection ──────────────────────────────────────────

/** Coarse classification of a file's detected kind. */
export type FileKind =
  | "pdf"
  | "image"
  | "archive"
  | "text"
  | "spreadsheet"
  | "document"
  | "audio"
  | "video"
  | "executable"
  | "signature"
  | "other";

// ── Command names ────────────────────────────────────────────────
// A single source of truth for the string command names invoked
// through Tauri's `invoke`. Centralising them prevents typos on
// either side of the boundary.

export const CommandName = {
  /** Inspect a local file and return real metadata. */
  InspectFile: "inspect_file",
  /** Read the current settings object. */
  ReadSettings: "read_settings",
  /** Write a partial settings update. */
  WriteSettings: "write_settings",
  /** Read the resolved app version & edition info. */
  ReadAppInfo: "read_app_info",
} as const;

export type CommandName = (typeof CommandName)[keyof typeof CommandName];

// ── Tauri event channel names ────────────────────────────────────

export const EventName = {
  /** Progress update for a running task. */
  TaskProgress: "paperu://task/progress",
  /** Final outcome of a task. */
  TaskFinished: "paperu://task/finished",
} as const;

export type EventName = (typeof EventName)[keyof typeof EventName];
