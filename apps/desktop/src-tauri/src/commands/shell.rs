//! `reveal_path` and `open_path` commands — platform-native file
//! revelation and opening.
//!
//! These let the user open a produced output file in its default
//! application, or reveal it in the file manager (Explorer on Windows,
//! Finder on macOS, xdg-open on Linux).
//!
//! Security: the path is re-validated server-side via
//! `validate_input_path`. The commands only open files that exist on
//! disk. They never grant the webview arbitrary shell access — the
//! commands are narrow-purpose Rust functions, not general shell
//! executors. The Tauri capability surface is unchanged.

use std::path::Path;

use crate::contracts::common::FilePath;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use crate::filesystem;

/// Request to reveal a file in the platform file manager.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealPathRequest {
    /// Absolute path to the file to reveal. Re-validated server-side.
    pub path: FilePath,
}

/// `reveal_path` command: open the file's parent folder in the platform
/// file manager, selecting the file.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn reveal_path(request: RevealPathRequest) -> Result<()> {
    let path = filesystem::paths::validate_input_path(&request.path)?;
    if !path.exists() {
        return Err(AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "Paperu can't find that file to reveal it.",
        )
        .severity(ErrorSeverity::Warning)
        .build());
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer /select,"path"` opens Explorer with the file selected.
        std::process::Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| {
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't open File Explorer.",
                )
                .technical(e.to_string())
                .build()
            })?;
    }

    #[cfg(target_os = "macos")]
    {
        // `open -R path` reveals the file in Finder.
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| {
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't open Finder.",
                )
                .technical(e.to_string())
                .build()
            })?;
    }

    #[cfg(target_os = "linux")]
    {
        // Reveal the parent directory; xdg-open doesn't support file
        // selection, so we open the containing folder.
        let parent = path.parent().unwrap_or(Path::new("/"));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| {
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't open the file manager.",
                )
                .technical(e.to_string())
                .build()
            })?;
    }

    Ok(())
}

/// Request to open a file with its default application.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPathRequest {
    /// Absolute path to the file to open. Re-validated server-side.
    pub path: FilePath,
}

/// `open_path` command: open a file with the platform default
/// application.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn open_path(request: OpenPathRequest) -> Result<()> {
    let path = filesystem::paths::validate_input_path(&request.path)?;
    if !path.exists() {
        return Err(AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "Paperu can't find that file to open it.",
        )
        .severity(ErrorSeverity::Warning)
        .build());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| {
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't open that file.",
                )
                .technical(e.to_string())
                .build()
            })?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| {
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't open that file.",
                )
                .technical(e.to_string())
                .build()
            })?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| {
                AppError::builder(
                    code::IO_FAILURE,
                    ErrorCategory::Filesystem,
                    "Paperu couldn't open that file.",
                )
                .technical(e.to_string())
                .build()
            })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveal_rejects_empty_path() {
        let req = RevealPathRequest {
            path: String::new(),
        };
        let result = reveal_path(req);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::EMPTY_INPUT);
    }

    #[test]
    fn open_rejects_empty_path() {
        let req = OpenPathRequest {
            path: String::new(),
        };
        let result = open_path(req);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, code::EMPTY_INPUT);
    }

    #[test]
    fn reveal_rejects_nonexistent() {
        let req = RevealPathRequest {
            path: "/nonexistent/path/that/does/not/exist/file.pdf".into(),
        };
        let result = reveal_path(req);
        // validate_input_path falls back to lexical form for nonexistent
        // paths, then the exists() check fails.
        assert!(result.is_err());
    }
}
