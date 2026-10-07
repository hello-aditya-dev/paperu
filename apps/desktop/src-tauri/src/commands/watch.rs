#![cfg(feature = "tauri-runtime")]
//! Watch Folders — Tauri command wrappers over `crate::watch::WatchService`.
//!
//! The notify watcher logic (debouncing, self-loop prevention, lifecycle)
//! lives in `crate::watch` (pure Rust, unit-tested). This module is the
//! thin Tauri boundary: it owns a `WatchService` in app state and emits
//! events to the frontend via `paperu://watch-event`.

use crate::errors::Result;
use crate::watch::{WatchEvent, WatchService};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// The WATCH_EVENT_CHANNEL is re-exported from contracts; keep a local
/// copy so this module is self-contained.
const WATCH_EVENT_CHANNEL: &str = "paperu://watch-event";

/// App-managed state holding the active watcher.
pub struct WatchState {
    pub service: Mutex<WatchService>,
}

impl Default for WatchState {
    fn default() -> Self {
        WatchState {
            service: Mutex::new(WatchService::new()),
        }
    }
}

/// Start watching a folder (recursive, debounced 400ms). Emits
/// `paperu://watch-event` for each debounced change. Replaces any
/// existing watcher. The path must exist + be a directory.
#[tauri::command]
pub fn start_watch_folder(
    path: String,
    app: AppHandle,
    state: State<'_, WatchState>,
) -> Result<()> {
    let mut svc = state.service.lock().unwrap();
    svc.start(&path, move |ev: WatchEvent| {
        let _ = app.emit(WATCH_EVENT_CHANNEL, ev);
    })
}

/// Stop the active watcher (if any). Safe to call when none is active.
#[tauri::command]
pub fn stop_watch_folder(state: State<'_, WatchState>) -> Result<()> {
    state.service.lock().unwrap().stop();
    Ok(())
}

/// Returns the currently-watched path (null if none).
#[tauri::command]
pub fn current_watch_folder(state: State<'_, WatchState>) -> Option<String> {
    state
        .service
        .lock()
        .unwrap()
        .current_path()
        .map(|s| s.to_string())
}
