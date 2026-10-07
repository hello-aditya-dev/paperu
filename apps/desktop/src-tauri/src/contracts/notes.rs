//! Notes contract (Rust mirror of `notes.ts`).
//!
//! Local-first notes with autosave + soft-delete (Master Prompt 4 §27-32).
//! Body is stored as markdown-ish text. NEVER uploaded. Search is local.

use serde::{Deserialize, Serialize};

/// A single note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub body: String,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// A folder for organizing notes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

/// Request to create a new note.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub folder_id: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// Request to update a note. Used by autosave — only provided fields update.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    pub id: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub folder_id: Option<String>,
    pub pinned: Option<bool>,
    pub tags: Option<Vec<String>>,
}

/// Request to create a folder.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}
