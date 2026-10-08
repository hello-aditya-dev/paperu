#![cfg(feature = "tauri-runtime")]
//! Watch Rules — gated Tauri commands for CRUD on watch rules (P5f).

use crate::errors::Result;
use crate::state::AppState;
use crate::watch_rules::{self, CreateWatchRuleRequest, WatchRule};

#[tauri::command]
pub fn create_watch_rule(
    state: tauri::State<'_, AppState>,
    request: CreateWatchRuleRequest,
) -> Result<WatchRule> {
    watch_rules::create_rule(&state.db, request)
}

#[tauri::command]
pub fn list_watch_rules(state: tauri::State<'_, AppState>) -> Result<Vec<WatchRule>> {
    watch_rules::list_rules(&state.db)
}

#[tauri::command]
pub fn delete_watch_rule(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    watch_rules::delete_rule(&state.db, &id)
}

#[tauri::command]
pub fn toggle_watch_rule(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<WatchRule> {
    watch_rules::toggle_rule(&state.db, &id, enabled)
}
