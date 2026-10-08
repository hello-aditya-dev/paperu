/**
 * Open With listener — handles file paths passed to Paperu via Windows
 * "Open With" or any platform's "open file with application" gesture
 * (P0-E).
 *
 * Two paths exist:
 *  1. Initial launch (no Paperu running): the OS hands Paperu the
 *     file path as a CLI argument. Rust queues it on
 *     `AppState::open_with_queue`. The frontend pops the queue via
 *     `consume_open_with_event` on its first ready tick — this both
 *     signals "frontend ready" and retrieves the path.
 *  2. Subsequent launch (Paperu already running): the
 *     `tauri-plugin-single-instance` callback focuses the existing
 *     window + emits the `paperu://open-file` Tauri event. The
 *     frontend listener (registered on mount) handles it live.
 *
 * The Rust side validates paths; the frontend re-validates
 * defensively (absolute + known extension) before staging — never
 * trust an IPC payload with a file path even though our own Rust
 * produced it.
 *
 * Routing:
 *   - PDF  → /reader   (Study Reader)
 *   - image → /image/fit (Image Fit)
 *   - other → /inspect (universal "tell me about this file" surface)
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile } from "@/lib/ipc";
import { basename } from "@/lib/platform";
import { useWorkingFile } from "@/lib/working-file";

const OPEN_FILE_EVENT = "paperu://open-file";

const PDF_EXTENSIONS: ReadonlySet<string> = new Set(["pdf"]);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "heic",
  "heif",
  "avif",
  "svg",
]);

/**
 * Cross-platform check: is `p` absolute on any supported OS?
 *
 * Unix `/…`, Windows drive `C:\…` / `c:/…`, and UNC `\\…` / `//…`
 * all count. A drive-relative path like `C:foo` (no separator after
 * the colon) is NOT absolute and is rejected.
 */
export function isAbsoluteNativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  // Unix absolute.
  if (p.startsWith("/")) return true;
  // Windows UNC (forward or back slashes).
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  // Windows drive-absolute: <letter>:<slash-or-backslash>…
  return /^[A-Za-z]:[\\/]/.test(p);
}

/** Lowercased extension without the leading dot, or null if none. */
function getExtension(p: string): string | null {
  const i = p.lastIndexOf(".");
  if (i < 0) return null;
  const ext = p.slice(i + 1).toLowerCase();
  return ext.length === 0 ? null : ext;
}

/**
 * Pick the route for a file based on its extension.
 *
 * PDFs go to the Study Reader, images to Image Fit, anything else
 * to the Inspect view (the universal "tell me about this file"
 * surface — Inspect handles unknown formats gracefully).
 */
export function routeForExtension(ext: string | null): string {
  if (ext && PDF_EXTENSIONS.has(ext)) return "/reader";
  if (ext && IMAGE_EXTENSIONS.has(ext)) return "/image/fit";
  return "/inspect";
}

/**
 * Stage the file as a WorkingFile + navigate to the right route.
 *
 * Defensive: re-validates that the path is absolute before staging.
 * The Rust layer already validated, but the frontend never trusts
 * IPC payloads with file paths. If the inspect call fails, we still
 * navigate so the user sees the route's empty state rather than a
 * silent no-op.
 */
async function stageAndNavigate(
  navigate: (path: string) => void,
  rawPath: string,
): Promise<void> {
  if (!isAbsoluteNativePath(rawPath)) {
    // Don't navigate — the path is malformed and the target route
    // has no file to act on. Log it so a developer can spot the
    // regression.
    console.warn("[open-with] rejected non-absolute path", rawPath);
    return;
  }
  const ext = getExtension(rawPath);
  const route = routeForExtension(ext);
  const fileName = basename(rawPath);

  // Inspect the file to get real metadata, then stage it as a
  // WorkingFile so the target route auto-loads it on mount.
  try {
    const inspected = await inspectFile(rawPath);
    useWorkingFile.getState().stageRaw({
      path: inspected.path,
      fileName: inspected.fileName || fileName,
      kind: inspected.kind,
      mimeType: inspected.mimeType,
      size: inspected.size.bytes,
      humanReadableSize: inspected.size.humanReadable,
      sourceOperation: "inspect",
    });
  } catch (err) {
    // Inspect can fail if the file doesn't exist or the path is
    // unreadable. We still navigate to the target route — the route
    // will surface a clear "file not found" state rather than a
    // silent no-op.
    console.warn("[open-with] inspect failed; navigating anyway", err);
  }
  navigate(route);
}

/**
 * Initialise the Open With listener. Call once on app mount.
 *
 * - Pops any queued path from the Rust side (initial-launch CLI arg).
 * - Registers a listener for live `paperu://open-file` events
 *   (subsequent launches).
 *
 * Outside Tauri (tests, plain browser), both calls fail silently —
 * the function is a safe no-op.
 *
 * Returns a cleanup function that unregisters the listener + aborts
 * any in-flight stage-and-navigate.
 */
export function initOpenWithListener(
  navigate: (path: string) => void,
): () => void {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;

  // Register the live listener. The Rust setup hook emits the
  // initial-launch file path via a delayed async task (500ms) so the
  // frontend has time to register this listener. Subsequent launches
  // (second instance) emit immediately via the single-instance
  // callback — the same listener catches those.
  listen<string>(OPEN_FILE_EVENT, (event) => {
    if (cancelled) return;
    const payload = event.payload;
    const path = typeof payload === "string" ? payload : "";
    if (!path) {
      console.warn("[open-with] received empty payload", payload);
      return;
    }
    void stageAndNavigate(navigate, path);
  })
    .then((un) => {
      if (cancelled) un();
      else unlisten = un;
    })
    .catch(() => {
      // Outside Tauri or listener setup failed — no-op.
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
