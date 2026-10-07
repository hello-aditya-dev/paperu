//! Settings commands.
//!
//! These commands require the Tauri runtime to inject `AppState`.
//! Without the `tauri-runtime` feature they are not compiled; the
//! underlying settings logic (`crate::settings`) is tested directly.

#![cfg(feature = "tauri-runtime")]

use crate::contracts::settings::{Settings, SettingsPatch};
use crate::errors::Result;
use crate::state::AppState;

/// Read the current settings.
#[tauri::command]
pub fn read_settings(state: tauri::State<'_, AppState>) -> Result<Settings> {
    crate::settings::load(&state.db)
}

/// Apply a partial settings patch and return the new settings.
#[tauri::command]
pub fn write_settings(state: tauri::State<'_, AppState>, patch: SettingsPatch) -> Result<Settings> {
    crate::settings::apply_patch(&state.db, &patch)
}
