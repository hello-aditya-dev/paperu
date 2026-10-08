//! Privacy-safe local analytics (90% §67, COMMERCIAL-04). Opt-in.
//! Stores ONLY coarse event types + timestamps. NEVER paths, filenames,
//! document contents, signatures, clipboard, or form data. No network
//! endpoint in V1 (local store only; remote endpoint is configurable future).

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub id: String,
    pub event_type: String,
    pub timestamp: String,
    pub detail: Option<String>,
}

pub fn log_event(db: &Database, event_type: &str, detail: Option<&str>) -> Result<()> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO analytics_event (id, event_type, timestamp, detail) VALUES (?1, ?2, ?3, ?4)",
            params![id, event_type, now, detail],
        ).map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn list_events(db: &Database, limit: i64) -> Result<Vec<AnalyticsEvent>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, event_type, timestamp, detail FROM analytics_event ORDER BY timestamp DESC LIMIT ?1").map_err(map_sqlite)?;
        let rows = stmt.query_map(params![limit], |r| Ok(AnalyticsEvent {
            id: r.get(0)?, event_type: r.get(1)?, timestamp: r.get(2)?, detail: r.get(3)?,
        })).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(map_sqlite)?); }
        Ok(out)
    })
}

pub fn clear_events(db: &Database) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM analytics_event", [])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn event_count(db: &Database) -> Result<i64> {
    db.with_conn(|conn| {
        conn.query_row("SELECT COUNT(*) FROM analytics_event", [], |r| r.get(0))
            .map_err(map_sqlite)
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
        "Paperu could not read or write analytics events.",
    )
    .technical(err.to_string())
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
    fn log_list_clear_events() {
        let db = fresh_db();
        log_event(&db, "app_started", None).unwrap();
        log_event(&db, "operation_success", Some("pdf_merge")).unwrap();
        assert_eq!(event_count(&db).unwrap(), 2);
        let events = list_events(&db, 100).unwrap();
        assert_eq!(events.len(), 2);
        // Most recent first.
        assert_eq!(events[0].event_type, "operation_success");
        assert_eq!(events[0].detail.as_deref(), Some("pdf_merge"));
        clear_events(&db).unwrap();
        assert_eq!(event_count(&db).unwrap(), 0);
    }
}
