#![allow(warnings)]
//! Archive Studio — ZIP safety validation (Feature 15).
//! 50%: path-traversal prevention, ZIP Slip detection, entry listing
//! validation. Actual ZIP create/extract needs the `zip` crate (next sprint).
//! The security-critical path validation is testable NOW without the crate.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use std::path::{Component, Path, PathBuf};

/// A ZIP entry from the listing (path + size + compressed size).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntryInfo {
    pub name: String,
    pub uncompressed_size: u64,
    pub compressed_size: u64,
    pub is_directory: bool,
}

/// Validate that a ZIP entry name is safe (no path traversal, no absolute paths).
/// Returns the sanitized relative path, or an error if the entry is dangerous.
pub fn validate_zip_entry(name: &str) -> Result<PathBuf> {
    // Reject absolute paths.
    if name.starts_with('/')
        || name.starts_with('\\')
        || name.len() >= 2 && name.as_bytes()[1] == b':'
    {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Archive entry has an absolute path — rejected.",
        )
        .technical(format!("entry: {name}"))
        .severity(ErrorSeverity::Warning)
        .build());
    }
    // Reject path traversal (../, ..\).
    let normalized = name.replace("\\", "/");
    let p = Path::new(&normalized);
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                return Err(AppError::builder(
                    code::PATH_INVALID,
                    ErrorCategory::Filesystem,
                    "Archive entry contains '..' — ZIP Slip attack rejected.",
                )
                .technical(format!("entry: {name}"))
                .severity(ErrorSeverity::Warning)
                .build());
            }
            Component::RootDir => {
                return Err(AppError::builder(
                    code::PATH_INVALID,
                    ErrorCategory::Filesystem,
                    "Archive entry has a root path — rejected.",
                )
                .build());
            }
            Component::Prefix(_) => {
                return Err(AppError::builder(
                    code::PATH_INVALID,
                    ErrorCategory::Filesystem,
                    "Archive entry has a Windows drive prefix — rejected.",
                )
                .build());
            }
            _ => {}
        }
    }
    // Normalize separators.
    Ok(PathBuf::from(name.replace('\\', "/")))
}

/// Check if an extraction destination is contained within the base dir.
/// Prevents symlink escapes and directory traversal.
pub fn is_contained(base: &Path, target: &Path) -> bool {
    let canonical_base = match base.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let canonical_target = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    canonical_target.starts_with(&canonical_base)
}

/// Detect suspicious compression ratios (decompression bomb).
/// Returns true if the ratio is suspicious (e.g. > 100:1).
pub fn is_suspicious_ratio(uncompressed: u64, compressed: u64) -> bool {
    if compressed == 0 {
        return uncompressed > 0;
    }
    let ratio = uncompressed as f64 / compressed as f64;
    ratio > 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        assert!(validate_zip_entry("../etc/passwd").is_err());
        assert!(validate_zip_entry("foo/../../bar").is_err());
        assert!(validate_zip_entry("..\\windows\\system32").is_err());
    }

    #[test]
    fn rejects_absolute() {
        assert!(validate_zip_entry("/etc/passwd").is_err());
        assert!(validate_zip_entry("C:\\Windows\\system32").is_err());
    }

    #[test]
    fn accepts_safe_paths() {
        assert!(validate_zip_entry("folder/file.txt").is_ok());
        assert!(validate_zip_entry("nested/deep/path.pdf").is_ok());
    }

    #[test]
    fn detects_suspicious_ratio() {
        assert!(is_suspicious_ratio(1_000_000_000, 1_000)); // 1000:1
        assert!(!is_suspicious_ratio(1_000, 500)); // 2:1 — normal
    }

    #[test]
    fn is_contained_works() {
        let tmp = std::env::temp_dir().join(format!("paperu-archive-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let sub = tmp.join("subfolder");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(is_contained(&tmp, &sub));
        assert!(!is_contained(&tmp, std::path::Path::new("/etc")));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
