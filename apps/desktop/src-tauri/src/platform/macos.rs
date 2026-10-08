//! macOS platform adapter.
#![cfg(target_os = "macos")]

use std::path::{Path, PathBuf};
use std::process::Command;

use super::PlatformCapabilities;

pub struct MacosPlatform;

impl PlatformCapabilities for MacosPlatform {
    fn platform_name(&self) -> String {
        "macOS".to_string()
    }

    fn supports_hard_links(&self) -> bool {
        // APFS supports hard links; HFS+ does too.
        true
    }

    fn path_separator(&self) -> char {
        '/'
    }

    fn app_data_dir(&self) -> PathBuf {
        // ~/Library/Application Support/paperu
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("paperu");
        }
        std::env::temp_dir().join("paperu")
    }

    fn temp_dir(&self) -> PathBuf {
        std::env::temp_dir()
    }

    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), String> {
        // `open -R <path>` reveals the file in Finder.
        let status = Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|e| format!("open launch failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("open exited with {}", status))
        }
    }

    fn open_with_default(&self, path: &Path) -> Result<(), String> {
        let status = Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| format!("open launch failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("open exited with {}", status))
        }
    }
}
