//! Recipe run cancellation registry (Prompt 01 §13, Prompt 02 Block 2).
//!
//! Maintains TWO mappings:
//!   - `run_id → Arc<AtomicBool>` (the cancellation token)
//!   - `recipe_id → Vec<run_id>` (active runs per recipe)
//!
//! P02 fix: the previous implementation only had the run_id mapping.
//! The `cancel_recipe_run` Tauri command took a `recipe_id` (wrong —
//! the registry was keyed by `run_id`) + returned `true` without
//! actually cancelling anything. Now:
//!
//! - `cancel_recipe_run(run_id)` accepts the CANONICAL run_id.
//! - `register_run(recipe_id, run_id)` enforces one-active-run-per-recipe
//!   (V1 policy: if a run for the same recipe_id is already active,
//!   the old run is auto-cancelled before the new one starts).
//! - The UI receives the real `run_id` from `execute_recipe` + passes
//!   it to `cancelRecipeRun(runId)`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

/// The global cancellation registry.
static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);

/// Internal registry state.
struct Registry {
    /// run_id → cancellation token.
    tokens: HashMap<String, Arc<AtomicBool>>,
    /// recipe_id → active run_id (one active run per recipe — V1 policy).
    recipe_runs: HashMap<String, String>,
}

impl Registry {
    fn new() -> Self {
        Self {
            tokens: HashMap::new(),
            recipe_runs: HashMap::new(),
        }
    }

    fn get_or_init() -> std::sync::MutexGuard<'static, Option<Registry>> {
        let mut guard = REGISTRY.lock().unwrap();
        if guard.is_none() {
            *guard = Some(Registry::new());
        }
        guard
    }
}

/// Register a new run. Enforces one-active-run-per-recipe: if a
/// previous run for the same `recipe_id` is still active, it is
/// auto-cancelled before the new run registers.
///
/// Returns the cancellation token.
pub fn register_run(recipe_id: &str, run_id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    let mut guard = Registry::get_or_init();
    let reg = guard.as_mut().unwrap();

    // Enforce one-active-run-per-recipe: cancel any existing active
    // run for this recipe_id.
    if let Some(old_run_id) = reg.recipe_runs.get(recipe_id).cloned() {
        if let Some(old_token) = reg.tokens.get(&old_run_id) {
            old_token.store(true, Ordering::SeqCst);
        }
        reg.tokens.remove(&old_run_id);
    }

    // Register the new run.
    reg.tokens.insert(run_id.to_string(), token.clone());
    reg.recipe_runs
        .insert(recipe_id.to_string(), run_id.to_string());

    token
}

/// Cancel a run by its canonical `run_id`. Returns `true` if the run
/// was found + the cancel flag was set. Returns `false` if the run
/// doesn't exist or already finished.
pub fn cancel_run(run_id: &str) -> bool {
    let mut guard = Registry::get_or_init();
    let reg = guard.as_mut().unwrap();
    if let Some(token) = reg.tokens.get(run_id) {
        token.store(true, Ordering::SeqCst);
        return true;
    }
    false
}

/// Remove a run from the registry (called after execution completes
/// or is cancelled). Best-effort — also removes the recipe_id → run_id
/// mapping if it points to this run.
pub fn unregister_run(recipe_id: &str, run_id: &str) {
    let mut guard = Registry::get_or_init();
    let reg = guard.as_mut().unwrap();
    reg.tokens.remove(run_id);
    // Only remove the recipe_run mapping if it points to THIS run_id
    // (a newer run may have already replaced it).
    if reg
        .recipe_runs
        .get(recipe_id)
        .is_some_and(|id| id == run_id)
    {
        reg.recipe_runs.remove(recipe_id);
    }
}

/// Generate a new run ID.
pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()
}

/// Check if a run is cancelled. Convenience for the executor.
pub fn is_cancelled(token: &AtomicBool) -> bool {
    token.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_registry() {
        let mut guard = REGISTRY.lock().unwrap();
        *guard = Some(Registry::new());
    }

    #[test]
    fn register_cancel_unregister() {
        fresh_registry();
        let id = new_run_id();
        let token = register_run("recipe-1", &id);
        assert!(!is_cancelled(&token), "not cancelled initially");
        assert!(cancel_run(&id), "cancel finds the run");
        assert!(is_cancelled(&token), "cancelled after cancel_run");
        unregister_run("recipe-1", &id);
        assert!(!cancel_run(&id), "cancel after unregister finds nothing");
    }

    #[test]
    fn cancel_unknown_run_returns_false() {
        fresh_registry();
        let id = new_run_id();
        assert!(!cancel_run(&id), "unknown run not found");
    }

    #[test]
    fn one_active_run_per_recipe_auto_cancels_old() {
        fresh_registry();
        let run1 = new_run_id();
        let token1 = register_run("recipe-x", &run1);
        assert!(!is_cancelled(&token1), "run1 not cancelled initially");

        // Register a second run for the same recipe — the first
        // should be auto-cancelled.
        let run2 = new_run_id();
        let token2 = register_run("recipe-x", &run2);
        assert!(
            is_cancelled(&token1),
            "run1 auto-cancelled when run2 starts"
        );
        assert!(!is_cancelled(&token2), "run2 not cancelled");

        // Cancel run2 by its run_id.
        assert!(cancel_run(&run2));
        assert!(is_cancelled(&token2));
    }

    #[test]
    fn cancelling_run_a_does_not_cancel_run_b() {
        fresh_registry();
        let run_a = new_run_id();
        let token_a = register_run("recipe-a", &run_a);
        let run_b = new_run_id();
        let token_b = register_run("recipe-b", &run_b);

        assert!(cancel_run(&run_a), "cancel run A");
        assert!(is_cancelled(&token_a), "A cancelled");
        assert!(
            !is_cancelled(&token_b),
            "B not cancelled when A is cancelled"
        );
    }

    #[test]
    fn completed_run_cannot_be_cancelled() {
        fresh_registry();
        let run_id = new_run_id();
        let _token = register_run("recipe-c", &run_id);
        // Simulate completion: unregister.
        unregister_run("recipe-c", &run_id);
        // Now cancel should return false.
        assert!(
            !cancel_run(&run_id),
            "completed run cannot be cancelled retroactively"
        );
    }
}
