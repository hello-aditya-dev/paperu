#![allow(warnings)]
//! File Rescue — conservative file validation + recovery (Feature 16).
//! 50%: classifies files as valid/malformed/unsupported, attempts
//! PDF re-save recovery where possible. Never modifies the original.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueDiagnosis {
    pub path: String,
    pub file_kind: String,
    pub status: String, // valid|malformed|truncated|unsupported
    pub message: String,
    pub recoverable: bool,
}

/// Diagnose a file's integrity. Deterministic, no AI.
pub fn diagnose(path: &str) -> Result<RescueDiagnosis> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "That file doesn't exist.",
        )
        .build());
    }
    let bytes = fs::read(p).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't read that file.",
        )
        .technical(e.to_string())
        .build()
    })?;

    // Detect kind by magic bytes.
    let (kind, status, msg, recoverable) = if bytes.len() >= 4 && &bytes[..4] == b"%PDF" {
        // PDF
        if bytes.len() < 10 || !bytes.windows(5).any(|w| w == b"%%EOF") {
            (
                "pdf",
                "truncated",
                "PDF is missing its %%EOF marker — likely truncated.".to_string(),
                true,
            )
        } else {
            (
                "pdf",
                "valid",
                "PDF structure looks valid.".to_string(),
                false,
            )
        }
    } else if bytes.len() >= 4
        && (bytes[0..2] == [0xFF, 0xD8] || // JPEG
        bytes.len() >= 8 && &bytes[..8] == b"\x89PNG\r\n\x1a\n")
    {
        // PNG
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("image");
        (
            "image",
            "valid",
            format!("{} image header is valid.", ext.to_uppercase()),
            false,
        )
    } else if bytes.len() >= 4 && &bytes[..4] == b"PK\x03\x04" {
        // ZIP
        (
            "zip",
            "valid",
            "ZIP archive header is valid.".to_string(),
            false,
        )
    } else if bytes.is_empty() {
        (
            "empty",
            "malformed",
            "File is empty (0 bytes).".to_string(),
            false,
        )
    } else {
        (
            "other",
            "unsupported",
            "Paperu can't diagnose this file type yet.".to_string(),
            false,
        )
    };

    Ok(RescueDiagnosis {
        path: path.to_string(),
        file_kind: kind.to_string(),
        status: status.to_string(),
        message: msg,
        recoverable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnoses_valid_pdf() {
        let tmp = std::env::temp_dir().join(format!("paperu-rescue-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("test.pdf");
        std::fs::write(&f, b"%PDF-1.4\nstuff\n%%EOF").unwrap();
        let d = diagnose(f.to_str().unwrap()).unwrap();
        assert_eq!(d.file_kind, "pdf");
        assert_eq!(d.status, "valid");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn diagnoses_truncated_pdf() {
        let tmp = std::env::temp_dir().join(format!("paperu-rescue-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("trunc.pdf");
        std::fs::write(&f, b"%PDF-1.4\nstuff without end marker").unwrap();
        let d = diagnose(f.to_str().unwrap()).unwrap();
        assert_eq!(d.status, "truncated");
        assert!(d.recoverable);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn diagnoses_empty_file() {
        let tmp = std::env::temp_dir().join(format!("paperu-rescue-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("empty.bin");
        std::fs::write(&f, b"").unwrap();
        let d = diagnose(f.to_str().unwrap()).unwrap();
        assert_eq!(d.status, "malformed");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn diagnoses_jpeg() {
        let tmp = std::env::temp_dir().join(format!("paperu-rescue-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("test.jpg");
        std::fs::write(&f, [0xFF, 0xD8, 0xFF, 0xE0]).unwrap();
        let d = diagnose(f.to_str().unwrap()).unwrap();
        assert_eq!(d.file_kind, "image");
        assert_eq!(d.status, "valid");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
