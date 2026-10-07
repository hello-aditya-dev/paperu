#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::organizer::{self, DryRunResult, ExecuteResult, OrganizerRule};
use crate::state::AppState;

#[tauri::command]
pub fn save_organizer_rule(
    state: tauri::State<'_, AppState>,
    rule: OrganizerRule,
) -> Result<String> {
    organizer::save_rule(&state.db, &rule)
}

#[tauri::command]
pub fn list_organizer_rules(state: tauri::State<'_, AppState>) -> Result<Vec<OrganizerRule>> {
    organizer::list_rules(&state.db)
}

#[tauri::command]
pub fn delete_organizer_rule(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    organizer::delete_rule(&state.db, &id)
}

#[tauri::command]
pub fn dry_run_organizer(rule: OrganizerRule) -> Result<DryRunResult> {
    organizer::dry_run(&rule)
}

#[tauri::command]
pub fn execute_organizer(rule: OrganizerRule) -> Result<ExecuteResult> {
    organizer::execute(&rule)
}
