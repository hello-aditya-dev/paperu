//! Timer Jobs — persisted scheduled jobs (90% §59, AUTOMATION-04, P0-02).
//!
//! P0-02: this module is now a real scheduler, not just CRUD. It owns:
//! - **Schedule validation + next_run computation** in UTC, with a
//!   per-job IANA timezone (default UTC) and validated expressions.
//! - **Exactly-once claiming**: a `timer_job_occurrence` row with a
//!   primary key on `(job_id, occurrence_key)` makes claiming atomic —
//!   two scheduler ticks racing on the same occurrence can never both
//!   dispatch.
//! - **Real action dispatch**: an allowlist of supported actions
//!   (backup_recipe, organizer_rule) dispatched to the real Rust
//!   implementations. No arbitrary commands or scripts.
//! - **Persistent history**: every dispatch records a `timer_job_history`
//!   row with status (success|failure|skipped) + a short message. No
//!   paths or document contents are ever stored.
//! - **`last_run` + `next_run` updates** after each dispatch.
//! - **Missed-run handling**: on startup, the scheduler finds due
//!   occurrences and dispatches them. Skipped (overdue-by-policy) runs
//!   are recorded as `skipped`.
//!
//! The background thread is owned by `scheduler::Scheduler` which
//! ticks every 30s. It runs independently of whether the `/timer` route
//! is open.

pub mod clock;
pub mod scheduler;

pub use clock::{Clock, SystemClock, TestClock};
pub use scheduler::Scheduler;

use chrono::{DateTime, Datelike, NaiveTime, TimeZone, Utc, Weekday};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

/// The allowlist of action types the scheduler will dispatch. Anything
/// else is rejected at create time AND at dispatch time (defence in depth).
/// P01: added `recipe` so timers can run Typed Recipes on a schedule.
pub const ALLOWED_ACTION_TYPES: &[&str] = &["backup_recipe", "organizer_rule", "recipe"];

/// A persisted scheduled job.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerJob {
    pub id: String,
    pub name: String,
    pub schedule_kind: String, // one_time|daily|weekly
    pub schedule_expr: String, // ISO datetime for one_time; "HH:MM" for daily; "weekday HH:MM" for weekly
    pub action_type: String,
    pub action_id: String,
    pub enabled: bool,
    pub timezone: String,
    pub last_run: Option<String>,
    pub last_error: Option<String>,
    pub next_run: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTimerRequest {
    pub name: String,
    pub schedule_kind: String,
    pub schedule_expr: String,
    pub action_type: String,
    pub action_id: String,
    pub timezone: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTimerRequest {
    pub id: String,
    pub name: Option<String>,
    pub schedule_kind: Option<String>,
    pub schedule_expr: Option<String>,
    pub action_type: Option<String>,
    pub action_id: Option<String>,
    pub timezone: Option<String>,
    pub enabled: Option<bool>,
}

/// A row of execution history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerJobHistory {
    pub id: String,
    pub job_id: String,
    pub occurrence_key: String,
    pub started_at: String,
    pub finished_at: String,
    pub status: String, // success|failure|skipped
    pub message: Option<String>,
}

/// The result of dispatching a job's action.
#[derive(Debug, Clone)]
pub struct DispatchResult {
    pub status: &'static str, // "success" | "failure" | "skipped"
    pub message: String,
}

pub fn create_timer(db: &Database, req: CreateTimerRequest) -> Result<TimerJob> {
    // Validate schedule before persisting.
    let tz = req.timezone.as_deref().unwrap_or("UTC");
    validate_schedule(&req.schedule_kind, &req.schedule_expr, tz)?;
    if !ALLOWED_ACTION_TYPES.contains(&req.action_type.as_str()) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That action type is not supported by Timer Jobs.",
        )
        .technical(format!("action_type: {}", req.action_type))
        .build());
    }
    if req.name.trim().is_empty() || req.action_id.trim().is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Timer name and action ID are required.",
        )
        .build());
    }
    let timezone = tz.to_string();
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        let enabled_int = i64::from(req.enabled.unwrap_or(true));
        let next = compute_next_occurrence(
            &req.schedule_kind,
            &req.schedule_expr,
            &timezone,
            parse_iso(&now).unwrap_or(Utc::now()),
        )
        .map(|dt| dt.to_rfc3339());
        conn.execute(
            "INSERT INTO timer_job (id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, timezone, last_run, last_error, next_run, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, ?9, ?10)",
            params![id, req.name, req.schedule_kind, req.schedule_expr, req.action_type, req.action_id, enabled_int, timezone, next, now],
        ).map_err(map_sqlite)?;
        read_row(conn, &id)
    })
}

pub fn update_timer(db: &Database, req: UpdateTimerRequest) -> Result<TimerJob> {
    // Load existing.
    let existing = db.with_conn(|conn| read_row(conn, &req.id))?;
    let name = req.name.unwrap_or(existing.name);
    let schedule_kind = req.schedule_kind.unwrap_or(existing.schedule_kind);
    let schedule_expr = req.schedule_expr.unwrap_or(existing.schedule_expr);
    let action_type = req.action_type.unwrap_or(existing.action_type);
    let action_id = req.action_id.unwrap_or(existing.action_id);
    let timezone = req.timezone.unwrap_or(existing.timezone);
    let enabled = req.enabled.unwrap_or(existing.enabled);
    // Re-validate the merged schedule.
    validate_schedule(&schedule_kind, &schedule_expr, &timezone)?;
    if !ALLOWED_ACTION_TYPES.contains(&action_type.as_str()) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That action type is not supported by Timer Jobs.",
        )
        .build());
    }
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        let next = compute_next_occurrence(&schedule_kind, &schedule_expr, &timezone, parse_iso(&now).unwrap_or(Utc::now()))
            .map(|dt| dt.to_rfc3339());
        let enabled_int = i64::from(enabled);
        conn.execute(
            "UPDATE timer_job SET name=?1, schedule_kind=?2, schedule_expr=?3, action_type=?4, action_id=?5, timezone=?6, enabled=?7, next_run=?8 WHERE id=?9",
            params![name, schedule_kind, schedule_expr, action_type, action_id, timezone, enabled_int, next, req.id],
        ).map_err(map_sqlite)?;
        read_row(conn, &req.id)
    })
}

pub fn list_timers(db: &Database) -> Result<Vec<TimerJob>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, timezone, last_run, last_error, next_run, created_at FROM timer_job ORDER BY name").map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_job).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(map_sqlite)?); }
        Ok(out)
    })
}

pub fn delete_timer(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM timer_job WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn toggle_timer(db: &Database, id: &str, enabled: bool) -> Result<TimerJob> {
    db.with_conn(|conn| {
        let enabled_int = i64::from(enabled);
        conn.execute(
            "UPDATE timer_job SET enabled = ?1 WHERE id = ?2",
            params![enabled_int, id],
        )
        .map_err(map_sqlite)?;
        read_row(conn, id)
    })
}

pub fn get_timer(db: &Database, id: &str) -> Result<TimerJob> {
    db.with_conn(|conn| read_row(conn, id))
}

pub fn list_history(db: &Database, job_id: &str, limit: i64) -> Result<Vec<TimerJobHistory>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, job_id, occurrence_key, started_at, finished_at, status, message FROM timer_job_history WHERE job_id = ?1 ORDER BY started_at DESC LIMIT ?2",
        )
        .map_err(map_sqlite)?;
        let rows = stmt
            .query_map(params![job_id, limit], |r| {
                Ok(TimerJobHistory {
                    id: r.get(0)?,
                    job_id: r.get(1)?,
                    occurrence_key: r.get(2)?,
                    started_at: r.get(3)?,
                    finished_at: r.get(4)?,
                    status: r.get(5)?,
                    message: r.get(6)?,
                })
            })
            .map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

/// Find all enabled jobs whose `next_run` is due at or before `now`.
/// Used by the scheduler each tick.
pub fn find_due_jobs(db: &Database, now: DateTime<Utc>) -> Result<Vec<TimerJob>> {
    let now_iso = now.to_rfc3339();
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, timezone, last_run, last_error, next_run, created_at FROM timer_job WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?1 ORDER BY next_run ASC",
        )
        .map_err(map_sqlite)?;
        let rows = stmt.query_map(params![now_iso], row_to_job).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

/// Claim an occurrence for exclusive dispatch. Returns `true` if this
/// caller won the claim (the row was newly inserted); `false` if
/// another caller already claimed it (exactly-once).
pub fn claim_occurrence(
    db: &Database,
    job_id: &str,
    occurrence_key: &str,
    claimed_at: DateTime<Utc>,
) -> Result<bool> {
    db.with_conn(|conn| {
        let claimed_iso = claimed_at.to_rfc3339();
        // INSERT OR IGNORE — the PK (job_id, occurrence_key) makes this
        // an atomic claim. If the row already exists, no rows are
        // affected → false (someone else claimed it).
        let affected = conn.execute(
            "INSERT OR IGNORE INTO timer_job_occurrence (job_id, occurrence_key, claimed_at, completed_at, status, message) VALUES (?1, ?2, ?3, NULL, 'pending', NULL)",
            params![job_id, occurrence_key, claimed_iso],
        ).map_err(map_sqlite)?;
        Ok(affected > 0)
    })
}

/// Mark an occurrence complete + write a history row + advance the
/// job's next_run + last_run. Atomic within one DB transaction.
pub fn record_completion(
    db: &Database,
    job: &TimerJob,
    occurrence_key: &str,
    started_at: DateTime<Utc>,
    finished_at: DateTime<Utc>,
    result: &DispatchResult,
) -> Result<()> {
    let next = compute_next_occurrence(
        &job.schedule_kind,
        &job.schedule_expr,
        &job.timezone,
        finished_at,
    );
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(map_sqlite)?;
        // 1. Update occurrence row.
        tx.execute(
            "UPDATE timer_job_occurrence SET completed_at = ?1, status = ?2, message = ?3 WHERE job_id = ?4 AND occurrence_key = ?5",
            params![finished_at.to_rfc3339(), result.status, result.message, job.id, occurrence_key],
        ).map_err(map_sqlite)?;
        // 2. Insert a history row.
        let hid = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO timer_job_history (id, job_id, occurrence_key, started_at, finished_at, status, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![hid, job.id, occurrence_key, started_at.to_rfc3339(), finished_at.to_rfc3339(), result.status, result.message],
        ).map_err(map_sqlite)?;
        // 3. Advance next_run + last_run + last_error.
        let next_iso = next.map(|dt| dt.to_rfc3339());
        let last_err: Option<String> = if result.status == "failure" {
            Some(result.message.clone())
        } else {
            None
        };
        tx.execute(
            "UPDATE timer_job SET last_run = ?1, next_run = ?2, last_error = ?3 WHERE id = ?4",
            params![finished_at.to_rfc3339(), next_iso, last_err, job.id],
        ).map_err(map_sqlite)?;
        tx.commit().map_err(map_sqlite)?;
        Ok(())
    })
}

/// Reset next_run for a job based on the current time. Called when a
/// job is created, updated, or re-enabled.
pub fn reschedule(db: &Database, job_id: &str) -> Result<()> {
    let job = db.with_conn(|conn| read_row(conn, job_id))?;
    let now = Utc::now();
    let next = compute_next_occurrence(&job.schedule_kind, &job.schedule_expr, &job.timezone, now);
    db.with_conn(|conn| {
        let next_iso = next.map(|dt| dt.to_rfc3339());
        conn.execute(
            "UPDATE timer_job SET next_run = ?1 WHERE id = ?2",
            params![next_iso, job_id],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── Schedule validation + computation ───────────────────────────────

/// Validate a schedule expression for the given kind. Returns Ok(())
/// if valid; Err with a structured error otherwise.
pub fn validate_schedule(kind: &str, expr: &str, tz: &str) -> Result<()> {
    if !["one_time", "daily", "weekly"].contains(&kind) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Schedule kind must be one-time, daily, or weekly.",
        )
        .technical(format!("kind: {kind}"))
        .build());
    }
    match kind {
        "one_time" => {
            let _ = parse_iso(expr).map_err(|()| {
                AppError::builder(
                    code::INVALID_INPUT,
                    ErrorCategory::Validation,
                    "One-time schedule needs an ISO 8601 datetime (e.g. 2026-12-25T10:00:00Z).",
                )
                .technical(format!("expr: {expr}"))
                .build()
            })?;
        }
        "daily" => {
            parse_hhmm(expr).map_err(|()| {
                AppError::builder(
                    code::INVALID_INPUT,
                    ErrorCategory::Validation,
                    "Daily schedule needs HH:MM (24-hour, e.g. 09:30).",
                )
                .technical(format!("expr: {expr}"))
                .build()
            })?;
        }
        "weekly" => {
            parse_weekly(expr).map_err(|()| {
                AppError::builder(
                    code::INVALID_INPUT,
                    ErrorCategory::Validation,
                    "Weekly schedule needs 'Weekday HH:MM' (e.g. Mon 09:30).",
                )
                .technical(format!("expr: {expr}"))
                .build()
            })?;
        }
        _ => unreachable!(),
    }
    // Validate the timezone is recognised. For V1 we accept "UTC" or
    // any non-empty string; a true IANA resolver would require chrono-tz.
    // We still reject obviously-bogus values.
    if tz.is_empty() || tz.len() > 64 {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Timezone is invalid.",
        )
        .technical(format!("tz: {tz}"))
        .build());
    }
    Ok(())
}

/// Compute the next occurrence of a schedule on or after `from`.
/// Returns None if the schedule is invalid or (for one_time) in the past.
pub fn compute_next_occurrence(
    kind: &str,
    expr: &str,
    tz: &str,
    from: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let tz: chrono_tz::Tz = tz.parse().ok()?;
    match kind {
        "one_time" => {
            let t = parse_iso(expr).ok()?;
            if t < from {
                None
            } else {
                Some(t)
            }
        }
        "daily" => {
            let (h, m) = parse_hhmm(expr).ok()?;
            next_daily_tz(from, h, m, tz)
        }
        "weekly" => {
            let (wd, h, m) = parse_weekly(expr).ok()?;
            next_weekly_tz(from, wd, h, m, tz)
        }
        _ => None,
    }
}

/// Compute the daily occurrence: today at HH:MM (in the configured TZ),
/// or tomorrow if that time has passed.
fn next_daily_tz(from: DateTime<Utc>, h: u32, m: u32, tz: chrono_tz::Tz) -> Option<DateTime<Utc>> {
    let local_from = from.with_timezone(&tz);
    for delta in 0..=2 {
        let local_date = local_from.date_naive() + chrono::Duration::days(delta);
        let local_naive = local_date.and_hms_opt(h, m, 0)?;
        if let Some(dt) = tz.from_local_datetime(&local_naive).single() {
            let utc = dt.with_timezone(&Utc);
            if utc > from {
                return Some(utc);
            }
        }
    }
    None
}

fn next_weekly_tz(
    from: DateTime<Utc>,
    target_wd: Weekday,
    h: u32,
    m: u32,
    tz: chrono_tz::Tz,
) -> Option<DateTime<Utc>> {
    let local_from = from.with_timezone(&tz);
    for delta in 0..=14 {
        let local_date = local_from.date_naive() + chrono::Duration::days(delta);
        if local_date.weekday() != target_wd {
            continue;
        }
        let local_naive = local_date.and_hms_opt(h, m, 0)?;
        if let Some(dt) = tz.from_local_datetime(&local_naive).single() {
            let utc = dt.with_timezone(&Utc);
            if utc > from {
                return Some(utc);
            }
        }
    }
    None
}

// ── Parsers ─────────────────────────────────────────────────────────

fn parse_iso(s: &str) -> std::result::Result<DateTime<Utc>, ()> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| ())
}

fn parse_hhmm(s: &str) -> std::result::Result<(u32, u32), ()> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return Err(());
    }
    let h: u32 = parts[0].parse().map_err(|_| ())?;
    let m: u32 = parts[1].parse().map_err(|_| ())?;
    if h > 23 || m > 59 {
        return Err(());
    }
    // Build a NaiveTime to validate the combo.
    let _ = NaiveTime::from_hms_opt(h, m, 0).ok_or(())?;
    Ok((h, m))
}

fn parse_weekly(s: &str) -> std::result::Result<(Weekday, u32, u32), ()> {
    let s = s.trim();
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() != 2 {
        return Err(());
    }
    let wd = match parts[0] {
        "Mon" | "MON" | "mon" => Weekday::Mon,
        "Tue" | "TUE" | "tue" => Weekday::Tue,
        "Wed" | "WED" | "wed" => Weekday::Wed,
        "Thu" | "THU" | "thu" => Weekday::Thu,
        "Fri" | "FRI" | "fri" => Weekday::Fri,
        "Sat" | "SAT" | "sat" => Weekday::Sat,
        "Sun" | "SUN" | "sun" => Weekday::Sun,
        _ => return Err(()),
    };
    let (h, m) = parse_hhmm(parts[1])?;
    Ok((wd, h, m))
}

// ── Helpers ────────────────────────────────────────────────────────

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<TimerJob> {
    conn.query_row(
        "SELECT id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, timezone, last_run, last_error, next_run, created_at FROM timer_job WHERE id = ?1",
        params![id], row_to_job,
    ).map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<TimerJob> {
    let enabled_int: i64 = row.get(6)?;
    Ok(TimerJob {
        id: row.get(0)?,
        name: row.get(1)?,
        schedule_kind: row.get(2)?,
        schedule_expr: row.get(3)?,
        action_type: row.get(4)?,
        action_id: row.get(5)?,
        enabled: enabled_int != 0,
        timezone: row.get(7)?,
        last_run: row.get(8)?,
        last_error: row.get(9)?,
        next_run: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn now_iso(conn: &rusqlite::Connection) -> Result<String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
        r.get(0)
    })
    .map_err(map_sqlite)
}

fn map_sqlite(err: rusqlite::Error) -> AppError {
    AppError::builder(
        code::DATABASE_UNAVAILABLE,
        ErrorCategory::Database,
        "Paperu could not read or write timer jobs.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That timer job wasn't found.",
    )
    .technical(format!("id={id}: {err}"))
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn fresh_db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    #[test]
    fn create_list_delete_timer() {
        let db = fresh_db();
        let t = create_timer(
            &db,
            CreateTimerRequest {
                name: "Daily Backup".to_string(),
                schedule_kind: "daily".to_string(),
                schedule_expr: "09:00".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "recipe-123".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        assert_eq!(list_timers(&db).unwrap().len(), 1);
        assert!(t.next_run.is_some(), "next_run was computed");
        assert_eq!(t.timezone, "UTC");
        delete_timer(&db, &t.id).unwrap();
        assert_eq!(list_timers(&db).unwrap().len(), 0);
    }

    #[test]
    fn toggle_timer_works() {
        let db = fresh_db();
        let t = create_timer(
            &db,
            CreateTimerRequest {
                name: "Test".to_string(),
                schedule_kind: "one_time".to_string(),
                schedule_expr: "2026-12-25T10:00:00Z".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        assert!(t.enabled);
        let disabled = toggle_timer(&db, &t.id, false).unwrap();
        assert!(!disabled.enabled);
    }

    #[test]
    fn reject_invalid_schedule_kind() {
        let db = fresh_db();
        let res = create_timer(
            &db,
            CreateTimerRequest {
                name: "X".to_string(),
                schedule_kind: "hourly".to_string(),
                schedule_expr: "09:00".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        );
        assert!(res.is_err(), "hourly is rejected");
    }

    #[test]
    fn reject_invalid_daily_expr() {
        let db = fresh_db();
        let res = create_timer(
            &db,
            CreateTimerRequest {
                name: "X".to_string(),
                schedule_kind: "daily".to_string(),
                schedule_expr: "25:00".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        );
        assert!(res.is_err(), "25:00 is invalid");
    }

    #[test]
    fn reject_unsupported_action_type() {
        let db = fresh_db();
        let res = create_timer(
            &db,
            CreateTimerRequest {
                name: "X".to_string(),
                schedule_kind: "daily".to_string(),
                schedule_expr: "09:00".to_string(),
                action_type: "shell_command".to_string(),
                action_id: "rm -rf /".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        );
        assert!(res.is_err(), "shell_command action is rejected");
    }

    #[test]
    fn compute_next_occurrence_daily() {
        let from = "2026-06-01T08:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let next = compute_next_occurrence("daily", "09:00", "UTC", from).unwrap();
        // 09:00 today is after 08:00 → today at 09:00.
        assert_eq!(
            next,
            "2026-06-01T09:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        // 10:00 today is past 09:00 → tomorrow at 09:00.
        let from2 = "2026-06-01T10:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let next2 = compute_next_occurrence("daily", "09:00", "UTC", from2).unwrap();
        assert_eq!(
            next2,
            "2026-06-02T09:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
    }

    #[test]
    fn compute_next_occurrence_weekly() {
        // 2026-06-01 is a Monday.
        let from = "2026-06-01T08:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let next = compute_next_occurrence("weekly", "Mon 09:00", "UTC", from).unwrap();
        assert_eq!(
            next,
            "2026-06-01T09:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        // Same day at 10:00 → next Monday at 09:00.
        let from2 = "2026-06-01T10:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let next2 = compute_next_occurrence("weekly", "Mon 09:00", "UTC", from2).unwrap();
        assert_eq!(
            next2,
            "2026-06-08T09:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
    }

    #[test]
    fn compute_next_occurrence_one_time_future() {
        let from = "2026-06-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let next = compute_next_occurrence("one_time", "2026-12-25T10:00:00Z", "UTC", from);
        assert!(next.is_some());
    }

    #[test]
    fn compute_next_occurrence_one_time_past_returns_none() {
        let from = "2026-06-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let next = compute_next_occurrence("one_time", "2020-01-01T00:00:00Z", "UTC", from);
        assert!(next.is_none(), "expired one-time schedules return None");
    }

    #[test]
    fn claim_occurrence_is_exactly_once() {
        let db = fresh_db();
        let t = create_timer(
            &db,
            CreateTimerRequest {
                name: "Test".to_string(),
                schedule_kind: "one_time".to_string(),
                schedule_expr: "2026-12-25T10:00:00Z".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        let now = Utc::now();
        let first = claim_occurrence(&db, &t.id, "2026-12-25T10:00:00Z", now).unwrap();
        assert!(first, "first claim wins");
        let second = claim_occurrence(&db, &t.id, "2026-12-25T10:00:00Z", now).unwrap();
        assert!(!second, "second claim is rejected (exactly-once)");
    }

    #[test]
    fn record_completion_advances_next_run_and_writes_history() {
        let db = fresh_db();
        let t = create_timer(
            &db,
            CreateTimerRequest {
                name: "Test".to_string(),
                schedule_kind: "daily".to_string(),
                schedule_expr: "09:00".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        let occ = "2026-06-01T09:00:00Z";
        let started = "2026-06-01T09:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let finished = started + Duration::seconds(5);
        record_completion(
            &db,
            &t,
            occ,
            started,
            finished,
            &DispatchResult {
                status: "success",
                message: "backup OK".to_string(),
            },
        )
        .unwrap();
        // History row was written.
        let h = list_history(&db, &t.id, 10).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].status, "success");
        assert_eq!(h[0].message.as_deref(), Some("backup OK"));
        // next_run advanced to tomorrow at 09:00.
        let updated = get_timer(&db, &t.id).unwrap();
        assert!(updated.last_run.is_some());
        assert!(updated.next_run.is_some());
        assert_ne!(updated.next_run, Some(occ.to_string()));
    }

    #[test]
    fn update_timer_revalidates_schedule() {
        let db = fresh_db();
        let t = create_timer(
            &db,
            CreateTimerRequest {
                name: "Test".to_string(),
                schedule_kind: "daily".to_string(),
                schedule_expr: "09:00".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        // Change to weekly with a valid expr.
        let updated = update_timer(
            &db,
            UpdateTimerRequest {
                id: t.id.clone(),
                name: None,
                schedule_kind: Some("weekly".to_string()),
                schedule_expr: Some("Mon 10:00".to_string()),
                action_type: None,
                action_id: None,
                timezone: None,
                enabled: None,
            },
        )
        .unwrap();
        assert_eq!(updated.schedule_kind, "weekly");
        assert_eq!(updated.schedule_expr, "Mon 10:00");
        // Now try to break it with an invalid expr.
        let res = update_timer(
            &db,
            UpdateTimerRequest {
                id: t.id,
                name: None,
                schedule_kind: None,
                schedule_expr: Some("garbage".to_string()),
                action_type: None,
                action_id: None,
                timezone: None,
                enabled: None,
            },
        );
        assert!(res.is_err(), "invalid schedule rejected on update");
    }

    #[test]
    fn find_due_jobs_returns_only_due_enabled() {
        let db = fresh_db();
        let t1 = create_timer(
            &db,
            CreateTimerRequest {
                name: "Past".to_string(),
                schedule_kind: "one_time".to_string(),
                schedule_expr: "2020-01-01T00:00:00Z".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r1".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        // next_run for one_time in the past was set to None at create
        // time (compute_next_occurrence returns None). Force-set it
        // to simulate "should have fired".
        db.with_conn(|c| {
            c.execute(
                "UPDATE timer_job SET next_run = '2020-01-01T00:00:00Z' WHERE id = ?1",
                params![t1.id],
            )
            .map_err(map_sqlite)
        })
        .unwrap();
        let t2 = create_timer(
            &db,
            CreateTimerRequest {
                name: "Future".to_string(),
                schedule_kind: "one_time".to_string(),
                schedule_expr: "2099-01-01T00:00:00Z".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "r2".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        let now = "2026-06-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let due = find_due_jobs(&db, now).unwrap();
        assert_eq!(due.len(), 1, "only the past-due job is returned");
        assert_eq!(due[0].id, t1.id);
        // The future job is not due.
        assert!(due.iter().all(|j| j.id != t2.id));
    }

    /// End-to-end test: a due backup-recipe timer fires, creates a verified
    /// destination file, records success history, advances next_run,
    /// and does NOT re-run on a second tick (exactly-once).
    #[test]
    fn end_to_end_backup_timer_fires_and_verifies() {
        use std::path::Path;
        let db = fresh_db();
        // Prepare a real source file + destination.
        let tmp = std::env::temp_dir().join(format!("paperu-timer-e2e-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("source.txt");
        let payload = b"backup me for real";
        std::fs::write(&src, payload).unwrap();
        let dest_dir = tmp.join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        // Create a backup recipe pointing at the source + dest.
        let recipe = crate::backup_recipes::create_recipe(
            &db,
            crate::backup_recipes::CreateRecipeRequest {
                name: "E2E Backup".to_string(),
                sources: vec![src.to_string_lossy().to_string()],
                destination: dest_dir.to_string_lossy().to_string(),
                include_patterns: None,
                exclude_patterns: None,
            },
        )
        .unwrap();
        // Create a daily timer for the recipe, due in the past.
        let timer = create_timer(
            &db,
            CreateTimerRequest {
                name: "E2E Timer".to_string(),
                schedule_kind: "daily".to_string(),
                schedule_expr: "09:00".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: recipe.id.clone(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        // Force the timer's next_run to be in the past.
        let occ_key = "2026-06-01T09:00:00Z";
        db.with_conn(|c| {
            c.execute(
                "UPDATE timer_job SET next_run = ?1 WHERE id = ?2",
                params![occ_key, timer.id],
            )
            .map_err(map_sqlite)
        })
        .unwrap();
        // Build a scheduler with a test clock pinned past the due time.
        let now = "2026-06-01T10:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let clock = std::sync::Arc::new(TestClock::new(now));
        let sched = scheduler::Scheduler::new(db.clone(), clock);
        // Tick once — should dispatch the backup recipe.
        sched.tick().unwrap();
        // The destination file exists with the verified bytes.
        let dest_file = dest_dir.join("source.txt");
        assert!(dest_file.exists(), "destination file was created");
        assert_eq!(std::fs::read(&dest_file).unwrap(), payload);
        // The source is untouched.
        assert_eq!(std::fs::read(&src).unwrap(), payload);
        // History says success.
        let h = list_history(&db, &timer.id, 10).unwrap();
        assert_eq!(h.len(), 1, "exactly one history row");
        assert_eq!(h[0].status, "success");
        assert_eq!(h[0].occurrence_key, occ_key);
        // next_run advanced to tomorrow at 09:00.
        let updated = get_timer(&db, &timer.id).unwrap();
        assert_ne!(updated.next_run.as_deref(), Some(occ_key));
        // Tick again — must NOT re-run the same occurrence.
        sched.tick().unwrap();
        let h2 = list_history(&db, &timer.id, 10).unwrap();
        assert_eq!(h2.len(), 1, "exactly-once: no duplicate run after restart");
        // The destination file was not re-created with a "(1)" suffix.
        let only_one = std::fs::read_dir(&dest_dir).unwrap().count();
        assert_eq!(only_one, 1, "no duplicate output");
        // Cleanup.
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = Path::new(&dest_dir).exists();
    }

    /// Expired one-time job: scheduler records a `skipped` history row
    /// (no-op dispatch), advances next_run to None.
    #[test]
    fn expired_one_time_job_is_skipped_not_re_run() {
        let db = fresh_db();
        let timer = create_timer(
            &db,
            CreateTimerRequest {
                name: "Expired".to_string(),
                schedule_kind: "one_time".to_string(),
                schedule_expr: "2020-01-01T00:00:00Z".to_string(),
                action_type: "backup_recipe".to_string(),
                action_id: "nonexistent-recipe".to_string(),
                timezone: None,
                enabled: Some(true),
            },
        )
        .unwrap();
        // Force next_run to the past (compute_next_occurrence would
        // have returned None at create time; force-set for the test).
        let occ_key = "2020-01-01T00:00:00Z";
        db.with_conn(|c| {
            c.execute(
                "UPDATE timer_job SET next_run = ?1 WHERE id = ?2",
                params![occ_key, timer.id],
            )
            .map_err(map_sqlite)
        })
        .unwrap();
        let now = "2026-06-01T10:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let clock = std::sync::Arc::new(TestClock::new(now));
        let sched = scheduler::Scheduler::new(db.clone(), clock);
        sched.tick().unwrap();
        // History says skipped (the recipe doesn't exist; we don't
        // want to dispatch to a missing action — record as skipped).
        let h = list_history(&db, &timer.id, 10).unwrap();
        assert_eq!(h.len(), 1, "skipped is still recorded once");
        assert_eq!(h[0].status, "skipped");
        // next_run is now NULL (one_time + past → no next occurrence).
        let updated = get_timer(&db, &timer.id).unwrap();
        assert!(
            updated.next_run.is_none(),
            "expired one_time has no next_run"
        );
    }
}
