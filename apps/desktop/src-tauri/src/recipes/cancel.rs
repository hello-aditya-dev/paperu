//! Recipe run cancellation registry (Prompt 01 §13).
//!
//! A process-wide map of `run_id → AtomicBool`. The execute_recipe
//! function checks the flag between steps; if cancelled, it stops
//! scheduling new operations + records the run as cancelled.
//!
//! The flag is set by the gated `cancel_recipe_run` Tauri command
//! (see commands/recipes.rs). The registry is non-gated so the
//! execute_recipe function (also non-gated) can use it in tests.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use uuid::Uuid;

/// The global cancellation registry. A Mutex<HashMap<run_id, flag>>.
static REGISTRY: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

use std::sync::Arc;

/// Register a new run. Returns the cancellation token (an Arc to
/// the AtomicBool). The token is also stored in the registry so the
/// `cancel_run` function can set it.
pub fn register_run(run_id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    let mut guard = REGISTRY.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(run_id.to_string(), token.clone());
    token
}

/// Cancel a run by ID. Returns true if the run was found + cancelled.
pub fn cancel_run(run_id: &str) -> bool {
    let guard = REGISTRY.lock().unwrap();
    if let Some(map) = guard.as_ref() {
        if let Some(token) = map.get(run_id) {
            token.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

/// Remove a run from the registry (called after execution completes
/// or is cancelled). Best-effort.
pub fn unregister_run(run_id: &str) {
    let mut guard = REGISTRY.lock().unwrap();
    if let Some(map) = guard.as_mut() {
        map.remove(run_id);
    }
}

/// Generate a new run ID.
pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_cancel_unregister() {
        let id = new_run_id();
        let token = register_run(&id);
        assert!(!token.load(Ordering::SeqCst), "not cancelled initially");
        assert!(cancel_run(&id), "cancel finds the run");
        assert!(token.load(Ordering::SeqCst), "cancelled after cancel_run");
        unregister_run(&id);
        assert!(!cancel_run(&id), "cancel after unregister finds nothing");
    }

    #[test]
    fn cancel_unknown_run_returns_false() {
        let id = new_run_id();
        assert!(!cancel_run(&id), "unknown run not found");
    }
}
