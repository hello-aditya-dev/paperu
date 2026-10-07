//! `finalize_output` command — the canonical non-destructive output
//! finalization path, exposed to the webview engine layer.
//!
//! The webview-based engines (pdf-lib, pdfjs, canvas) produce output
//! bytes in memory. Rather than writing directly to the user's
//! filesystem (which would bypass the atomic-finalization invariant),
//! they send the bytes here. This command:
//!
//! 1. Validates the source path (the original file, used to compute the
//!    output directory and base name).
//! 2. Computes the destination path: same directory as the source, with
//!    the given suffix and extension, conflict-renamed per the canonical
//!    `ConflictStrategy::Rename` default.
//! 3. Writes the bytes to a temp file under `TempWorkspace`.
//! 4. Calls `atomic_finalize` to move the temp file into place.
//! 5. Returns the destination path and real output metadata.
//!
//! The original source file is never modified. A failed finalization
//! never corrupts the source. Partial outputs live only in the temp
//! workspace and are cleaned on the next startup.

use std::path::{Path, PathBuf};

use crate::contracts::common::FilePath;
use crate::contracts::inspect::InspectFileResponse;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use crate::filesystem;

/// Request to finalize an in-memory output into a file on disk.
///
/// The `sourcePath` is the original file the user operated on. The output
/// is written to the same directory with `-{suffix}.{ext}` appended (and
/// conflict-renamed if needed). The source is never touched.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeOutputRequest {
    /// Absolute path to the original source file. Used to compute the
    /// output directory and base name. Re-validated server-side.
    pub source_path: String,
    /// Suffix appended to the source file stem, e.g. "-paperu".
    pub suffix: String,
    /// Output extension without the dot, e.g. "pdf" or "jpg".
    pub extension: String,
    /// The output bytes, base64-encoded (Tauri IPC cannot transfer raw
    /// binary directly).
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
}

/// The result of a successful finalization.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeOutputResponse {
    /// The canonical absolute path of the written output.
    pub output_path: FilePath,
    /// Real metadata about the output file (size, kind, etc.).
    pub output: InspectFileResponse,
}

/// `finalize_output` command: write engine-produced bytes to disk safely.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn finalize_output(request: FinalizeOutputRequest) -> Result<FinalizeOutputResponse> {
    // 1. Validate the source path.
    let source_path = filesystem::paths::validate_input_path(&request.source_path)?;
    let source_dir = source_path.parent().ok_or_else(|| {
        AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Paperu could not determine the folder for the source file.",
        )
        .build()
    })?;
    let source_stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("paperu");

    // 2. Compute the destination name: {stem}{suffix}.{ext}.
    // Validate the suffix and extension do not contain path separators or
    // reserved characters.
    if request.suggestion_invalid() || request.extension_invalid() {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Paperu received an invalid output name.",
        )
        .technical(format!(
            "suffix={:?} ext={:?}",
            request.suffix, request.extension
        ))
        .build());
    }
    let dest_name = format!("{}{}.{}", source_stem, request.suffix, request.extension);
    let dest = source_dir.join(&dest_name);

    // 3. Conflict resolution: rename with a numeric suffix if the
    //    destination already exists (canonical default).
    let dest = resolve_conflict_rename(&dest);

    // 4. Decode the base64 bytes.
    let bytes = base64_decode(&request.bytes_base64)?;

    // 5. Write to a temp file under TempWorkspace.
    let ws = filesystem::temp::TempWorkspace::ensure()?;
    let temp_suffix = format!(".{}", request.extension);
    let temp = ws.new_file(&temp_suffix);
    std::fs::write(&temp, &bytes).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu could not write the temporary output.",
        )
        .technical(e.to_string())
        .build()
    })?;

    // 6. Validate the temp file is non-empty.
    let temp_meta = std::fs::metadata(&temp).map_err(AppError::from)?;
    if temp_meta.len() == 0 {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::builder(
            code::OUTPUT_VALIDATION_FAILED,
            ErrorCategory::Processing,
            "Paperu produced an empty output file.",
        )
        .severity(ErrorSeverity::Error)
        .recoverability(Recoverability::ActionRequired)
        .build());
    }

    // 7. Atomically finalize: move temp into the destination.
    if let Err(e) = filesystem::temp::atomic_finalize(&temp, &dest, false) {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }

    // 8. Inspect the output to return real metadata.
    let dest_path = filesystem::paths::path_to_file_path(&dest);
    let output = filesystem::inspect::inspect_file(&dest_path)?;

    Ok(FinalizeOutputResponse {
        output_path: dest_path,
        output,
    })
}

impl FinalizeOutputRequest {
    /// True if the suffix contains path separators or reserved chars.
    fn suggestion_invalid(&self) -> bool {
        self.suffix
            .chars()
            .any(|c| c == '/' || c == '\\' || c == '\0' || c == ':')
    }
    /// True if the extension is empty or contains non-alphanumeric chars.
    fn extension_invalid(&self) -> bool {
        self.extension.is_empty() || self.extension.chars().any(|c| !c.is_ascii_alphanumeric())
    }
}

/// If `dest` already exists, append " (1)", " (2)", ... until a free
/// name is found. Mirrors the canonical `ConflictStrategy::Rename`.
fn resolve_conflict_rename(dest: &Path) -> PathBuf {
    if !dest.exists() {
        return dest.to_path_buf();
    }
    let dir = dest.parent().unwrap_or(Path::new("."));
    let stem = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("paperu");
    let ext = dest.extension().and_then(|e| e.to_str()).unwrap_or("");
    for n in 1u32..=9999 {
        let name = if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
    }
    // Fallback: unlikely to reach here.
    dest.to_path_buf()
}

/// Minimal base64 decoder (no external crate dependency to keep the
/// dependency surface unchanged). Supports standard base64 with padding.
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
                "Paperu received malformed output data.",
            )
            .technical(format!("invalid base64 byte: {b}"))
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
    // Handle padding remainder.
    if i == 2 {
        out.push((buf[0] << 2) | (buf[1] >> 4));
    } else if i == 3 {
        out.push((buf[0] << 2) | (buf[1] >> 4));
        out.push((buf[1] << 4) | (buf[2] >> 2));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        let original = b"Paperu test output - hello world!";
        let encoded = base64_encode(original);
        let decoded = base64_decode(&encoded).expect("decode");
        assert_eq!(decoded, original);
    }

    #[test]
    fn base64_empty() {
        let decoded: Vec<u8> = base64_decode("").expect("empty");
        assert_eq!(decoded.len(), 0);
    }

    #[test]
    fn base64_with_padding() {
        // "Paperu" -> base64 "UGFwZXJ1"
        // "Paper" -> base64 "UGFwZXI="
        let decoded = base64_decode("UGFwZXI=").expect("decode");
        assert_eq!(decoded, b"Paper");
    }

    #[test]
    fn suffix_rejects_separators() {
        let req = FinalizeOutputRequest {
            source_path: "/tmp/test.pdf".into(),
            suffix: "../evil".into(),
            extension: "pdf".into(),
            bytes_base64: String::new(),
        };
        assert!(req.suggestion_invalid());
    }

    #[test]
    fn extension_rejects_non_alphanumeric() {
        let req = FinalizeOutputRequest {
            source_path: "/tmp/test.pdf".into(),
            suffix: "-out".into(),
            extension: "pdf.exe".into(),
            bytes_base64: String::new(),
        };
        assert!(req.extension_invalid());
    }

    /// Tiny encoder for test fixtures only.
    fn base64_encode(data: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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
}
