//! Tauri command handlers — the IPC boundary.
//!
//! Every command here is the thin, typed entry point that the
//! React layer invokes through `@paperu/contracts`. Commands must:
//!   - validate all input server-side (never trust the frontend),
//!   - return `Result<T>` (structured errors, never panics),
//!   - perform no business logic themselves — they delegate to the
//!     filesystem / settings / task layers.
//!
//! The `#[tauri::command]` macros are only active with the
//! `tauri-runtime` feature. Without it, the functions are plain
//! Rust functions testable on any platform.

#[cfg(feature = "tauri-runtime")]
pub mod analytics;
#[cfg(feature = "tauri-runtime")]
pub mod application_kit;
#[cfg(feature = "tauri-runtime")]
pub mod archive_studio;
#[cfg(feature = "tauri-runtime")]
pub mod backup_recipes;
#[cfg(feature = "tauri-runtime")]
pub mod citations;
#[cfg(feature = "tauri-runtime")]
pub mod downloads_cleaner;
#[cfg(feature = "tauri-runtime")]
pub mod duplicate_finder;
#[cfg(feature = "tauri-runtime")]
pub mod file_rescue;
pub mod finalize;
#[cfg(feature = "tauri-runtime")]
pub mod forms_vault;
pub mod inspect;
#[cfg(feature = "tauri-runtime")]
pub mod notes;
#[cfg(feature = "tauri-runtime")]
pub mod organizer;
pub mod pdf_info;
#[cfg(feature = "tauri-runtime")]
pub mod pdf_native;
pub mod read_file;
#[cfg(feature = "tauri-runtime")]
pub mod reading_history;
#[cfg(feature = "tauri-runtime")]
pub mod recent_work;
#[cfg(feature = "tauri-runtime")]
pub mod rename;
pub mod save_as;
#[cfg(feature = "tauri-runtime")]
pub mod settings;
pub mod shell;
#[cfg(feature = "tauri-runtime")]
pub mod signature_vault;
#[cfg(feature = "tauri-runtime")]
pub mod study_packs;
#[cfg(feature = "tauri-runtime")]
pub mod timer_jobs;
#[cfg(feature = "tauri-runtime")]
pub mod usb_toolbox;
#[cfg(feature = "tauri-runtime")]
pub mod watch;

#[cfg(feature = "tauri-runtime")]
pub use analytics::*;
#[cfg(feature = "tauri-runtime")]
pub use application_kit::*;
#[cfg(feature = "tauri-runtime")]
pub use archive_studio::*;
#[cfg(feature = "tauri-runtime")]
pub use backup_recipes::*;
#[cfg(feature = "tauri-runtime")]
pub use citations::*;
#[cfg(feature = "tauri-runtime")]
pub use downloads_cleaner::*;
#[cfg(feature = "tauri-runtime")]
pub use duplicate_finder::*;
#[cfg(feature = "tauri-runtime")]
pub use file_rescue::*;
pub use finalize::*;
#[cfg(feature = "tauri-runtime")]
pub use forms_vault::*;
pub use inspect::*;
#[cfg(feature = "tauri-runtime")]
pub use notes::*;
#[cfg(feature = "tauri-runtime")]
pub use organizer::*;
pub use pdf_info::*;
#[cfg(feature = "tauri-runtime")]
pub use pdf_native::*;
pub use read_file::*;
#[cfg(feature = "tauri-runtime")]
pub use reading_history::*;
#[cfg(feature = "tauri-runtime")]
pub use recent_work::*;
#[cfg(feature = "tauri-runtime")]
pub use rename::*;
pub use save_as::*;
#[cfg(feature = "tauri-runtime")]
pub use settings::*;
pub use shell::*;
#[cfg(feature = "tauri-runtime")]
pub use signature_vault::*;
#[cfg(feature = "tauri-runtime")]
pub use study_packs::*;
#[cfg(feature = "tauri-runtime")]
pub use timer_jobs::*;
#[cfg(feature = "tauri-runtime")]
pub use usb_toolbox::*;
#[cfg(feature = "tauri-runtime")]
pub use watch::*;

use serde::Serialize;

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use crate::licensing;

/// The Paperu app version, mirrored from Cargo.toml at build time.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Information about the running application.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoResponse {
    pub name: String,
    pub version: String,
    pub edition: String,
    pub settings_version: u32,
}

/// `read_app_info` command: returns product identity & version.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn read_app_info() -> AppInfoResponse {
    let ent = licensing::current_entitlement();
    AppInfoResponse {
        name: "Paperu".to_string(),
        version: APP_VERSION.to_string(),
        edition: ent.edition.as_id(),
        settings_version: crate::contracts::settings::SETTINGS_VERSION,
    }
}

/// Convert any non-AppError failure into a structured unknown error
/// so the UI never receives raw text. Used as a catch-all wrapper.
pub fn sanitize<E: std::fmt::Display>(err: &E) -> AppError {
    AppError::builder(
        code::UNKNOWN,
        ErrorCategory::Internal,
        "Something went wrong on this PC.",
    )
    .technical(err.to_string())
    .severity(ErrorSeverity::Error)
    .recoverability(Recoverability::Fatal)
    .build()
}

/// Wrap an arbitrary fallible result into Paperu's `Result`.
pub fn into_app_result<T, E: std::fmt::Display>(res: std::result::Result<T, E>) -> Result<T> {
    res.map_err(|e| sanitize(&e))
}
