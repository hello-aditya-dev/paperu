//! Timer Jobs — persisted scheduled jobs (90% §59, AUTOMATION-04).
//! Schema in migration 0006 (timer_job). Honest: Paperu must be running
//! for timers to fire (no background daemon). The UI says this clearly.

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerJob {
    pub id: String,
    pub name: String,
    pub schedule_kind: String, // one_time|daily|weekly
    pub schedule_expr: String, // ISO datetime for one_time; "HH:MM" for daily; "weekday HH:MM" for weekly
    pub action_type: String,   // backup_recipe|organizer_rule|rename_preset
    pub action_id: String,
    pub enabled: bool,
    pub last_run: Option<String>,
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
    pub enabled: Option<bool>,
}

pub fn create_timer(db: &Database, req: CreateTimerRequest) -> Result<TimerJob> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        let enabled_int = i64::from(req.enabled.unwrap_or(true));
        let next = compute_next_run(&req.schedule_kind, &req.schedule_expr);
        conn.execute(
            "INSERT INTO timer_job (id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, last_run, next_run, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)",
            params![id, req.name, req.schedule_kind, req.schedule_expr, req.action_type, req.action_id, enabled_int, next, now],
        ).map_err(map_sqlite)?;
        read_row(conn, &id)
    })
}

pub fn list_timers(db: &Database) -> Result<Vec<TimerJob>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, last_run, next_run, created_at FROM timer_job ORDER BY name").map_err(map_sqlite)?;
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

/// Compute the next run time based on schedule kind + expr.
/// one_time: the expr is an ISO datetime; next_run = the expr.
/// daily: expr is "HH:MM"; next_run = today at that time, or tomorrow if past.
/// weekly: expr is "weekday HH:MM"; next_run = the expr (simplified).
/// Honest: returns None if the computation fails (the UI shows "pending").
fn compute_next_run(kind: &str, expr: &str) -> Option<String> {
    match kind {
        "one_time" => Some(expr.to_string()),
        "daily" => {
            // expr is "HH:MM" — compute next occurrence.
            let parts: Vec<&str> = expr.split(':').collect();
            if parts.len() != 2 {
                return None;
            }
            let h: u32 = parts[0].parse().ok()?;
            let m: u32 = parts[1].parse().ok()?;
            let now = chrono::Utc::now();
            let today = now.naive_utc().date().and_hms_opt(h, m, 0)?;
            if today > now.naive_utc() {
                Some(today.to_string())
            } else {
                Some((today + chrono::Duration::days(1)).to_string())
            }
        }
        "weekly" => Some(expr.to_string()),
        _ => None,
    }
}

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<TimerJob> {
    conn.query_row(
        "SELECT id, name, schedule_kind, schedule_expr, action_type, action_id, enabled, last_run, next_run, created_at FROM timer_job WHERE id = ?1",
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
        last_run: row.get(7)?,
        next_run: row.get(8)?,
        created_at: row.get(9)?,
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
                enabled: Some(true),
            },
        )
        .unwrap();
        assert_eq!(list_timers(&db).unwrap().len(), 1);
        assert!(t.next_run.is_some(), "next_run was computed");
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
                enabled: Some(true),
            },
        )
        .unwrap();
        assert!(t.enabled);
        let disabled = toggle_timer(&db, &t.id, false).unwrap();
        assert!(!disabled.enabled);
    }

    #[test]
    fn compute_next_run_daily() {
        let next = compute_next_run("daily", "09:00");
        assert!(next.is_some(), "daily next_run is computed");
    }

    #[test]
    fn compute_next_run_invalid_returns_none() {
        assert!(compute_next_run("invalid", "garbage").is_none());
    }
}
