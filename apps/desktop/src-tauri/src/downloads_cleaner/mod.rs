#![allow(warnings)]
//! Downloads Cleaner — local folder scan + categorization (Feature 8).
//! 50%: scans a user-chosen folder, categorizes by extension, sorts by
//! age/size/type. Never auto-deletes — shows a preview for user action.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub category: String,
    pub size_bytes: u64,
    pub human_readable_size: String,
    pub modified_at: String,
}

/// Scan a folder and categorize files. Returns all files with their category.
pub fn scan_folder(folder: &str) -> Result<Vec<FileEntry>> {
    let root = Path::new(folder);
    if !root.exists() || !root.is_dir() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "That folder doesn't exist or isn't a folder.",
        )
        .build());
    }
    let mut entries = Vec::new();
    collect(root, &mut entries)?;
    // Sort by size descending.
    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(entries)
}

fn collect(dir: &Path, entries: &mut Vec<FileEntry>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(map_io)? {
        let entry = entry.map_err(map_io)?;
        let path = entry.path();
        if path.is_dir() {
            collect(&path, entries)?;
        } else if let Ok(meta) = entry.metadata() {
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let category = categorize(&ext);
            let modified = meta
                .modified()
                .map(|t| format!("{:?}", t))
                .unwrap_or_else(|_| "unknown".to_string());
            entries.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                name,
                category,
                size_bytes: meta.len(),
                human_readable_size: human_bytes(meta.len()),
                modified_at: modified,
            });
        }
    }
    Ok(())
}

fn categorize(ext: &str) -> String {
    match ext {
        "exe" | "msi" | "deb" | "rpm" | "dmg" | "appimage" => "installers".to_string(),
        "pdf" => "pdf".to_string(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "svg" => "images".to_string(),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" => "archives".to_string(),
        "mp4" | "avi" | "mov" | "mkv" | "webm" => "video".to_string(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" => "audio".to_string(),
        "doc" | "docx" | "odt" | "rtf" | "txt" | "csv" | "xlsx" | "xls" | "pptx" | "ppt" => {
            "documents".to_string()
        }
        _ => "other".to_string(),
    }
}

fn human_bytes(n: u64) -> String {
    if n < 1024 {
        return format!("{} B", n);
    }
    if n < 1048576 {
        return format!("{:.1} KB", n as f64 / 1024.0);
    }
    if n < 1073741824 {
        return format!("{:.1} MB", n as f64 / 1048576.0);
    }
    format!("{:.2} GB", n as f64 / 1073741824.0)
}

fn map_io(err: std::io::Error) -> AppError {
    AppError::builder(
        code::IO_FAILURE,
        ErrorCategory::Filesystem,
        "Paperu couldn't read a file.",
    )
    .technical(err.to_string())
    .severity(ErrorSeverity::Error)
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorize_extensions() {
        assert_eq!(categorize("pdf"), "pdf");
        assert_eq!(categorize("exe"), "installers");
        assert_eq!(categorize("jpg"), "images");
        assert_eq!(categorize("zip"), "archives");
        assert_eq!(categorize("mp4"), "video");
        assert_eq!(categorize("xyz"), "other");
    }

    #[test]
    fn scan_returns_files() {
        let tmp = std::env::temp_dir().join(format!("paperu-clean-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("report.pdf"), b"pdf content").unwrap();
        fs::write(tmp.join("photo.jpg"), b"image").unwrap();
        let entries = scan_folder(tmp.to_str().unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.category == "pdf"));
        assert!(entries.iter().any(|e| e.category == "images"));
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn rejects_nonexistent() {
        assert!(scan_folder("/nonexistent/xyz").is_err());
    }
}
