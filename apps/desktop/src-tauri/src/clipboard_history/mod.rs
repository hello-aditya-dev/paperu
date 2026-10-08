//! Clipboard History — opt-in local clipboard journal (P5, AUTOMATION-05).
//!
//! Schema in migration 0006 (clipboard_history). Stores ONLY text
//! content in V1 (image clipboard is platform-specific + needs security
//! review). The user must explicitly click "Save current clipboard" —
//! there is no background polling in V1.
//!
//! Auto-capture needs the Tauri clipboard plugin + Windows CI
//! validation — that is V2 work.
//!
//! Privacy:
//!   - Opt-in: the route shows a clear notice until the user enables it.
//!   - Bounded: retention limit (default 7 days) + max entries (default 100).
//!   - No network: clipboard contents never leave the local DB.
//!   - Sensitive-data precaution: the user can pause (just don't click
//!     Save), pin important entries, delete individual entries, clear all.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

/// Default retention: 7 days.
pub const DEFAULT_RETENTION_DAYS: i64 = 7;

/// Default max entries (oldest unpinned purged when exceeded).
pub const DEFAULT_MAX_ENTRIES: i64 = 100;

/// Max content size (1 MiB) — prevents pathological memory growth.
const MAX_CONTENT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: String,
    pub kind: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub pinned: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEntryRequest {
    pub content: String,
}

pub fn add_entry(db: &Database, req: AddEntryRequest) -> Result<ClipboardEntry> {
    if req.content.is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Nothing to save — the clipboard is empty.",
        )
        .build());
    }
    let content = if req.content.len() > MAX_CONTENT_BYTES {
        req.content.chars().take(MAX_CONTENT_BYTES / 4).collect()
    } else {
        req.content
    };
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO clipboard_history (id, kind, content, file_path, pinned, created_at) VALUES (?1, 'text', ?2, NULL, 0, ?3)",
            params![id, content, now],
        )
        .map_err(map_sqlite)?;
        // Enforce max-entries: purge oldest unpinned beyond the limit.
        // `rowid DESC` is the deterministic tie-breaker (newest insert first).
        conn.execute(
            "DELETE FROM clipboard_history WHERE id IN (
                SELECT id FROM clipboard_history WHERE pinned = 0
                ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?1
            )",
            params![DEFAULT_MAX_ENTRIES],
        )
        .map_err(map_sqlite)?;
        read_row(conn, &id)
    })
}

pub fn list_entries(db: &Database, query: Option<&str>) -> Result<Vec<ClipboardEntry>> {
    db.with_conn(|conn| {
        let mut out = Vec::new();
        match query {
            Some(q) if !q.is_empty() => {
                let pattern = format!("%{q}%");
                let mut stmt = conn.prepare(
                    "SELECT id, kind, content, file_path, pinned, created_at FROM clipboard_history WHERE content LIKE ?1 ORDER BY pinned DESC, created_at DESC LIMIT 500",
                )
                .map_err(map_sqlite)?;
                let rows = stmt.query_map(params![pattern], row_to_entry).map_err(map_sqlite)?;
                for r in rows {
                    out.push(r.map_err(map_sqlite)?);
                }
            }
            _ => {
                let mut stmt = conn.prepare(
                    "SELECT id, kind, content, file_path, pinned, created_at FROM clipboard_history ORDER BY pinned DESC, created_at DESC LIMIT 500",
                )
                .map_err(map_sqlite)?;
                let rows = stmt.query_map([], row_to_entry).map_err(map_sqlite)?;
                for r in rows {
                    out.push(r.map_err(map_sqlite)?);
                }
            }
        }
        Ok(out)
    })
}

pub fn set_pinned(db: &Database, id: &str, pinned: bool) -> Result<ClipboardEntry> {
    db.with_conn(|conn| {
        let p = i64::from(pinned);
        conn.execute(
            "UPDATE clipboard_history SET pinned = ?1 WHERE id = ?2",
            params![p, id],
        )
        .map_err(map_sqlite)?;
        read_row(conn, id)
    })
}

pub fn delete_entry(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn clear_all(db: &Database) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM clipboard_history", [])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn purge_old(db: &Database, retention_days: i64) -> Result<u64> {
    db.with_conn(|conn| {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
        let cutoff_iso = cutoff.to_rfc3339();
        let n = conn
            .execute(
                "DELETE FROM clipboard_history WHERE pinned = 0 AND created_at < ?1",
                params![cutoff_iso],
            )
            .map_err(map_sqlite)?;
        Ok(n as u64)
    })
}

pub fn entry_count(db: &Database) -> Result<i64> {
    db.with_conn(|conn| {
        conn.query_row("SELECT COUNT(*) FROM clipboard_history", [], |r| r.get(0))
            .map_err(map_sqlite)
    })
}

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<ClipboardEntry> {
    conn.query_row(
        "SELECT id, kind, content, file_path, pinned, created_at FROM clipboard_history WHERE id = ?1",
        params![id],
        row_to_entry,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<ClipboardEntry> {
    let pinned_int: i64 = row.get(4)?;
    Ok(ClipboardEntry {
        id: row.get(0)?,
        kind: row.get(1)?,
        content: row.get(2)?,
        file_path: row.get(3)?,
        pinned: pinned_int != 0,
        created_at: row.get(5)?,
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
        "Paperu could not read or write clipboard history.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That clipboard entry wasn't found.",
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
    fn add_list_delete_entry() {
        let db = fresh_db();
        let e = add_entry(
            &db,
            AddEntryRequest {
                content: "hello clipboard".to_string(),
            },
        )
        .unwrap();
        assert_eq!(e.kind, "text");
        assert_eq!(e.content.as_deref(), Some("hello clipboard"));
        assert!(!e.pinned);
        assert_eq!(entry_count(&db).unwrap(), 1);
        let list = list_entries(&db, None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, e.id);
        delete_entry(&db, &e.id).unwrap();
        assert_eq!(entry_count(&db).unwrap(), 0);
    }

    #[test]
    fn rejects_empty_content() {
        let db = fresh_db();
        let res = add_entry(&db, AddEntryRequest { content: "".into() });
        assert!(res.is_err());
    }

    #[test]
    fn pin_survives_purge_unpinned_does_not() {
        let db = fresh_db();
        let pinned = add_entry(
            &db,
            AddEntryRequest {
                content: "important".into(),
            },
        )
        .unwrap();
        set_pinned(&db, &pinned.id, true).unwrap();
        let unpinned = add_entry(
            &db,
            AddEntryRequest {
                content: "ephemeral".into(),
            },
        )
        .unwrap();
        // Backdate both to before retention.
        let old = chrono::Utc::now() - chrono::Duration::days(30);
        db.with_conn(|c| {
            c.execute(
                "UPDATE clipboard_history SET created_at = ?1",
                params![old.to_rfc3339()],
            )
            .map_err(map_sqlite)
            .map(|_| ())
        })
        .unwrap();
        let purged = purge_old(&db, 7).unwrap();
        assert_eq!(purged, 1, "only the unpinned entry is purged");
        assert_eq!(entry_count(&db).unwrap(), 1);
        // The pinned entry is the survivor.
        let survivor = list_entries(&db, None).unwrap();
        assert_eq!(survivor[0].id, pinned.id);
        // The unpinned is gone.
        assert!(survivor.iter().all(|e| e.id != unpinned.id));
    }

    #[test]
    fn max_entries_purges_oldest_unpinned() {
        let db = fresh_db();
        for i in 0..110 {
            add_entry(
                &db,
                AddEntryRequest {
                    content: format!("entry-{i}"),
                },
            )
            .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(
            entry_count(&db).unwrap(),
            100,
            "excess entries purged to max"
        );
    }

    #[test]
    fn search_filters_by_substring() {
        let db = fresh_db();
        add_entry(
            &db,
            AddEntryRequest {
                content: "find me please".into(),
            },
        )
        .unwrap();
        add_entry(
            &db,
            AddEntryRequest {
                content: "other text".into(),
            },
        )
        .unwrap();
        let hits = list_entries(&db, Some("find")).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].content, Some("find me please".to_string()));
    }

    #[test]
    fn clear_all_removes_everything() {
        let db = fresh_db();
        add_entry(
            &db,
            AddEntryRequest {
                content: "a".into(),
            },
        )
        .unwrap();
        add_entry(
            &db,
            AddEntryRequest {
                content: "b".into(),
            },
        )
        .unwrap();
        clear_all(&db).unwrap();
        assert_eq!(entry_count(&db).unwrap(), 0);
    }

    #[test]
    fn purge_old_with_future_retention_keeps_all() {
        let db = fresh_db();
        add_entry(
            &db,
            AddEntryRequest {
                content: "x".into(),
            },
        )
        .unwrap();
        let purged = purge_old(&db, 36500).unwrap();
        assert_eq!(purged, 0, "100-year retention keeps everything");
    }
}
