/**
 * @paperu/contracts — settings.ts
 *
 * Typed, versioned application settings. Settings are persisted by
 * the Rust layer (SQLite) and exposed over IPC. The React layer
 * never scatters `localStorage` calls; it always goes through the
 * typed settings abstraction.
 *
 * Defaults are explicit and versioned (see `DEFAULT_SETTINGS` and
 * `SETTINGS_VERSION`). Adding a setting is a contract change.
 */

import type { ConflictStrategy } from "./operations.js";

// ── Versioning ────────────────────────────────────────────────────

/** Settings schema version. Bump on any breaking shape change. */
export const SETTINGS_VERSION = 1 as const;

// ── Enumerations ───────────────────────────────────────────────────

export const ThemePreference = {
  Light: "light",
  Dark: "dark",
  System: "system",
} as const;
export type ThemePreference =
  (typeof ThemePreference)[keyof typeof ThemePreference];

// ConflictStrategy is defined in operations.ts and re-exported via
// the package barrel (index.ts). Imported here as a type only.

export const UpdatePreference = {
  /** Do not check for updates automatically. */
  Off: "off",
  /** Check and notify, never auto-install. */
  Notify: "notify",
} as const;
export type UpdatePreference =
  (typeof UpdatePreference)[keyof typeof UpdatePreference];

export interface Settings {
  /** Schema version of this settings object. */
  readonly version: number;
  readonly theme: ThemePreference;
  /** Default behaviour when an output name collides. */
  readonly defaultConflictStrategy: ConflictStrategy;
  /** Default output directory, or null for "next to source". */
  readonly defaultOutputDir: string | null;
  /** Maximum number of recent files to remember. */
  readonly recentFilesLimit: number;
  /** Whether to check for updates on launch. */
  readonly updatePreference: UpdatePreference;
  /** Reduced-motion preference for accessibility. */
  readonly reducedMotion: boolean;
  /**
   * Whether Paperu may (in future) send opt-in diagnostics.
   * Defaults to false. Local-first: never on by default.
   *
   * P4: Diagnostics covers crash reports + stack traces (future). It
   * does NOT authorise product analytics. Both must be off by default.
   */
  readonly allowDiagnostics: boolean;
  /**
   * Whether Paperu may collect opt-in product analytics (coarse event
   * types only — never paths, filenames, or document contents).
   * Defaults to false. Distinct from diagnostics so a user can opt
   * into crash reporting without opting into usage analytics.
   */
  readonly allowProductAnalytics: boolean;
}

/** The explicit, versioned defaults. Source of truth for first launch. */
export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  theme: ThemePreference.System,
  defaultConflictStrategy: "rename",
  defaultOutputDir: null,
  recentFilesLimit: 25,
  updatePreference: UpdatePreference.Notify,
  reducedMotion: false,
  allowDiagnostics: false,
  allowProductAnalytics: false,
};

/**
 * A partial settings patch. Unknown keys are rejected. Only the
 * Rust side applies patches; the type is shared for validation.
 */
export type SettingsPatch = Partial<Omit<Settings, "version">>;

// ── App info ───────────────────────────────────────────────────────

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly edition: string;
  readonly settingsVersion: number;
}
