//! Study Packs — organize files + notes into named packs (90% §41).
//! Schema in migration 0006 (study_pack + study_pack_item). Local-only.

use rusqlite::params;
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPack {
    pub id: String,
    pub name: String,
    pub subject: Option<String>,
    pub semester: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPackItem {
    pub id: String,
    pub pack_id: String,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_kind: Option<String>,
    pub note_id: Option<String>,
    pub label: String,
    pub section: Option<String>,
    pub pinned: bool,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePackRequest {
    pub name: String,
    pub subject: Option<String>,
    pub semester: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddItemRequest {
    pub pack_id: String,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub file_kind: Option<String>,
    pub note_id: Option<String>,
    pub label: String,
    pub section: Option<String>,
}

pub fn create_pack(db: &Database, req: CreatePackRequest) -> Result<StudyPack> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO study_pack (id, name, subject, semester, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, req.name, req.subject, req.semester, req.description, now],
        )
        .map_err(map_sqlite)?;
        read_pack(conn, &id)
    })
}

pub fn list_packs(db: &Database) -> Result<Vec<StudyPack>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, name, subject, semester, description, created_at, updated_at FROM study_pack ORDER BY name")
            .map_err(map_sqlite)?;
        let rows = stmt.query_map([], |r| Ok(StudyPack {
            id: r.get(0)?, name: r.get(1)?, subject: r.get(2)?, semester: r.get(3)?,
            description: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)?,
        })).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(map_sqlite)?); }
        Ok(out)
    })
}

pub fn delete_pack(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM study_pack WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn add_item(db: &Database, req: AddItemRequest) -> Result<StudyPackItem> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO study_pack_item (id, pack_id, file_path, file_name, file_kind, note_id, label, section, pinned, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9)",
            params![id, req.pack_id, req.file_path, req.file_name, req.file_kind, req.note_id, req.label, req.section, now],
        )
        .map_err(map_sqlite)?;
        read_item(conn, &id)
    })
}

pub fn list_items(db: &Database, pack_id: &str) -> Result<Vec<StudyPackItem>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, pack_id, file_path, file_name, file_kind, note_id, label, section, pinned, sort_order, created_at FROM study_pack_item WHERE pack_id = ?1 ORDER BY pinned DESC, sort_order, created_at")
            .map_err(map_sqlite)?;
        let rows = stmt.query_map(params![pack_id], |r| {
            let pinned_int: i64 = r.get(8)?;
            Ok(StudyPackItem {
                id: r.get(0)?, pack_id: r.get(1)?, file_path: r.get(2)?, file_name: r.get(3)?,
                file_kind: r.get(4)?, note_id: r.get(5)?, label: r.get(6)?, section: r.get(7)?,
                pinned: pinned_int != 0, sort_order: r.get(9)?, created_at: r.get(10)?,
            })
        }).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(map_sqlite)?); }
        Ok(out)
    })
}

pub fn remove_item(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM study_pack_item WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

fn read_pack(conn: &rusqlite::Connection, id: &str) -> Result<StudyPack> {
    conn.query_row(
        "SELECT id, name, subject, semester, description, created_at, updated_at FROM study_pack WHERE id = ?1",
        params![id], |r| Ok(StudyPack {
            id: r.get(0)?, name: r.get(1)?, subject: r.get(2)?, semester: r.get(3)?,
            description: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)?,
        }),
    ).map_err(|e| map_sqlite_not_found(e, id))
}

fn read_item(conn: &rusqlite::Connection, id: &str) -> Result<StudyPackItem> {
    conn.query_row(
        "SELECT id, pack_id, file_path, file_name, file_kind, note_id, label, section, pinned, sort_order, created_at FROM study_pack_item WHERE id = ?1",
        params![id], |r| {
            let pinned_int: i64 = r.get(8)?;
            Ok(StudyPackItem {
                id: r.get(0)?, pack_id: r.get(1)?, file_path: r.get(2)?, file_name: r.get(3)?,
                file_kind: r.get(4)?, note_id: r.get(5)?, label: r.get(6)?, section: r.get(7)?,
                pinned: pinned_int != 0, sort_order: r.get(9)?, created_at: r.get(10)?,
            })
        },
    ).map_err(|e| map_sqlite_not_found(e, id))
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
        "Paperu could not read or write study packs.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That study pack or item wasn't found.",
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
    fn create_list_delete_pack() {
        let db = fresh_db();
        let p = create_pack(
            &db,
            CreatePackRequest {
                name: "Sem 3 Physics".to_string(),
                subject: Some("Physics".to_string()),
                semester: Some("3".to_string()),
                description: None,
            },
        )
        .unwrap();
        assert_eq!(list_packs(&db).unwrap().len(), 1);
        delete_pack(&db, &p.id).unwrap();
        assert_eq!(list_packs(&db).unwrap().len(), 0);
    }

    #[test]
    fn add_list_remove_items() {
        let db = fresh_db();
        let p = create_pack(
            &db,
            CreatePackRequest {
                name: "Test".to_string(),
                subject: None,
                semester: None,
                description: None,
            },
        )
        .unwrap();
        add_item(
            &db,
            AddItemRequest {
                pack_id: p.id.clone(),
                file_path: Some("/x/a.pdf".to_string()),
                file_name: Some("a.pdf".to_string()),
                file_kind: Some("pdf".to_string()),
                note_id: None,
                label: "Chapter 1".to_string(),
                section: None,
            },
        )
        .unwrap();
        add_item(
            &db,
            AddItemRequest {
                pack_id: p.id.clone(),
                file_path: None,
                file_name: None,
                file_kind: None,
                note_id: Some("note-123".to_string()),
                label: "Notes".to_string(),
                section: None,
            },
        )
        .unwrap();
        let items = list_items(&db, &p.id).unwrap();
        assert_eq!(items.len(), 2);
        remove_item(&db, &items[0].id).unwrap();
        assert_eq!(list_items(&db, &p.id).unwrap().len(), 1);
    }

    #[test]
    fn delete_pack_cascades_items() {
        let db = fresh_db();
        let p = create_pack(
            &db,
            CreatePackRequest {
                name: "Cascade".to_string(),
                subject: None,
                semester: None,
                description: None,
            },
        )
        .unwrap();
        add_item(
            &db,
            AddItemRequest {
                pack_id: p.id.clone(),
                file_path: None,
                file_name: None,
                file_kind: None,
                note_id: None,
                label: "Item".to_string(),
                section: None,
            },
        )
        .unwrap();
        assert_eq!(list_items(&db, &p.id).unwrap().len(), 1);
        delete_pack(&db, &p.id).unwrap();
        assert_eq!(
            list_items(&db, &p.id).unwrap().len(),
            0,
            "cascade deletes items"
        );
    }
}
