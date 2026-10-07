// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "tauri-runtime")]
fn main() {
    paperu::run();
}

#[cfg(not(feature = "tauri-runtime"))]
fn main() {
    // Without the tauri-runtime feature, the desktop shell is not
    // compiled. This stub exists so `cargo check` / `cargo test` work
    // on any platform. The real entry point is the `tauri-runtime`
    // build used by CI and release engineering.
    eprintln!("paperu: compiled without tauri-runtime feature; core-only mode");
}
