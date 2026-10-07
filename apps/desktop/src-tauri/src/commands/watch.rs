#![cfg(feature = "tauri-runtime")]
//! Watch Folders — debounced filesystem watching via `notify`
//! (CC0) + `notify-debouncer-mini` (MIT/Apache). OSS harvest §22.
//!
//! On Windows this uses ReadDirectoryChangesW (notify's native platform
//! mechanism); on macOS FSEvents; on Linux inotify. Paperu never
//! hand-rolls platform watcher code.
//!
//! Events are debounced (default 400ms) to coalesce rapid sequences,
//! then emitted to the frontend as `paperu://watch-event` with the
//! changed paths + kind (create/modify/remove). The frontend decides
//! what to do with them — Paperu takes NO destructive automatic action
//! (§22). Self-loop prevention: events whose paths end in
//! `-paperu-*` (Paperu's own finalize_output suffixes) are filtered so
//! a Watch Folder rule doesn't re-trigger on Paperu's own output.

use crate::errors::{code, AppError, ErrorCategory, Result};
use crate::state::AppState;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// The event payload emitted to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub path: String,
    pub kind: String, // create | modify | remove | rename
}

/// The active watcher, held in app state.
pub struct WatchState {
    pub debouncer:
        Mutex<Option<Debouncer<notify::RecommendedWatcher, notify_debouncer_mini::DebouncedEvent>>>,
    pub current_path: Mutex<Option<String>>,
}

impl Default for WatchState {
    fn default() -> Self {
        WatchState {
            debouncer: Mutex::new(None),
            current_path: Mutex::new(None),
        }
    }
}

/// Start watching a folder. Replaces any existing watcher (one at a time
/// for V1). Emits `paperu://watch-event` for each debounced change.
/// The path must exist + be a directory.
#[tauri::command]
pub fn start_watch_folder(
    path: String,
    app: AppHandle,
    state: State<'_, WatchState>,
) -> Result<()> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Choose an existing folder to watch.",
        )
        .technical(format!("not a directory: {path}"))
        .build());
    }
    // Set up the debounced watcher before replacing the old one, so a
    // failure to start the new watcher doesn't leave us with none.
    let app_for_callback = app.clone();
    let watcher_path = path.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let events = res.unwrap_or_default();
            for ev in events {
                for changed in &ev.paths {
                    let lossy = changed.to_string_lossy().to_string();
                    // Self-loop prevention: ignore Paperu's own output files.
                    if lossy.contains("-paperu-")
                        || lossy.contains("-portal-ready")
                        || lossy.contains("-print-")
                        || lossy.contains("-fit")
                        || lossy.contains("-rescued")
                        || lossy.contains("-archive")
                    {
                        continue;
                    }
                    let kind = if ev.event.kind.is_create() {
                        "create"
                    } else if ev.event.kind.is_modify() {
                        "modify"
                    } else if ev.event.kind.is_remove() {
                        "remove"
                    } else if ev.event.kind.is_access() {
                        "access"
                    } else {
                        "other"
                    };
                    let _ = app_for_callback.emit(
                        "paperu://watch-event",
                        WatchEvent {
                            path: lossy,
                            kind: kind.to_string(),
                        },
                    );
                }
            }
        },
    )
    .map_err(|e| {
        AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "Paperu couldn't start watching that folder.",
        )
        .technical(e.to_string())
        .build()
    })?;
    debouncer
        .watch(&p, notify::RecursiveMode::Recursive)
        .map_err(|e| {
            AppError::builder(
                code::PROCESSING_FAILED,
                ErrorCategory::Processing,
                "Paperu couldn't watch that folder. Check the path and permissions.",
            )
            .technical(e.to_string())
            .build()
        })?;
    // Replace the old watcher (dropping it stops the underlying watcher).
    *state.debouncer.lock().unwrap() = Some(debouncer);
    *state.current_path.lock().unwrap() = Some(watcher_path);
    Ok(())
}

/// Stop the active watcher (if any). Safe to call when none is active.
#[tauri::command]
pub fn stop_watch_folder(state: State<'_, WatchState>) -> Result<()> {
    let mut guard = state.debouncer.lock().unwrap();
    *guard = None; // dropping the Debouncer stops the watcher.
    *state.current_path.lock().unwrap() = None;
    Ok(())
}

/// Returns the currently-watched path (null if none).
#[tauri::command]
pub fn current_watch_folder(state: State<'_, WatchState>) -> Option<String> {
    state.current_path.lock().unwrap().clone()
}

/// AppState already holds the DB; the WatchState is a separate managed
/// state. This helper is unused but keeps the import referenced.
#[allow(dead_code)]
fn _state_ref(_s: &AppState) {}
