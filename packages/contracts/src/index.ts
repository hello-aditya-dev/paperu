/**
 * @paperu/contracts — the formal agreement between the Paperu
 * React/TypeScript layer and the Tauri/Rust layer.
 *
 * Importing from this package is the only sanctioned way for the
 * frontend to speak to native code. Both sides are expected to keep
 * these types in sync; contract tests assert the JSON shapes match.
 *
 * See `docs/architecture/contracts.md` for the full rationale.
 */

export * from "./common.js";
export * from "./errors.js";
export * from "./inspect.js";
export * from "./recent_work.js";
export * from "./tasks.js";
export * from "./operations.js";
export * from "./progress.js";
export * from "./settings.js";
