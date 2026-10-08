//! Backup Recipes — persistent backup definitions + copy+verify execution (90% §54).
//! Schema in migration 0006 (backup_recipe). Reuses the shared copy_and_verify primitive.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};
use crate::filesystem::{copy_and_verify, ConflictPolicy};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecipe {
    pub id: String,
    pub name: String,
    pub sources: Vec<String>,
    pub destination: String,
    pub include_patterns: Option<Vec<String>>,
    pub exclude_patterns: Option<Vec<String>>,
    pub last_run: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecipeRequest {
    pub name: String,
    pub sources: Vec<String>,
    pub destination: String,
    pub include_patterns: Option<Vec<String>>,
    pub exclude_patterns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRunResult {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
    pub total_bytes: u64,
}

pub fn create_recipe(db: &Database, req: CreateRecipeRequest) -> Result<BackupRecipe> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        let sources_json = serde_json::to_string(&req.sources).unwrap_or_default();
        let include_json = req.include_patterns.as_ref().map(|p| serde_json::to_string(p).unwrap_or_default());
        let exclude_json = req.exclude_patterns.as_ref().map(|p| serde_json::to_string(p).unwrap_or_default());
        conn.execute(
            "INSERT INTO backup_recipe (id, name, sources, destination, include_patterns, exclude_patterns, last_run, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7)",
            params![id, req.name, sources_json, req.destination, include_json, exclude_json, now],
        ).map_err(map_sqlite)?;
        read_recipe(conn, &id)
    })
}

pub fn list_recipes(db: &Database) -> Result<Vec<BackupRecipe>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, name, sources, destination, include_patterns, exclude_patterns, last_run, created_at, updated_at FROM backup_recipe ORDER BY name").map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_recipe).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(map_sqlite)?); }
        Ok(out)
    })
}

pub fn delete_recipe(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM backup_recipe WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn run_recipe(db: &Database, id: &str) -> Result<BackupRunResult> {
    let recipe = db.with_conn(|conn| read_recipe(conn, id))?;
    let dest = std::path::Path::new(&recipe.destination);
    std::fs::create_dir_all(dest).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't create the destination folder.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    let mut total_bytes: u64 = 0;
    for source_path in &recipe.sources {
        let src = std::path::Path::new(source_path);
        if !src.is_file() {
            failed.push(format!("{source_path} (not a regular file)"));
            continue;
        }
        let file_name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file");
        match copy_and_verify(
            src,
            dest,
            file_name,
            ConflictPolicy::Rename,
            &|| false,
            &|_, _| {},
        ) {
            Ok(result) => {
                if result.verified {
                    succeeded.push(result.destination);
                    total_bytes += result.bytes_copied;
                } else {
                    failed.push(format!("{source_path} (SHA-256 mismatch)"));
                }
            }
            Err(e) => {
                failed.push(format!("{source_path} ({e})"));
            }
        }
    }
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        conn.execute(
            "UPDATE backup_recipe SET last_run = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })?;
    Ok(BackupRunResult {
        succeeded,
        failed,
        total_bytes,
    })
}

fn read_recipe(conn: &rusqlite::Connection, id: &str) -> Result<BackupRecipe> {
    conn.query_row(
        "SELECT id, name, sources, destination, include_patterns, exclude_patterns, last_run, created_at, updated_at FROM backup_recipe WHERE id = ?1",
        params![id], row_to_recipe,
    ).map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_recipe(row: &rusqlite::Row) -> rusqlite::Result<BackupRecipe> {
    let sources_json: String = row.get(2)?;
    let sources: Vec<String> = serde_json::from_str(&sources_json).unwrap_or_default();
    let include_json: Option<String> = row.get(4)?;
    let exclude_json: Option<String> = row.get(5)?;
    Ok(BackupRecipe {
        id: row.get(0)?,
        name: row.get(1)?,
        sources,
        destination: row.get(3)?,
        include_patterns: include_json.and_then(|j| serde_json::from_str(&j).ok()),
        exclude_patterns: exclude_json.and_then(|j| serde_json::from_str(&j).ok()),
        last_run: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
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
        "Paperu could not read or write backup recipes.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That backup recipe wasn't found.",
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
    fn create_list_delete_recipe() {
        let db = fresh_db();
        let r = create_recipe(
            &db,
            CreateRecipeRequest {
                name: "My Backup".to_string(),
                sources: vec!["/home/user/doc.pdf".to_string()],
                destination: "/backup".to_string(),
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        assert_eq!(list_recipes(&db).unwrap().len(), 1);
        delete_recipe(&db, &r.id).unwrap();
        assert_eq!(list_recipes(&db).unwrap().len(), 0);
    }

    #[test]
    fn run_recipe_copies_and_verifies() {
        let db = fresh_db();
        let tmp = std::env::temp_dir().join(format!("paperu-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("source.txt");
        std::fs::write(&src, b"backup me").unwrap();
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        let r = create_recipe(
            &db,
            CreateRecipeRequest {
                name: "Test".to_string(),
                sources: vec![src.to_string_lossy().to_string()],
                destination: dest.to_string_lossy().to_string(),
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        let result = run_recipe(&db, &r.id).unwrap();
        assert_eq!(result.succeeded.len(), 1);
        assert_eq!(result.failed.len(), 0);
        assert!(result.total_bytes > 0);
        assert_eq!(
            std::fs::read(dest.join("source.txt")).unwrap(),
            b"backup me"
        );
        assert_eq!(std::fs::read(&src).unwrap(), b"backup me");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn run_recipe_handles_missing_source() {
        let db = fresh_db();
        let tmp =
            std::env::temp_dir().join(format!("paperu-backup-missing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("dest");
        let r = create_recipe(
            &db,
            CreateRecipeRequest {
                name: "Missing".to_string(),
                sources: vec!["/nonexistent/file.txt".to_string()],
                destination: dest.to_string_lossy().to_string(),
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        let result = run_recipe(&db, &r.id).unwrap();
        assert_eq!(result.succeeded.len(), 0);
        assert_eq!(result.failed.len(), 1);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
