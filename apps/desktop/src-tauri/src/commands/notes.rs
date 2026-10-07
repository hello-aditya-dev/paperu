//! Notes Tauri commands (feature-gated to tauri-runtime).

#![cfg(feature = "tauri-runtime")]

use crate::contracts::notes::{
    CreateNoteFolderRequest, CreateNoteRequest, Note, NoteFolder, UpdateNoteRequest,
};
use crate::errors::Result;
use crate::notes;
use crate::state::AppState;

#[tauri::command]
pub fn create_note(state: tauri::State<'_, AppState>, request: CreateNoteRequest) -> Result<Note> {
    notes::create_note(&state.db, request)
}

#[tauri::command]
pub fn list_notes(
    state: tauri::State<'_, AppState>,
    include_deleted: Option<bool>,
) -> Result<Vec<Note>> {
    notes::list_notes(&state.db, include_deleted.unwrap_or(false))
}

#[tauri::command]
pub fn get_note(state: tauri::State<'_, AppState>, id: String) -> Result<Note> {
    notes::get_note(&state.db, &id)
}

#[tauri::command]
pub fn update_note(state: tauri::State<'_, AppState>, request: UpdateNoteRequest) -> Result<Note> {
    notes::update_note(&state.db, request)
}

#[tauri::command]
pub fn soft_delete_note(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    notes::soft_delete_note(&state.db, &id)
}

#[tauri::command]
pub fn restore_note(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    notes::restore_note(&state.db, &id)
}

#[tauri::command]
pub fn purge_deleted_notes(
    state: tauri::State<'_, AppState>,
    older_than_iso: String,
) -> Result<usize> {
    notes::purge_deleted(&state.db, &older_than_iso)
}

#[tauri::command]
pub fn create_note_folder(
    state: tauri::State<'_, AppState>,
    request: CreateNoteFolderRequest,
) -> Result<NoteFolder> {
    notes::create_folder(&state.db, request)
}

#[tauri::command]
pub fn list_note_folders(state: tauri::State<'_, AppState>) -> Result<Vec<NoteFolder>> {
    notes::list_folders(&state.db)
}

#[tauri::command]
pub fn search_notes(state: tauri::State<'_, AppState>, query: String) -> Result<Vec<Note>> {
    notes::search_notes(&state.db, &query)
}
