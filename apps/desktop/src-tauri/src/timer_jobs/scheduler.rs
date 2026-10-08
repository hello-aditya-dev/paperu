//! Background scheduler for Timer Jobs (P0-02).
//!
//! The scheduler runs in its own background thread, independent of
//! whether the `/timer` route is open. Every `TICK_INTERVAL` it:
//!
//! 1. Loads enabled jobs whose `next_run <= now`.
//! 2. For each, attempts to claim the occurrence atomically
//!    (`INSERT OR IGNORE` on the `(job_id, occurrence_key)` PK).
//!    If the claim fails, another tick already dispatched it — skip.
//! 3. Dispatches the allowlisted action (backup_recipe, organizer_rule).
//! 4. Records a `timer_job_history` row + advances `next_run`/`last_run`.
//!
//! The clock is injectable so tests call `tick()` directly with a
//! `TestClock` pinned to a specific time, instead of sleeping.

use std::sync::Arc;
use std::thread;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Utc};
use tracing::{error, info, warn};

use crate::database::Database;
use crate::errors::Result;
use crate::timer_jobs::clock::{Clock, SystemClock};
use crate::timer_jobs::{
    claim_occurrence, find_due_jobs, record_completion, DispatchResult, TimerJob,
};

/// The interval between scheduler ticks in production.
const TICK_INTERVAL: StdDuration = StdDuration::from_secs(30);

/// A scheduler instance. Cheaply clonable so the background thread can
/// own its own copy while the test harness drives `tick()` directly.
pub struct Scheduler {
    db: Database,
    clock: Arc<dyn Clock>,
}

impl Scheduler {
    /// Construct a scheduler with the given DB handle + clock.
    pub fn new(db: Database, clock: Arc<dyn Clock>) -> Self {
        Self { db, clock }
    }

    /// Construct a production scheduler using the system clock.
    pub fn production(db: Database) -> Self {
        Self::new(db, Arc::new(SystemClock))
    }

    /// Run one tick synchronously. Tests call this directly with a
    /// `TestClock` to drive the scheduler deterministically.
    pub fn tick(&self) -> Result<()> {
        let now = self.clock.now();
        let due = find_due_jobs(&self.db, now)?;
        if due.is_empty() {
            return Ok(());
        }
        for job in due {
            if let Err(e) = self.dispatch_once(&job, now) {
                // Don't let one job's failure kill the whole tick.
                warn!(job_id = %job.id, error = %e, "timer job dispatch failed");
            }
        }
        Ok(())
    }

    /// Claim + dispatch a single job occurrence. Idempotent — if the
    /// occurrence was already claimed, this is a no-op.
    fn dispatch_once(&self, job: &TimerJob, now: DateTime<Utc>) -> Result<()> {
        let occ_key = job.next_run.clone().unwrap_or_else(|| now.to_rfc3339());
        // Exactly-once claim. If another tick already claimed this
        // occurrence, `claimed` is false → skip silently.
        let claimed = claim_occurrence(&self.db, &job.id, &occ_key, now)?;
        if !claimed {
            return Ok(());
        }
        let started = self.clock.now();
        // Dispatch the allowlisted action.
        let result = self.dispatch_action(job);
        let finished = self.clock.now();
        record_completion(&self.db, job, &occ_key, started, finished, &result)?;
        match result.status {
            "success" => {
                info!(job_id = %job.id, occurrence = %occ_key, "timer job fired successfully")
            }
            "failure" => {
                warn!(job_id = %job.id, occurrence = %occ_key, msg = %result.message, "timer job failed")
            }
            _ => info!(job_id = %job.id, occurrence = %occ_key, "timer job skipped"),
        }
        Ok(())
    }

    /// Dispatch the job's allowlisted action. Returns a `DispatchResult`
    /// with status + a short message (never paths/contents).
    fn dispatch_action(&self, job: &TimerJob) -> DispatchResult {
        match job.action_type.as_str() {
            "backup_recipe" => {
                // If the recipe was deleted, this is a configuration
                // stale-job — mark as skipped, not failure (we can't
                // dispatch what no longer exists).
                let recipe_exists = crate::backup_recipes::recipe_exists(&self.db, &job.action_id);
                if !recipe_exists {
                    return DispatchResult {
                        status: "skipped",
                        message: "backup recipe no longer exists".to_string(),
                    };
                }
                match crate::backup_recipes::run_recipe(&self.db, &job.action_id) {
                    Ok(r) => {
                        if r.failed.is_empty() {
                            DispatchResult {
                                status: "success",
                                message: format!("backed up {} files", r.succeeded.len()),
                            }
                        } else {
                            DispatchResult {
                                status: "failure",
                                message: format!(
                                    "{} succeeded, {} failed",
                                    r.succeeded.len(),
                                    r.failed.len()
                                ),
                            }
                        }
                    }
                    Err(e) => DispatchResult {
                        status: "failure",
                        message: e.message.clone(),
                    },
                }
            }
            "organizer_rule" => {
                // P01: dispatch an organizer rule. The organizer module
                // exposes execute(rule) which moves/copies files per the
                // rule's condition + action. We look up the rule by ID.
                let rule = crate::organizer::list_rules(&self.db)
                    .ok()
                    .and_then(|rules| {
                        rules
                            .into_iter()
                            .find(|r| r.id.as_deref() == Some(&job.action_id))
                    });
                let Some(rule) = rule else {
                    return DispatchResult {
                        status: "skipped",
                        message: "organizer rule no longer exists".to_string(),
                    };
                };
                match crate::organizer::execute(&rule) {
                    Ok(r) => {
                        if r.failed.is_empty() {
                            DispatchResult {
                                status: "success",
                                message: format!("organized {} files", r.succeeded.len()),
                            }
                        } else {
                            DispatchResult {
                                status: "failure",
                                message: format!(
                                    "{} succeeded, {} failed",
                                    r.succeeded.len(),
                                    r.failed.len()
                                ),
                            }
                        }
                    }
                    Err(e) => DispatchResult {
                        status: "failure",
                        message: e.message.clone(),
                    },
                }
            }
            "recipe" => {
                // P01: dispatch a Typed Recipe. The recipe's own
                // sources are used as input (the timer fires the
                // recipe as configured). No arbitrary paths from
                // the timer — only the recipe's stored steps.
                let recipe_exists = crate::recipes::list_recipes(&self.db)
                    .is_ok_and(|list| list.iter().any(|r| r.id == job.action_id));
                if !recipe_exists {
                    return DispatchResult {
                        status: "skipped",
                        message: "typed recipe no longer exists".to_string(),
                    };
                }
                // Execute with the timer's configured input_paths
                // (P02 §10.2). If no input_paths are configured, use
                // empty — the recipe's own PlaceInOutputDir steps
                // may have their own paths.
                let input_paths: Vec<String> = job.input_paths.clone().unwrap_or_default();
                let mut progress_calls: Vec<String> = Vec::new();
                let result = crate::recipes::execute_recipe(
                    &self.db,
                    &job.action_id,
                    &input_paths,
                    &mut |msg: &str| {
                        progress_calls.push(msg.to_string());
                    },
                );
                match result {
                    Ok(r) => DispatchResult {
                        status: if r.status == "success" {
                            "success"
                        } else {
                            "failure"
                        },
                        message: format!(
                            "recipe {}: {} steps executed",
                            r.status,
                            r.step_results.len()
                        ),
                    },
                    Err(e) => DispatchResult {
                        status: "failure",
                        message: e.message.clone(),
                    },
                }
            }
            _ => DispatchResult {
                status: "skipped",
                message: format!("unsupported action: {}", job.action_type),
            },
        }
    }

    /// Spawn the background scheduler thread. Returns a `JoinHandle`
    /// so the caller (Tauri setup) can `join()` on shutdown if needed.
    /// The thread runs forever, ticking every `TICK_INTERVAL`.
    pub fn spawn(self) -> thread::JoinHandle<()> {
        thread::Builder::new()
            .name("paperu-timer-scheduler".into())
            .spawn(move || {
                info!(
                    interval_secs = TICK_INTERVAL.as_secs(),
                    "timer scheduler started"
                );
                loop {
                    if let Err(e) = self.tick() {
                        error!(error = %e, "timer scheduler tick failed");
                    }
                    thread::sleep(TICK_INTERVAL);
                }
            })
            .expect("spawn timer scheduler thread")
    }

    /// Public dispatch hook — used by the `trigger_timer_job_now`
    /// command to reuse the same allowlisted dispatch logic.
    pub fn dispatch_action_for(&self, job: &TimerJob) -> DispatchResult {
        self.dispatch_action(job)
    }
}
