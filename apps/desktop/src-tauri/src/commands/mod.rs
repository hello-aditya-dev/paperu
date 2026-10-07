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

pub mod finalize;
pub mod inspect;
pub mod read_file;
#[cfg(feature = "tauri-runtime")]
pub mod settings;
pub mod shell;

pub use finalize::*;
pub use inspect::*;
pub use read_file::*;
#[cfg(feature = "tauri-runtime")]
pub use settings::*;
pub use shell::*;

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
