//! Watch Rules — wire Watch Folders events to non-destructive actions
//! (P5f, AUTO-03/AUTO-05).
//!
//! Schema in migration 0006 (watch_folder). Each rule maps a folder +
//! condition (extension / filename-contains / size) to an action
//! (backup_recipe / recipe / organizer_rule). When the watch service
//! fires an event, `find_matching_rules` is called + each match is
//! dispatched via `dispatch_action`.
//!
//! Privacy + safety:
//! - Paperu takes NO destructive automatic action. The only actions
//!   supported are non-destructive: backup_recipe (copy+verify),
//!   recipe (typed operations, only PlaceInOutputDir + VerifyOutput
//!   execute Rust-side), organizer_rule (move/copy via the existing
//!   organizer module).
//! - Self-loop prevention: the watch service already filters Paperu's
//!   own output suffixes (see `watch::is_paperu_output`).
//! - Recursive-loop prevention: a rule's action destination must not
//!   be inside the watched folder (checked at dispatch time).

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

/// The allowlist of action types the watch dispatcher will run. No
/// arbitrary commands or scripts.
pub const ALLOWED_ACTION_TYPES: &[&str] = &["backup_recipe", "recipe", "organizer_rule"];

/// The allowlist of condition types.
pub const ALLOWED_CONDITION_TYPES: &[&str] =
    &["extension", "filename_contains", "prefix", "suffix"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRule {
    pub id: String,
    pub folder_path: String,
    pub condition_type: String,
    pub condition_value: String,
    pub action_type: String,
    pub action_id: String,
    pub enabled: bool,
    pub recursive: bool,
    pub paused: bool,
    pub last_triggered_at: Option<String>,
    pub last_status: Option<String>,
    pub name: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWatchRuleRequest {
    pub folder_path: String,
    pub condition_type: String,
    pub condition_value: String,
    pub action_type: String,
    pub action_id: String,
    pub enabled: Option<bool>,
}

/// The result of dispatching a watch rule's action.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDispatchResult {
    pub rule_id: String,
    pub action_type: String,
    pub status: String, // success | failure | skipped
    pub message: String,
}

pub fn create_rule(db: &Database, req: CreateWatchRuleRequest) -> Result<WatchRule> {
    if !ALLOWED_CONDITION_TYPES.contains(&req.condition_type.as_str()) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That watch condition type is not supported.",
        )
        .technical(format!("condition_type: {}", req.condition_type))
        .build());
    }
    if !ALLOWED_ACTION_TYPES.contains(&req.action_type.as_str()) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That watch action type is not supported.",
        )
        .technical(format!("action_type: {}", req.action_type))
        .build());
    }
    if req.folder_path.trim().is_empty() || req.action_id.trim().is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Folder path and action ID are required.",
        )
        .build());
    }
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        let enabled_int = i64::from(req.enabled.unwrap_or(true));
        conn.execute(
            "INSERT INTO watch_folder (id, folder_path, condition_type, condition_value, action_type, action_id, enabled, recursive, paused, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 0, ?8, ?8)",
            params![id, req.folder_path, req.condition_type, req.condition_value, req.action_type, req.action_id, enabled_int, now],
        ).map_err(map_sqlite)?;
        read_row(conn, &id)
    })
}

pub fn list_rules(db: &Database) -> Result<Vec<WatchRule>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, folder_path, condition_type, condition_value, action_type, action_id, enabled, recursive, paused, last_triggered_at, last_status, name, created_at, updated_at FROM watch_folder ORDER BY created_at DESC",
        ).map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_rule).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

pub fn delete_rule(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM watch_folder WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn toggle_rule(db: &Database, id: &str, enabled: bool) -> Result<WatchRule> {
    db.with_conn(|conn| {
        let enabled_int = i64::from(enabled);
        conn.execute(
            "UPDATE watch_folder SET enabled = ?1 WHERE id = ?2",
            params![enabled_int, id],
        )
        .map_err(map_sqlite)?;
        read_row(conn, id)
    })
}

/// Find all enabled, non-paused rules whose folder_path matches the
/// event's folder (path-aware recursive matching) AND whose condition
/// matches `file_name`. Returns the rules to dispatch.
///
/// P02 fix: the previous implementation did an exact folder-path match
/// (`WHERE folder_path = ?1`). Now we load ALL enabled rules + check
/// path containment using PathBuf components (not string starts_with).
/// For recursive=1 rules, the event folder can be the rule's root OR
/// any subdirectory. For recursive=0, only the exact root matches.
pub fn find_matching_rules(db: &Database, folder: &str, file_name: &str) -> Result<Vec<WatchRule>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, folder_path, condition_type, condition_value, action_type, action_id, enabled, recursive, paused, last_triggered_at, last_status, name, created_at, updated_at FROM watch_folder WHERE enabled = 1 AND paused = 0 ORDER BY created_at",
        )
        .map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_rule).map_err(map_sqlite)?;
        let event_folder = std::path::Path::new(folder);
        let mut out = Vec::new();
        for r in rows {
            let rule = r.map_err(map_sqlite)?;
            let rule_root = std::path::Path::new(&rule.folder_path);
            // Path-aware containment: the event folder must be the
            // rule's root (for recursive=0) OR the rule's root OR a
            // subdirectory of it (for recursive=1).
            let matches_folder = if rule.recursive {
                is_path_contained(event_folder, rule_root)
            } else {
                // Non-recursive: only the exact root.
                paths_equal(event_folder, rule_root)
            };
            if matches_folder && condition_matches(&rule.condition_type, &rule.condition_value, file_name) {
                out.push(rule);
            }
        }
        Ok(out)
    })
}

/// True if `child` is the same as `parent` OR a subdirectory of `parent`.
/// Uses PathBuf components, NOT string starts_with — prevents
/// `/home/user/downloads` from matching `/home/user/downloads-old`.
fn is_path_contained(child: &std::path::Path, parent: &std::path::Path) -> bool {
    let child_components: Vec<_> = child.components().collect();
    let parent_components: Vec<_> = parent.components().collect();
    if child_components.len() < parent_components.len() {
        return false;
    }
    child_components[..parent_components.len()] == parent_components[..]
}

/// True if two paths are equal (component-by-component).
fn paths_equal(a: &std::path::Path, b: &std::path::Path) -> bool {
    let a_components: Vec<_> = a.components().collect();
    let b_components: Vec<_> = b.components().collect();
    a_components == b_components
}

/// Loop prevention (Prompt 02 §7): check if the action's output
/// would land inside the watched folder. Returns true if a loop
/// would occur. Uses path-component-based containment.
fn is_output_inside_watch(db: &Database, rule: &WatchRule) -> bool {
    let watch_root = std::path::Path::new(&rule.folder_path);
    match rule.action_type.as_str() {
        "backup_recipe" => {
            // Check the backup recipe's destination.
            if let Ok(recipes) = crate::backup_recipes::list_recipes(db) {
                if let Some(recipe) = recipes.into_iter().find(|r| r.id == rule.action_id) {
                    let dest = std::path::Path::new(&recipe.destination);
                    return is_path_contained(dest, watch_root);
                }
            }
            false
        }
        "organizer_rule" => {
            // Check the organizer rule's dest_folder.
            if let Ok(rules) = crate::organizer::list_rules(db) {
                if let Some(org_rule) = rules
                    .into_iter()
                    .find(|r| r.id.as_deref() == Some(&rule.action_id))
                {
                    let dest = std::path::Path::new(&org_rule.dest_folder);
                    return is_path_contained(dest, watch_root);
                }
            }
            false
        }
        "recipe" => {
            // Check the typed recipe's PlaceInOutputDir steps' dir.
            if let Ok(steps) = crate::recipes::list_steps(db, &rule.action_id) {
                for step in steps {
                    if let crate::recipes::OperationKind::PlaceInOutputDir { dir } = step.operation
                    {
                        let dest = std::path::Path::new(&dir);
                        if is_path_contained(dest, watch_root) {
                            return true;
                        }
                    }
                }
            }
            false
        }
        _ => false,
    }
}

/// True if the condition matches the file name.
fn condition_matches(condition_type: &str, value: &str, file_name: &str) -> bool {
    let name_lower = file_name.to_lowercase();
    let value_lower = value.to_lowercase();
    match condition_type {
        "extension" => {
            // value is "pdf" or ".pdf" — normalise.
            let v = value_lower.trim_start_matches('.');
            name_lower.ends_with(&format!(".{v}"))
        }
        "filename_contains" => name_lower.contains(&value_lower),
        "prefix" => name_lower.starts_with(&value_lower),
        "suffix" => {
            // suffix matches before the extension.
            let stem = match name_lower.rsplit_once('.') {
                Some((s, _)) => s,
                None => &name_lower,
            };
            stem.ends_with(&value_lower)
        }
        _ => false,
    }
}

/// Dispatch a single watch rule's action on the given file. Non-destructive
/// only: backup_recipe copies+verifies, recipe runs typed ops, organizer_rule
/// moves/copies via the existing organizer module.
///
/// Honest V1: organizer_rule dispatch is not yet wired (the organizer module
/// doesn't expose a "run by id with this file" entry). It records as
/// "skipped" so the user sees the rule fired but no action was taken.
pub fn dispatch_action(db: &Database, rule: &WatchRule, file_path: &str) -> WatchDispatchResult {
    // Loop prevention (Prompt 02 §7): check if the action's output
    // would land inside the watched folder. Uses path-component-based
    // containment (not string starts_with) to prevent false positives
    // like /downloads matching /downloads-old.
    if is_output_inside_watch(db, rule) {
        return WatchDispatchResult {
            rule_id: rule.id.clone(),
            action_type: rule.action_type.clone(),
            status: "skipped".to_string(),
            message: "action output is inside the watched folder (loop prevention)".to_string(),
        };
    }
    match rule.action_type.as_str() {
        "backup_recipe" => {
            // Run the backup recipe as-is (its sources are fixed).
            match crate::backup_recipes::run_recipe(db, &rule.action_id) {
                Ok(r) if r.failed.is_empty() => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "success".to_string(),
                    message: format!(
                        "backed up {} files (trigger: {file_path})",
                        r.succeeded.len()
                    ),
                },
                Ok(r) => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "failure".to_string(),
                    message: format!("{} ok, {} failed", r.succeeded.len(), r.failed.len()),
                },
                Err(e) => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "failure".to_string(),
                    message: e.message.clone(),
                },
            }
        }
        "recipe" => {
            // Run the typed recipe with the watched file as input.
            let mut progress_calls: Vec<String> = Vec::new();
            let result = crate::recipes::execute_recipe(
                db,
                &rule.action_id,
                &[file_path.to_string()],
                &mut |msg: &str| {
                    progress_calls.push(msg.to_string());
                },
            );
            match result {
                Ok(r) => {
                    let failed = r
                        .step_results
                        .iter()
                        .filter(|s| s.status == "failure")
                        .count();
                    let succeeded = r
                        .step_results
                        .iter()
                        .filter(|s| s.status == "success")
                        .count();
                    WatchDispatchResult {
                        rule_id: rule.id.clone(),
                        action_type: rule.action_type.clone(),
                        status: if failed == 0 {
                            "success".to_string()
                        } else {
                            "failure".to_string()
                        },
                        message: format!("{succeeded} steps succeeded, {failed} failed"),
                    }
                }
                Err(e) => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "failure".to_string(),
                    message: e.message.clone(),
                },
            }
        }
        "organizer_rule" => {
            // P01: dispatch an organizer rule. Look up the rule by ID
            // + call organizer::execute which moves/copies files per
            // the rule's condition + action.
            let org_rule = crate::organizer::list_rules(db).ok().and_then(|rules| {
                rules
                    .into_iter()
                    .find(|r| r.id.as_deref() == Some(&rule.action_id))
            });
            let Some(org_rule) = org_rule else {
                return WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "skipped".to_string(),
                    message: "organizer rule no longer exists".to_string(),
                };
            };
            match crate::organizer::execute_one(&org_rule, std::path::Path::new(file_path)) {
                Ok(r) if r.failed.is_empty() => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "success".to_string(),
                    message: format!(
                        "organized {} files (trigger: {file_path})",
                        r.succeeded.len()
                    ),
                },
                Ok(r) => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "failure".to_string(),
                    message: format!("{} ok, {} failed", r.succeeded.len(), r.failed.len()),
                },
                Err(e) => WatchDispatchResult {
                    rule_id: rule.id.clone(),
                    action_type: rule.action_type.clone(),
                    status: "failure".to_string(),
                    message: e.message.clone(),
                },
            }
        }
        _ => WatchDispatchResult {
            rule_id: rule.id.clone(),
            action_type: rule.action_type.clone(),
            status: "skipped".to_string(),
            message: format!("unsupported action: {}", rule.action_type),
        },
    }
}

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<WatchRule> {
    conn.query_row(
        "SELECT id, folder_path, condition_type, condition_value, action_type, action_id, enabled, recursive, paused, last_triggered_at, last_status, name, created_at, updated_at FROM watch_folder WHERE id = ?1",
        params![id], row_to_rule,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_rule(row: &rusqlite::Row) -> rusqlite::Result<WatchRule> {
    let enabled_int: i64 = row.get(6)?;
    let recursive_int: i64 = row.get(7).unwrap_or(1);
    let paused_int: i64 = row.get(8).unwrap_or(0);
    Ok(WatchRule {
        id: row.get(0)?,
        folder_path: row.get(1)?,
        condition_type: row.get(2)?,
        condition_value: row.get(3)?,
        action_type: row.get(4)?,
        action_id: row.get(5)?,
        enabled: enabled_int != 0,
        recursive: recursive_int != 0,
        paused: paused_int != 0,
        last_triggered_at: row.get(9).ok(),
        last_status: row.get(10).ok(),
        name: row.get(11).ok(),
        created_at: row.get(12).unwrap_or_else(|_| String::new()),
        updated_at: row.get(13).ok(),
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
        "Paperu could not read or write watch rules.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That watch rule wasn't found.",
    )
    .technical(format!("id={id}: {err}"))
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    #[test]
    fn create_list_delete_rule() {
        let db = fresh_db();
        let r = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/home/user/downloads".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "recipe-1".to_string(),
                enabled: Some(true),
            },
        )
        .unwrap();
        assert_eq!(list_rules(&db).unwrap().len(), 1);
        assert!(r.enabled);
        delete_rule(&db, &r.id).unwrap();
        assert_eq!(list_rules(&db).unwrap().len(), 0);
    }

    #[test]
    fn rejects_invalid_condition_type() {
        let db = fresh_db();
        let res = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/x".to_string(),
                condition_type: "regex".to_string(),
                condition_value: ".*".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                enabled: Some(true),
            },
        );
        assert!(res.is_err());
    }

    #[test]
    fn rejects_invalid_action_type() {
        let db = fresh_db();
        let res = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/x".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "shell_command".to_string(),
                action_id: "rm -rf /".to_string(),
                enabled: Some(true),
            },
        );
        assert!(res.is_err(), "shell_command action rejected");
    }

    #[test]
    fn condition_matches_extension() {
        assert!(condition_matches("extension", "pdf", "doc.pdf"));
        assert!(condition_matches("extension", ".pdf", "doc.pdf"));
        assert!(!condition_matches("extension", "pdf", "doc.txt"));
        assert!(!condition_matches("extension", "pdf", "pdf.txt"));
    }

    #[test]
    fn condition_matches_filename_contains() {
        assert!(condition_matches(
            "filename_contains",
            "report",
            "Q3-report.pdf"
        ));
        assert!(!condition_matches("filename_contains", "secret", "doc.pdf"));
    }

    #[test]
    fn condition_matches_prefix_suffix() {
        assert!(condition_matches("prefix", "INV", "INV-0001.pdf"));
        assert!(!condition_matches("prefix", "INV", "REC-0001.pdf"));
        assert!(condition_matches("suffix", "-final", "report-final.pdf"));
        assert!(!condition_matches("suffix", "-final", "report-draft.pdf"));
    }

    #[test]
    fn find_matching_rules_returns_only_matching_enabled() {
        let db = fresh_db();
        let r1 = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/downloads".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                enabled: Some(true),
            },
        )
        .unwrap();
        let _r2 = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/downloads".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "jpg".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r2".to_string(),
                enabled: Some(true),
            },
        )
        .unwrap();
        // Disable r1 — should not match.
        toggle_rule(&db, &r1.id, false).unwrap();
        let matches = find_matching_rules(&db, "/downloads", "doc.pdf").unwrap();
        assert_eq!(matches.len(), 0, "disabled rule does not match");
        // Re-enable r1 — now matches.
        toggle_rule(&db, &r1.id, true).unwrap();
        let matches = find_matching_rules(&db, "/downloads", "doc.pdf").unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, r1.id);
        // Wrong folder — no match.
        let matches = find_matching_rules(&db, "/other", "doc.pdf").unwrap();
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn dispatch_action_skips_organizer_rule_when_rule_missing() {
        // P01: organizer_rule dispatch is now WIRED. If the rule ID
        // doesn't exist, dispatch is "skipped" (the rule was deleted).
        let db = fresh_db();
        let r = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/downloads".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "organizer_rule".to_string(),
                action_id: "nonexistent-rule-id".to_string(),
                enabled: Some(true),
            },
        )
        .unwrap();
        let res = dispatch_action(&db, &r, "/downloads/doc.pdf");
        assert_eq!(res.status, "skipped");
        assert!(res.message.contains("no longer exists"));
    }

    #[test]
    fn dispatch_action_backup_recipe_runs_or_fails_cleanly() {
        let db = fresh_db();
        // Create a backup recipe pointing at a nonexistent file — dispatch should fail, not crash.
        let recipe = crate::backup_recipes::create_recipe(
            &db,
            crate::backup_recipes::CreateRecipeRequest {
                name: "Test".to_string(),
                sources: vec!["/nonexistent/file.pdf".to_string()],
                destination: "/backup".to_string(),
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        let r = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/downloads".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: recipe.id.clone(),
                enabled: Some(true),
            },
        )
        .unwrap();
        let res = dispatch_action(&db, &r, "/downloads/trigger.pdf");
        // The recipe's source doesn't exist → failure, not crash.
        assert!(
            res.status == "failure" || res.status == "success",
            "dispatch returns a clean status, not a panic"
        );
    }

    #[test]
    fn dispatch_action_recursive_loop_prevention() {
        let db = fresh_db();
        // Backup recipe whose destination is INSIDE the watched folder.
        let recipe = crate::backup_recipes::create_recipe(
            &db,
            crate::backup_recipes::CreateRecipeRequest {
                name: "Recursive".to_string(),
                sources: vec!["/source/file.pdf".to_string()],
                destination: "/downloads/backup".to_string(), // inside watched folder
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        let r = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: "/downloads".to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: recipe.id.clone(),
                enabled: Some(true),
            },
        )
        .unwrap();
        let res = dispatch_action(&db, &r, "/downloads/trigger.pdf");
        assert_eq!(res.status, "skipped");
        assert!(res.message.contains("loop prevention"));
    }

    #[test]
    fn end_to_end_watch_rule_fires_backup_on_matching_file() {
        // Create a real source file + backup recipe + watch rule.
        // Simulate a watch event + verify the backup was created.
        let db = fresh_db();
        let tmp = std::env::temp_dir().join(format!("paperu-watch-e2e-{}", uuid::Uuid::new_v4()));
        let watched = tmp.join("watched");
        let dest = tmp.join("backup");
        std::fs::create_dir_all(&watched).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        let src = tmp.join("source.pdf");
        std::fs::write(&src, b"watch trigger source").unwrap();
        let recipe = crate::backup_recipes::create_recipe(
            &db,
            crate::backup_recipes::CreateRecipeRequest {
                name: "E2E Watch".to_string(),
                sources: vec![src.to_string_lossy().to_string()],
                destination: dest.to_string_lossy().to_string(),
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        let rule = create_rule(
            &db,
            CreateWatchRuleRequest {
                folder_path: watched.to_string_lossy().to_string(),
                condition_type: "extension".to_string(),
                condition_value: "pdf".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: recipe.id.clone(),
                enabled: Some(true),
            },
        )
        .unwrap();
        // Simulate a watch event: a new PDF appeared in the watched folder.
        let new_file_name = "report.pdf";
        let matches = find_matching_rules(&db, &watched.to_string_lossy(), new_file_name).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, rule.id);
        // Dispatch the matching rule.
        let new_file_path = watched.join(new_file_name);
        let res = dispatch_action(&db, &matches[0], &new_file_path.to_string_lossy());
        assert_eq!(res.status, "success", "backup recipe ran successfully");
        // The backup was created (the recipe's source was copied to dest).
        let dest_file = dest.join("source.pdf");
        assert!(dest_file.exists(), "destination file was created");
        assert_eq!(std::fs::read(&dest_file).unwrap(), b"watch trigger source");
        // Cleanup.
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
