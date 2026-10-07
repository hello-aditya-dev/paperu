#![cfg(feature = "tauri-runtime")]
use crate::duplicate_finder::{self, DuplicateGroup};
use crate::errors::Result;

#[tauri::command]
pub fn find_exact_duplicates(folder: String) -> Result<Vec<DuplicateGroup>> {
    duplicate_finder::find_exact_duplicates(&folder)
}
