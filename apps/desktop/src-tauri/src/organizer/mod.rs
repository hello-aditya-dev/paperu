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
    pub action: String, // move|copy
    pub enabled: Option<bool>,
    pub sort_order: Option<i64>,
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
                 condition_value, action, enabled, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                rule.name,
                rule.source_folder,
                rule.dest_folder,
                rule.condition_type,
                rule.condition_value,
                rule.action,
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
                    condition_value, action, enabled, sort_order
             FROM organizer_rule ORDER BY sort_order",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map([], |r| {
                let enabled_int: i64 = r.get(7)?;
                Ok(OrganizerRule {
                    id: Some(r.get(0)?),
                    name: r.get(1)?,
                    source_folder: r.get(2)?,
                    dest_folder: r.get(3)?,
                    condition_type: r.get(4)?,
                    condition_value: r.get(5)?,
                    action: r.get(6)?,
                    enabled: Some(enabled_int != 0),
                    sort_order: Some(r.get(8)?),
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
            enabled: Some(true),
            sort_order: None,
        };
        let id = save_rule(&db, &rule).unwrap();
        assert_eq!(list_rules(&db).unwrap().len(), 1);
        delete_rule(&db, &id).unwrap();
        assert_eq!(list_rules(&db).unwrap().len(), 0);
    }
}
