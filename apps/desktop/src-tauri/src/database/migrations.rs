//! Database migrations.
//!
//! Migrations are plain SQL files under `migrations/`, embedded at
//! compile time. They run in order inside a transaction. The schema
//! version is recorded after each successful migration.
//!
//! Adding a migration:
//!   1. Add `migrations/000N_label.sql`.
//!   2. Add it to the `MIGRATIONS` list below in order.
//!   3. Add a migration test asserting it is idempotent.

use rusqlite::Connection;

use crate::errors::{code, AppError, ErrorCategory, Result};

/// A migration entry: a version number, a label, and the SQL.
struct Migration {
    version: u32,
    label: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        label: "init",
        sql: include_str!("../../migrations/0001_init.sql"),
    },
    Migration {
        version: 2,
        label: "recent_work",
        sql: include_str!("../../migrations/0002_recent_work.sql"),
    },
    Migration {
        version: 3,
        label: "application_kit",
        sql: include_str!("../../migrations/0003_application_kit.sql"),
    },
    Migration {
        version: 4,
        label: "notes",
        sql: include_str!("../../migrations/0004_notes.sql"),
    },
    Migration {
        version: 5,
        label: "reading_history",
        sql: include_str!("../../migrations/0005_reading_history.sql"),
    },
    Migration {
        version: 6,
        label: "feature_expansion",
        sql: include_str!("../../migrations/0006_feature_expansion.sql"),
    },
    Migration {
        version: 7,
        label: "organizer_conflict_policy",
        sql: include_str!("../../migrations/0007_organizer_conflict_policy.sql"),
    },
    Migration {
        version: 8,
        label: "signature_vault",
        sql: include_str!("../../migrations/0008_signature_vault.sql"),
    },
];

/// The highest migration version known to this build.
pub const LATEST_VERSION: u32 = 8;

/// Run all pending migrations inside a transaction.
pub fn run(conn: &Connection) -> Result<()> {
    ensure_schema_version_table(conn)?;

    let current = current_version(conn)?;
    tracing::info!(current, latest = LATEST_VERSION, "database migration check");

    if current > LATEST_VERSION {
        // The DB is newer than this build. Refuse rather than risk
        // downgrade corruption.
        return Err(AppError::builder(
            code::DATABASE_MIGRATION_FAILED,
            ErrorCategory::Database,
            "Paperu's local database is from a newer version.",
        )
        .detail("Update Paperu to the latest version to continue.")
        .technical(format!(
            "db version {current} > build version {LATEST_VERSION}"
        ))
        .build());
    }

    for m in MIGRATIONS {
        if m.version > current {
            let tx = conn.unchecked_transaction().map_err(map_sqlite)?;
            if let Err(e) = tx.execute_batch(m.sql) {
                let _ = tx.rollback();
                return Err(migration_failure(e, m.version, m.label));
            }
            if let Err(e) = tx.execute(
                "INSERT INTO schema_version (version, label) VALUES (?1, ?2)",
                rusqlite::params![m.version, m.label],
            ) {
                let _ = tx.rollback();
                return Err(migration_failure(e, m.version, m.label));
            }
            tx.commit()
                .map_err(|e| migration_failure(e, m.version, m.label))?;
            tracing::info!(version = m.version, label = m.label, "applied migration");
        }
    }

    Ok(())
}

fn ensure_schema_version_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version     INTEGER PRIMARY KEY,
            applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            label       TEXT    NOT NULL
        )",
        [],
    )
    .map_err(map_sqlite)?;
    Ok(())
}

fn current_version(conn: &Connection) -> Result<u32> {
    let v: Option<u32> = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .ok()
        .flatten();
    Ok(v.unwrap_or(0))
}

fn map_sqlite(err: rusqlite::Error) -> AppError {
    AppError::builder(
        code::DATABASE_MIGRATION_FAILED,
        ErrorCategory::Database,
        "Paperu could not update its local database.",
    )
    .technical(err.to_string())
    .build()
}

fn migration_failure(err: rusqlite::Error, version: u32, label: &str) -> AppError {
    AppError::builder(
        code::DATABASE_MIGRATION_FAILED,
        ErrorCategory::Database,
        "Paperu could not complete a database update.",
    )
    .technical(format!("migration {version} ({label}) failed: {err}"))
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn
    }

    #[test]
    fn runs_migrations_on_fresh_db() {
        let conn = fresh_conn();
        run(&conn).expect("migrations run");
        assert_eq!(current_version(&conn).unwrap(), LATEST_VERSION);
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = fresh_conn();
        run(&conn).expect("first run");
        run(&conn).expect("second run is a no-op");
        assert_eq!(current_version(&conn).unwrap(), LATEST_VERSION);
    }

    #[test]
    fn refuses_downgrade() {
        let conn = fresh_conn();
        run(&conn).expect("migrations");
        // Tamper: pretend the DB is from the future.
        conn.execute(
            "INSERT INTO schema_version (version, applied_at, label) VALUES (999, 'x', 'future')",
            [],
        )
        .unwrap();
        let res = run(&conn);
        assert!(res.is_err(), "must refuse a newer-than-build DB");
    }
}
