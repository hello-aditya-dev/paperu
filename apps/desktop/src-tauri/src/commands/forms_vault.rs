#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::forms_vault::{self, FormField, UpsertFieldRequest};
use crate::state::AppState;

#[tauri::command]
pub fn upsert_forms_field(
    state: tauri::State<'_, AppState>,
    request: UpsertFieldRequest,
) -> Result<FormField> {
    forms_vault::upsert(&state.db, request)
}

#[tauri::command]
pub fn list_forms_fields(state: tauri::State<'_, AppState>) -> Result<Vec<FormField>> {
    forms_vault::list(&state.db)
}

#[tauri::command]
pub fn remove_forms_field(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    forms_vault::remove(&state.db, &id)
}

#[tauri::command]
pub fn clear_forms_fields(state: tauri::State<'_, AppState>) -> Result<()> {
    forms_vault::clear_all(&state.db)
}
