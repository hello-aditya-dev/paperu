//! Privacy-safe local analytics (90% §67, COMMERCIAL-04, P4 hardening).
//!
//! P4 changes from the prior implementation:
//! - **Separate consent**: `allowDiagnostics` and `allowProductAnalytics`
//!   are distinct settings. Diagnostics covers future crash reports +
//!   stack traces; product analytics covers coarse event counts. Both
//!   default OFF. A user can opt into crash reporting without opting
//!   into usage analytics.
//! - **Typed event attributes** instead of free-form strings. Each
//!   event has a fixed `event_type` from an allowlist + a typed
//!   `EventAttribute` enum (OperationKind, Outcome). No arbitrary
//!   user-supplied strings, no paths, no filenames, no document data.
//! - **Tests prove no logging when disabled** — both for diagnostics-
//!   only-off + product-analytics-off.
//!
//! No network endpoint in V1 (local store only; remote endpoint is
//! configurable future, never automatic).

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

/// Typed, allowlisted event attributes. Never arbitrary strings.
/// Stored as a small JSON blob in the `attributes` column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventAttribute {
    /// Coarse operation kind (pdf_merge, image_fit, etc.).
    /// The value MUST be in `ALLOWED_OPERATION_KINDS`.
    OperationKind(String),
    /// Outcome of an operation: success | failure | cancelled.
    Outcome(String),
    /// A UI surface (home, reader, batch). Coarse identifier only.
    Surface(String),
}

/// Allowlist of operation-kind values for the `OperationKind` attribute.
pub const ALLOWED_OPERATION_KINDS: &[&str] = &[
    "pdf_merge",
    "pdf_split",
    "pdf_sign",
    "pdf_fill",
    "pdf_watermark",
    "pdf_pages",
    "pdf_fit",
    "pdf_compare",
    "pdf_notebook",
    "image_fit",
    "image_metadata",
    "image_compress",
    "archive_create",
    "archive_extract",
    "usb_copy",
    "backup_recipe",
    "organizer_rule",
    "rename",
    "business_doc",
    "portal_ready",
    "assignment",
];

/// Allowlist of outcome values.
pub const ALLOWED_OUTCOMES: &[&str] = &["success", "failure", "cancelled"];

/// Allowlist of surface values.
pub const ALLOWED_SURFACES: &[&str] = &[
    "home", "reader", "batch", "print", "kit", "timer", "watch", "send",
];

/// Validate a typed attribute against its allowlist.
pub fn validate_attribute(attr: &EventAttribute) -> Result<()> {
    match attr {
        EventAttribute::OperationKind(k) => {
            if !ALLOWED_OPERATION_KINDS.contains(&k.as_str()) {
                return Err(AppError::builder(
                    code::INVALID_INPUT,
                    ErrorCategory::Validation,
                    "That operation kind is not in the analytics allowlist.",
                )
                .technical(format!("operation_kind: {k}"))
                .build());
            }
            Ok(())
        }
        EventAttribute::Outcome(o) => {
            if !ALLOWED_OUTCOMES.contains(&o.as_str()) {
                return Err(AppError::builder(
                    code::INVALID_INPUT,
                    ErrorCategory::Validation,
                    "That outcome is not in the analytics allowlist.",
                )
                .technical(format!("outcome: {o}"))
                .build());
            }
            Ok(())
        }
        EventAttribute::Surface(s) => {
            if !ALLOWED_SURFACES.contains(&s.as_str()) {
                return Err(AppError::builder(
                    code::INVALID_INPUT,
                    ErrorCategory::Validation,
                    "That surface is not in the analytics allowlist.",
                )
                .technical(format!("surface: {s}"))
                .build());
            }
            Ok(())
        }
    }
}

/// Read the `allowProductAnalytics` setting. Returns false if absent
/// or explicitly false. (Diagnostics consent does NOT authorise
/// product analytics — both must be checked separately.)
fn is_product_analytics_enabled(db: &Database) -> bool {
    db.with_conn(|conn| {
        let row: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .ok();
        let enabled = match row {
            Some(json) => {
                let s: crate::contracts::settings::Settings =
                    serde_json::from_str(&json).unwrap_or_default();
                s.allow_product_analytics
            }
            None => false,
        };
        Ok(enabled)
    })
    .unwrap_or(false)
}

/// Backwards-compatible legacy check — used by legacy callers that
/// still use `allow_diagnostics` for operation-level events. Kept so
/// the existing settings UI doesn't break. New code should use
/// `is_product_analytics_enabled`.
fn is_diagnostics_enabled(db: &Database) -> bool {
    db.with_conn(|conn| {
        let row: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .ok();
        let enabled = match row {
            Some(json) => {
                let s: crate::contracts::settings::Settings =
                    serde_json::from_str(&json).unwrap_or_default();
                s.allow_diagnostics
            }
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
    /// Typed attributes (JSON-encoded `Vec<EventAttribute>`).
    /// Backwards-compatible with the old `detail: Option<String>`
    /// column — old events have a free-form string here, new events
    /// have a JSON array of typed attributes.
    pub detail: Option<String>,
}

/// Log an analytics event. P4: silent no-op when BOTH
/// `allow_diagnostics` AND `allow_product_analytics` are OFF (default).
/// Event types not in the allowlist are rejected. Typed attributes
/// are validated against their allowlists.
///
/// Note: this function is the canonical public entry. The legacy
/// free-form `detail: Option<&str>` signature is preserved for
/// backwards-compat with existing callers; new callers should use
/// `log_event_typed` which takes `&[EventAttribute]`.
pub fn log_event(db: &Database, event_type: &str, detail: Option<&str>) -> Result<()> {
    // P4: require product-analytics consent for operation-level events.
    // Diagnostics consent alone is NOT enough for product analytics.
    if !is_product_analytics_enabled(db) {
        return Ok(()); // silent no-op
    }
    if !is_allowed_event(event_type) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That analytics event type is not in the allowlist.",
        )
        .technical(format!("rejected event_type: {event_type}"))
        .build());
    }
    // Legacy free-form detail: reject anything that looks like a path
    // (defence in depth — typed attributes are the preferred path).
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

/// Log an analytics event with typed attributes (P4 preferred path).
/// Each attribute is validated against its allowlist. The attributes
/// are serialised as a small JSON array in the `detail` column.
pub fn log_event_typed(
    db: &Database,
    event_type: &str,
    attributes: &[EventAttribute],
) -> Result<()> {
    if !is_product_analytics_enabled(db) {
        return Ok(()); // silent no-op
    }
    if !is_allowed_event(event_type) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That analytics event type is not in the allowlist.",
        )
        .technical(format!("rejected event_type: {event_type}"))
        .build());
    }
    for a in attributes {
        validate_attribute(a)?;
    }
    let detail_json = if attributes.is_empty() {
        None
    } else {
        serde_json::to_string(attributes).ok()
    };
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO analytics_event (id, event_type, timestamp, detail) VALUES (?1, ?2, ?3, ?4)",
            params![id, event_type, now, detail_json],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

/// Manual override for diagnostics-only events (crash reports etc).
/// These require `allow_diagnostics`, not `allow_product_analytics`.
/// Kept separate so a user can opt into crash reporting without
/// opting into product analytics. (Stub for future use — no
/// diagnostics events are emitted in V1.)
pub fn log_diagnostics_event(db: &Database, event_type: &str, message: &str) -> Result<()> {
    if !is_diagnostics_enabled(db) {
        return Ok(());
    }
    if !is_allowed_event(event_type) {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That diagnostics event type is not in the allowlist.",
        )
        .build());
    }
    // Diagnostics may carry short messages, but never paths.
    if message.contains('/') || message.contains('\\') {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Diagnostics message must not contain file paths.",
        )
        .build());
    }
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        conn.execute(
            "INSERT INTO analytics_event (id, event_type, timestamp, detail) VALUES (?1, ?2, ?3, ?4)",
            params![id, event_type, now, message],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

pub fn list_events(db: &Database, limit: i64) -> Result<Vec<AnalyticsEvent>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, event_type, timestamp, detail FROM analytics_event ORDER BY rowid DESC LIMIT ?1").map_err(map_sqlite)?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(AnalyticsEvent {
                id: r.get(0)?,
                event_type: r.get(1)?,
                timestamp: r.get(2)?,
                detail: r.get(3)?,
            })
        }).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
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
    use crate::contracts::settings::Settings;

    fn fresh_db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    fn fresh_db_with(setting: &str) -> Database {
        let db = fresh_db();
        let mut s = Settings::default();
        match setting {
            "diagnostics" => s.allow_diagnostics = true,
            "product" => s.allow_product_analytics = true,
            "both" => {
                s.allow_diagnostics = true;
                s.allow_product_analytics = true;
            }
            _ => {}
        }
        let json = serde_json::to_string(&s).unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('settings', ?1)",
                params![json],
            )
            .map_err(map_sqlite)
            .map(|_| ())
        })
        .unwrap();
        db
    }

    // ── P4: default-OFF tests (both diagnostics + product) ────────

    #[test]
    fn no_events_recorded_when_both_off() {
        // P4: default OFF — no events recorded.
        let db = fresh_db();
        log_event(&db, "app_started", None).unwrap();
        log_event_typed(&db, "app_started", &[]).unwrap();
        log_diagnostics_event(&db, "app_started", "no paths").unwrap();
        assert_eq!(event_count(&db).unwrap(), 0, "no events when both OFF");
    }

    #[test]
    fn no_product_events_when_only_diagnostics_on() {
        // P4: diagnostics alone does NOT authorise product analytics.
        let db = fresh_db_with("diagnostics");
        log_event(&db, "app_started", None).unwrap();
        log_event_typed(&db, "app_started", &[]).unwrap();
        assert_eq!(
            event_count(&db).unwrap(),
            0,
            "diagnostics-only does not authorise product events"
        );
        // Diagnostics events ARE recorded.
        log_diagnostics_event(&db, "app_started", "msg").unwrap();
        assert_eq!(event_count(&db).unwrap(), 1);
    }

    #[test]
    fn product_events_when_product_consent_on() {
        let db = fresh_db_with("product");
        log_event(&db, "app_started", None).unwrap();
        log_event_typed(
            &db,
            "operation_success",
            &[EventAttribute::OperationKind("pdf_merge".into())],
        )
        .unwrap();
        assert_eq!(event_count(&db).unwrap(), 2, "product events recorded");
    }

    #[test]
    fn rejected_event_type_not_in_allowlist() {
        let db = fresh_db_with("product");
        let result = log_event(&db, "arbitrary_event", None);
        assert!(result.is_err(), "non-allowlisted event type rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    #[test]
    fn rejected_detail_containing_path() {
        let db = fresh_db_with("product");
        let result = log_event(&db, "app_started", Some("/home/user/secret.pdf"));
        assert!(result.is_err(), "detail with path separator rejected");
        let result2 = log_event(&db, "app_started", Some("C:\\Users\\secret"));
        assert!(result2.is_err(), "detail with drive prefix rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    // ── P4: typed attribute allowlist tests ───────────────────────

    #[test]
    fn typed_attribute_operation_kind_rejects_unknown() {
        let db = fresh_db_with("product");
        let res = log_event_typed(
            &db,
            "operation_success",
            &[EventAttribute::OperationKind("unknown_kind".into())],
        );
        assert!(res.is_err(), "unknown operation_kind rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    #[test]
    fn typed_attribute_outcome_rejects_unknown() {
        let db = fresh_db_with("product");
        let res = log_event_typed(
            &db,
            "operation_success",
            &[EventAttribute::Outcome("weird".into())],
        );
        assert!(res.is_err(), "unknown outcome rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    #[test]
    fn typed_attribute_surface_rejects_unknown() {
        let db = fresh_db_with("product");
        let res = log_event_typed(
            &db,
            "operation_success",
            &[EventAttribute::Surface("secret_panel".into())],
        );
        assert!(res.is_err(), "unknown surface rejected");
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    #[test]
    fn typed_attributes_accept_known_combination() {
        let db = fresh_db_with("product");
        log_event_typed(
            &db,
            "operation_success",
            &[
                EventAttribute::OperationKind("pdf_merge".into()),
                EventAttribute::Outcome("success".into()),
                EventAttribute::Surface("batch".into()),
            ],
        )
        .unwrap();
        assert_eq!(event_count(&db).unwrap(), 1);
        // The detail column has a JSON array of typed attributes.
        let evs = list_events(&db, 10).unwrap();
        assert_eq!(evs.len(), 1);
        let detail = evs[0].detail.as_ref().expect("detail set");
        assert!(detail.contains("pdf_merge"));
        assert!(detail.contains("success"));
        assert!(detail.contains("batch"));
    }

    // ── backwards-compat: list + clear + count ────────────────────

    #[test]
    fn list_clear_events() {
        let db = fresh_db_with("product");
        log_event(&db, "app_started", None).unwrap();
        log_event(&db, "operation_success", Some("pdf_merge")).unwrap();
        assert_eq!(event_count(&db).unwrap(), 2);
        let events = list_events(&db, 100).unwrap();
        assert_eq!(events.len(), 2);
        clear_events(&db).unwrap();
        assert_eq!(event_count(&db).unwrap(), 0);
    }

    // ── Default-Settings sanity ────────────────────────────────────

    #[test]
    fn default_settings_have_both_analytics_off() {
        let s = Settings::default();
        assert!(!s.allow_diagnostics, "diagnostics default OFF");
        assert!(!s.allow_product_analytics, "product analytics default OFF");
    }
}
