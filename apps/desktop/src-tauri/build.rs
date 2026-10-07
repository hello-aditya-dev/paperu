fn main() {
    // The Tauri build script only runs when the `tauri-runtime` feature
    // is enabled (i.e. on a platform with Tauri's system dependencies).
    #[cfg(feature = "tauri-runtime")]
    {
        tauri_build::build()
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        // No build script work needed for core-only checks.
    }
}
