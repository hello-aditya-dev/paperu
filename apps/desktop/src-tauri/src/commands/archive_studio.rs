#![cfg(feature = "tauri-runtime")]
use crate::archive_studio::{self, CreateResult, ExtractResult, ListResult};
use crate::errors::Result;
use std::path::PathBuf;

#[tauri::command]
pub fn validate_zip_entry(name: String) -> Result<PathBuf> {
    archive_studio::validate_zip_entry(&name)
}

#[tauri::command]
pub fn check_suspicious_ratio(uncompressed: u64, compressed: u64) -> bool {
    archive_studio::is_suspicious_ratio(uncompressed, compressed)
}

#[tauri::command]
pub fn check_destination_contained(base: String, target: String) -> bool {
    archive_studio::is_contained(std::path::Path::new(&base), std::path::Path::new(&target))
}

#[tauri::command]
pub fn list_archive(path: String) -> Result<ListResult> {
    archive_studio::list_archive(&path)
}

#[tauri::command]
pub fn extract_archive(path: String, dest: String) -> Result<ExtractResult> {
    archive_studio::extract_archive(&path, &dest)
}

#[tauri::command]
pub fn create_archive(archive_path: String, files: Vec<String>) -> Result<CreateResult> {
    archive_studio::create_archive(&archive_path, &files)
}
