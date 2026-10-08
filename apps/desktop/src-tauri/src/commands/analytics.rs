#![cfg(feature = "tauri-runtime")]
use crate::analytics::{self, AnalyticsEvent};
use crate::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn log_analytics_event(
    state: tauri::State<'_, AppState>,
    event_type: String,
    detail: Option<String>,
) -> Result<()> {
    analytics::log_event(&state.db, &event_type, detail.as_deref())
}

#[tauri::command]
pub fn list_analytics_events(
    state: tauri::State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<AnalyticsEvent>> {
    analytics::list_events(&state.db, limit.unwrap_or(100))
}

#[tauri::command]
pub fn clear_analytics_events(state: tauri::State<'_, AppState>) -> Result<()> {
    analytics::clear_events(&state.db)
}

#[tauri::command]
pub fn analytics_event_count(state: tauri::State<'_, AppState>) -> Result<i64> {
    analytics::event_count(&state.db)
}
