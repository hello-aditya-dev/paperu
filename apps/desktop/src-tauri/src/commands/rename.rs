#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::rename::{self, RenameConfig, RenamePreview, RenameResult};

#[tauri::command]
pub fn preview_rename(paths: Vec<String>, config: RenameConfig) -> Result<Vec<RenamePreview>> {
    rename::preview(&paths, &config)
}

#[tauri::command]
pub fn execute_rename(paths: Vec<String>, config: RenameConfig) -> Result<RenameResult> {
    rename::execute(&paths, &config)
}
