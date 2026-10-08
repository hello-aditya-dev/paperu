#![cfg(feature = "tauri-runtime")]
use crate::clipboard_history::{self, AddEntryRequest, ClipboardEntry};
use crate::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn add_clipboard_entry(
    state: tauri::State<'_, AppState>,
    request: AddEntryRequest,
) -> Result<ClipboardEntry> {
    clipboard_history::add_entry(&state.db, request)
}

#[tauri::command]
pub fn list_clipboard_entries(
    state: tauri::State<'_, AppState>,
    query: Option<String>,
) -> Result<Vec<ClipboardEntry>> {
    clipboard_history::list_entries(&state.db, query.as_deref())
}

#[tauri::command]
pub fn set_clipboard_entry_pinned(
    state: tauri::State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<ClipboardEntry> {
    clipboard_history::set_pinned(&state.db, &id, pinned)
}

#[tauri::command]
pub fn delete_clipboard_entry(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    clipboard_history::delete_entry(&state.db, &id)
}

#[tauri::command]
pub fn clear_clipboard_history(state: tauri::State<'_, AppState>) -> Result<()> {
    clipboard_history::clear_all(&state.db)
}

#[tauri::command]
pub fn clipboard_entry_count(state: tauri::State<'_, AppState>) -> Result<i64> {
    clipboard_history::entry_count(&state.db)
}
