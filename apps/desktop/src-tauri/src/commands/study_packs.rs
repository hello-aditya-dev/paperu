#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::state::AppState;
use crate::study_packs::{self, AddItemRequest, CreatePackRequest, StudyPack, StudyPackItem};

#[tauri::command]
pub fn create_study_pack(
    state: tauri::State<'_, AppState>,
    request: CreatePackRequest,
) -> Result<StudyPack> {
    study_packs::create_pack(&state.db, request)
}

#[tauri::command]
pub fn list_study_packs(state: tauri::State<'_, AppState>) -> Result<Vec<StudyPack>> {
    study_packs::list_packs(&state.db)
}

#[tauri::command]
pub fn delete_study_pack(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    study_packs::delete_pack(&state.db, &id)
}

#[tauri::command]
pub fn add_study_pack_item(
    state: tauri::State<'_, AppState>,
    request: AddItemRequest,
) -> Result<StudyPackItem> {
    study_packs::add_item(&state.db, request)
}

#[tauri::command]
pub fn list_study_pack_items(
    state: tauri::State<'_, AppState>,
    packId: String,
) -> Result<Vec<StudyPackItem>> {
    study_packs::list_items(&state.db, &packId)
}

#[tauri::command]
pub fn remove_study_pack_item(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    study_packs::remove_item(&state.db, &id)
}
