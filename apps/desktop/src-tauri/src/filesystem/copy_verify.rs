//! Shared copy + verify primitive (90% §52).
//!
//! One Rust primitive used by USB Toolbox, Backup Recipes, and any future
//! file-copy operation that must guarantee integrity. Pipeline:
//!   source → temporary destination → stream copy → SHA-256 source →
//!   SHA-256 destination → compare → atomic rename.
//! Cancellation via a predicate. Never overwrites by default (uses the
//! shared conflict resolver). The source is never deleted.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use crate::filesystem::resolve_conflict;
use crate::filesystem::ConflictPolicy;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;

/// The result of a copy+verify operation.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyVerifyResult {
    /// The final destination path (may differ from the requested one if a
    /// collision was renamed by the conflict resolver).
    pub destination: String,
    pub source_hash: String,
    pub dest_hash: String,
    pub bytes_copied: u64,
    /// True when source + dest SHA-256 match (the operation succeeded).
    pub verified: bool,
}

/// Copy a source file to a destination with SHA-256 verification.
///
/// The copy goes to a temporary file first, then is renamed to the final
/// destination (atomic where the filesystem supports it). The destination
/// is resolved via the shared conflict resolver (default Rename — never
/// silent overwrite). The source is never modified or deleted.
///
/// `should_cancel` is polled during the copy; if it returns true, the
/// partial temp file is deleted + an AbortError is returned.
///
/// `on_progress` is called periodically with bytes copied + total.
pub fn copy_and_verify(
    source: &Path,
    dest_dir: &Path,
    file_name: &str,
    policy: ConflictPolicy,
    should_cancel: &dyn Fn() -> bool,
    on_progress: &dyn Fn(u64, u64),
) -> Result<CopyVerifyResult> {
    if !source.is_file() {
        return Err(AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "The source file doesn't exist or isn't a regular file.",
        )
        .technical(format!("source: {}", source.display()))
        .build());
    }
    // Ensure the destination directory exists.
    std::fs::create_dir_all(dest_dir).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't create the destination folder.",
        )
        .technical(e.to_string())
        .build()
    })?;
    // Resolve the final destination via the shared conflict resolver.
    let requested = dest_dir.join(file_name);
    let final_dest = resolve_conflict(&requested, policy).ok_or_else(|| {
        AppError::builder(
            code::ALREADY_EXISTS,
            ErrorCategory::Filesystem,
            "The destination file already exists — skipped (conflict policy: skip).",
        )
        .technical(format!("dest: {}", requested.display()))
        .severity(ErrorSeverity::Warning)
        .build()
    })?;
    // Copy to a temp file in the destination dir first.
    let temp_path = dest_dir.join(format!(".paperu-copy-{}.tmp", uuid::Uuid::new_v4()));
    let total = source.metadata().map_or(0, |m| m.len());
    let source_hash;
    let bytes_copied;
    {
        let mut src = std::fs::File::open(source).map_err(|e| {
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't open the source file.",
            )
            .technical(e.to_string())
            .build()
        })?;
        let mut dst = std::fs::File::create(&temp_path).map_err(|e| {
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't create the temporary copy file.",
            )
            .technical(e.to_string())
            .build()
        })?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 65536].into_boxed_slice();
        let mut copied: u64 = 0;
        loop {
            if should_cancel() {
                let _ = std::fs::remove_file(&temp_path);
                return Err(AppError::builder(
                    code::TASK_CANCELLED,
                    ErrorCategory::Cancellation,
                    "The copy was cancelled — partial output cleaned up.",
                )
                .build());
            }
            let n = src.read(&mut buf).map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't read from the source during copy.",
                )
                .technical(e.to_string())
                .build()
            })?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            dst.write_all(&buf[..n]).map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't write to the destination during copy.",
                )
                .technical(e.to_string())
                .build()
            })?;
            copied += n as u64;
            on_progress(copied, total);
        }
        source_hash = hasher.finalize();
        bytes_copied = copied;
        // 90% §1B: flush + close the temp file BEFORE hashing it. If the OS
        // still has buffered writes, the hash would be wrong (verify-then-
        // close is a real bug). drop(dst) flushes + closes.
        dst.flush().map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't flush the temporary copy.",
            )
            .technical(e.to_string())
            .build()
        })?;
    } // dst dropped here → flushed + closed.
      // 90% §1B: hash the TEMP file (NOT the final dest) + compare BEFORE the
      // rename. Only finalize (rename) after verification succeeds. Never
      // return success with verified: false.
    let dest_hash = hash_file(&temp_path)?;
    if source_hash.as_slice() != dest_hash.as_slice() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "SHA-256 mismatch — the copied bytes don't match the source. The temp output was deleted; nothing was finalized.",
        )
        .technical(format!(
            "source={} dest={}",
            hex(&source_hash),
            hex(&dest_hash)
        ))
        .build());
    }
    // Verified — finalize the atomic rename.
    std::fs::rename(&temp_path, &final_dest).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't finalize the copy (rename temp → dest).",
        )
        .technical(e.to_string())
        .build()
    })?;
    Ok(CopyVerifyResult {
        destination: final_dest.to_string_lossy().to_string(),
        source_hash: hex(&source_hash),
        dest_hash: hex(&dest_hash),
        bytes_copied,
        verified: true,
    })
}

fn hash_file(path: &Path) -> Result<[u8; 32]> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't open the destination for verification.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536].into_boxed_slice();
    loop {
        let n = f.read(&mut buf).map_err(|e| {
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't read the destination for verification.",
            )
            .technical(e.to_string())
            .build()
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().into())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_and_verify_round_trips_with_matching_hash() {
        let tmp = std::env::temp_dir().join(format!("paperu-cv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("source.bin");
        let payload = b"hello-paperu-verify-me-12345";
        std::fs::write(&src, payload).unwrap();
        let dest_dir = tmp.join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let result = copy_and_verify(
            &src,
            &dest_dir,
            "source.bin",
            ConflictPolicy::Rename,
            &|| false,
            &|_, _| {},
        )
        .unwrap();
        assert!(result.verified, "source + dest SHA-256 must match");
        assert_eq!(result.bytes_copied, payload.len() as u64);
        assert_eq!(std::fs::read(&result.destination).unwrap(), payload);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn copy_and_verify_never_overwrites_existing() {
        let tmp = std::env::temp_dir().join(format!("paperu-cv-collide-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("src.bin");
        std::fs::write(&src, b"incoming").unwrap();
        let dest_dir = tmp.join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(dest_dir.join("src.bin"), b"pre-existing").unwrap();
        let result = copy_and_verify(
            &src,
            &dest_dir,
            "src.bin",
            ConflictPolicy::Rename,
            &|| false,
            &|_, _| {},
        )
        .unwrap();
        // The pre-existing file is untouched; the incoming went to "src (1).bin".
        assert_eq!(
            std::fs::read(dest_dir.join("src.bin")).unwrap(),
            b"pre-existing"
        );
        assert!(result.destination.ends_with("src (1).bin"));
        assert_eq!(std::fs::read(&result.destination).unwrap(), b"incoming");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn copy_and_verify_cancellation_cleans_up_temp() {
        let tmp = std::env::temp_dir().join(format!("paperu-cv-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("src.bin");
        std::fs::write(&src, b"x".repeat(1024)).unwrap();
        let dest_dir = tmp.join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let result = copy_and_verify(
            &src,
            &dest_dir,
            "src.bin",
            ConflictPolicy::Rename,
            &|| true,
            &|_, _| {}, // always cancel
        );
        assert!(result.is_err(), "cancellation returns an error");
        // No temp file left behind.
        assert!(
            dest_dir.read_dir().unwrap().count() == 0,
            "no partial output"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn copy_and_verify_skip_policy_returns_already_exists() {
        let tmp = std::env::temp_dir().join(format!("paperu-cv-skip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("src.bin");
        std::fs::write(&src, b"incoming").unwrap();
        let dest_dir = tmp.join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(dest_dir.join("src.bin"), b"pre-existing").unwrap();
        let result = copy_and_verify(
            &src,
            &dest_dir,
            "src.bin",
            ConflictPolicy::Skip,
            &|| false,
            &|_, _| {},
        );
        assert!(result.is_err(), "skip policy returns an error on collision");
        // The pre-existing file is untouched.
        assert_eq!(
            std::fs::read(dest_dir.join("src.bin")).unwrap(),
            b"pre-existing"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }
}
