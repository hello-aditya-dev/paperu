#![cfg(feature = "tauri-runtime")]
use crate::backup_recipes::{self, BackupRecipe, BackupRunResult, CreateRecipeRequest};
use crate::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn create_backup_recipe(
    state: tauri::State<'_, AppState>,
    request: CreateRecipeRequest,
) -> Result<BackupRecipe> {
    backup_recipes::create_recipe(&state.db, request)
}

#[tauri::command]
pub fn list_backup_recipes(state: tauri::State<'_, AppState>) -> Result<Vec<BackupRecipe>> {
    backup_recipes::list_recipes(&state.db)
}

#[tauri::command]
pub fn delete_backup_recipe(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    backup_recipes::delete_recipe(&state.db, &id)
}

#[tauri::command]
pub fn run_backup_recipe(state: tauri::State<'_, AppState>, id: String) -> Result<BackupRunResult> {
    backup_recipes::run_recipe(&state.db, &id)
}
