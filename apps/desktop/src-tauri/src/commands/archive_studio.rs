#![cfg(feature = "tauri-runtime")]
use crate::archive_studio::{self};
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
