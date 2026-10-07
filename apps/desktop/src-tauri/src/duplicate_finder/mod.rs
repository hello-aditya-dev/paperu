#![allow(warnings)]
//! Duplicate Finder — exact + similar duplicate grouping (Feature 9).
//! 50%: groups by size + first/last bytes comparison (fast exact dup check).
//! Perceptual hashing (pHash/dHash) for similar images is a later sprint.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub group_id: String,
    pub file_size: u64,
    pub human_readable_size: String,
    pub paths: Vec<String>,
    pub potential_space_saved: u64,
}

/// Scan a folder for exact duplicates. Groups by size, then confirms
/// via first 4KB + last 4KB comparison (fast, no full hash needed for 50%).
pub fn find_exact_duplicates(folder: &str) -> Result<Vec<DuplicateGroup>> {
    let root = Path::new(folder);
    if !root.exists() || !root.is_dir() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "That folder doesn't exist or isn't a folder.",
        )
        .build());
    }
    // Walk + group by size.
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    collect_files(root, &mut by_size)?;

    // For each size-group with >1 file, confirm duplicates via bytes.
    let mut groups = Vec::new();
    for (size, paths) in by_size {
        if paths.len() < 2 || size == 0 {
            continue;
        }
        let confirmed = confirm_duplicates(&paths, size)?;
        if confirmed.len() > 1 {
            let saved = size * (confirmed.len() as u64 - 1);
            groups.push(DuplicateGroup {
                group_id: format!("size-{}", size),
                file_size: size,
                human_readable_size: human_bytes(size),
                paths: confirmed
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect(),
                potential_space_saved: saved,
            });
        }
    }
    groups.sort_by(|a, b| b.potential_space_saved.cmp(&a.potential_space_saved));
    Ok(groups)
}

fn collect_files(dir: &Path, by_size: &mut HashMap<u64, Vec<PathBuf>>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(map_io)? {
        let entry = entry.map_err(map_io)?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, by_size)?;
        } else if let Ok(meta) = entry.metadata() {
            let size = meta.len();
            by_size.entry(size).or_default().push(path);
        }
    }
    Ok(())
}

/// Confirm duplicates by comparing first 4KB + last 4KB.
fn confirm_duplicates(paths: &[PathBuf], _size: u64) -> Result<Vec<PathBuf>> {
    let mut groups: HashMap<Vec<u8>, Vec<PathBuf>> = HashMap::new();
    for p in paths {
        let fingerprint = file_fingerprint(p)?;
        groups.entry(fingerprint).or_default().push(p.clone());
    }
    // Return the largest sub-group.
    let largest = groups.into_values().max_by_key(|v| v.len());
    Ok(largest.unwrap_or_default())
}

fn file_fingerprint(path: &Path) -> Result<Vec<u8>> {
    let bytes = fs::read(path).map_err(map_io)?;
    let len = bytes.len();
    let first = &bytes[..len.min(4096)];
    let last = if len > 4096 {
        &bytes[len.saturating_sub(4096)..]
    } else {
        &[]
    };
    let mut fp = Vec::with_capacity(8192);
    fp.extend_from_slice(first);
    fp.extend_from_slice(last);
    Ok(fp)
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
    fn finds_exact_duplicates() {
        let tmp = std::env::temp_dir().join(format!("paperu-dup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("a.txt"), b"identical content").unwrap();
        fs::write(tmp.join("b.txt"), b"identical content").unwrap();
        fs::write(tmp.join("c.txt"), b"different").unwrap();
        let groups = find_exact_duplicates(tmp.to_str().unwrap()).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].paths.len(), 2);
        assert!(groups[0].potential_space_saved > 0);
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn no_duplicates_returns_empty() {
        let tmp = std::env::temp_dir().join(format!("paperu-dup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("a.txt"), b"unique A").unwrap();
        fs::write(tmp.join("b.txt"), b"unique B").unwrap();
        let groups = find_exact_duplicates(tmp.to_str().unwrap()).unwrap();
        assert!(groups.is_empty());
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn rejects_nonexistent_folder() {
        let result = find_exact_duplicates("/nonexistent/path/xyz");
        assert!(result.is_err());
    }
}
