/**
 * Typed Tauri IPC client.
 *
 * The only sanctioned way for the React layer to call native code.
 * Wraps Tauri's `invoke` with the contracts from `@paperu/contracts`
 * and converts rejections into structured `AppError` values. The UI
 * never receives raw strings.
 *
 * When running outside Tauri (unit tests, plain browser), calls fall
 * back to a registered mock so components can be tested without a
 * native backend. Production never mocks.
 */

import type {
  AppError,
  AppInfo,
  InspectFileResponse,
  Settings,
  SettingsPatch,
} from "@paperu/contracts";
import {
  CommandName,
  isAppError,
  appError as buildAppError,
  ErrorCategory,
  ErrorCode,
  ErrorSeverity,
  Recoverability,
} from "@paperu/contracts";

// ── Tauri invoke shim ────────────────────────────────────────────
// We import `invoke` lazily so that this module loads in a plain
// browser/jsdom environment (tests) without Tauri's runtime present.

type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

async function getInvoke(): Promise<InvokeFn | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const api = await import("@tauri-apps/api/core");
    return api.invoke as InvokeFn;
  }
  return null;
}

// ── Mock registry (tests/dev only) ────────────────────────────────

type MockHandler = (args: Record<string, unknown> | undefined) => unknown;

const mocks = new Map<string, MockHandler>();

/** Register a mock handler for a command. Test-only. */
export function __mockCommand(cmd: string, fn: MockHandler): void {
  mocks.set(cmd, fn);
}

/** Clear all mocks. Test-only. */
export function __clearMocks(): void {
  mocks.clear();
}

function isMocked(cmd: string): boolean {
  return mocks.has(cmd);
}

// ── Error normalisation ───────────────────────────────────────────

const unknownError: AppError = buildAppError({
  code: ErrorCode.Unknown,
  category: ErrorCategory.Internal,
  severity: ErrorSeverity.Error,
  recoverability: Recoverability.Fatal,
  message: "Something went wrong on this PC.",
});

function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) {
    return buildAppError({
      code: ErrorCode.Unknown,
      category: ErrorCategory.Internal,
      message: "Something went wrong on this PC.",
      technical: err.message,
    });
  }
  return unknownError;
}

// ── Typed commands ────────────────────────────────────────────────

/** Inspect a local file and return real metadata. */
export async function inspectFile(
  path: string,
): Promise<InspectFileResponse> {
  const args: Record<string, unknown> = {
    request: { path },
  };
  return call<InspectFileResponse>(CommandName.InspectFile, args);
}

/**
 * Inspect multiple local files. Returns one result per path, preserving
 * order. Each file is inspected independently; a failure on one file does
 * not prevent the others from being inspected. The `onResult` callback is
 * invoked as each inspection completes so the UI can stream updates.
 *
 * No file content is read; only metadata. The original files are never
 * modified.
 */
export async function inspectFiles(
  paths: readonly string[],
  onResult?: (path: string, result: InspectFileResponse | AppError) => void,
): Promise<InspectFileResponse[]> {
  const results: InspectFileResponse[] = [];
  // Inspect sequentially to avoid flooding the IPC channel and to give
  // the UI a steady stream of real progress. Bounded parallelism could be
  // added later if batch performance demands it.
  for (const path of paths) {
    try {
      const r = await inspectFile(path);
      results.push(r);
      onResult?.(path, r);
    } catch (err) {
      onResult?.(path, err as AppError);
    }
  }
  return results;
}

/** Read the current settings. */
export async function readSettings(): Promise<Settings> {
  return call<Settings>(CommandName.ReadSettings);
}

/** Apply a settings patch. */
export async function writeSettings(patch: SettingsPatch): Promise<Settings> {
  return call<Settings>(CommandName.WriteSettings, { patch });
}

/** Read app identity/version. */
export async function readAppInfo(): Promise<AppInfo> {
  return call<AppInfo>(CommandName.ReadAppInfo);
}

// ── Core call ────────────────────────────────────────────────────

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isMocked(cmd)) {
    // Mocks are synchronous-ish; preserve async semantics.
    const handler = mocks.get(cmd)!;
    return Promise.resolve(handler(args) as T);
  }
  const invoke = await getInvoke();
  if (!invoke) {
    throw buildAppError({
      code: ErrorCode.NotImplemented,
      category: ErrorCategory.Unsupported,
      severity: ErrorSeverity.Warning,
      recoverability: Recoverability.ActionRequired,
      message: "Paperu is running outside its desktop shell.",
      detail: "This build needs the Paperu desktop app to access your files.",
      technical: "no __TAURI_INTERNALS__ on window; invoke unavailable",
    });
  }
  try {
    return (await invoke(cmd, args)) as T;
  } catch (err) {
    throw toAppError(err);
  }
}
