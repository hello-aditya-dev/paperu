//! Shared destination-collision resolver (90% §6).
//!
//! Every file-move/copy/extract/backup/USB operation MUST use this to
//! decide the final destination when the target already exists. The
//! default is RENAME (never silent overwrite); SKIP is opt-in; explicit
//! Overwrite requires a separate, deliberate user-approved call path.
//!
//! Used by: Folder Organizer, Archive extract, USB copy+verify, Backup
//! Recipes, and any future file-producing operation.

use std::path::{Path, PathBuf};

/// The collision policy. Overwrite is deliberately NOT a default — it
/// requires explicit per-action user approval at the call site.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Find a non-colliding name like "name (1).ext" (default).
    Rename,
    /// Skip the file entirely when the destination exists.
    Skip,
}

impl Default for ConflictPolicy {
    fn default() -> Self {
        ConflictPolicy::Rename
    }
}

/// Resolve the final destination for a file, given a collision policy.
///
/// - No collision → returns the original `dest`.
/// - Collision + Rename → returns a non-colliding renamed path
///   ("name (1).ext", "name (2).ext", …).
/// - Collision + Skip → returns None (the caller skips the file).
///
/// Never overwrites silently. Overwrite requires the caller to bypass
/// this function with explicit user approval.
pub fn resolve_conflict(dest: &Path, policy: ConflictPolicy) -> Option<PathBuf> {
    if !dest.exists() {
        return Some(dest.to_path_buf());
    }
    match policy {
        ConflictPolicy::Skip => None,
        ConflictPolicy::Rename => Some(renamed_destination(dest)),
    }
}

/// Find a non-colliding destination by appending " (N)" before the extension.
/// Tries N = 1, 2, 3, … up to 9999. Returns the original if all collide
/// (extremely unlikely; the caller treats it as a write).
fn renamed_destination(dest: &Path) -> PathBuf {
    let parent = dest.parent().unwrap_or_else(|| Path::new(""));
    let stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = dest.extension().and_then(|s| s.to_str());
    for n in 1..=9999u32 {
        let new_stem = format!("{stem} ({n})");
        let candidate = match ext {
            Some(e) => parent.join(format!("{new_stem}.{e}")),
            None => parent.join(new_stem),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    // Fallback: all 9999 names collide — return the original (the caller
    // will get a write error, which is reported, not a silent overwrite).
    dest.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_collision_returns_original() {
        let tmp = std::env::temp_dir().join(format!("paperu-conflict-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("newfile.txt");
        let r = resolve_conflict(&dest, ConflictPolicy::Rename);
        assert_eq!(r.as_deref(), Some(&*dest));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn rename_finds_non_colliding_name() {
        let tmp = std::env::temp_dir().join(format!("paperu-conflict-r-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("doc.pdf");
        std::fs::write(&dest, b"original").unwrap();
        let r = resolve_conflict(&dest, ConflictPolicy::Rename).unwrap();
        assert_eq!(r, tmp.join("doc (1).pdf"));
        assert!(!r.exists(), "the renamed target must not exist yet");
        // Pre-create "(1)" too → resolver should find "(2)".
        std::fs::write(tmp.join("doc (1).pdf"), b"first").unwrap();
        let r2 = resolve_conflict(&dest, ConflictPolicy::Rename).unwrap();
        assert_eq!(r2, tmp.join("doc (2).pdf"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn skip_returns_none_on_collision() {
        let tmp = std::env::temp_dir().join(format!("paperu-conflict-s-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("exists.txt");
        std::fs::write(&dest, b"x").unwrap();
        assert_eq!(resolve_conflict(&dest, ConflictPolicy::Skip), None);
        // The existing file is untouched.
        assert_eq!(std::fs::read(&dest).unwrap(), b"x");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn rename_preserves_no_extension() {
        let tmp =
            std::env::temp_dir().join(format!("paperu-conflict-noext-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("README");
        std::fs::write(&dest, b"x").unwrap();
        let r = resolve_conflict(&dest, ConflictPolicy::Rename).unwrap();
        assert_eq!(r, tmp.join("README (1)"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn default_policy_is_rename() {
        assert_eq!(ConflictPolicy::default(), ConflictPolicy::Rename);
    }
}
