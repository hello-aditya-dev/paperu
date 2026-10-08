//! Signature Vault — the user's local-only signature references (90% §37).
//!
//! Stores ONLY file references + metadata (never signature image bytes in
//! the DB). Variants: full signature, initials, guardian/work slot.
//! Privacy doctrine: local-only, no uploads, no AI.
//!
//! Mirrors the application_kit CRUD pattern (add/list/update/remove +
//! atomic replace). The actual signature FILES live on the user's disk;
//! Paperu stores the path + metadata so workflows (Sign PDF, Assignment
//! Studio, Application Kit) can reuse them.

use rusqlite::params;
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

/// The signature variant.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SignatureVariant {
    Full,
    Initials,
    Guardian,
    Work,
}

impl SignatureVariant {
    fn as_str(&self) -> &'static str {
        match self {
            SignatureVariant::Full => "full",
            SignatureVariant::Initials => "initials",
            SignatureVariant::Guardian => "guardian",
            SignatureVariant::Work => "work",
        }
    }
    fn from_str(s: &str) -> Self {
        match s {
            "initials" => SignatureVariant::Initials,
            "guardian" => SignatureVariant::Guardian,
            "work" => SignatureVariant::Work,
            _ => SignatureVariant::Full,
        }
    }
}

/// A stored signature reference.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureItem {
    pub id: String,
    pub label: String,
    pub variant: SignatureVariant,
    pub file_path: String,
    pub file_name: String,
    pub file_kind: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub notes: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Request to add a new signature.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSignatureRequest {
    pub label: String,
    pub variant: SignatureVariant,
    pub file_path: String,
    pub file_name: String,
    pub file_kind: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub notes: Option<String>,
}

/// Request to update a signature (label/notes/sort only — file ref uses replace).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSignatureRequest {
    pub id: String,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub sort_order: Option<i64>,
}

pub fn add(db: &Database, req: AddSignatureRequest) -> Result<SignatureItem> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO signature_vault_item
                (id, label, variant, file_path, file_name, file_kind,
                 mime_type, size_bytes, notes, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)",
            params![
                id,
                req.label,
                req.variant.as_str(),
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

pub fn list(db: &Database) -> Result<Vec<SignatureItem>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, label, variant, file_path, file_name, file_kind,
                        mime_type, size_bytes, notes, sort_order, created_at, updated_at
                 FROM signature_vault_item
                 ORDER BY variant, sort_order, created_at",
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

pub fn update(db: &Database, req: UpdateSignatureRequest) -> Result<SignatureItem> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        let current = read_row(conn, &req.id)?;
        let label = req.label.unwrap_or(current.label);
        let notes = req.notes.or(current.notes);
        let sort_order = req.sort_order.unwrap_or(current.sort_order);
        conn.execute(
            "UPDATE signature_vault_item
             SET label = ?1, notes = ?2, sort_order = ?3, updated_at = ?4
             WHERE id = ?5",
            params![label, notes, sort_order, now, req.id],
        )
        .map_err(map_sqlite)?;
        read_row(conn, &req.id)
    })
}

/// Atomically replace a signature's file reference (90% §7 pattern).
pub fn replace(db: &Database, id: &str, req: AddSignatureRequest) -> Result<SignatureItem> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        let changed = conn
            .execute(
                "UPDATE signature_vault_item SET
                label = ?1, variant = ?2, file_path = ?3, file_name = ?4,
                file_kind = ?5, mime_type = ?6, size_bytes = ?7, notes = ?8,
                updated_at = ?9
             WHERE id = ?10",
                params![
                    req.label,
                    req.variant.as_str(),
                    req.file_path,
                    req.file_name,
                    req.file_kind,
                    req.mime_type,
                    req.size_bytes,
                    req.notes,
                    now,
                    id,
                ],
            )
            .map_err(map_sqlite)?;
        if changed == 0 {
            return Err(AppError::builder(
                code::FILE_NOT_FOUND,
                ErrorCategory::Filesystem,
                "That signature wasn't found.",
            )
            .technical(format!("id={id}"))
            .build());
        }
        read_row(conn, id)
    })
}

pub fn remove(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM signature_vault_item WHERE id = ?1",
            params![id],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── helpers ──────────────────────────────────────────────────────

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<SignatureItem> {
    conn.query_row(
        "SELECT id, label, variant, file_path, file_name, file_kind,
                mime_type, size_bytes, notes, sort_order, created_at, updated_at
         FROM signature_vault_item WHERE id = ?1",
        params![id],
        row_to_item,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<SignatureItem> {
    Ok(SignatureItem {
        id: row.get(0)?,
        label: row.get(1)?,
        variant: SignatureVariant::from_str(&row.get::<_, String>(2)?),
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
        crate::errors::ErrorCategory::Database,
        "Paperu could not read or write signature vault items.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That signature wasn't found.",
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

    fn sample_request(label: &str, variant: SignatureVariant) -> AddSignatureRequest {
        AddSignatureRequest {
            label: label.to_string(),
            variant,
            file_path: "/home/user/sig.png".to_string(),
            file_name: "sig.png".to_string(),
            file_kind: "image".to_string(),
            mime_type: Some("image/png".to_string()),
            size_bytes: Some(12345),
            notes: None,
        }
    }

    #[test]
    fn add_list_round_trip() {
        let db = fresh_db();
        add(&db, sample_request("My Signature", SignatureVariant::Full)).unwrap();
        add(&db, sample_request("Initials", SignatureVariant::Initials)).unwrap();
        let items = list(&db).unwrap();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn update_changes_label_only() {
        let db = fresh_db();
        let item = add(&db, sample_request("Original", SignatureVariant::Full)).unwrap();
        update(
            &db,
            UpdateSignatureRequest {
                id: item.id,
                label: Some("Updated".to_string()),
                notes: Some("note".to_string()),
                sort_order: None,
            },
        )
        .unwrap();
        let updated = list(&db).unwrap()[0].clone();
        assert_eq!(updated.label, "Updated");
        assert_eq!(updated.notes.as_deref(), Some("note"));
        // File path unchanged.
        assert_eq!(updated.file_path, item.file_path);
    }

    #[test]
    fn replace_preserves_id() {
        let db = fresh_db();
        let original = add(&db, sample_request("Sig", SignatureVariant::Full)).unwrap();
        let mut new_req = sample_request("Sig v2", SignatureVariant::Initials);
        new_req.file_path = "/new/path/sig.png".to_string();
        let replaced = replace(&db, &original.id, new_req).unwrap();
        assert_eq!(replaced.id, original.id, "replace preserves the id");
        assert_eq!(replaced.label, "Sig v2");
        assert_eq!(replaced.file_path, "/new/path/sig.png");
        assert_eq!(list(&db).unwrap().len(), 1, "no orphan row");
    }

    #[test]
    fn remove_works() {
        let db = fresh_db();
        let item = add(&db, sample_request("ToDelete", SignatureVariant::Full)).unwrap();
        assert_eq!(list(&db).unwrap().len(), 1);
        remove(&db, &item.id).unwrap();
        assert_eq!(list(&db).unwrap().len(), 0);
    }
}
