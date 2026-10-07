#![allow(warnings)]
//! Folder Organizer — rules-based file automation (Feature 11).
//! 50%: DB-persisted rules, dry-run preview, move/copy actions.
//! No automatic deletion at 50%.

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use rusqlite::params;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerRule {
    pub id: Option<String>,
    pub name: String,
    pub source_folder: String,
    pub dest_folder: String,
    pub condition_type: String,
    pub condition_value: String,
    pub action: String,                  // move|copy
    pub conflict_policy: Option<String>, // "rename" (default) | "skip"
    pub enabled: Option<bool>,
    pub sort_order: Option<i64>,
}

/// Resolve the rule's conflict policy string to the enum (default Rename).
fn policy_of(rule: &OrganizerRule) -> crate::filesystem::ConflictPolicy {
    match rule.conflict_policy.as_deref().unwrap_or("rename") {
        "skip" => crate::filesystem::ConflictPolicy::Skip,
        _ => crate::filesystem::ConflictPolicy::Rename,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DryRunResult {
    pub matched_files: Vec<MatchedFile>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedFile {
    pub path: String,
    pub name: String,
    pub matches: bool,
    pub action: String,
    pub dest_path: String,
}

/// Preview what a rule would do. Does NOT touch the filesystem.
pub fn dry_run(rule: &OrganizerRule) -> Result<DryRunResult> {
    let src = Path::new(&rule.source_folder);
    if !src.is_dir() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Source folder doesn't exist.",
        )
        .build());
    }
    let dest = Path::new(&rule.dest_folder);
    let mut matched = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    for entry in std::fs::read_dir(src).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't read the folder.",
        )
        .technical(e.to_string())
        .build()
    })? {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let matches = match rule.condition_type.as_str() {
            "extension" => path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case(&rule.condition_value))
                .unwrap_or(false),
            "filename_contains" => name
                .to_lowercase()
                .contains(&rule.condition_value.to_lowercase()),
            "prefix" => name.starts_with(&rule.condition_value),
            "suffix" => name.ends_with(&rule.condition_value),
            _ => false,
        };
        if matches {
            let dest_path = dest.join(&name);
            matched.push(MatchedFile {
                path: path.to_string_lossy().to_string(),
                name: name.clone(),
                matches: true,
                action: rule.action.clone(),
                dest_path: dest_path.to_string_lossy().to_string(),
            });
        } else {
            skipped.push(name);
        }
    }
    Ok(DryRunResult {
        matched_files: matched,
        skipped,
        errors,
    })
}

/// Result of running an organizer rule for real (execute).
/// Each matched file is either moved/copied (succeeded) or reported
/// with the error that stopped it (failed). The batch never aborts on a
/// single file failure — one bad file doesn't stop the rest.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    pub succeeded: Vec<MatchedFile>,
    pub failed: Vec<ExecuteFailure>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteFailure {
    pub path: String,
    pub name: String,
    pub error: String,
}

/// Run a rule against the filesystem for real. Performs the configured
/// action (move/copy) on every matched file. The destination folder is
/// created if missing. Cross-volume moves fall back to copy+delete
/// (std::fs::rename fails across filesystem boundaries on Windows).
///
/// Source safety (§22): the original is only removed on a successful
/// move. A failed move leaves the source untouched. A copy never
/// touches the source.
pub fn execute(rule: &OrganizerRule) -> Result<ExecuteResult> {
    let src = Path::new(&rule.source_folder);
    if !src.is_dir() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Source folder doesn't exist.",
        )
        .build());
    }
    let dest = Path::new(&rule.dest_folder);
    // Create the destination folder if it's missing — a rule shouldn't
    // fail just because the user hasn't made the target folder yet.
    if !dest.exists() {
        std::fs::create_dir_all(dest).map_err(|e| {
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't create the destination folder.",
            )
            .technical(e.to_string())
            .build()
        })?;
    }

    // Reuse the dry-run matcher to decide which files to act on.
    let preview = dry_run(rule)?;
    let policy = policy_of(rule);
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();

    for file in preview.matched_files.into_iter() {
        let from = Path::new(&file.path);
        let to = Path::new(&file.dest_path);
        // Skip directories — only act on files.
        if !from.is_file() {
            failed.push(ExecuteFailure {
                path: file.path.clone(),
                name: file.name.clone(),
                error: "Not a regular file.".to_string(),
            });
            continue;
        }
        // Collision-safe destination (90% §6). Default Rename never
        // overwrites; Skip returns None. Overwrite is NOT offered here.
        let final_dest = match crate::filesystem::resolve_conflict(to, policy) {
            Some(p) => p,
            None => {
                failed.push(ExecuteFailure {
                    path: file.path.clone(),
                    name: file.name.clone(),
                    error: "Destination exists — skipped (conflict policy: skip).".to_string(),
                });
                continue;
            }
        };
        let outcome = match rule.action.as_str() {
            "move" => move_file(from, &final_dest),
            "copy" => std::fs::copy(from, &final_dest).map(|_| ()),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Unknown action",
            )),
        };
        match outcome {
            Ok(()) => {
                // Report the final destination (which may differ from the
                // dry-run dest_path if a collision was renamed).
                let mut out = file;
                out.dest_path = final_dest.to_string_lossy().to_string();
                succeeded.push(out);
            }
            Err(e) => failed.push(ExecuteFailure {
                path: file.path,
                name: file.name,
                error: e.to_string(),
            }),
        }
    }
    Ok(ExecuteResult { succeeded, failed })
}

/// Move a file, falling back to copy+delete across volumes. std::fs::rename
/// is atomic on the same filesystem but fails across volume boundaries
/// (e.g. C: → D: on Windows, / → /mnt on Linux). The fallback preserves
/// source-safety: the source is only removed after a successful copy.
///
/// Uses the portable `ErrorKind::CrossesDevices` (stable since Rust 1.85)
/// rather than a raw OS error code, so the fallback triggers correctly on
/// both Windows (ERROR_NOT_SAME_DEVICE) and Linux (EXDEV).
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {
            // Cross-device link — fall back to copy + remove.
            std::fs::copy(from, to)?;
            std::fs::remove_file(from)?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

// ── DB CRUD ─────────────────────────────────────────────────────

pub fn save_rule(db: &Database, rule: &OrganizerRule) -> Result<String> {
    db.with_conn(|conn| {
        let id = rule
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_iso(conn)?;
        let enabled = if rule.enabled.unwrap_or(true) { 1 } else { 0 };
        let sort = rule.sort_order.unwrap_or(0);
        conn.execute(
            "INSERT OR REPLACE INTO organizer_rule
                (id, name, source_folder, dest_folder, condition_type,
                 condition_value, action, conflict_policy, enabled, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                rule.name,
                rule.source_folder,
                rule.dest_folder,
                rule.condition_type,
                rule.condition_value,
                rule.action,
                rule.conflict_policy,
                enabled,
                sort,
                now
            ],
        )
        .map_err(map_sqlite)?;
        Ok(id)
    })
}

pub fn list_rules(db: &Database) -> Result<Vec<OrganizerRule>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, source_folder, dest_folder, condition_type,
                    condition_value, action, conflict_policy, enabled, sort_order
             FROM organizer_rule ORDER BY sort_order",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map([], |r| {
                let enabled_int: i64 = r.get(8)?;
                Ok(OrganizerRule {
                    id: Some(r.get(0)?),
                    name: r.get(1)?,
                    source_folder: r.get(2)?,
                    dest_folder: r.get(3)?,
                    condition_type: r.get(4)?,
                    condition_value: r.get(5)?,
                    action: r.get(6)?,
                    conflict_policy: r.get(7)?,
                    enabled: Some(enabled_int != 0),
                    sort_order: Some(r.get(9)?),
                })
            })
            .map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

pub fn delete_rule(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM organizer_rule WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

fn now_iso(conn: &rusqlite::Connection) -> Result<String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
        r.get(0)
    })
    .map_err(map_sqlite)
}

fn map_sqlite(err: rusqlite::Error) -> AppError {
    AppError::builder(
        code::DATABASE_UNAVAILABLE,
        ErrorCategory::Database,
        "Paperu could not read or write organizer rules.",
    )
    .technical(err.to_string())
    .severity(ErrorSeverity::Error)
    .recoverability(Recoverability::Retryable)
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;

    fn fresh_db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    #[test]
    fn dry_run_extension_match() {
        let tmp = std::env::temp_dir().join(format!("paperu-org-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("a.pdf"), b"x").unwrap();
        std::fs::write(tmp.join("b.txt"), b"y").unwrap();
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        let rule = OrganizerRule {
            id: None,
            name: "PDFs".to_string(),
            source_folder: tmp.to_string_lossy().to_string(),
            dest_folder: dest.to_string_lossy().to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "move".to_string(),
            conflict_policy: None,
            enabled: Some(true),
            sort_order: None,
        };
        let result = dry_run(&rule).unwrap();
        assert_eq!(result.matched_files.len(), 1);
        assert_eq!(result.matched_files[0].name, "a.pdf");
        assert_eq!(result.skipped.len(), 1);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_list_delete_rule() {
        let db = fresh_db();
        let rule = OrganizerRule {
            id: None,
            name: "Test".to_string(),
            source_folder: "/tmp/src".to_string(),
            dest_folder: "/tmp/dst".to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "move".to_string(),
            conflict_policy: None,
            enabled: Some(true),
            sort_order: None,
        };
        let id = save_rule(&db, &rule).unwrap();
        assert_eq!(list_rules(&db).unwrap().len(), 1);
        delete_rule(&db, &id).unwrap();
        assert_eq!(list_rules(&db).unwrap().len(), 0);
    }

    #[test]
    fn execute_moves_matched_files_and_leaves_unmatched() {
        let tmp = std::env::temp_dir().join(format!("paperu-exec-{}", uuid::Uuid::new_v4()));
        let src = tmp.join("src");
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(src.join("a.pdf"), b"pdf-bytes").unwrap();
        std::fs::write(src.join("b.txt"), b"txt-bytes").unwrap();

        let rule = OrganizerRule {
            id: None,
            name: "PDFs".to_string(),
            source_folder: src.to_string_lossy().to_string(),
            dest_folder: dest.to_string_lossy().to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "move".to_string(),
            conflict_policy: None,
            enabled: Some(true),
            sort_order: None,
        };
        let result = execute(&rule).unwrap();
        assert_eq!(result.succeeded.len(), 1, "one file should have moved");
        assert_eq!(result.failed.len(), 0);
        assert_eq!(result.succeeded[0].name, "a.pdf");
        // Source-safety: the matched file is gone from source, in dest.
        assert!(
            !src.join("a.pdf").exists(),
            "moved file must be gone from source"
        );
        assert!(dest.join("a.pdf").exists(), "moved file must be in dest");
        // Unmatched file is untouched in source.
        assert!(
            src.join("b.txt").exists(),
            "unmatched file must stay in source"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn execute_creates_dest_folder_if_missing() {
        let tmp = std::env::temp_dir().join(format!("paperu-exec-mkdir-{}", uuid::Uuid::new_v4()));
        let src = tmp.join("src");
        let dest = tmp.join("nested").join("dest");
        std::fs::create_dir_all(&src).unwrap();
        // dest deliberately NOT created.
        std::fs::write(src.join("x.pdf"), b"x").unwrap();
        let rule = OrganizerRule {
            id: None,
            name: "PDFs".to_string(),
            source_folder: src.to_string_lossy().to_string(),
            dest_folder: dest.to_string_lossy().to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "copy".to_string(),
            conflict_policy: None,
            enabled: Some(true),
            sort_order: None,
        };
        let result = execute(&rule).unwrap();
        assert_eq!(result.succeeded.len(), 1);
        assert!(dest.exists(), "execute must create the destination folder");
        assert!(dest.join("x.pdf").exists());
        // Copy leaves the source untouched (source-safety).
        assert!(
            src.join("x.pdf").exists(),
            "copy must not remove the source"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn execute_directory_collision_is_renamed_around() {
        // 90% §6: a same-named DIRECTORY at the destination no longer blocks
        // the move — the shared conflict resolver renames the incoming file
        // to "blocked (1).pdf" so the batch completes. (Previously a
        // directory collision was a per-file failure; the conflict resolver
        // makes it a success.)
        let tmp =
            std::env::temp_dir().join(format!("paperu-exec-dircollide-{}", uuid::Uuid::new_v4()));
        let src = tmp.join("src");
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(src.join("ok.pdf"), b"ok").unwrap();
        std::fs::write(src.join("blocked.pdf"), b"blocked-content").unwrap();
        // Make dest/blocked.pdf a directory — a same-name collision.
        std::fs::create_dir_all(dest.join("blocked.pdf")).unwrap();
        let rule = OrganizerRule {
            id: None,
            name: "PDFs".to_string(),
            source_folder: src.to_string_lossy().to_string(),
            dest_folder: dest.to_string_lossy().to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "move".to_string(),
            conflict_policy: None, // default rename
            enabled: Some(true),
            sort_order: None,
        };
        let result = execute(&rule).unwrap();
        // Both files succeed — the directory collision is renamed around.
        assert_eq!(
            result.succeeded.len(),
            2,
            "both files move (collision renamed)"
        );
        // ok.pdf went to dest/ok.pdf.
        assert!(dest.join("ok.pdf").is_file());
        // blocked.pdf went to dest/blocked (1).pdf; the directory is untouched.
        assert!(
            dest.join("blocked.pdf").is_dir(),
            "the directory collision is untouched"
        );
        assert!(
            dest.join("blocked (1).pdf").is_file(),
            "the incoming file is renamed"
        );
        assert_eq!(
            std::fs::read(dest.join("blocked (1).pdf")).unwrap(),
            b"blocked-content"
        );
        // Both source files are gone (moved).
        assert!(!src.join("ok.pdf").exists());
        assert!(!src.join("blocked.pdf").exists());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn execute_default_rename_never_overwrites_destination() {
        // 90% §6: a collision must NEVER silently overwrite. The default
        // policy (rename) writes the incoming file to "name (1).ext"; the
        // existing destination's content is untouched.
        let tmp =
            std::env::temp_dir().join(format!("paperu-collision-rename-{}", uuid::Uuid::new_v4()));
        let src = tmp.join("src");
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(src.join("a.pdf"), b"INCOMING").unwrap();
        // Pre-create the collision at the destination with different content.
        std::fs::write(dest.join("a.pdf"), b"PRE-EXISTING").unwrap();
        let rule = OrganizerRule {
            id: None,
            name: "PDFs".to_string(),
            source_folder: src.to_string_lossy().to_string(),
            dest_folder: dest.to_string_lossy().to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "move".to_string(),
            conflict_policy: None, // default → rename
            enabled: Some(true),
            sort_order: None,
        };
        let result = execute(&rule).unwrap();
        assert_eq!(
            result.succeeded.len(),
            1,
            "the incoming file is moved (renamed)"
        );
        // The pre-existing content is UNTOUCHED.
        assert_eq!(std::fs::read(dest.join("a.pdf")).unwrap(), b"PRE-EXISTING");
        // The incoming file landed at "a (1).pdf" with its content.
        assert_eq!(std::fs::read(dest.join("a (1).pdf")).unwrap(), b"INCOMING");
        // The succeeded entry reports the FINAL (renamed) destination.
        assert!(
            result.succeeded[0].dest_path.ends_with("a (1).pdf"),
            "report the renamed destination"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn execute_skip_policy_leaves_existing_untouched() {
        // 90% §6: the skip policy leaves the existing destination untouched
        // AND the source in place (the file is skipped, not moved).
        let tmp =
            std::env::temp_dir().join(format!("paperu-collision-skip-{}", uuid::Uuid::new_v4()));
        let src = tmp.join("src");
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(src.join("a.pdf"), b"INCOMING").unwrap();
        std::fs::write(dest.join("a.pdf"), b"PRE-EXISTING").unwrap();
        let rule = OrganizerRule {
            id: None,
            name: "PDFs".to_string(),
            source_folder: src.to_string_lossy().to_string(),
            dest_folder: dest.to_string_lossy().to_string(),
            condition_type: "extension".to_string(),
            condition_value: "pdf".to_string(),
            action: "move".to_string(),
            conflict_policy: Some("skip".to_string()),
            enabled: Some(true),
            sort_order: None,
        };
        let result = execute(&rule).unwrap();
        assert_eq!(
            result.succeeded.len(),
            0,
            "the collision is skipped, not moved"
        );
        assert!(
            result.failed.iter().any(|f| f.name == "a.pdf"),
            "reported as skipped"
        );
        // Both files are untouched.
        assert_eq!(std::fs::read(dest.join("a.pdf")).unwrap(), b"PRE-EXISTING");
        assert_eq!(std::fs::read(src.join("a.pdf")).unwrap(), b"INCOMING");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
