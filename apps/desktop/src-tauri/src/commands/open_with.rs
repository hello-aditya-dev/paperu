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
//!    and queues it on [`AppState::open_with_queue`]. The frontend
//!    pops the queue via [`consume_open_with_event`] on its first
//!    ready tick (signalling "frontend ready") — this avoids racing
//!    the event listener setup before the React app has mounted.
//!
//! 2. **Subsequent launch** (Paperu already running): the
//!    `tauri-plugin-single-instance` init callback receives the
//!    args, validates, and emits `paperu://open-file` directly. The
//!    frontend's listener (registered on mount) handles it live.
//!
//! Path validation is non-gated (no `#[cfg(feature = "tauri-runtime")]`)
//! so the same logic runs in CI on every platform. The validation
//! reuses [`crate::filesystem::paths::validate_input_path`] for the
//! canonicalization + reserved-name checks, and adds two Open With
//! specific guards:
//!
//! - **Cross-platform absolute acceptance**: a Windows drive path
//!   (`C:\Users\…`) or UNC path (`\\server\share\…`) is accepted on
//!   any host OS. Open With can hand Paperu a path even when Paperu
//!   itself runs under a different OS (rare; the existence check
//!   downstream catches the rest).
//!
//! - **Traversal rejection**: any `..` component is rejected. The
//!   underlying `validate_input_path` falls back to the lexical form
//!   for non-existent files, so without this guard a path like
//!   `/safe/.. /etc/passwd` could slip through. Open With receives
//!   arbitrary paths from the OS shell — paranoia is warranted.

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
///
/// Reuses [`filesystem::paths::validate_input_path`] for the
/// reserved-name + canonicalize step when the path is natively
/// absolute on this host; for cross-platform Windows-style paths on a
/// non-Windows host, returns the lexical form (the underlying
/// `validate_input_path` would reject on `is_absolute()`).
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
    // BOTH Unix `/` and Windows `\` as separators. The std
    // `Path::components()` only splits on the host OS's separator,
    // so on a non-Windows host a Windows path like
    // `C:\Users\..\evil\file.pdf` would be parsed as a single
    // component and the `..` would slip through. Open With receives
    // arbitrary paths from the OS shell — we split ourselves so the
    // guard is platform-independent.
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
    // Belt + suspenders: also catch stdlib-parsed ParentDir components
    // (no-op on hosts where the split above already covered both
    // separators; the redundant guard costs nothing and protects
    // against future stdlib quirks).
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

    // Cross-platform absolute check. `Path::is_absolute()` only
    // returns true for the host OS's native absolute form, but Open
    // With can hand Paperu a Windows path even when Paperu runs
    // elsewhere. Accept Unix `/…`, Windows drive `<letter>:\…`, and
    // UNC `\\…` (or `//…`) on any host.
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

    // Delegate to validate_input_path for the reserved-name +
    // canonicalize step when the path is natively absolute on this
    // host. For cross-platform Windows-style paths on a non-Windows
    // host, the underlying call would reject on `is_absolute()` —
    // we've already done the syntactic checks above, so return the
    // lexical form. The file existence check is the next layer's
    // job (inspect_file surfaces FILE_NOT_FOUND).
    if is_native_absolute {
        filesystem::paths::validate_input_path(trimmed)
    } else {
        Ok(candidate.to_path_buf())
    }
}

/// True when `p` starts with a Windows drive prefix like `C:\` or
/// `c:/` (any single ASCII letter, case-insensitive). The form
/// `C:foo` (no separator after the colon) is a drive-relative path
/// on Windows and is NOT absolute — reject it.
fn has_windows_drive_prefix(p: &str) -> bool {
    let bytes = p.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// `consume_open_with_event` command: pop the next queued Open With
/// path (if any). Called by the frontend on its first ready tick —
/// this both signals "frontend ready" and retrieves the initial-launch
/// file path that `setup` queued.
///
/// Returns `Some(validated_path)` if a queued path exists, `None`
/// otherwise. Subsequent launches emit the `paperu://open-file` event
/// directly (the frontend's listener, registered on mount, handles
/// those live).
///
/// Gated behind `tauri-runtime` because the signature uses
/// `tauri::State`. The path-validation logic in
/// [`validate_open_with_path`] is non-gated and runs in CI on every
/// platform.
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub fn consume_open_with_event(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Option<String>> {
    let mut q = state
        .open_with_queue
        .lock()
        .map_err(|e| crate::errors::AppError::unknown(&e))?;
    Ok(q.pop())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Mandatory Open With path validation tests (P0-E) ──────────────
    // These run in CI on every platform (non-gated — the module is
    // always compiled). Each case asserts the exact behaviour the
    // master prompt requires for the Open With lifecycle.

    #[test]
    fn valid_absolute_path_passes() {
        // A real Unix absolute path. validate_input_path canonicalizes
        // it (it exists in CI), so the result should be the canonical
        // form. If the path doesn't exist on this host, the lexical
        // form is returned — either way, the call must succeed.
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
        // A `..` component must be rejected even when the path is
        // syntactically absolute — defence in depth against Open With
        // payloads that try to escape.
        let result = validate_open_with_path("/safe/../../../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn windows_drive_path_passes_syntax_check_on_any_os() {
        // On a non-Windows host, `Path::is_absolute()` returns false
        // for `C:\Users\…`, but Open With can hand Paperu a Windows
        // path. validate_open_with_path must accept it syntactically.
        let result = validate_open_with_path("C:\\Users\\aditya\\Documents\\report.pdf");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        let path = result.unwrap();
        // The returned path is the lexical form on non-Windows hosts,
        // or the canonicalized form on Windows. Either way, the string
        // representation must contain the original segments.
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

    // ── Additional guards (defence in depth, not in the mandatory 5) ──

    #[test]
    fn whitespace_only_path_rejected_as_empty() {
        // The path is trimmed before the empty check — a path of only
        // spaces is equivalent to empty.
        let result = validate_open_with_path("   ");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::EMPTY_INPUT);
    }

    #[test]
    fn windows_unc_path_passes_syntax_check() {
        // UNC paths (`\\server\share\…`) are absolute on Windows and
        // accepted syntactically on any host.
        let result = validate_open_with_path("\\\\server\\share\\file.pdf");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
    }

    #[test]
    fn drive_relative_path_rejected() {
        // `C:foo` is drive-relative on Windows — NOT absolute. Reject.
        let result = validate_open_with_path("C:foo.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn traversal_in_middle_rejected() {
        // `..` anywhere in the path must be rejected.
        let result = validate_open_with_path("/home/user/../other/file.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }

    #[test]
    fn windows_drive_path_with_traversal_rejected() {
        // A Windows-style path with `..` must still be rejected — the
        // traversal guard runs before the cross-platform acceptance.
        let result = validate_open_with_path("C:\\Users\\..\\evil\\file.pdf");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::PATH_INVALID);
    }
}
