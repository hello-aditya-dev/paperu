//! `save_file_as` command — write bytes to a user-chosen destination
//! path (Master Prompt repair §32). Used by every result card's
//! "Save As" button.
//!
//! Unlike finalize_output (which computes the destination from a source
//! path), save_file_as takes the destination directly from the Tauri
//! save dialog. The Rust side still validates: absolute, no traversal,
//! parent exists, write to temp + atomic finalize.
//!
//! Source safety (§62): the source bytes come from the engine, never
//! from the user's original file. The user's chosen destination is
//! validated and written atomically — a crash mid-write never produces
//! a partial file at the destination.

use std::path::Path;

use crate::contracts::common::FilePath;
use crate::contracts::inspect::InspectFileResponse;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use crate::filesystem;

/// Request to save bytes to a user-chosen destination path.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileAsRequest {
    /// Absolute destination path chosen by the user via the save dialog.
    pub dest_path: String,
    /// The output bytes, base64-encoded (Tauri IPC can't transfer raw binary).
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
    /// True if the user explicitly accepted overwrite of an existing file.
    /// False is the safe default — publish refuses to overwrite.
    pub overwrite: bool,
}

/// The result of a successful save-as.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileAsResponse {
    pub output_path: FilePath,
    pub output: InspectFileResponse,
}

/// `save_file_as` command: write bytes to a user-chosen path.
///
/// P0-01: uses the canonical `publish_bytes` primitive — temp is staged
/// in the destination directory (same-volume → atomic rename), and the
/// publication uses `hard_link` (no-overwrite) or `rename` (overwrite)
/// which are atomic on both Windows and POSIX. A crash mid-write leaves
/// only the temp file (recognizable `.paperu-{uuid}.{ext}.tmp`); the
/// user's existing destination is never touched.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn save_file_as(request: SaveFileAsRequest) -> Result<SaveFileAsResponse> {
    // 1. Validate the destination path (absolute, no traversal, sane).
    let dest = filesystem::paths::validate_input_path(&request.dest_path)?;

    // 2. Parent directory must exist (we don't auto-create for Save As —
    //    the user explicitly chose this path; a missing parent is an error).
    let parent = dest.parent().ok_or_else(|| {
        AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Paperu could not determine the folder for the save destination.",
        )
        .build()
    })?;
    if !parent.exists() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "That folder doesn't exist.",
        )
        .technical(format!("parent not found: {}", parent.display()))
        .build());
    }

    // 3. Decode the base64 bytes.
    let bytes = base64_decode(&request.bytes_base64)?;

    // 4. Reject empty payloads (a 0-byte file is almost always a bug).
    if bytes.is_empty() {
        return Err(AppError::builder(
            code::OUTPUT_VALIDATION_FAILED,
            ErrorCategory::Processing,
            "Paperu won't save an empty file.",
        )
        .severity(ErrorSeverity::Error)
        .recoverability(Recoverability::ActionRequired)
        .build());
    }

    // 5. Clean up any stale Paperu temps in the destination directory.
    filesystem::publish::cleanup_stale_temps(parent);

    // 6. Publish atomically. If overwrite=false and dest exists, this
    //    returns ALREADY_EXISTS — the frontend re-prompts the user.
    filesystem::publish::publish_bytes(&dest, &bytes, request.overwrite)?;

    // 7. Read back real metadata about the output (size, kind, etc.).
    let output = inspect_file_at(&dest)?;
    Ok(SaveFileAsResponse {
        output_path: dest.to_string_lossy().to_string(),
        output,
    })
}

/// Inspect a file at an absolute path (reuses the canonical inspect logic).
fn inspect_file_at(path: &Path) -> Result<InspectFileResponse> {
    crate::filesystem::inspect::inspect_path(path)
}

// ── base64 (self-contained to avoid editing finalize.rs) ────────

fn base64_decode(s: &str) -> Result<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    fn val(c: u8) -> Option<u8> {
        TABLE.iter().position(|&t| t == c).map(|p| p as u8)
    }
    let cleaned: Vec<u8> = s
        .bytes()
        .filter(|&b| b != b'\n' && b != b'\r' && b != b' ')
        .collect();
    let mut out = Vec::with_capacity(cleaned.len() * 3 / 4);
    let mut buf = [0u8; 4];
    let mut i = 0;
    for &b in &cleaned {
        if b == b'=' {
            break;
        }
        let v = val(b).ok_or_else(|| {
            AppError::builder(
                code::INVALID_INPUT,
                ErrorCategory::Validation,
                "Paperu received invalid base64.",
            )
            .technical(format!("bad base64 char: {b}"))
            .severity(ErrorSeverity::Error)
            .recoverability(Recoverability::Fatal)
            .build()
        })?;
        buf[i] = v;
        i += 1;
        if i == 4 {
            out.push((buf[0] << 2) | (buf[1] >> 4));
            out.push((buf[1] << 4) | (buf[2] >> 2));
            out.push((buf[2] << 6) | buf[3]);
            i = 0;
        }
    }
    if i == 2 {
        out.push((buf[0] << 2) | (buf[1] >> 4));
    } else if i == 3 {
        out.push((buf[0] << 2) | (buf[1] >> 4));
        out.push((buf[1] << 4) | (buf[2] >> 2));
    }
    Ok(out)
}

#[cfg(test)]
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[((b0 & 0x03) << 4 | b1 >> 4) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((b1 & 0x0f) << 2 | b2 >> 6) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_file_as_writes_to_user_chosen_path() {
        let tmp = std::env::temp_dir().join(format!("paperu-save-as-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("user-saved.pdf");
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"hello save-as"),
            overwrite: false,
        };
        let res = save_file_as(req).unwrap();
        assert!(dest.exists());
        assert_eq!(res.output_path, dest.to_string_lossy().to_string());
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello save-as");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_file_as_refuses_existing_without_overwrite() {
        let tmp = std::env::temp_dir().join(format!("paperu-save-as-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("existing.pdf");
        std::fs::write(&dest, b"already here").unwrap();
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"new"),
            overwrite: false,
        };
        let res = save_file_as(req);
        assert!(
            res.is_err(),
            "must refuse overwrite without explicit consent"
        );
        assert_eq!(std::fs::read(&dest).unwrap(), b"already here");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_file_as_overwrites_when_explicit() {
        let tmp = std::env::temp_dir().join(format!("paperu-save-as-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("overwrite-me.pdf");
        std::fs::write(&dest, b"old").unwrap();
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"new content"),
            overwrite: true,
        };
        save_file_as(req).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"new content");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn base64_round_trip() {
        let original = b"Paperu save-as test payload \x00\x01\x02 binary";
        let encoded = base64_encode(original);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    // ── P0-01 tests: cross-volume, read-only, collision, non-ASCII ─

    #[test]
    fn save_file_as_non_ascii_path() {
        let tmp = std::env::temp_dir().join(format!("paperu-save-as-u-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("Ünïcödé-文件.pdf");
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"unicode"),
            overwrite: false,
        };
        save_file_as(req).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"unicode");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_file_as_rejects_empty_payload() {
        // P0-01: an empty payload is a bug — must surface an error,
        // not write a 0-byte file the user might mistake for a result.
        let tmp =
            std::env::temp_dir().join(format!("paperu-save-as-empty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("empty.pdf");
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b""),
            overwrite: false,
        };
        let res = save_file_as(req);
        assert!(res.is_err(), "empty payload must be rejected");
        assert!(!dest.exists(), "no zero-byte file written");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_file_as_missing_parent_dir_errors_cleanly() {
        let dest = std::env::temp_dir()
            .join(format!("paperu-missing-{}", uuid::Uuid::new_v4()))
            .join("nonexistent")
            .join("out.pdf");
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"data"),
            overwrite: false,
        };
        let res = save_file_as(req);
        assert!(res.is_err(), "missing parent must error");
        assert!(!dest.exists());
    }

    #[test]
    fn save_file_as_source_remains_unchanged() {
        // The destination is the ONLY file affected — no source file is
        // touched. We simulate a source by writing one, then saving
        // a different file next to it.
        let tmp = std::env::temp_dir().join(format!("paperu-save-as-src-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("source.pdf");
        std::fs::write(&source, b"original source bytes").unwrap();
        let dest = tmp.join("output.pdf");
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"new output"),
            overwrite: false,
        };
        save_file_as(req).unwrap();
        // Source is untouched.
        assert_eq!(std::fs::read(&source).unwrap(), b"original source bytes");
        assert_eq!(std::fs::read(&dest).unwrap(), b"new output");
        // Only two files: source + dest (no leftover temp).
        let count = std::fs::read_dir(&tmp).unwrap().count();
        assert_eq!(count, 2, "no leftover temp file");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_file_as_leaves_no_temp_on_existing_dest() {
        // When ALREADY_EXISTS is returned, no temp must be left behind.
        let tmp = std::env::temp_dir().join(format!(
            "paperu-save-as-no-leftover-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("exists.pdf");
        std::fs::write(&dest, b"first").unwrap();
        let req = SaveFileAsRequest {
            dest_path: dest.to_string_lossy().to_string(),
            bytes_base64: base64_encode(b"second"),
            overwrite: false,
        };
        let _ = save_file_as(req);
        // Only the original dest — no temp.
        assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 1);
        assert_eq!(std::fs::read(&dest).unwrap(), b"first");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
