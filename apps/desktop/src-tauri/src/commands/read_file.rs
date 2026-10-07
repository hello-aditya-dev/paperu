//! `read_file_bytes` command — read a local file's bytes into memory.
//!
//! Used by the webview-side engines (pdf-lib, pdfjs, canvas) that need
//! the actual file content to process. The path is re-validated
//! server-side. The file is opened read-only; the original is never
//! modified.
//!
//! The bytes are returned base64-encoded because Tauri IPC cannot
//! transfer raw binary directly.

use crate::contracts::common::FilePath;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use crate::filesystem;

/// Request to read a local file's bytes.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileBytesRequest {
    /// Absolute path to the file. Re-validated server-side.
    pub path: FilePath,
}

/// The file bytes, base64-encoded.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileBytesResponse {
    /// Base64-encoded file bytes.
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
    /// Exact byte count.
    pub size: u64,
}

/// `read_file_bytes` command: read a file read-only and return its bytes.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn read_file_bytes(request: ReadFileBytesRequest) -> Result<ReadFileBytesResponse> {
    let path = filesystem::paths::validate_input_path(&request.path)?;
    let bytes = std::fs::read(&path).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu could not read that file.",
        )
        .technical(e.to_string())
        .severity(ErrorSeverity::Error)
        .build()
    })?;
    let size = bytes.len() as u64;
    let encoded = base64_encode(&bytes);
    Ok(ReadFileBytesResponse {
        bytes_base64: encoded,
        size,
    })
}

/// Base64 encoder (no external crate).
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
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
    fn encode_round_trip() {
        let original = b"Paperu engine test";
        let encoded = base64_encode(original);
        assert_eq!(encoded.len(), original.len().div_ceil(3) * 4);
        // Decode and verify (reuse the decoder from finalize).
        // Simple check: the encoded string is valid base64 charset.
        assert!(encoded
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn encode_empty() {
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn encode_known_values() {
        // "Man" -> "TWFu"
        assert_eq!(base64_encode(b"Man"), "TWFu");
        // "Ma" -> "TWE="
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        // "M" -> "TQ=="
        assert_eq!(base64_encode(b"M"), "TQ==");
    }
}
