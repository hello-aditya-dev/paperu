//! Forms Vault — local-only reusable personal field values (90% §38).
//!
//! Stores reusable form field VALUES (name, address, email, phone, etc.)
//! so the user can copy them into forms. Explicitly local + private —
//! Paperu never injects data into arbitrary websites (no DOM automation).
//! The user copies a field value to the clipboard or types it manually.

use rusqlite::params;
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub id: String,
    pub field_key: String,
    pub field_value: String,
    pub label: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertFieldRequest {
    pub field_key: String,
    pub field_value: String,
    pub label: Option<String>,
}

/// Upsert a field by key (if the key exists, update the value; else insert).
pub fn upsert(db: &Database, req: UpsertFieldRequest) -> Result<FormField> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        // Check if the field_key already exists.
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM forms_vault_field WHERE field_key = ?1",
                params![req.field_key],
                |r| r.get(0),
            )
            .ok();
        let id_was_existing = existing_id.is_some();
        let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        if id_was_existing {
            conn.execute(
                "UPDATE forms_vault_field SET field_value = ?1, label = ?2, updated_at = ?3 WHERE id = ?4",
                params![req.field_value, req.label, now, id],
            )
            .map_err(map_sqlite)?;
        } else {
            conn.execute(
                "INSERT INTO forms_vault_field (id, field_key, field_value, label, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, req.field_key, req.field_value, req.label, now],
            )
            .map_err(map_sqlite)?;
        }
        read_row(conn, &id)
    })
}

pub fn list(db: &Database) -> Result<Vec<FormField>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, field_key, field_value, label, created_at, updated_at FROM forms_vault_field ORDER BY field_key")
            .map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_field).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

pub fn remove(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM forms_vault_field WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn clear_all(db: &Database) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM forms_vault_field", [])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<FormField> {
    conn.query_row(
        "SELECT id, field_key, field_value, label, created_at, updated_at FROM forms_vault_field WHERE id = ?1",
        params![id],
        row_to_field,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_field(row: &rusqlite::Row) -> rusqlite::Result<FormField> {
    Ok(FormField {
        id: row.get(0)?,
        field_key: row.get(1)?,
        field_value: row.get(2)?,
        label: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
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
        "Paperu could not read or write forms vault fields.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That forms-vault field wasn't found.",
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
    fn upsert_inserts_then_updates() {
        let db = fresh_db();
        let f1 = upsert(
            &db,
            UpsertFieldRequest {
                field_key: "name".to_string(),
                field_value: "Alice".to_string(),
                label: None,
            },
        )
        .unwrap();
        assert_eq!(f1.field_value, "Alice");
        // Upsert same key → update (same id).
        let f2 = upsert(
            &db,
            UpsertFieldRequest {
                field_key: "name".to_string(),
                field_value: "Bob".to_string(),
                label: Some("Full name".to_string()),
            },
        )
        .unwrap();
        assert_eq!(f2.id, f1.id, "upsert by key preserves the id");
        assert_eq!(f2.field_value, "Bob");
        assert_eq!(f2.label.as_deref(), Some("Full name"));
        assert_eq!(list(&db).unwrap().len(), 1, "no duplicate row");
    }

    #[test]
    fn list_orders_by_key() {
        let db = fresh_db();
        upsert(
            &db,
            UpsertFieldRequest {
                field_key: "phone".to_string(),
                field_value: "123".to_string(),
                label: None,
            },
        )
        .unwrap();
        upsert(
            &db,
            UpsertFieldRequest {
                field_key: "email".to_string(),
                field_value: "a@b.com".to_string(),
                label: None,
            },
        )
        .unwrap();
        upsert(
            &db,
            UpsertFieldRequest {
                field_key: "name".to_string(),
                field_value: "Alice".to_string(),
                label: None,
            },
        )
        .unwrap();
        let fields = list(&db).unwrap();
        assert_eq!(fields.len(), 3);
        // Ordered by field_key alphabetically: email, name, phone.
        assert_eq!(fields[0].field_key, "email");
        assert_eq!(fields[1].field_key, "name");
        assert_eq!(fields[2].field_key, "phone");
    }

    #[test]
    fn remove_and_clear_work() {
        let db = fresh_db();
        let f = upsert(
            &db,
            UpsertFieldRequest {
                field_key: "name".to_string(),
                field_value: "Alice".to_string(),
                label: None,
            },
        )
        .unwrap();
        assert_eq!(list(&db).unwrap().len(), 1);
        remove(&db, &f.id).unwrap();
        assert_eq!(list(&db).unwrap().len(), 0);
        // Clear on empty is safe.
        clear_all(&db).unwrap();
    }
}
