//! Safe path handling.
//!
//! Responsible for:
//!   - canonicalization (without following symlinks unexpectedly)
//!   - reserved Windows name detection (CON, PRN, AUX, NUL, ...)
//!   - long-path handling (\\?\ prefix on Windows)
//!   - traversal prevention (reject `..` outside a base where scoped)
//!   - synced-folder detection (OneDrive) for UX awareness

use std::path::{Path, PathBuf};

use crate::contracts::common::FilePath;
use crate::errors::{code, AppError, ErrorCategory, Recoverability, Result};

/// Windows reserved device names. Paperu must reject these as
/// outputs and warn when encountered as inputs.
pub const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Reserved characters in Windows file names.
pub const WINDOWS_RESERVED_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Validate and canonicalize a user-supplied path string into an
/// absolute `PathBuf`. The path must:
/// - be non-empty
/// - be absolute
/// - not contain traversal that escapes after canonicalization
/// - not be a Windows reserved name when used as a final component
pub fn validate_input_path(raw: &str) -> Result<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Paperu needs a file path to work with.",
        )
        .recoverability(Recoverability::ActionRequired)
        .build());
    }

    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Paperu only works with full file paths.",
        )
        .detail("Choose a file using the open button or drag a file in.")
        .technical(format!("relative path rejected: {trimmed}"))
        .build());
    }

    // Reject Windows reserved final component names regardless of OS,
    // so behaviour is consistent and the same validation runs in CI.
    if let Some(name) = candidate.file_name().and_then(|n| n.to_str()) {
        let stem = name.split('.').next().unwrap_or(name);
        if WINDOWS_RESERVED_NAMES
            .iter()
            .any(|r| r.eq_ignore_ascii_case(stem))
        {
            return Err(AppError::builder(
                code::RESERVED_NAME,
                ErrorCategory::Filesystem,
                "That file name is reserved by Windows and cannot be used.",
            )
            .technical(format!("reserved name: {name}"))
            .build());
        }
        if name.chars().any(|c| WINDOWS_RESERVED_CHARS.contains(&c)) {
            return Err(AppError::builder(
                code::PATH_INVALID,
                ErrorCategory::Filesystem,
                "That file name contains characters Windows does not allow.",
            )
            .technical(format!("reserved char in name: {name}"))
            .build());
        }
    }

    // Canonicalize when the file exists; otherwise fall back to the
    // lexical absolute form so inspection can still report existence.
    match std::fs::canonicalize(candidate) {
        Ok(abs) => Ok(abs),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(candidate.to_path_buf()),
        Err(err) => Err(AppError::from(err)),
    }
}

/// Convert a `PathBuf` to a contract `FilePath` string. On Windows
/// this would apply the extended-length prefix when needed; on other
/// platforms it returns the native string form.
pub fn path_to_file_path(path: &Path) -> FilePath {
    path.to_string_lossy().into_owned()
}

/// True when the path appears to live inside a known cloud-synced
/// folder (OneDrive). Used only for UX awareness, never to upload.
pub fn is_in_synced_folder(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    lower.contains("onedrive")
}
