#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::state::AppState;
use crate::timer_jobs::{self, CreateTimerRequest, TimerJob};

#[tauri::command]
pub fn create_timer_job(
    state: tauri::State<'_, AppState>,
    request: CreateTimerRequest,
) -> Result<TimerJob> {
    timer_jobs::create_timer(&state.db, request)
}

#[tauri::command]
pub fn list_timer_jobs(state: tauri::State<'_, AppState>) -> Result<Vec<TimerJob>> {
    timer_jobs::list_timers(&state.db)
}

#[tauri::command]
pub fn delete_timer_job(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    timer_jobs::delete_timer(&state.db, &id)
}

#[tauri::command]
pub fn toggle_timer_job(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<TimerJob> {
    timer_jobs::toggle_timer(&state.db, &id, enabled)
}
