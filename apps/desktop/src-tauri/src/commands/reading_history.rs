//! Reading history Tauri commands (feature-gated to tauri-runtime).

#![cfg(feature = "tauri-runtime")]

use crate::contracts::reading_history::{ReadingHistoryEntry, UpdateReadingHistoryRequest};
use crate::errors::Result;
use crate::reading_history;
use crate::state::AppState;

#[tauri::command]
pub fn upsert_reading_history(
    state: tauri::State<'_, AppState>,
    request: UpdateReadingHistoryRequest,
) -> Result<ReadingHistoryEntry> {
    reading_history::upsert(&state.db, request)
}

#[tauri::command]
pub fn get_reading_history(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Option<ReadingHistoryEntry>> {
    reading_history::get_for_path(&state.db, &path)
}

#[tauri::command]
pub fn list_reading_history(state: tauri::State<'_, AppState>) -> Result<Vec<ReadingHistoryEntry>> {
    reading_history::list(&state.db)
}

#[tauri::command]
pub fn remove_reading_history(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    reading_history::remove(&state.db, &id)
}

#[tauri::command]
pub fn clear_reading_history(state: tauri::State<'_, AppState>) -> Result<()> {
    reading_history::clear(&state.db)
}
