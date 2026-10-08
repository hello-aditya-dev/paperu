//! Linux platform adapter.
#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::process::Command;

use super::PlatformCapabilities;

pub struct LinuxPlatform;

impl PlatformCapabilities for LinuxPlatform {
    fn platform_name(&self) -> String {
        "Linux".to_string()
    }

    fn supports_hard_links(&self) -> bool {
        // ext4/xfs/btrfs support hard links; FAT/exFAT/network mounts may not.
        // Assume local filesystem (the common case).
        true
    }

    fn path_separator(&self) -> char {
        '/'
    }

    fn app_data_dir(&self) -> PathBuf {
        // XDG standard: $XDG_DATA_HOME/paperu or ~/.local/share/paperu
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            if !xdg_data.is_empty() {
                return PathBuf::from(xdg_data).join("paperu");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("paperu");
        }
        std::env::temp_dir().join("paperu")
    }

    fn temp_dir(&self) -> PathBuf {
        // XDG standard: $XDG_RUNTIME_DIR or /tmp.
        if let Ok(xdg_runtime) = std::env::var("XDG_RUNTIME_DIR") {
            if !xdg_runtime.is_empty() {
                return PathBuf::from(xdg_runtime);
            }
        }
        std::env::temp_dir()
    }

    fn reveal_in_file_manager(&self, path: &Path) -> Result<(), String> {
        // xdg-open opens the parent directory in the default file manager.
        let parent = path.parent().unwrap_or(Path::new("."));
        let status = Command::new("xdg-open")
            .arg(parent)
            .status()
            .map_err(|e| format!("xdg-open launch failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("xdg-open exited with {}", status))
        }
    }

    fn open_with_default(&self, path: &Path) -> Result<(), String> {
        let status = Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| format!("xdg-open launch failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("xdg-open exited with {}", status))
        }
    }
}
