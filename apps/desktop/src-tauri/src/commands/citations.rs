#![cfg(feature = "tauri-runtime")]
use crate::citations::{self, CitationEntry, SavedCitation};
use crate::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn save_citation(
    state: tauri::State<'_, AppState>,
    entry: CitationEntry,
) -> Result<SavedCitation> {
    citations::save(&state.db, &entry)
}

#[tauri::command]
pub fn list_citations(state: tauri::State<'_, AppState>) -> Result<Vec<SavedCitation>> {
    citations::list(&state.db)
}

#[tauri::command]
pub fn delete_citation(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    citations::delete(&state.db, &id)
}

#[tauri::command]
pub fn format_citation(entry: CitationEntry, style: String) -> String {
    citations::format_citation(&entry, &style)
}
