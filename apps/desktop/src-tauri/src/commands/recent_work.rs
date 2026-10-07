//! Recent work Tauri command wrappers.
//!
//! These commands require the Tauri runtime to inject `AppState`.
//! Without the `tauri-runtime` feature they are not compiled; the
//! underlying recent_work logic (`crate::recent_work`) is tested
//! directly with an in-memory database.

#![cfg(feature = "tauri-runtime")]

use crate::contracts::recent_work::{AddRecentWorkRequest, RecentWorkEntry};
use crate::errors::Result;
use crate::recent_work;
use crate::state::AppState;

/// Add a new recent-work entry. Returns the inserted entry.
#[tauri::command]
pub fn add_recent_work(
    state: tauri::State<'_, AppState>,
    request: AddRecentWorkRequest,
) -> Result<RecentWorkEntry> {
    recent_work::add(&state.db, request)
}

/// List recent-work entries, most-recent-first.
#[tauri::command]
pub fn list_recent_work(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<RecentWorkEntry>> {
    // Default to 50; the History view paginates anyway.
    let limit = limit.unwrap_or(50);
    recent_work::list(&state.db, limit)
}

/// Remove a single recent-work entry by id.
#[tauri::command]
pub fn remove_recent_work(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    recent_work::remove(&state.db, &id)
}

/// Clear all recent-work entries.
#[tauri::command]
pub fn clear_recent_work(state: tauri::State<'_, AppState>) -> Result<()> {
    recent_work::clear(&state.db)
}
