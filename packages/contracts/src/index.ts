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
export * from "./application_kit.js";
export * from "./notes.js";
export * from "./reading_history.js";
export * from "./recent_work.js";
export * from "./tasks.js";
export * from "./operations.js";
export * from "./progress.js";
export * from "./settings.js";
export * from "./rename.js";
export * from "./citations.js";
export * from "./duplicate_finder.js";
export * from "./downloads_cleaner.js";
export * from "./organizer.js";
export * from "./file_rescue.js";
export * from "./archive_studio.js";
export * from "./pdf_native.js";
export * from "./watch.js";
