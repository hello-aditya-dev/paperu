//! Application kit logic — the user's reusable personal documents
//! (Master Prompt 4 §18-22).
//!
//! Stores ONLY file references + metadata. The actual files live in
//! Paperu's managed kit storage directory (set up by Integrator when
//! the Tauri runtime wires the storage path). NEVER document bytes
//! in the DB. NEVER uploaded. Privacy doctrine §19, §76.

use rusqlite::params;
use uuid::Uuid;

use crate::contracts::application_kit::{
    AddApplicationKitItemRequest, ApplicationKitItem, UpdateApplicationKitItemRequest,
};
use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};

/// Add a new kit item. Returns the inserted entry.
pub fn add(db: &Database, req: AddApplicationKitItemRequest) -> Result<ApplicationKitItem> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO application_kit_item
                (id, kind, label, file_path, file_name, file_kind,
                 mime_type, size_bytes, notes, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)",
            params![
                id,
                req.kind,
                req.label,
                req.file_path,
                req.file_name,
                req.file_kind,
                req.mime_type,
                req.size_bytes,
                req.notes,
                now,
            ],
        )
        .map_err(map_sqlite)?;
        read_row(conn, &id)
    })
}

/// List all kit items, grouped by kind then sorted by sort_order + created_at.
pub fn list(db: &Database) -> Result<Vec<ApplicationKitItem>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, label, file_path, file_name, file_kind,
                        mime_type, size_bytes, notes, sort_order, created_at, updated_at
                 FROM application_kit_item
                 ORDER BY kind, sort_order, created_at",
            )
            .map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_item).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

/// Update an existing kit item. Only provided fields are updated.
pub fn update(db: &Database, req: UpdateApplicationKitItemRequest) -> Result<ApplicationKitItem> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        // Fetch current to merge partial updates.
        let current = read_row(conn, &req.id)?;
        let label = req.label.unwrap_or(current.label);
        let notes = req.notes.or(current.notes);
        let sort_order = req.sort_order.unwrap_or(current.sort_order);
        conn.execute(
            "UPDATE application_kit_item
             SET label = ?1, notes = ?2, sort_order = ?3, updated_at = ?4
             WHERE id = ?5",
            params![label, notes, sort_order, now, req.id],
        )
        .map_err(map_sqlite)?;
        read_row(conn, &req.id)
    })
}

/// Remove a single kit item by id.
pub fn remove(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM application_kit_item WHERE id = ?1",
            params![id],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── helpers ──────────────────────────────────────────────────────

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<ApplicationKitItem> {
    conn.query_row(
        "SELECT id, kind, label, file_path, file_name, file_kind,
                mime_type, size_bytes, notes, sort_order, created_at, updated_at
         FROM application_kit_item WHERE id = ?1",
        params![id],
        row_to_item,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<ApplicationKitItem> {
    Ok(ApplicationKitItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        label: row.get(2)?,
        file_path: row.get(3)?,
        file_name: row.get(4)?,
        file_kind: row.get(5)?,
        mime_type: row.get(6)?,
        size_bytes: row.get(7)?,
        notes: row.get(8)?,
        sort_order: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
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
        "Paperu could not read or write your application kit.",
    )
    .technical(err.to_string())
    .severity(ErrorSeverity::Error)
    .recoverability(Recoverability::Retryable)
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    if let rusqlite::Error::QueryReturnedNoRows = err {
        AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "Paperu could not find that application kit item.",
        )
        .technical(format!("application_kit id {id} not in db"))
        .severity(ErrorSeverity::Warning)
        .recoverability(Recoverability::Retryable)
        .build()
    } else {
        map_sqlite(err)
    }
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

    fn sample_request(label: &str, kind: &str) -> AddApplicationKitItemRequest {
        AddApplicationKitItemRequest {
            kind: kind.to_string(),
            label: label.to_string(),
            file_path: format!("/tmp/kit/{label}.pdf"),
            file_name: format!("{label}.pdf"),
            file_kind: "pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            size_bytes: Some(100_000),
            notes: None,
        }
    }

    #[test]
    fn add_and_list_round_trip() {
        let db = fresh_db();
        let item = add(&db, sample_request("Resume", "resume")).unwrap();
        assert_eq!(item.label, "Resume");
        assert_eq!(item.kind, "resume");
        assert_ne!(item.id, "");

        let list = list(&db).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, item.id);
    }

    #[test]
    fn list_groups_by_kind_then_sort_order() {
        let db = fresh_db();
        add(&db, sample_request("Photo A", "photo")).unwrap();
        add(&db, sample_request("Signature A", "signature")).unwrap();
        add(&db, sample_request("Photo B", "photo")).unwrap();

        let list = list(&db).unwrap();
        assert_eq!(list.len(), 3);
        // Sorted by kind alphabetically: photo, photo, signature.
        assert_eq!(list[0].kind, "photo");
        assert_eq!(list[1].kind, "photo");
        assert_eq!(list[2].kind, "signature");
    }

    #[test]
    fn update_changes_provided_fields_only() {
        let db = fresh_db();
        let item = add(&db, sample_request("Resume", "resume")).unwrap();
        let updated = update(
            &db,
            UpdateApplicationKitItemRequest {
                id: item.id.clone(),
                label: Some("Updated Resume".to_string()),
                notes: Some("renewed 2025".to_string()),
                sort_order: None,
            },
        )
        .unwrap();
        assert_eq!(updated.label, "Updated Resume");
        assert_eq!(updated.notes.as_deref(), Some("renewed 2025"));
        // Original file_path / file_name unchanged.
        assert_eq!(updated.file_path, item.file_path);
    }

    #[test]
    fn remove_works() {
        let db = fresh_db();
        let item = add(&db, sample_request("ToDelete", "other")).unwrap();
        assert_eq!(list(&db).unwrap().len(), 1);
        remove(&db, &item.id).unwrap();
        assert_eq!(list(&db).unwrap().len(), 0);
    }
}
