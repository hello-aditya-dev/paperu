//! Reading history logic — the user's last reading position per
//! document (Master Prompt 4 §25). Local only, clearable.
//! NEVER stores document contents.

use rusqlite::params;
use uuid::Uuid;

use crate::contracts::reading_history::{ReadingHistoryEntry, UpdateReadingHistoryRequest};
use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};

/// Upsert reading-history for a path. Called when a document is opened
/// or scrolled. Returns the upserted entry.
pub fn upsert(db: &Database, req: UpdateReadingHistoryRequest) -> Result<ReadingHistoryEntry> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        // Bookmark preservation (repair §21):
        //   None  → leave existing bookmarks unchanged (SQL NULL → COALESCE keeps the row value)
        //   Some(vec) → set bookmarks to that vec (even if empty: Some([]) explicitly clears)
        // The previous code did `unwrap_or_default()` which converted
        // None to `[]`, then COALESCE'd — but a non-NULL `"[]"` always
        // wins over the row value, clobbering stored bookmarks on every
        // page-change scroll. Now None becomes SQL NULL so COALESCE
        // preserves the existing row.
        let bookmarks_param: Option<String> = match &req.bookmarks {
            None => None,
            Some(vec) => Some(serde_json::to_string(vec).map_err(AppError::from)?),
        };
        // Try UPDATE first; if no row affected, INSERT.
        let updated = conn
            .execute(
                "UPDATE reading_history SET
                     file_name = ?1, file_kind = ?2,
                     last_page = COALESCE(?3, last_page),
                     scroll_y = COALESCE(?4, scroll_y),
                     zoom_level = COALESCE(?5, zoom_level),
                     bookmarks = COALESCE(?6, bookmarks),
                     last_opened_at = ?7
                 WHERE file_path = ?8",
                params![
                    req.file_name,
                    req.file_kind,
                    req.last_page,
                    req.scroll_y,
                    req.zoom_level,
                    bookmarks_param,
                    now,
                    req.file_path,
                ],
            )
            .map_err(map_sqlite)?;
        if updated == 0 {
            // Insert new row. For a brand-new row, None bookmarks
            // (caller didn't specify) defaults to the empty array
            // (the column default is '[]'). Some(vec) persists as-is.
            let id = Uuid::new_v4().to_string();
            let init_bookmarks = bookmarks_param.unwrap_or_else(|| "[]".to_string());
            conn.execute(
                "INSERT INTO reading_history
                    (id, file_path, file_name, file_kind, last_page, scroll_y,
                     zoom_level, bookmarks, last_opened_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    req.file_path,
                    req.file_name,
                    req.file_kind,
                    req.last_page.unwrap_or(1),
                    req.scroll_y.unwrap_or(0.0),
                    req.zoom_level.unwrap_or(1.0),
                    init_bookmarks,
                    now,
                ],
            )
            .map_err(map_sqlite)?;
        }
        read_row_by_path(conn, &req.file_path)
    })
}

/// Get reading-history for a specific file path (returns None if absent).
pub fn get_for_path(db: &Database, path: &str) -> Result<Option<ReadingHistoryEntry>> {
    db.with_conn(|conn| {
        let result = conn.query_row(
            "SELECT id, file_path, file_name, file_kind, last_page, scroll_y,
                    zoom_level, bookmarks, last_opened_at
             FROM reading_history WHERE file_path = ?1",
            params![path],
            row_to_entry,
        );
        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(map_sqlite(e)),
        }
    })
}

/// List all entries, most-recently-opened-first.
pub fn list(db: &Database) -> Result<Vec<ReadingHistoryEntry>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, file_name, file_kind, last_page, scroll_y,
                        zoom_level, bookmarks, last_opened_at
                 FROM reading_history ORDER BY last_opened_at DESC",
            )
            .map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_entry).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

/// Remove a single entry by id.
pub fn remove(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM reading_history WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

/// Clear all entries.
pub fn clear(db: &Database) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM reading_history", [])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── helpers ──────────────────────────────────────────────────────

fn read_row_by_path(conn: &rusqlite::Connection, path: &str) -> Result<ReadingHistoryEntry> {
    conn.query_row(
        "SELECT id, file_path, file_name, file_kind, last_page, scroll_y,
                zoom_level, bookmarks, last_opened_at
         FROM reading_history WHERE file_path = ?1",
        params![path],
        row_to_entry,
    )
    .map_err(map_sqlite)
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<ReadingHistoryEntry> {
    let bookmarks_json: String = row.get(7)?;
    let bookmarks: Vec<i64> = serde_json::from_str(&bookmarks_json).unwrap_or_default();
    Ok(ReadingHistoryEntry {
        id: row.get(0)?,
        file_path: row.get(1)?,
        file_name: row.get(2)?,
        file_kind: row.get(3)?,
        last_page: row.get(4)?,
        scroll_y: row.get(5)?,
        zoom_level: row.get(6)?,
        bookmarks,
        last_opened_at: row.get(8)?,
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
        "Paperu could not read or write reading history.",
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
    fn upsert_inserts_then_updates() {
        let db = fresh_db();
        let req = UpdateReadingHistoryRequest {
            file_path: "/tmp/book.pdf".to_string(),
            file_name: "book.pdf".to_string(),
            file_kind: "pdf".to_string(),
            last_page: Some(1),
            scroll_y: Some(0.0),
            zoom_level: Some(1.0),
            bookmarks: None,
        };
        let entry = upsert(&db, req).unwrap();
        assert_eq!(entry.last_page, 1);

        // Update last_page.
        let req2 = UpdateReadingHistoryRequest {
            file_path: "/tmp/book.pdf".to_string(),
            file_name: "book.pdf".to_string(),
            file_kind: "pdf".to_string(),
            last_page: Some(42),
            scroll_y: None,
            zoom_level: None,
            bookmarks: Some(vec![1, 5, 10]),
        };
        let updated = upsert(&db, req2).unwrap();
        assert_eq!(updated.last_page, 42);
        assert_eq!(updated.bookmarks, vec![1, 5, 10]);
        // No duplicate rows.
        assert_eq!(list(&db).unwrap().len(), 1);
    }

    #[test]
    fn get_for_path_returns_none_when_absent() {
        let db = fresh_db();
        let r = get_for_path(&db, "/tmp/never-opened.pdf").unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn list_is_most_recent_first() {
        let db = fresh_db();
        upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/a.pdf".to_string(),
                file_name: "a.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(1),
                scroll_y: None,
                zoom_level: None,
                bookmarks: None,
            },
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/b.pdf".to_string(),
                file_name: "b.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(1),
                scroll_y: None,
                zoom_level: None,
                bookmarks: None,
            },
        )
        .unwrap();
        let list = list(&db).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].file_name, "b.pdf");
    }

    #[test]
    fn remove_and_clear_work() {
        let db = fresh_db();
        let e = upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/x.pdf".to_string(),
                file_name: "x.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(1),
                scroll_y: None,
                zoom_level: None,
                bookmarks: None,
            },
        )
        .unwrap();
        remove(&db, &e.id).unwrap();
        assert_eq!(list(&db).unwrap().len(), 0);

        // Add 3, clear all.
        for i in 0..3 {
            upsert(
                &db,
                UpdateReadingHistoryRequest {
                    file_path: format!("/tmp/{i}.pdf"),
                    file_name: format!("{i}.pdf"),
                    file_kind: "pdf".to_string(),
                    last_page: Some(1),
                    scroll_y: None,
                    zoom_level: None,
                    bookmarks: None,
                },
            )
            .unwrap();
        }
        assert_eq!(list(&db).unwrap().len(), 3);
        clear(&db).unwrap();
        assert_eq!(list(&db).unwrap().len(), 0);
    }

    /// Regression (repair §21): a scroll/page-change upsert with
    /// `bookmarks: None` MUST NOT clobber existing bookmarks. The
    /// previous code's `unwrap_or_default()` converted None to `[]`
    /// and silently erased stored bookmarks on every scroll.
    #[test]
    fn none_bookmarks_preserves_existing() {
        let db = fresh_db();
        // First upsert: store bookmarks [1, 5, 10].
        upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/book.pdf".to_string(),
                file_name: "book.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(1),
                scroll_y: None,
                zoom_level: None,
                bookmarks: Some(vec![1, 5, 10]),
            },
        )
        .unwrap();
        // Second upsert: page change, bookmarks: None.
        // The bug would clobber [1,5,10] → [].
        let after = upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/book.pdf".to_string(),
                file_name: "book.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(42),
                scroll_y: None,
                zoom_level: None,
                bookmarks: None, // ← must preserve existing
            },
        )
        .unwrap();
        assert_eq!(after.last_page, 42);
        assert_eq!(after.bookmarks, vec![1, 5, 10], "bookmarks preserved");
    }

    /// Regression (repair §21): `Some([])` explicitly clears bookmarks.
    /// This is the orthogonal case — None preserves, Some([]) clears.
    #[test]
    fn some_empty_bookmarks_clears_existing() {
        let db = fresh_db();
        upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/c.pdf".to_string(),
                file_name: "c.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(1),
                scroll_y: None,
                zoom_level: None,
                bookmarks: Some(vec![2, 4, 6]),
            },
        )
        .unwrap();
        let after = upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/c.pdf".to_string(),
                file_name: "c.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(2),
                scroll_y: None,
                zoom_level: None,
                bookmarks: Some(vec![]), // ← explicit clear
            },
        )
        .unwrap();
        assert_eq!(after.bookmarks, Vec::<i64>::new());
    }

    /// Regression (repair §20): opening a brand-new PDF (no prior
    /// history row) and changing page MUST create a history row.
    #[test]
    fn first_open_creates_history_row() {
        let db = fresh_db();
        // No prior history. Open + change page.
        let entry = upsert(
            &db,
            UpdateReadingHistoryRequest {
                file_path: "/tmp/new.pdf".to_string(),
                file_name: "new.pdf".to_string(),
                file_kind: "pdf".to_string(),
                last_page: Some(5),
                scroll_y: None,
                zoom_level: None,
                bookmarks: None,
            },
        )
        .unwrap();
        assert_eq!(entry.last_page, 5);
        assert_eq!(entry.file_name, "new.pdf");
        // Verify a row actually exists now.
        let fetched = get_for_path(&db, "/tmp/new.pdf").unwrap();
        assert!(fetched.is_some(), "history row created on first open");
        assert_eq!(fetched.unwrap().last_page, 5);
    }
}
