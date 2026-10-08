#![cfg(feature = "tauri-runtime")]
//! Watch Folders — Tauri command wrappers over `crate::watch::WatchService`.
//!
//! The notify watcher logic (debouncing, self-loop prevention, lifecycle)
//! lives in `crate::watch` (pure Rust, unit-tested). This module is the
//! thin Tauri boundary: it owns a `WatchService` in app state, emits
//! `paperu://watch-event` for the frontend feed, AND dispatches any
//! matching watch rules (P5f, AUTO-03) on each event.

use crate::database::Database;
use crate::errors::Result;
use crate::watch::{WatchEvent, WatchService};
use crate::watch_rules;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// The WATCH_EVENT_CHANNEL is re-exported from contracts; keep a local
/// copy so this module is self-contained.
const WATCH_EVENT_CHANNEL: &str = "paperu://watch-event";

/// App-managed state holding the active watcher.
pub struct WatchState {
    pub service: Mutex<WatchService>,
    /// A clone of the Database so the watch callback can look up +
    /// dispatch matching rules. None if the DB wasn't available at
    /// start time (rare; rule dispatch is skipped).
    pub db: Option<Database>,
}

impl Default for WatchState {
    fn default() -> Self {
        WatchState {
            service: Mutex::new(WatchService::new()),
            db: None,
        }
    }
}

/// Start watching a folder (recursive, debounced 400ms). Emits
/// `paperu://watch-event` for each debounced change + dispatches any
/// matching watch rules (P5f). Replaces any existing watcher.
#[tauri::command]
pub fn start_watch_folder(
    path: String,
    app: AppHandle,
    state: State<'_, WatchState>,
    app_state: State<'_, crate::state::AppState>,
) -> Result<()> {
    // Clone the DB so the watch callback can look up rules.
    let db = app_state.db.clone();
    let mut svc = state.service.lock().unwrap();
    // Stash the DB on WatchState so the callback can access it.
    // (We pass it into the closure directly instead — simpler.)
    svc.start(&path, move |ev: WatchEvent| {
        // Emit to the frontend feed.
        let _ = app.emit(WATCH_EVENT_CHANNEL, &ev);
        // P5f: dispatch matching watch rules. Non-destructive only
        // (backup_recipe copy+verify, recipe typed ops, organizer_rule
        // honestly skipped). Self-loop prevention is in
        // `watch::is_paperu_output`; recursive-loop prevention is in
        // `watch_rules::dispatch_action`.
        let path = std::path::Path::new(&ev.path);
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let folder = path.parent().and_then(|p| p.to_str()).unwrap_or(&ev.path);
        if !file_name.is_empty() {
            if let Ok(matches) = watch_rules::find_matching_rules(&db, folder, file_name) {
                for rule in matches {
                    let res = watch_rules::dispatch_action(&db, &rule, &ev.path);
                    tracing::info!(
                        rule_id = %res.rule_id,
                        action = %res.action_type,
                        status = %res.status,
                        msg = %res.message,
                        "watch rule dispatched"
                    );
                }
            }
        }
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
