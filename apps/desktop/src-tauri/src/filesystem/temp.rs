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

use crate::errors::{AppError, Result};

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

/// Atomically finalize a temp output into its destination.
///
/// **Deprecated for new code** — use `crate::filesystem::publish::publish`
/// or `publish_bytes` instead, which stage the temp file in the
/// destination directory (same-volume → truly atomic on all platforms).
///
/// This function is retained for backwards-compatibility. It wraps the
/// new `publish` primitive: if the temp is in the same directory as the
/// destination, the rename is atomic; if not (cross-volume), we copy
/// the temp into a destination-local staging path first, then publish.
/// On error the destination is never left partial.
pub fn atomic_finalize(temp: &Path, dest: &Path, overwrite: bool) -> Result<()> {
    // Fast path: temp is already in dest's directory.
    let temp_parent = temp.parent();
    let dest_parent = dest.parent();
    if temp_parent == dest_parent {
        return crate::filesystem::publish::publish(temp, dest, overwrite);
    }
    // Slow path: temp is elsewhere (e.g. OS temp dir). Stage it
    // destination-locally first, then publish — same-volume atomic.
    let dest_dir = dest.parent().unwrap_or(Path::new("."));
    let ext = dest.extension().and_then(|e| e.to_str()).unwrap_or("tmp");
    let local_temp = crate::filesystem::publish::stage_path(dest_dir, ext)?;
    fs::copy(temp, &local_temp).map_err(|e| {
        let _ = fs::remove_file(&local_temp);
        AppError::from(e)
    })?;
    crate::filesystem::publish::publish(&local_temp, dest, overwrite)?;
    // The original temp (if any) is no longer needed — remove it.
    let _ = fs::remove_file(temp);
    Ok(())
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
