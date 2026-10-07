//! Application kit Tauri commands (feature-gated to tauri-runtime).

#![cfg(feature = "tauri-runtime")]

use crate::application_kit;
use crate::contracts::application_kit::{
    AddApplicationKitItemRequest, ApplicationKitItem, UpdateApplicationKitItemRequest,
};
use crate::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn add_application_kit_item(
    state: tauri::State<'_, AppState>,
    request: AddApplicationKitItemRequest,
) -> Result<ApplicationKitItem> {
    application_kit::add(&state.db, request)
}

#[tauri::command]
pub fn list_application_kit_items(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ApplicationKitItem>> {
    application_kit::list(&state.db)
}

#[tauri::command]
pub fn update_application_kit_item(
    state: tauri::State<'_, AppState>,
    request: UpdateApplicationKitItemRequest,
) -> Result<ApplicationKitItem> {
    application_kit::update(&state.db, request)
}

#[tauri::command]
pub fn remove_application_kit_item(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    application_kit::remove(&state.db, &id)
}

/// Atomically replace a kit item's file reference (90% §7). Single
/// transactional UPDATE — preserves the id; failure leaves the original.
#[tauri::command]
pub fn replace_application_kit_item(
    state: tauri::State<'_, AppState>,
    id: String,
    request: AddApplicationKitItemRequest,
) -> Result<ApplicationKitItem> {
    application_kit::replace(&state.db, &id, request)
}
