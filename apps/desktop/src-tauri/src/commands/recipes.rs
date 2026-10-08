#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::recipes::{
    self, CreateRecipeRequest, OperationKind, Recipe, RecipePreview, RecipeRunHistory,
    RecipeRunResult, RecipeStep, UpdateRecipeRequest,
};
use crate::state::AppState;

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
    id: String,
    input_paths: Vec<String>,
) -> Result<RecipeRunResult> {
    // V1: synchronous execution. The Tauri runtime runs commands on a
    // worker thread, so a blocking copy+verify is fine. Progress is
    // streamed via tracing logs + the returned step_results; the
    // frontend polls list_recipe_run_history for live state if needed.
    let mut progress = |msg: &str| {
        tracing::info!(recipe_id = %id, "recipe progress: {msg}");
    };
    recipes::execute_recipe(&state.db, &id, &input_paths, &mut progress)
}

#[tauri::command]
pub fn list_recipe_run_history(
    state: tauri::State<'_, AppState>,
    id: String,
    limit: Option<i64>,
) -> Result<Vec<RecipeRunHistory>> {
    recipes::list_run_history(&state.db, &id, limit.unwrap_or(50))
}
