//! Recent work history — the persistent layer behind the History view.
//!
//! Stores ONLY file metadata (paths, sizes, operation id/label). NEVER
//! stores document contents (privacy doctrine §82). Cleared via
//! `clear()` or the History UI.
//!
//! Backed by the `recent_work` SQLite table (migration 0002). All
//! functions take a `&Database` reference so they're testable on any
//! platform without the Tauri runtime.

use rusqlite::params;
use uuid::Uuid;

use crate::contracts::recent_work::{AddRecentWorkRequest, RecentWorkEntry};
use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};

/// Maximum number of entries kept. Older entries are pruned on insert.
pub const MAX_ENTRIES: usize = 200;

/// Add a new recent-work entry. Returns the inserted entry with its
/// generated id and timestamp. Prunes entries beyond MAX_ENTRIES.
pub fn add(db: &Database, req: AddRecentWorkRequest) -> Result<RecentWorkEntry> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let correlation_id = req
            .correlation_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        // ISO-8601 UTC via SQLite (deterministic, no local clock skew).
        let created_at: String = conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
                r.get(0)
            })
            .map_err(map_sqlite)?;

        conn.execute(
            "INSERT INTO recent_work (
                id, source_path, source_file_name, file_kind,
                output_path, output_file_name,
                operation_id, operation_label, status,
                size_before, size_after,
                human_readable_size_before, human_readable_size_after,
                created_at, correlation_id
            ) VALUES (
                ?1, ?2, ?3, ?4,
                ?5, ?6,
                ?7, ?8, ?9,
                ?10, ?11,
                ?12, ?13,
                ?14, ?15
            )",
            params![
                id,
                req.source_path,
                req.source_file_name,
                req.file_kind,
                req.output_path,
                req.output_file_name,
                req.operation_id,
                req.operation_label,
                req.status,
                req.size_before,
                req.size_after,
                req.human_readable_size_before,
                req.human_readable_size_after,
                created_at,
                correlation_id,
            ],
        )
        .map_err(map_sqlite)?;

        // Prune oldest entries beyond MAX_ENTRIES.
        prune_old(conn)?;

        // Read back the row we just inserted (single source of truth).
        let entry = read_row(conn, &id)?;
        Ok(entry)
    })
}

/// List recent-work entries, most-recent-first.
pub fn list(db: &Database, limit: u32) -> Result<Vec<RecentWorkEntry>> {
    db.with_conn(|conn| {
        let limit = i64::from(limit.min(u32::try_from(MAX_ENTRIES).unwrap_or(u32::MAX)));
        let mut stmt = conn
            .prepare(
                "SELECT id, source_path, source_file_name, file_kind,
                        output_path, output_file_name,
                        operation_id, operation_label, status,
                        size_before, size_after,
                        human_readable_size_before, human_readable_size_after,
                        created_at, correlation_id
                 FROM recent_work
                 ORDER BY created_at DESC
                 LIMIT ?1",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map(params![limit], row_to_entry)
            .map_err(map_sqlite)?;
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
        conn.execute("DELETE FROM recent_work WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

/// Clear all entries.
pub fn clear(db: &Database) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM recent_work", [])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── internal helpers ──────────────────────────────────────────────

fn prune_old(conn: &rusqlite::Connection) -> Result<()> {
    // Delete all but the newest MAX_ENTRIES rows.
    conn.execute(
        "DELETE FROM recent_work
         WHERE id NOT IN (
             SELECT id FROM recent_work
             ORDER BY created_at DESC
             LIMIT ?1
         )",
        params![MAX_ENTRIES as i64],
    )
    .map_err(map_sqlite)?;
    Ok(())
}

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<RecentWorkEntry> {
    conn.query_row(
        "SELECT id, source_path, source_file_name, file_kind,
                output_path, output_file_name,
                operation_id, operation_label, status,
                size_before, size_after,
                human_readable_size_before, human_readable_size_after,
                created_at, correlation_id
         FROM recent_work
         WHERE id = ?1",
        params![id],
        row_to_entry,
    )
    .map_err(|e| {
        // Distinguish "not found" from "DB broken".
        if let rusqlite::Error::QueryReturnedNoRows = e {
            AppError::builder(
                code::FILE_NOT_FOUND,
                ErrorCategory::Filesystem,
                "Paperu could not find that recent-work entry.",
            )
            .technical(format!("recent_work id {id} not in db"))
            .severity(ErrorSeverity::Warning)
            .recoverability(Recoverability::Retryable)
            .build()
        } else {
            map_sqlite(e)
        }
    })
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<RecentWorkEntry> {
    Ok(RecentWorkEntry {
        id: row.get(0)?,
        source_path: row.get(1)?,
        source_file_name: row.get(2)?,
        file_kind: row.get(3)?,
        output_path: row.get(4)?,
        output_file_name: row.get(5)?,
        operation_id: row.get(6)?,
        operation_label: row.get(7)?,
        status: row.get(8)?,
        size_before: row.get(9)?,
        size_after: row.get(10)?,
        human_readable_size_before: row.get(11)?,
        human_readable_size_after: row.get(12)?,
        created_at: row.get(13)?,
        correlation_id: row.get(14)?,
    })
}

fn map_sqlite(err: rusqlite::Error) -> AppError {
    AppError::builder(
        code::DATABASE_UNAVAILABLE,
        ErrorCategory::Database,
        "Paperu could not read or write its local history.",
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
        // Run migrations on this in-memory conn.
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    fn sample_request(label: &str) -> AddRecentWorkRequest {
        AddRecentWorkRequest {
            source_path: format!("/tmp/{label}.pdf"),
            source_file_name: format!("{label}.pdf"),
            file_kind: "pdf".to_string(),
            output_path: Some(format!("/tmp/{label}-paperu.pdf")),
            output_file_name: Some(format!("{label}-paperu.pdf")),
            operation_id: "pdf-fit".to_string(),
            operation_label: "Made PDF fit".to_string(),
            status: "success".to_string(),
            size_before: Some(3_800_000_i64),
            size_after: Some(487_000_i64),
            human_readable_size_before: Some("3.8 MB".to_string()),
            human_readable_size_after: Some("487 KB".to_string()),
            correlation_id: None,
        }
    }

    #[test]
    fn add_and_list_round_trip() {
        let db = fresh_db();
        let entry = add(&db, sample_request("a")).unwrap();
        assert_eq!(entry.source_file_name, "a.pdf");
        assert_eq!(entry.operation_label, "Made PDF fit");
        assert_ne!(entry.id, "");
        assert_ne!(entry.correlation_id, "");

        let list = list(&db, 10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, entry.id);
    }

    #[test]
    fn list_is_most_recent_first() {
        let db = fresh_db();
        add(&db, sample_request("first")).unwrap();
        // Sleep > 1 second so SQLite's second-precision timestamp differs.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        add(&db, sample_request("second")).unwrap();

        let list = list(&db, 10).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].source_file_name, "second.pdf");
        assert_eq!(list[1].source_file_name, "first.pdf");
    }

    #[test]
    fn remove_by_id_works() {
        let db = fresh_db();
        let e = add(&db, sample_request("x")).unwrap();
        assert_eq!(list(&db, 10).unwrap().len(), 1);
        remove(&db, &e.id).unwrap();
        assert_eq!(list(&db, 10).unwrap().len(), 0);
    }

    #[test]
    fn clear_wipes_all() {
        let db = fresh_db();
        add(&db, sample_request("a")).unwrap();
        add(&db, sample_request("b")).unwrap();
        add(&db, sample_request("c")).unwrap();
        assert_eq!(list(&db, 100).unwrap().len(), 3);
        clear(&db).unwrap();
        assert_eq!(list(&db, 100).unwrap().len(), 0);
    }

    #[test]
    fn pruning_keeps_only_max_entries() {
        let db = fresh_db();
        // Insert MAX_ENTRIES + 50 entries. SQLite timestamps are
        // second-precision, so we add a small sleep every few inserts
        // to ensure the order-by-created_at is total.
        for i in 0..(MAX_ENTRIES as u32 + 50) {
            let mut req = sample_request(&format!("file{i}"));
            req.source_path = format!("/tmp/file{i}.pdf");
            req.source_file_name = format!("file{i}.pdf");
            add(&db, req).unwrap();
            if i % 10 == 0 {
                std::thread::sleep(std::time::Duration::from_millis(1100));
            }
        }
        let list = list(&db, u32::MAX).unwrap();
        assert_eq!(list.len(), MAX_ENTRIES);
    }
}
