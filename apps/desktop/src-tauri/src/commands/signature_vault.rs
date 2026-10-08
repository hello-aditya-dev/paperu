#![cfg(feature = "tauri-runtime")]
//! Tauri commands for the Signature Vault (90% §37). Local-only signature
//! file references. Mirrors the application_kit command pattern.

use crate::errors::Result;
use crate::signature_vault::{self, AddSignatureRequest, SignatureItem, UpdateSignatureRequest};
use crate::state::AppState;

#[tauri::command]
pub fn add_signature_item(
    state: tauri::State<'_, AppState>,
    request: AddSignatureRequest,
) -> Result<SignatureItem> {
    signature_vault::add(&state.db, request)
}

#[tauri::command]
pub fn list_signature_items(state: tauri::State<'_, AppState>) -> Result<Vec<SignatureItem>> {
    signature_vault::list(&state.db)
}

#[tauri::command]
pub fn update_signature_item(
    state: tauri::State<'_, AppState>,
    request: UpdateSignatureRequest,
) -> Result<SignatureItem> {
    signature_vault::update(&state.db, request)
}

/// Atomically replace a signature's file reference (preserves the id).
#[tauri::command]
pub fn replace_signature_item(
    state: tauri::State<'_, AppState>,
    id: String,
    request: AddSignatureRequest,
) -> Result<SignatureItem> {
    signature_vault::replace(&state.db, &id, request)
}

#[tauri::command]
pub fn remove_signature_item(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    signature_vault::remove(&state.db, &id)
}
