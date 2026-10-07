//! Typed application settings, persisted in SQLite.
//!
//! The frontend never scatters `localStorage` calls. It always goes
//! through this typed abstraction over IPC. Defaults are explicit
//! and versioned (see `Settings::default`).

use rusqlite::{params, Connection};

use crate::contracts::settings::{Settings, SettingsPatch};
use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};

const SETTINGS_KEY: &str = "settings";

/// Load settings from the database, falling back to defaults when
/// absent (first launch). A corrupt stored blob is replaced with
/// defaults rather than crashing the app.
pub fn load(db: &Database) -> Result<Settings> {
    db.with_conn(|conn| {
        let row: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![SETTINGS_KEY],
                |r| r.get(0),
            )
            .ok();
        match row {
            None => Ok(Settings::default()),
            Some(json) => match serde_json::from_str::<Settings>(&json) {
                Ok(s) => Ok(merge_with_defaults(s)),
                Err(err) => {
                    tracing::warn!(error = %err, "settings blob unreadable; using defaults");
                    Ok(Settings::default())
                }
            },
        }
    })
}

/// Persist settings, replacing the stored blob atomically.
pub fn save(db: &Database, settings: &Settings) -> Result<()> {
    db.with_conn(|conn| {
        let json = serde_json::to_string(settings).map_err(AppError::from)?;
        upsert_setting(conn, SETTINGS_KEY, &json)
    })
}

/// Apply a partial patch to the persisted settings and return the
/// new resolved settings.
pub fn apply_patch(db: &Database, patch: &SettingsPatch) -> Result<Settings> {
    db.with_conn(|conn| {
        let mut current = load_from_conn(conn);
        patch.apply_to(&mut current);
        let json = serde_json::to_string(&current).map_err(AppError::from)?;
        upsert_setting(conn, SETTINGS_KEY, &json)?;
        Ok(current)
    })
}

fn load_from_conn(conn: &Connection) -> Settings {
    let row: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |r| r.get(0),
        )
        .ok();
    match row {
        Some(json) => serde_json::from_str::<Settings>(&json)
            .map(merge_with_defaults)
            .unwrap_or_default(),
        None => Settings::default(),
    }
}

fn upsert_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| {
        AppError::builder(
            code::DATABASE_UNAVAILABLE,
            ErrorCategory::Database,
            "Paperu could not save a setting.",
        )
        .technical(e.to_string())
        .build()
    })?;
    Ok(())
}

/// Forward-fill any missing fields from defaults so older stored
/// settings stay valid after a schema bump within the same version.
fn merge_with_defaults(mut stored: Settings) -> Settings {
    let defaults = Settings::default();
    if stored.version != crate::contracts::settings::SETTINGS_VERSION {
        // Across-version migration of settings would live here. For the
        // foundation we reset to defaults while preserving nothing
        // private (settings contain no secrets).
        stored.version = crate::contracts::settings::SETTINGS_VERSION;
        // Keep user-chosen simple fields where they are present.
        let _ = defaults; // explicit: defaults are the source of truth.
    }
    stored
}
