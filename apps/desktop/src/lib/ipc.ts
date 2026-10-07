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

// ── finalize_output (Builder-added command, typed locally) ─────────
// The contracts package is Integrator-controlled. The finalize_output
// command is a Builder addition; its types live here in the desktop app
// until the Integrator promotes them to @paperu/contracts.

/** Response from the finalize_output command. */
export interface FinalizeOutputResponse {
  readonly outputPath: string;
  readonly output: InspectFileResponse;
}

/**
 * Finalize engine-produced bytes into a file on disk via the canonical
 * non-destructive atomic-finalization path. The output is written next
 * to the source file with `-{suffix}.{ext}` appended, conflict-renamed.
 * The source is never modified.
 */
export async function finalizeOutput(
  sourcePath: string,
  suffix: string,
  extension: string,
  bytes: Uint8Array,
): Promise<FinalizeOutputResponse> {
  const bytesBase64 = bytesToBase64(bytes);
  const args: Record<string, unknown> = {
    request: {
      sourcePath,
      suffix,
      extension,
      bytesBase64,
    },
  };
  return call<FinalizeOutputResponse>("finalize_output", args);
}

/** Encode a Uint8Array as a base64 string (for IPC transfer). */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    const c0 = b0 >> 2;
    const c1 = ((b0 & 0x03) << 4) | (b1 >> 4);
    const c2 = ((b1 & 0x0f) << 2) | (b2 >> 6);
    const c3 = b2 & 0x3f;
    s += B64[c0]!;
    s += B64[c1]!;
    s += i + 1 < len ? B64[c2]! : "=";
    s += i + 2 < len ? B64[c3]! : "=";
  }
  return s;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// ── read_file_bytes (Builder-added command) ───────────────────────

/** Response from the read_file_bytes command. */
export interface ReadFileBytesResponse {
  readonly bytesBase64: string;
  readonly size: number;
}

/**
 * Read a local file's bytes read-only. Used by the webview engines that
 * need the actual file content to process. The original file is never
 * modified.
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const args: Record<string, unknown> = { request: { path } };
  const res = await call<ReadFileBytesResponse>("read_file_bytes", args);
  return base64ToBytes(res.bytesBase64);
}

/** Decode a base64 string into a Uint8Array. */
function base64ToBytes(s: string): Uint8Array {
  const cleaned = s.replace(/[\s]/g, "");
  const len = cleaned.length;
  const out = new Uint8Array((len * 3) / 4);
  let outIdx = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = cleaned[i]!;
    if (c === "=") break;
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx++] = (buf >> bits) & 0xff;
    }
  }
  return out.slice(0, outIdx);
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
