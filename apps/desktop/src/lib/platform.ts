/**
 * Platform detection and platform-aware UX utilities.
 *
 * Paperu is cross-platform (Windows, macOS, Linux). The UI must respect
 * each OS's conventions for:
 *   - keyboard shortcuts (Ctrl vs Cmd)
 *   - modifier key labels
 *   - path separators in display
 *   - default file dialog titles
 *
 * Detection is based on `navigator.platform` / `navigator.userAgent`
 * in the webview. This is UX-only — the Rust layer is the source of
 * truth for all filesystem operations and re-validates everything.
 */

export type Platform = "macos" | "windows" | "linux" | "unknown";

/** Detect the current platform from the browser environment. */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  if (ua.includes("mac") || platform.includes("mac")) return "macos";
  if (ua.includes("win") || platform.includes("win")) return "windows";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  return "unknown";
}

let cachedPlatform: Platform | null = null;

/** Get the platform (cached after first call). */
export function getPlatform(): Platform {
  if (cachedPlatform === null) cachedPlatform = detectPlatform();
  return cachedPlatform;
}

/** True if running on macOS. */
export function isMac(): boolean {
  return getPlatform() === "macos";
}

/** True if running on Windows. */
export function isWindows(): boolean {
  return getPlatform() === "windows";
}

/** The modifier key used for shortcuts on this platform. */
export function modKey(): "⌘" | "Ctrl" {
  return isMac() ? "⌘" : "Ctrl";
}

/** The alt/option key label for this platform. */
export function altKey(): "⌥" | "Alt" {
  return isMac() ? "⌥" : "Alt";
}

/** The shift key label for this platform. */
export function shiftKey(): "⇧" | "Shift" {
  return isMac() ? "⇧" : "Shift";
}

/**
 * Format a keyboard shortcut for display on the current platform.
 * E.g. formatShortcut("1") → "⌘1" on macOS, "Ctrl+1" on Windows/Linux.
 */
export function formatShortcut(key: string): string {
  return isMac() ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Format a full shortcut spec with optional modifiers.
 * E.g. formatShortcutSpec(["mod", "shift"], "S") → "⌘⇧S" on macOS.
 */
export function formatShortcutSpec(
  modifiers: ("mod" | "shift" | "alt")[],
  key: string,
): string {
  const parts: string[] = [];
  for (const m of modifiers) {
    if (m === "mod") parts.push(isMac() ? "⌘" : "Ctrl");
    else if (m === "shift") parts.push(shiftKey());
    else if (m === "alt") parts.push(altKey());
  }
  parts.push(key);
  return isMac() ? parts.join("") : parts.join("+");
}

/**
 * Check if a keyboard event matches a mod+key shortcut.
 * "mod" maps to metaKey on macOS, ctrlKey elsewhere.
 */
export function matchesShortcut(
  e: KeyboardEvent,
  key: string,
  modifiers: ("mod" | "shift" | "alt")[] = ["mod"],
): boolean {
  const wantMod = modifiers.includes("mod");
  const wantShift = modifiers.includes("shift");
  const wantAlt = modifiers.includes("alt");
  const modPressed = isMac() ? e.metaKey : e.ctrlKey;
  return (
    modPressed === wantMod &&
    e.shiftKey === wantShift &&
    e.altKey === wantAlt &&
    e.key.toLowerCase() === key.toLowerCase()
  );
}

/** The path separator for display on this platform. */
export function pathSeparator(): string {
  return isWindows() ? "\\" : "/";
}

/** Get the basename of a path, handling both / and \ separators. */
export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Get the directory of a path, handling both separators. */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}
