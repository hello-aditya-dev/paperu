#![cfg(feature = "tauri-runtime")]
use std::sync::Arc;

use crate::errors::Result;
use crate::state::AppState;
use crate::timer_jobs::clock::SystemClock;
use crate::timer_jobs::scheduler::Scheduler;
use crate::timer_jobs::{self, CreateTimerRequest, TimerJob, TimerJobHistory, UpdateTimerRequest};

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
    let _ = timer_jobs::toggle_timer(&state.db, &id, enabled)?;
    // When re-enabling, recompute next_run from now.
    if enabled {
        let _ = timer_jobs::reschedule(&state.db, &id);
    }
    timer_jobs::get_timer(&state.db, &id)
}

#[tauri::command]
pub fn update_timer_job(
    state: tauri::State<'_, AppState>,
    request: UpdateTimerRequest,
) -> Result<TimerJob> {
    timer_jobs::update_timer(&state.db, request)
}

#[tauri::command]
pub fn get_timer_job_history(
    state: tauri::State<'_, AppState>,
    id: String,
    limit: Option<i64>,
) -> Result<Vec<TimerJobHistory>> {
    timer_jobs::list_history(&state.db, &id, limit.unwrap_or(50))
}

/// Manually trigger a timer job immediately (manual "Run now"). Useful
/// for testing + for users who don't want to wait. Claims a fresh
/// occurrence keyed on the current time (so it doesn't collide with
/// any scheduled occurrence). Records a history row. Does NOT advance
/// next_run (the manual run is independent of the schedule).
#[tauri::command]
pub fn trigger_timer_job_now(state: tauri::State<'_, AppState>, id: String) -> Result<TimerJob> {
    let job = timer_jobs::get_timer(&state.db, &id)?;
    let started = chrono::Utc::now();
    let occ_key = format!("{}#manual", started.to_rfc3339());
    // Claim (always wins — unique key includes "#manual" suffix).
    let _ = timer_jobs::claim_occurrence(&state.db, &id, &occ_key, started)?;
    // Dispatch via the scheduler's action dispatcher.
    let sched = Scheduler::new(state.db.clone(), Arc::new(SystemClock));
    let result = sched.dispatch_action_for(&job);
    let finished = chrono::Utc::now();
    timer_jobs::record_completion(&state.db, &job, &occ_key, started, finished, &result)?;
    // For manual runs we don't advance the scheduled next_run — the
    // user can re-read the job to see the unchanged next_run.
    timer_jobs::get_timer(&state.db, &id)
}
