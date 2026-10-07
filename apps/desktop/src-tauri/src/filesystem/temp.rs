//! Temporary-file & crash-recovery management.
//!
//! Paperu writes outputs to a temporary location first, validates
//! them, then atomically moves them into place. This module owns the
//! temp workspace and the startup cleanup pass that removes stale
//! partial outputs left by a crash or interruption.
//!
//! See docs/architecture/crash-recovery.md for the full design.

use std::fs;
use std::path::{Path, PathBuf};

use tracing::{info, warn};

use crate::errors::{code, AppError, ErrorCategory, Result};

/// A managed temporary workspace for Paperu.
pub struct TempWorkspace {
    root: PathBuf,
}

impl TempWorkspace {
    /// Create/ensure the temp workspace under the OS temp dir.
    pub fn ensure() -> Result<Self> {
        let root = std::env::temp_dir().join("paperu");
        fs::create_dir_all(&root).map_err(AppError::from)?;
        Ok(Self { root })
    }

    /// Create a temp workspace under a custom root (for testing).
    #[cfg(test)]
    pub fn with_root(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(AppError::from)?;
        Ok(Self { root })
    }

    /// The root of the workspace.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Allocate a unique temp file path (not yet created).
    pub fn new_file(&self, suffix: &str) -> PathBuf {
        let id = uuid::Uuid::new_v4();
        let name = format!("paperu-{id}{suffix}");
        self.root.join(name)
    }

    /// Remove the entire workspace. Used by tests and explicit cleanup.
    pub fn purge(&self) -> Result<()> {
        if self.root.exists() {
            fs::remove_dir_all(&self.root).map_err(AppError::from)?;
        }
        Ok(())
    }

    /// Startup recovery: remove stale partial outputs from a previous
    /// run that crashed or was interrupted. Paperu never leaves
    /// partial outputs in the user's chosen location; leftovers live
    /// only here and are safe to discard.
    pub fn startup_cleanup(&self) -> Result<()> {
        let read = match fs::read_dir(&self.root) {
            Ok(r) => r,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(AppError::from(err)),
        };
        let mut removed = 0u32;
        for entry in read.flatten() {
            let p = entry.path();
            match fs::remove_file(&p) {
                Ok(()) => removed += 1,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    warn!(?p, error = %err, "failed to remove stale temp entry");
                }
            }
        }
        if removed > 0 {
            info!(removed, "cleaned stale temp files on startup");
        }
        Ok(())
    }
}

/// Atomically finalize a temp output into its destination: write to a
/// temp path, then rename into place. On Windows, `rename` across
/// volumes fails, so we fall back to copy+delete only when the caller
/// has explicitly accepted overwrite semantics. For the non-destructive
/// default, the destination must not already exist.
pub fn atomic_finalize(temp: &Path, dest: &Path, overwrite: bool) -> Result<()> {
    if dest.exists() && !overwrite {
        return Err(AppError::builder(
            code::ALREADY_EXISTS,
            ErrorCategory::Filesystem,
            "An output with that name already exists.",
        )
        .detail("Paperu never overwrites your files unless you explicitly choose to.")
        .technical(format!("destination exists: {}", dest.display()))
        .build());
    }
    // rename is atomic on the same filesystem.
    match fs::rename(temp, dest) {
        Ok(()) => Ok(()),
        Err(_err) if overwrite => {
            // Cross-volume fallback for explicit overwrite only.
            fs::copy(temp, dest).map_err(AppError::from)?;
            let _ = fs::remove_file(temp);
            Ok(())
        }
        Err(err) => Err(AppError::from(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_ws() -> TempWorkspace {
        let root = std::env::temp_dir().join(format!("paperu-test-{}", uuid::Uuid::new_v4()));
        TempWorkspace::with_root(root).expect("ensure")
    }

    #[test]
    fn temp_workspace_creates_and_cleans() {
        let ws = unique_ws();
        let file = ws.new_file(".tmp");
        fs::write(&file, b"paperu test").expect("write");
        assert!(file.exists());
        ws.startup_cleanup().expect("cleanup");
        assert!(!file.exists(), "stale temp file should be removed");
        ws.purge().expect("purge");
    }

    #[test]
    fn atomic_finalize_refuses_existing_without_overwrite() {
        let ws = unique_ws();
        let temp = ws.new_file(".tmp");
        fs::write(&temp, b"temp").expect("write");
        let dest = ws.new_file(".out");
        fs::write(&dest, b"existing").expect("write dest");
        let res = atomic_finalize(&temp, &dest, false);
        assert!(res.is_err(), "must refuse existing without overwrite");
        assert_eq!(fs::read(&dest).unwrap(), b"existing");
        ws.purge().expect("purge");
    }

    #[test]
    fn atomic_finalize_moves_when_clear() {
        let ws = unique_ws();
        let temp = ws.new_file(".tmp");
        fs::write(&temp, b"final").expect("write");
        let dest = ws.new_file(".out");
        let _ = fs::remove_file(&dest);
        atomic_finalize(&temp, &dest, false).expect("finalize");
        assert_eq!(fs::read(&dest).unwrap(), b"final");
        assert!(!temp.exists(), "temp must be consumed");
        ws.purge().expect("purge");
    }
}
