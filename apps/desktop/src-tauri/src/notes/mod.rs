//! Notes logic — local-first notes with autosave + soft-delete
//! (Master Prompt 4 §27-32).
//!
//! Body is markdown-ish text, stored as a single TEXT blob. Autosave
//! is an atomic UPSERT (UPDATE on existing rows) — a crash never
//! loses the last committed state. NEVER uploaded. Search is local.

use rusqlite::params;
use uuid::Uuid;

use crate::contracts::notes::{
    CreateNoteFolderRequest, CreateNoteRequest, Note, NoteFolder, UpdateNoteRequest,
};
use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};

/// Create a new note. Returns the inserted note.
pub fn create_note(db: &Database, req: CreateNoteRequest) -> Result<Note> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        let title = req.title.unwrap_or_default();
        let body = req.body.unwrap_or_default();
        let tags_json =
            serde_json::to_string(&req.tags.unwrap_or_default()).map_err(AppError::from)?;
        conn.execute(
            "INSERT INTO note (id, folder_id, title, body, pinned, tags,
                               created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?6, NULL)",
            params![id, req.folder_id, title, body, tags_json, now],
        )
        .map_err(map_sqlite)?;
        read_note_row(conn, &id)
    })
}

/// List notes (most-recent-first). If `include_deleted` is false,
/// soft-deleted notes are excluded.
pub fn list_notes(db: &Database, include_deleted: bool) -> Result<Vec<Note>> {
    db.with_conn(|conn| {
        let sql = if include_deleted {
            "SELECT id, folder_id, title, body, pinned, tags, created_at, updated_at, deleted_at
             FROM note ORDER BY pinned DESC, updated_at DESC"
        } else {
            "SELECT id, folder_id, title, body, pinned, tags, created_at, updated_at, deleted_at
             FROM note WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC"
        };
        let mut stmt = conn.prepare(sql).map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_note).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

/// Get a single note by id.
pub fn get_note(db: &Database, id: &str) -> Result<Note> {
    db.with_conn(|conn| read_note_row(conn, id))
}

/// Autosave: update a note's body/title/tags atomically. Only
/// provided fields are updated. Called on every keystroke (debounced).
pub fn update_note(db: &Database, req: UpdateNoteRequest) -> Result<Note> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        let current = read_note_row(conn, &req.id)?;
        let title = req.title.unwrap_or(current.title);
        let body = req.body.unwrap_or(current.body);
        let folder_id = req.folder_id.or(current.folder_id);
        let pinned = req.pinned.unwrap_or(current.pinned);
        let tags = req.tags.unwrap_or(current.tags);
        let tags_json = serde_json::to_string(&tags).map_err(AppError::from)?;
        conn.execute(
            "UPDATE note SET title = ?1, body = ?2, folder_id = ?3,
                             pinned = ?4, tags = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                title,
                body,
                folder_id,
                i64::from(pinned),
                tags_json,
                now,
                req.id
            ],
        )
        .map_err(map_sqlite)?;
        read_note_row(conn, &req.id)
    })
}

/// Soft-delete a note (moves to "recently deleted"). Hard-delete
/// happens via purge_deleted after the restore window.
pub fn soft_delete_note(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        conn.execute(
            "UPDATE note SET deleted_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

/// Restore a soft-deleted note.
pub fn restore_note(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE note SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

/// Purge all soft-deleted notes older than the given cutoff (ISO timestamp).
pub fn purge_deleted(db: &Database, older_than_iso: &str) -> Result<usize> {
    db.with_conn(|conn| {
        let n = conn
            .execute(
                "DELETE FROM note WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
                params![older_than_iso],
            )
            .map_err(map_sqlite)?;
        Ok(n)
    })
}

/// Create a folder.
pub fn create_folder(db: &Database, req: CreateNoteFolderRequest) -> Result<NoteFolder> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO note_folder (id, name, parent_id, sort_order, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            params![id, req.name, req.parent_id, now],
        )
        .map_err(map_sqlite)?;
        conn.query_row(
            "SELECT id, name, parent_id, sort_order, created_at FROM note_folder WHERE id = ?1",
            params![id],
            |row| {
                Ok(NoteFolder {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
        .map_err(map_sqlite)
    })
}

/// List folders.
pub fn list_folders(db: &Database) -> Result<Vec<NoteFolder>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, parent_id, sort_order, created_at
                 FROM note_folder ORDER BY sort_order, name",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(NoteFolder {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
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

/// Local search across title, body, tags. No AI, no remote indexing.
pub fn search_notes(db: &Database, query: &str) -> Result<Vec<Note>> {
    let q = format!("%{}%", query.trim().to_lowercase());
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, folder_id, title, body, pinned, tags, created_at, updated_at, deleted_at
                 FROM note
                 WHERE deleted_at IS NULL
                   AND (LOWER(title) LIKE ?1 OR LOWER(body) LIKE ?1 OR LOWER(tags) LIKE ?1)
                 ORDER BY pinned DESC, updated_at DESC",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map(params![q], row_to_note)
            .map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

// ── helpers ──────────────────────────────────────────────────────

fn read_note_row(conn: &rusqlite::Connection, id: &str) -> Result<Note> {
    conn.query_row(
        "SELECT id, folder_id, title, body, pinned, tags, created_at, updated_at, deleted_at
         FROM note WHERE id = ?1",
        params![id],
        row_to_note,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let pinned_int: i64 = row.get(4)?;
    Ok(Note {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        pinned: pinned_int != 0,
        tags,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
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
        "Paperu could not read or write your notes.",
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
            "Paperu could not find that note.",
        )
        .technical(format!("note id {id} not in db"))
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

    #[test]
    fn create_and_get_note() {
        let db = fresh_db();
        let note = create_note(
            &db,
            CreateNoteRequest {
                folder_id: None,
                title: Some("First note".to_string()),
                body: Some("Hello world".to_string()),
                tags: Some(vec!["todo".to_string()]),
            },
        )
        .unwrap();
        assert_eq!(note.title, "First note");
        assert_eq!(note.tags, vec!["todo".to_string()]);
        assert_ne!(note.id, "");

        let fetched = get_note(&db, &note.id).unwrap();
        assert_eq!(fetched.body, "Hello world");
    }

    #[test]
    fn autosave_preserves_state() {
        let db = fresh_db();
        let note = create_note(
            &db,
            CreateNoteRequest {
                folder_id: None,
                title: None,
                body: None,
                tags: None,
            },
        )
        .unwrap();
        // Simulate autosave: update body multiple times.
        let updated = update_note(
            &db,
            UpdateNoteRequest {
                id: note.id.clone(),
                body: Some("new body".to_string()),
                title: None,
                folder_id: None,
                pinned: None,
                tags: None,
            },
        )
        .unwrap();
        assert_eq!(updated.body, "new body");
        assert_eq!(updated.title, ""); // unchanged
    }

    #[test]
    fn soft_delete_then_restore() {
        let db = fresh_db();
        let note = create_note(
            &db,
            CreateNoteRequest {
                folder_id: None,
                title: None,
                body: None,
                tags: None,
            },
        )
        .unwrap();
        soft_delete_note(&db, &note.id).unwrap();
        // Not in default list.
        assert_eq!(list_notes(&db, false).unwrap().len(), 0);
        // But IS in include_deleted list.
        assert_eq!(list_notes(&db, true).unwrap().len(), 1);
        // Restore.
        restore_note(&db, &note.id).unwrap();
        assert_eq!(list_notes(&db, false).unwrap().len(), 1);
    }

    #[test]
    fn search_finds_in_title_body_tags() {
        let db = fresh_db();
        create_note(
            &db,
            CreateNoteRequest {
                folder_id: None,
                title: Some("Algorithms homework".to_string()),
                body: Some("Chapter 3 exercises".to_string()),
                tags: Some(vec!["cs".to_string()]),
            },
        )
        .unwrap();
        create_note(
            &db,
            CreateNoteRequest {
                folder_id: None,
                title: Some("Grocery list".to_string()),
                body: Some("milk, eggs, algorithms".to_string()),
                tags: None,
            },
        )
        .unwrap();
        // Search in title.
        assert_eq!(search_notes(&db, "algorithms").unwrap().len(), 2);
        // Search in body.
        assert_eq!(search_notes(&db, "exercises").unwrap().len(), 1);
        // Search in tags.
        assert_eq!(search_notes(&db, "cs").unwrap().len(), 1);
    }

    #[test]
    fn folders_can_be_created_and_listed() {
        let db = fresh_db();
        create_folder(
            &db,
            CreateNoteFolderRequest {
                name: "Study".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        create_folder(
            &db,
            CreateNoteFolderRequest {
                name: "Personal".to_string(),
                parent_id: None,
            },
        )
        .unwrap();
        assert_eq!(list_folders(&db).unwrap().len(), 2);
    }
}
