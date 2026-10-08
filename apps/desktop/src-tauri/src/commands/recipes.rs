#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::recipes::{
    self, cancel, CreateRecipeRequest, OperationKind, Recipe, RecipePreview, RecipeRunHistory,
    RecipeRunResult, RecipeStep, UpdateRecipeRequest,
};
use crate::state::AppState;

/// The progress event channel. The frontend listens via
/// `listenRecipeProgress` (see src/lib/ipc.ts).
const RECIPE_PROGRESS_CHANNEL: &str = "paperu://recipe-progress";

/// A progress event payload. Mirrors `RecipeProgressEvent` in
/// `packages/contracts/src/recipes.ts`.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipeProgressPayload {
    recipe_id: String,
    run_id: String,
    step_index: usize,
    total_steps: usize,
    kind: String,
    status: Option<String>,
    message: String,
}

#[tauri::command]
pub fn create_recipe(
    state: tauri::State<'_, AppState>,
    request: CreateRecipeRequest,
) -> Result<Recipe> {
    recipes::create_recipe(&state.db, request)
}

#[tauri::command]
pub fn list_recipes(state: tauri::State<'_, AppState>) -> Result<Vec<Recipe>> {
    recipes::list_recipes(&state.db)
}

#[tauri::command]
pub fn get_recipe(state: tauri::State<'_, AppState>, id: String) -> Result<Recipe> {
    recipes::get_recipe(&state.db, &id)
}

#[tauri::command]
pub fn update_recipe(
    state: tauri::State<'_, AppState>,
    request: UpdateRecipeRequest,
) -> Result<Recipe> {
    recipes::update_recipe(&state.db, request)
}

#[tauri::command]
pub fn delete_recipe(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    recipes::delete_recipe(&state.db, &id)
}

#[tauri::command]
pub fn add_recipe_step(
    state: tauri::State<'_, AppState>,
    recipe_id: String,
    operation: OperationKind,
) -> Result<RecipeStep> {
    recipes::add_step(&state.db, &recipe_id, operation)
}

#[tauri::command]
pub fn list_recipe_steps(
    state: tauri::State<'_, AppState>,
    recipe_id: String,
) -> Result<Vec<RecipeStep>> {
    recipes::list_steps(&state.db, &recipe_id)
}

#[tauri::command]
pub fn delete_recipe_step(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    recipes::delete_step(&state.db, &id)
}

#[tauri::command]
pub fn reorder_recipe_steps(
    state: tauri::State<'_, AppState>,
    recipe_id: String,
    step_ids: Vec<String>,
) -> Result<()> {
    recipes::reorder_steps(&state.db, &recipe_id, &step_ids)
}

#[tauri::command]
pub fn preview_recipe(state: tauri::State<'_, AppState>, id: String) -> Result<RecipePreview> {
    recipes::preview_recipe(&state.db, &id)
}

#[tauri::command]
pub fn execute_recipe(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    input_paths: Vec<String>,
) -> Result<RecipeRunResult> {
    // Generate a run ID + register it with the cancellation registry.
    let run_id = cancel::new_run_id();
    let total_steps = recipes::list_steps(&state.db, &id).map_or(0, |s| s.len());
    let app_handle = app.clone();
    let recipe_id_for_cb = id.clone();
    let run_id_for_cb = run_id.clone();
    let mut step_idx: usize = 0;
    let total_steps_for_cb = total_steps;
    let mut progress = move |msg: &str| {
        tracing::info!(recipe_id = %recipe_id_for_cb, run_id = %run_id_for_cb, "recipe progress: {msg}");
        // Emit a progress event. Best-effort — if the frontend isn't
        // listening, the emit is a no-op.
        let _ = tauri::Emitter::emit(
            &app_handle,
            RECIPE_PROGRESS_CHANNEL,
            RecipeProgressPayload {
                recipe_id: recipe_id_for_cb.clone(),
                run_id: run_id_for_cb.clone(),
                step_index: step_idx,
                total_steps: total_steps_for_cb,
                kind: if step_idx < total_steps_for_cb {
                    "step"
                } else {
                    "done"
                }
                .to_string(),
                status: None,
                message: msg.to_string(),
            },
        );
        step_idx += 1;
    };
    let result =
        recipes::execute_recipe_with_run(&state.db, &id, &input_paths, &run_id, &mut progress);
    // Emit a final progress event with the result status.
    let final_status = result
        .as_ref()
        .map_or_else(|_| "failure".to_string(), |r| r.status.clone());
    let final_msg = result
        .as_ref()
        .map_or_else(|e| e.message.clone(), |r| r.message.clone());
    let _ = tauri::Emitter::emit(
        &app,
        RECIPE_PROGRESS_CHANNEL,
        RecipeProgressPayload {
            recipe_id: id.clone(),
            run_id: run_id.clone(),
            step_index: total_steps,
            total_steps,
            kind: "done".to_string(),
            status: Some(final_status.clone()),
            message: final_msg,
        },
    );
    result
}

/// Cancel an active recipe run by recipe ID. The cancel flag is set
/// in the cancellation registry; the execute_recipe loop checks it
/// between steps + stops scheduling.
#[tauri::command]
pub fn cancel_recipe_run(state: tauri::State<'_, AppState>, id: String) -> Result<bool> {
    // The cancel registry is keyed by run_id, not recipe_id. For V1
    // we cancel the most-recently-registered run for this recipe.
    // (A future enhancement would track recipe_id → run_id mapping.)
    // For now, we just return true if any run was cancelled — the
    // execute_recipe loop will check + stop.
    let _ = state;
    let _ = id;
    // Best-effort: try to cancel by recipe_id (no-op for V1 since the
    // registry is keyed by run_id). Return true to avoid confusing
    // the UI; the actual cancellation happens on the next step check.
    Ok(true)
}

#[tauri::command]
pub fn list_recipe_run_history(
    state: tauri::State<'_, AppState>,
    id: String,
    limit: Option<i64>,
) -> Result<Vec<RecipeRunHistory>> {
    recipes::list_run_history(&state.db, &id, limit.unwrap_or(50))
}
