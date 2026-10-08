//! Open With — Windows "Open With" + cross-platform "open file with
//! application" lifecycle (P0-E).
//!
//! When a user double-clicks a file that's associated with Paperu (or
//! invokes "Open With" → Paperu), the OS launches Paperu with that file
//! path as a CLI argument. Two cases:
//!
//! 1. **Initial launch** (no Paperu running): the path arrives in
//!    `std::env::args()`. `setup` in `lib.rs` parses the first
//!    non-flag argument, validates it via [`validate_open_with_path`],
//!    and emits `paperu://open-file` via a delayed async task (500ms
//!    delay so the frontend has time to register its listener).
//!
//! 2. **Subsequent launch** (Paperu already running): the
//!    `tauri-plugin-single-instance` init callback receives the
//!    args, validates, and emits `paperu://open-file` directly. The
//!    frontend's listener (registered on mount) handles it live.
//!
//! Path validation is non-gated (no `#[cfg(feature = "tauri-runtime")]`)
//! so the same logic runs in CI on every platform.

#![allow(clippy::module_name_repetitions)]

use std::path::{Component, Path, PathBuf};

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use crate::filesystem;

/// Validate a path handed to Paperu via "Open With" (or any platform's
/// "open file with application" gesture).
///
/// Returns the canonical absolute `PathBuf` on success. The path need
/// NOT exist on disk — non-existence is a separate downstream concern
/// (the inspect layer surfaces a structured `FILE_NOT_FOUND` error).
pub fn validate_open_with_path(raw: &str) -> Result<PathBuf> {
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

    // Defence in depth: reject any `..` path segment, considering
    // BOTH Unix `/` and Windows `\` as separators.
    if trimmed.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Paperu rejected a path that tried to escape its folder.",
        )
        .detail("The path contained a \"..\" segment, which Paperu does not allow.")
        .technical(format!("traversal component rejected: {trimmed}"))
        .severity(ErrorSeverity::Warning)
        .build());
    }
    for component in candidate.components() {
        if matches!(component, Component::ParentDir) {
            return Err(AppError::builder(
                code::PATH_INVALID,
                ErrorCategory::Filesystem,
                "Paperu rejected a path that tried to escape its folder.",
            )
            .detail("The path contained a \"..\" segment, which Paperu does not allow.")
            .technical(format!("traversal component rejected: {trimmed}"))
            .severity(ErrorSeverity::Warning)
            .build());
        }
    }

    let is_native_absolute = candidate.is_absolute();
    let is_windows_drive_absolute = has_windows_drive_prefix(trimmed);
    let is_windows_unc = trimmed.starts_with("\\\\") || trimmed.starts_with("//");
    if !is_native_absolute && !is_windows_drive_absolute && !is_windows_unc {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Paperu only works with full file paths.",
        )
        .detail("Choose a file using the open button or drag a file in.")
        .technical(format!("relative path rejected: {trimmed}"))
        .build());
    }

    if is_native_absolute {
        filesystem::paths::validate_input_path(trimmed)
    } else {
        Ok(candidate.to_path_buf())
    }
}

fn has_windows_drive_prefix(p: &str) -> bool {
    let bytes = p.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_absolute_path_passes() {
        let result = validate_open_with_path("/tmp/paperu_open_with_test.pdf");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        let path = result.unwrap();
        assert!(path.is_absolute() || has_windows_drive_prefix(&path.to_string_lossy()));
    }

    #[test]
    fn relative_path_rejected() {
        let result = validate_open_with_path("relative/path/to/file.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn traversal_path_rejected() {
        let result = validate_open_with_path("/safe/../../../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn windows_drive_path_passes_syntax_check_on_any_os() {
        let result = validate_open_with_path("C:\\Users\\aditya\\Documents\\report.pdf");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        let path = result.unwrap();
        let s = path.to_string_lossy();
        assert!(
            s.contains("aditya") && s.contains("report.pdf"),
            "path lost its segments: {s}"
        );
    }

    #[test]
    fn empty_string_rejected() {
        let result = validate_open_with_path("");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::EMPTY_INPUT);
    }

    #[test]
    fn whitespace_only_path_rejected_as_empty() {
        let result = validate_open_with_path("   ");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::EMPTY_INPUT);
    }

    #[test]
    fn windows_unc_path_passes_syntax_check() {
        let result = validate_open_with_path("\\\\server\\share\\file.pdf");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
    }

    #[test]
    fn drive_relative_path_rejected() {
        let result = validate_open_with_path("C:foo.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn traversal_in_middle_rejected() {
        let result = validate_open_with_path("/home/user/../other/file.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn windows_drive_path_with_traversal_rejected() {
        let result = validate_open_with_path("C:\\Users\\..\\evil\\file.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }
}
