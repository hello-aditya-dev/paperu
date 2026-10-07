//! Local SQLite state.
//!
//! Paperu stores only *application state* locally — never user
//! document contents. The database holds:
//!   - schema version (migration tracking)
//!   - app settings (key/value)
//!   - task history (recent operations)
//!
//! First launch, existing database, migrations and a corrupted/unavailable
//! DB are all handled gracefully (see docs/architecture/database.md).

pub mod migrations;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};

/// A guarded database handle. Serialized access via a Mutex because
/// SQLite (default config) is single-writer and the app is single-user.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open (and create if absent) the database at `path`, then run
    /// pending migrations.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                AppError::builder(
                    code::DATABASE_INIT_FAILED,
                    ErrorCategory::Database,
                    "Paperu could not prepare its local data folder.",
                )
                .technical(err.to_string())
                .severity(ErrorSeverity::Critical)
                .recoverability(Recoverability::Fatal)
                .build()
            })?;
        }

        let conn = Connection::open(path).map_err(map_db_error)?;

        // Recommended pragmas for a local single-user desktop DB.
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(map_db_error)?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(map_db_error)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(map_db_error)?;

        migrations::run(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Acquire the connection under the guard.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        let conn = self.conn.lock().map_err(|_| {
            AppError::builder(
                code::DATABASE_UNAVAILABLE,
                ErrorCategory::Database,
                "Paperu's local database is busy.",
            )
            .recoverability(Recoverability::Retryable)
            .build()
        })?;
        f(&conn)
    }

    /// The resolved schema version after migrations.
    pub fn schema_version(&self) -> Result<u32> {
        self.with_conn(|conn| {
            let v: Option<u32> = conn
                .query_row(
                    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .ok();
            Ok(v.unwrap_or(0))
        })
    }
}

fn map_db_error(err: rusqlite::Error) -> AppError {
    use rusqlite::ErrorCode;
    let (code, category) = match err {
        rusqlite::Error::SqliteFailure(ref f, _) => match f.code {
            ErrorCode::CannotOpen => (code::DATABASE_UNAVAILABLE, ErrorCategory::Database),
            _ => (code::DATABASE_INIT_FAILED, ErrorCategory::Database),
        },
        _ => (code::DATABASE_INIT_FAILED, ErrorCategory::Database),
    };
    AppError::builder(
        code,
        category,
        "Paperu's local database reported a problem.",
    )
    .technical(err.to_string())
    .severity(ErrorSeverity::Error)
    .recoverability(Recoverability::Retryable)
    .build()
}

/// Default database file path under the app data directory.
pub fn default_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("paperu.db")
}
