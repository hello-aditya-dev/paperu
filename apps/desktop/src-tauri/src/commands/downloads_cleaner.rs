#![cfg(feature = "tauri-runtime")]
use crate::downloads_cleaner::{self, FileEntry};
use crate::errors::Result;

#[tauri::command]
pub fn scan_downloads_folder(folder: String) -> Result<Vec<FileEntry>> {
    downloads_cleaner::scan_folder(&folder)
}
