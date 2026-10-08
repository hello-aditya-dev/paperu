//! Privacy-safe local analytics (90% §67, COMMERCIAL-04). Opt-in.
//! Stores ONLY coarse event types + timestamps. NEVER paths, filenames,
//! document contents, signatures, clipboard, or form data. No network
//! endpoint in V1 (local store only; remote endpoint is configurable future).
//!
//! P0-F: logging is GENUINELY opt-in. The `allow_diagnostics` setting
//! (default OFF) must be true before any event is recorded. When disabled,
//! log_event returns Ok (silent no-op) — no event is stored. Event types
//! are restricted to a fixed allowlist; arbitrary types are rejected.

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The fixed allowlist of permitted event types. No arbitrary types allowed.
pub const ALLOWED_EVENT_TYPES: &[&str] = &[
    "app_started",
    "operation_started",
    "operation_success",
    "operation_failed",
    "upgrade_viewed",
    "license_activated",
];

/// Check if an event type is in the allowlist.
fn is_allowed_event(event_type: &str) -> bool {
    ALLOWED_EVENT_TYPES.contains(&event_type)
}

/// Check the `allow_diagnostics` setting from the settings table.
/// Returns false if the setting is absent or explicitly false.
fn is_analytics_enabled(db: &Database) -> bool {
    db.with_conn(|conn| {
        let row: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .ok();
        let enabled = match row {
            Some(json) => serde_json::from_str::<crate::contracts::settings::Settings>(&json)
                .is_ok_and(|s| s.allow_diagnostics),
            None => false,
        };
        Ok(enabled)
    })
    .unwrap_or(false)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub id: String,
    pub event_type: String,
    pub timestamp: String,
    pub detail: Option<String>,
}

/// Log an analytics event. P0-F: this is a silent no-op when the
/// `allow_diagnostics` setting is OFF (the default). Event types not
/// in the allowlist are rejected with an error. Detail values are
/// checked against a denylist of sensitive patterns (paths, filenames).
pub fn log_event(db: &Database, event_type: &str, detail: Option<&str>) -> Result<()> {
    // P0-F: enforce opt-in. Default OFF — no events recorded while disabled.
    if !is_analytics_enabled(db) {
        return Ok(()); // silent no-op — not an error, just not logged
    }
    // P0-F: restrict event types to the allowlist.
    if !is_allowed_event(event_type) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That analytics event type is not in the allowlist.",
        )
        .technical(format!("rejected event_type: {event_type}"))
        .build());
    }
    // P0-F: reject detail values that look like paths or filenames
    // (contain / or \ or drive prefixes). Never store paths.
    if let Some(d) = detail {
        if d.contains('/') || d.contains('\\') || (d.len() >= 2 && d.as_bytes()[1] == b':') {
            return Err(AppError::builder(
                code::INVALID_INPUT,
                ErrorCategory::Validation,
                "Analytics detail must not contain file paths.",
            )
            .technical("detail contains path separators or drive prefix")
            .build());
        }
    }
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO analytics_event (id, event_type, timestamp, detail) VALUES (?1, ?2, ?3, ?4)",
            params![id, event_type, now, detail],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn list_events(db: &Database, limit: i64) -> Result<Vec<AnalyticsEvent>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, event_type, timestamp, detail FROM analytics_event ORDER BY rowid DESC LIMIT ?1").map_err(map_sqlite)?;
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
    fn no_events_recorded_when_opt_in_disabled() {
        // P0-F: default OFF — no events recorded.
        let db = fresh_db();
        // Settings table exists but allowDiagnostics defaults to false.
        log_event(&db, "app_started", None).unwrap();
        assert_eq!(event_count(&db).unwrap(), 0, "no events when opt-in is OFF");
    }

    #[test]
    fn events_recorded_when_opt_in_enabled() {
        let db = fresh_db();
        // Enable diagnostics via settings.
        let settings = crate::contracts::settings::Settings {
            allow_diagnostics: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?1)",
                params![json],
            )
            .map_err(map_sqlite)
            .map(|_| ())
        })
        .unwrap();
        log_event(&db, "app_started", None).unwrap();
        log_event(&db, "operation_success", Some("pdf_merge")).unwrap();
        assert_eq!(
            event_count(&db).unwrap(),
            2,
            "events recorded when opt-in is ON"
        );
    }

    #[test]
    fn rejected_event_type_not_in_allowlist() {
        let db = fresh_db();
        // Enable diagnostics.
        let settings = crate::contracts::settings::Settings {
            allow_diagnostics: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?1)",
                params![json],
            )
            .map_err(map_sqlite)
            .map(|_| ())
        })
        .unwrap();
        // "arbitrary_event" is NOT in the allowlist.
        let result = log_event(&db, "arbitrary_event", None);
        assert!(result.is_err(), "non-allowlisted event type rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    #[test]
    fn rejected_detail_containing_path() {
        let db = fresh_db();
        // Enable.
        let settings = crate::contracts::settings::Settings {
            allow_diagnostics: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?1)",
                params![json],
            )
            .map_err(map_sqlite)
            .map(|_| ())
        })
        .unwrap();
        // Detail containing a path separator.
        let result = log_event(&db, "app_started", Some("/home/user/secret.pdf"));
        assert!(result.is_err(), "detail with path separator rejected");
        // Detail containing a Windows drive prefix.
        let result2 = log_event(&db, "app_started", Some("C:\\Users\\secret"));
        assert!(result2.is_err(), "detail with drive prefix rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    #[test]
    fn list_clear_events() {
        let db = fresh_db();
        // Enable.
        let settings = crate::contracts::settings::Settings {
            allow_diagnostics: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?1)",
                params![json],
            )
            .map_err(map_sqlite)
            .map(|_| ())
        })
        .unwrap();
        log_event(&db, "app_started", None).unwrap();
        log_event(&db, "operation_success", Some("pdf_merge")).unwrap();
        assert_eq!(event_count(&db).unwrap(), 2);
        let events = list_events(&db, 100).unwrap();
        assert_eq!(events.len(), 2);
        // Most recent first (rowid DESC).
        assert_eq!(events[0].event_type, "operation_success");
        assert_eq!(events[0].detail.as_deref(), Some("pdf_merge"));
        clear_events(&db).unwrap();
        assert_eq!(event_count(&db).unwrap(), 0);
    }
}
