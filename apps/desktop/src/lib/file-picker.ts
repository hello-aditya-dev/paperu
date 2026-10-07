/**
 * Canonical file picker — uses the Tauri dialog plugin to get absolute
 * paths (Master Prompt repair §6-8).
 *
 * The browser's <input type="file"> returns File objects whose `.name`
 * is just a basename — passing that to finalize_output as `sourcePath`
 * was the broken architecture. The Rust finalize_output validates paths
 * and uses the source path to compute the output directory + basename;
 * a basename like "photo.jpg" fails validation or produces wrong output.
 *
 * The canonical flow (§7):
 *   pickFiles() → absolute validated paths
 *   → inspectFile(path) → real metadata (kind, size, mime)
 *   → WorkingFile (path + metadata)
 *   → read_file_bytes (when bytes are needed)
 *   → engine processing
 *   → finalize_output with REAL absolute source path
 *
 * Outside Tauri (tests, plain browser): returns [] — the caller shows
 * a clear "needs desktop shell" message rather than faking a browser
 * fallback (per §0).
 */

import type { InspectFileResponse } from "@paperu/contracts";

/** A picked file with its absolute path + inspected metadata. */
export interface PickedFile {
  /** Canonical absolute path (Paperu FilePath). */
  readonly path: string;
  /** Display name (basename). */
  readonly fileName: string;
  /** Coarse kind from inspect_file: "pdf" | "image" | "other". */
  readonly kind: "pdf" | "image" | "other";
  /** MIME type if known. */
  readonly mimeType?: string;
  /** Size in bytes. */
  readonly size: number;
}

/**
 * Open the native Tauri file picker. Returns absolute paths.
 * Returns [] if the user cancels OR if running outside Tauri.
 *
 * @param opts.multiple If true, allow multiple selection. Default false.
 * @param opts.accept   Filter hint, e.g. "application/pdf" or "image/*".
 *                      (Tauri maps this to OS file-type filters.)
 */
export async function pickFiles(opts?: {
  multiple?: boolean;
  accept?: string;
}): Promise<readonly string[]> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return [];
  }
  const dialog = await import("@tauri-apps/plugin-dialog");
  // Build Tauri file-filter from the accept hint.
  const filters: { name: string; extensions: string[] }[] = [];
  if (opts?.accept) {
    if (opts.accept === "application/pdf") {
      filters.push({ name: "PDF", extensions: ["pdf"] });
    } else if (opts.accept.startsWith("image/")) {
      filters.push({
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"],
      });
    } else if (opts.accept.includes(",")) {
      // Multiple accept types — split + build one filter per group.
      for (const part of opts.accept.split(",")) {
        const trimmed = part.trim();
        if (trimmed === "application/pdf") {
          filters.push({ name: "PDF", extensions: ["pdf"] });
        } else if (trimmed.startsWith("image/")) {
          filters.push({
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "webp"],
          });
        }
      }
    }
  }
  const selected = await dialog.open({
    multiple: opts?.multiple ?? false,
    directory: false,
    filters: filters.length > 0 ? filters : undefined,
  });
  // dialog.open returns string | string[] | null (single) or string[] | null (multiple).
  if (selected === null || selected === undefined) return [];
  if (Array.isArray(selected)) return selected;
  return [selected];
}

/**
 * Pick files + inspect each one via the canonical inspect_file command.
 * Returns PickedFile objects with real metadata. Files that fail
 * inspection (corrupt, unreadable) are silently skipped — the caller
 * should show the count returned vs requested if it matters.
 *
 * Per §30: do NOT trust the file extension — inspect_file uses real
 * magic-byte detection.
 */
export async function pickAndInspectFiles(opts?: {
  multiple?: boolean;
  accept?: string;
}): Promise<readonly PickedFile[]> {
  const paths = await pickFiles(opts);
  if (paths.length === 0) return [];
  // Lazy-load inspectFile to avoid a static import cycle in tests.
  const { inspectFile } = await import("./ipc");
  const results: PickedFile[] = [];
  for (const path of paths) {
    try {
      const meta: InspectFileResponse = await inspectFile(path);
      const kind: "pdf" | "image" | "other" =
        meta.kind === "pdf" || meta.kind === "image" ? meta.kind : "other";
      results.push({
        path,
        fileName: meta.fileName,
        kind,
        mimeType: meta.mimeType,
        size: meta.size.bytes,
      });
    } catch {
      // Skip files that fail inspection — the caller's count check
      // surfaces the discrepancy.
    }
  }
  return results;
}

/**
 * Read file bytes via the canonical read_file_bytes Tauri command.
 * Returns a Uint8Array. This is the ONLY sanctioned way to read file
 * contents in the frontend — direct fetch() of file:// URLs is
 * blocked by the Tauri CSP and the OS file-access boundary.
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "Paperu needs its desktop shell to read file contents. " +
        "This build is running outside Tauri.",
    );
  }
  // Lazy-load to keep the ipc module out of the static graph for tests.
  const { readFileBytes } = await import("./ipc");
  return readFileBytes(path);
}
