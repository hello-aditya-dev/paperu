//! Platform abstraction layer.
//!
//! Provides typed capabilities for platform-specific behavior that
//! genuinely differs across Windows, macOS, and Linux. Uses Rust
//! conditional compilation (`#[cfg(target_os = "...")]`) — never
//! fragile environment-string matching.
//!
//! Shared application logic calls these traits; the platform-specific
//! impls live in `windows.rs`, `macos.rs`, `linux.rs`.

pub mod linux;
pub mod macos;
pub mod windows;

use std::path::PathBuf;

/// Platform-specific capabilities. Each method returns a portable
/// value (String, PathBuf, bool) — no platform-specific types leak.
pub trait PlatformCapabilities {
    /// The platform's human-readable name (e.g. "Windows 11", "macOS 15", "Ubuntu 22.04").
    fn platform_name(&self) -> String;

    /// True if the filesystem supports hard links (Windows NTFS, macOS APFS,
    /// Linux ext4/xfs all do; FAT/exFAT do not).
    fn supports_hard_links(&self) -> bool;

    /// The platform's native path separator ("/" on Unix, "\\" on Windows).
    fn path_separator(&self) -> char;

    /// The platform's default application data directory.
    fn app_data_dir(&self) -> PathBuf;

    /// The platform's default temp directory.
    fn temp_dir(&self) -> PathBuf;

    /// Reveal a path in the platform's native file manager.
    /// Windows: `explorer.exe /select,<path>`.
    /// macOS: `open -R <path>`.
    /// Linux: `xdg-open <parent_dir>` (or dbus-based).
    fn reveal_in_file_manager(&self, path: &std::path::Path) -> Result<(), String>;

    /// Open a path with the platform's default application.
    /// Windows: `cmd /c start "" <path>`.
    /// macOS: `open <path>`.
    /// Linux: `xdg-open <path>`.
    fn open_with_default(&self, path: &std::path::Path) -> Result<(), String>;
}

/// The current platform's capabilities. Selected at compile time.
pub fn current() -> Box<dyn PlatformCapabilities> {
    #[cfg(target_os = "windows")]
    return Box::new(windows::WindowsPlatform);
    #[cfg(target_os = "macos")]
    return Box::new(macos::MacosPlatform);
    #[cfg(target_os = "linux")]
    return Box::new(linux::LinuxPlatform);
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    compile_error!("Paperu supports Windows, macOS, and Linux only.");
}

/// True if the current OS is Windows.
pub fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

/// True if the current OS is macOS.
pub fn is_macos() -> bool {
    cfg!(target_os = "macos")
}

/// True if the current OS is Linux.
pub fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_platform_resolves() {
        let p = current();
        assert_ne!(p.platform_name(), "");
        // supports_hard_links returns a bool — just call it to prove
        // the trait method is reachable.
        let _ = p.supports_hard_links();
    }

    #[test]
    fn exactly_one_os_flag_is_true() {
        let count = [is_windows(), is_macos(), is_linux()]
            .iter()
            .filter(|&&x| x)
            .count();
        assert_eq!(count, 1, "exactly one OS flag should be true");
    }
}
