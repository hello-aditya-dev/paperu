#![allow(warnings)]
//! Rename Studio — previewed bulk rename engine (Master Prompt Feature 10).
//! Pure string-processing logic, fully testable without Tauri runtime.
//! The frontend calls `preview_rename` to compute proposed names, then
//! `execute_rename` to atomically rename files via std::fs::rename.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use std::path::{Path, PathBuf};

/// Configuration for a bulk rename operation.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConfig {
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub numbering: Option<bool>,
    pub numbering_start: Option<u32>,
    pub numbering_padding: Option<u32>,
    pub find: Option<String>,
    pub replace: Option<String>,
    pub case_conversion: Option<String>, // none|upper|lower|title
    pub trim_whitespace: Option<bool>,
    pub cleanup_illegal: Option<bool>,
    pub extension_change: Option<String>,
}

/// A single file's rename preview.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePreview {
    pub source_path: String,
    pub current_name: String,
    pub proposed_name: String,
    pub has_collision: bool,
    pub warning: Option<String>,
}

/// Preview a bulk rename. Does NOT touch the filesystem.
pub fn preview(paths: &[String], config: &RenameConfig) -> Result<Vec<RenamePreview>> {
    let mut used_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut previews = Vec::with_capacity(paths.len());
    let counter_start = config.numbering_start.unwrap_or(1);
    let padding = config.numbering_padding.unwrap_or(0);

    for (idx, path_str) in paths.iter().enumerate() {
        let path = Path::new(path_str);
        let current_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let (stem, ext) = split_name(&current_name);

        // Start with the stem.
        let mut new_stem = stem.to_string();

        // Find/replace.
        if let (Some(find), Some(replace)) = (&config.find, &config.replace) {
            if !find.is_empty() {
                new_stem = new_stem.replace(find, replace);
            }
        }

        // Case conversion.
        if let Some(case) = &config.case_conversion {
            new_stem = match case.as_str() {
                "upper" => new_stem.to_uppercase(),
                "lower" => new_stem.to_lowercase(),
                "title" => to_title_case(&new_stem),
                _ => new_stem,
            };
        }

        // Trim whitespace.
        if config.trim_whitespace.unwrap_or(false) {
            new_stem = new_stem.trim().to_string();
            new_stem = new_stem.split_whitespace().collect::<Vec<_>>().join(" ");
        }

        // Cleanup illegal Windows chars.
        if config.cleanup_illegal.unwrap_or(false) {
            new_stem = cleanup_illegal_chars(&new_stem);
        }

        // Numbering.
        if config.numbering.unwrap_or(false) {
            let num = counter_start + idx as u32;
            let num_str = if padding > 0 {
                format!("{:0width$}", num, width = padding as usize)
            } else {
                num.to_string()
            };
            new_stem = format!("{}{}", new_stem, num_str);
        }

        // Prefix / suffix.
        if let Some(prefix) = &config.prefix {
            new_stem = format!("{}{}", prefix, new_stem);
        }
        if let Some(suffix) = &config.suffix {
            new_stem = format!("{}{}", new_stem, suffix);
        }

        // Extension change.
        let new_ext = config.extension_change.as_deref().unwrap_or(ext);
        let proposed_name = if new_ext.is_empty() {
            new_stem.clone()
        } else {
            format!("{}.{}", new_stem, new_ext)
        };

        // Collision detection.
        let collision = used_names.contains(&proposed_name);
        if !collision {
            used_names.insert(proposed_name.clone());
        }

        // Warnings.
        let warning = if collision {
            Some("Collision detected — will be skipped unless resolved.".to_string())
        } else if is_windows_reserved(&proposed_name) {
            Some("Windows reserved name — may cause issues.".to_string())
        } else if proposed_name != current_name && config.extension_change.is_some() {
            Some("Extension changed — verify this is intended.".to_string())
        } else {
            None
        };

        previews.push(RenamePreview {
            source_path: path_str.clone(),
            current_name,
            proposed_name,
            has_collision: collision,
            warning,
        });
    }
    Ok(previews)
}

/// Execute renames. Only renames files that don't have collisions.
/// Returns (succeeded, skipped, errors).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub succeeded: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

pub fn execute(paths: &[String], config: &RenameConfig) -> Result<RenameResult> {
    let previews = preview(paths, config)?;
    let mut succeeded = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();
    let mut used_targets: std::collections::HashSet<String> = std::collections::HashSet::new();

    for p in &previews {
        if p.has_collision || used_targets.contains(&p.proposed_name) {
            skipped.push(p.source_path.clone());
            continue;
        }
        let source = Path::new(&p.source_path);
        let parent = source.parent().unwrap_or(Path::new("."));
        let target = parent.join(&p.proposed_name);
        used_targets.insert(p.proposed_name.clone());
        match std::fs::rename(source, &target) {
            Ok(()) => succeeded.push(p.source_path.clone()),
            Err(e) => errors.push(format!("{}: {}", p.source_path, e)),
        }
    }
    Ok(RenameResult {
        succeeded,
        skipped,
        errors,
    })
}

fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(pos) if pos > 0 => (&name[..pos], &name[pos + 1..]),
        _ => (name, ""),
    }
}

fn to_title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn cleanup_illegal_chars(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}

fn is_windows_reserved(name: &str) -> bool {
    let upper = name.to_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    matches!(
        stem,
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_prefix_suffix() {
        let config = RenameConfig {
            prefix: Some("paperu_".to_string()),
            suffix: Some("_v2".to_string()),
            numbering: None,
            numbering_start: None,
            numbering_padding: None,
            find: None,
            replace: None,
            case_conversion: None,
            trim_whitespace: None,
            cleanup_illegal: None,
            extension_change: None,
        };
        let previews = preview(&["/tmp/report.pdf".to_string()], &config).unwrap();
        assert_eq!(previews[0].proposed_name, "paperu_report_v2.pdf");
    }

    #[test]
    fn preview_numbering_with_padding() {
        let config = RenameConfig {
            prefix: None,
            suffix: None,
            numbering: Some(true),
            numbering_start: Some(1),
            numbering_padding: Some(3),
            find: None,
            replace: None,
            case_conversion: None,
            trim_whitespace: None,
            cleanup_illegal: None,
            extension_change: None,
        };
        let paths: Vec<String> = (0..3).map(|i| format!("/tmp/file_{i}.txt")).collect();
        let previews = preview(&paths, &config).unwrap();
        assert_eq!(previews[0].proposed_name, "file_0001.txt");
        assert_eq!(previews[1].proposed_name, "file_1002.txt");
        assert_eq!(previews[2].proposed_name, "file_2003.txt");
    }

    #[test]
    fn preview_find_replace() {
        let config = RenameConfig {
            prefix: None,
            suffix: None,
            numbering: None,
            numbering_start: None,
            numbering_padding: None,
            find: Some("old".to_string()),
            replace: Some("new".to_string()),
            case_conversion: None,
            trim_whitespace: None,
            cleanup_illegal: None,
            extension_change: None,
        };
        let previews = preview(&["/tmp/old_report.pdf".to_string()], &config).unwrap();
        assert_eq!(previews[0].proposed_name, "new_report.pdf");
    }

    #[test]
    fn preview_case_title() {
        let config = RenameConfig {
            prefix: None,
            suffix: None,
            numbering: None,
            numbering_start: None,
            numbering_padding: None,
            find: None,
            replace: None,
            case_conversion: Some("title".to_string()),
            trim_whitespace: None,
            cleanup_illegal: None,
            extension_change: None,
        };
        let previews = preview(&["/tmp/my file.pdf".to_string()], &config).unwrap();
        assert_eq!(previews[0].proposed_name, "My File.pdf");
    }

    #[test]
    fn preview_collision_detected() {
        let config = RenameConfig {
            prefix: Some("x".to_string()),
            suffix: None,
            numbering: None,
            numbering_start: None,
            numbering_padding: None,
            find: None,
            replace: None,
            case_conversion: None,
            trim_whitespace: None,
            cleanup_illegal: None,
            extension_change: None,
        };
        // Two files that would both become "xa.pdf" and "xb.pdf" — no collision.
        let paths = vec!["/tmp/a.pdf".to_string(), "/tmp/b.pdf".to_string()];
        let previews = preview(&paths, &config).unwrap();
        assert!(!previews[0].has_collision);
        assert!(!previews[1].has_collision);
    }

    #[test]
    fn preview_cleanup_illegal() {
        let config = RenameConfig {
            prefix: None,
            suffix: None,
            numbering: None,
            numbering_start: None,
            numbering_padding: None,
            find: None,
            replace: None,
            case_conversion: None,
            trim_whitespace: None,
            cleanup_illegal: Some(true),
            extension_change: None,
        };
        let previews = preview(&["/tmp/file<bad>:name.pdf".to_string()], &config).unwrap();
        assert_eq!(previews[0].proposed_name, "file_bad__name.pdf");
    }

    #[test]
    fn windows_reserved_detected() {
        assert!(is_windows_reserved("CON.txt"));
        assert!(is_windows_reserved("PRN"));
        assert!(!is_windows_reserved("report.pdf"));
    }

    #[test]
    fn execute_renames_files() {
        let tmp = std::env::temp_dir().join(format!("paperu-rename-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let f1 = tmp.join("a.txt");
        std::fs::write(&f1, "x").unwrap();
        let config = RenameConfig {
            prefix: Some("pre_".to_string()),
            suffix: None,
            numbering: None,
            numbering_start: None,
            numbering_padding: None,
            find: None,
            replace: None,
            case_conversion: None,
            trim_whitespace: None,
            cleanup_illegal: None,
            extension_change: None,
        };
        let result = execute(&[f1.to_string_lossy().to_string()], &config).unwrap();
        assert_eq!(result.succeeded.len(), 1);
        assert!(tmp.join("pre_a.txt").exists());
        std::fs::remove_dir_all(&tmp).ok();
    }
}
