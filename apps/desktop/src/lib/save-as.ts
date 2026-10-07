/**
 * Save As — native Tauri save dialog + canonical Rust write
 * (Master Prompt repair §32).
 *
 * Flow:
 *   1. save() from @tauri-apps/plugin-dialog → user picks destination
 *      (absolute path, correct extension, cancellation respected).
 *   2. invoke("save_file_as", { destPath, bytesBase64, overwrite })
 *      → Rust validates the path, writes to temp, atomic-finalizes.
 *   3. Returns the saved path + real metadata.
 *
 * Source safety (§62): the bytes come from the engine, never from the
 * user's original file. The destination is written atomically — a crash
 * mid-write never produces a partial file.
 *
 * Cancellation (§26): if the user cancels the save dialog, save()
 * returns null and we return null — no error, no fake success.
 */

import { invoke } from "@tauri-apps/api/core";
import type { InspectFileResponse } from "@paperu/contracts";

/** The result of a successful save-as. */
export interface SaveFileAsResult {
  /** The canonical absolute path of the saved file. */
  readonly outputPath: string;
  /** Real metadata about the saved file (size, kind, etc.). */
  readonly output: InspectFileResponse;
}

/**
 * Open the native save dialog + write bytes to the chosen path.
 *
 * @param bytes The bytes to save.
 * @param suggestedName Default filename shown in the dialog (no path).
 * @param extensionFilter Optional Tauri filter, e.g.
 *   [{ name: "PDF", extensions: ["pdf"] }]
 * @returns The saved path + metadata, or null if the user cancelled.
 */
export async function saveFileAs(
  bytes: Uint8Array,
  suggestedName: string,
  extensionFilter?: ReadonlyArray<{ name: string; extensions: readonly string[] }>,
): Promise<SaveFileAsResult | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "Save As needs the Paperu desktop shell. This build is running outside Tauri.",
    );
  }
  const dialog = await import("@tauri-apps/plugin-dialog");
  const destPath = await dialog.save({
    defaultPath: suggestedName,
    filters: extensionFilter
      ? extensionFilter.map((f) => ({
          name: f.name,
          extensions: [...f.extensions],
        }))
      : undefined,
  });
  // dialog.save returns string | null (null = user cancelled).
  if (destPath === null || destPath === undefined) return null;

  const bytesBase64 = bytesToBase64(bytes);
  // First attempt: overwrite=false (safe default). If the destination
  // already exists, the Rust command returns ALREADY_EXISTS — we then
  // re-prompt the user via a confirm() (Tauri's message dialog would be
  // cleaner, but confirm() works in the webview).
  try {
    return await invoke<SaveFileAsResult>("save_file_as", {
      request: {
        destPath,
        bytesBase64,
        overwrite: false,
      },
    });
  } catch (err) {
    // Check if it's the ALREADY_EXISTS error. We can't easily inspect
    // the AppError shape here without the contracts; for now, if the
    // destination exists, ask the user to confirm overwrite.
    if (await pathExists(destPath)) {
      const ok = confirm(
        `"${destPath.split(/[\\/]/).pop()}" already exists. Replace it?`,
      );
      if (!ok) return null;
      return await invoke<SaveFileAsResult>("save_file_as", {
        request: {
          destPath,
          bytesBase64,
          overwrite: true,
        },
      });
    }
    throw err;
  }
}

/** Check if a path exists (via the canonical inspect_file command). */
async function pathExists(path: string): Promise<boolean> {
  try {
    const { inspectFile } = await import("./ipc");
    await inspectFile(path);
    return true;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(bin);
}
