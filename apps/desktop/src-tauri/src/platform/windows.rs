//! Windows platform adapter.
#![cfg(target_os = "windows")]

use std::path::{Path, PathBuf};
use std::process::Command;

use super::PlatformCapabilities;

pub struct WindowsPlatform;

impl PlatformCapabilities for WindowsPlatform {
    fn platform_name(&self) -> String {
        "Windows".to_string()
    }

    fn supports_hard_links(&self) -> bool {
        // NTFS supports hard links; FAT/exFAT do not. We assume NTFS
        // for local app data (the common case).
        true
    }

    fn path_separator(&self) -> char {
        '\\'
    }

    fn app_data_dir(&self) -> PathBuf {
        // Use %LOCALAPPDATA% if available; fall back to %APPDATA%.
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local).join("paperu");
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("paperu");
        }
        std::env::temp_dir().join("paperu")
    }

    fn temp_dir(&self) -> PathBuf {
        std::env::temp_dir()
    }

    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), String> {
        // explorer.exe /select,<path> highlights the file.
        let parent = path.parent().unwrap_or(Path::new("."));
        let status = Command::new("explorer.exe")
            .arg("/select,")
            .arg(path)
            .status()
            .map_err(|e| format!("explorer.exe launch failed: {e}"))?;
        let _ = parent;
        if status.success() {
            Ok(())
        } else {
            Err(format!("explorer.exe exited with {}", status))
        }
    }

    fn open_with_default(&self, path: &Path) -> Result<(), String> {
        // `cmd /c start "" <path>` — the empty title is required.
        let status = Command::new("cmd")
            .arg("/c")
            .arg("start")
            .arg("")
            .arg(path)
            .status()
            .map_err(|e| format!("cmd launch failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("cmd exited with {}", status))
        }
    }
}
