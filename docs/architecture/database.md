# Architecture: database

Paperu uses SQLite for **application state only — never user
document contents**. This document describes the schema, the
migration system, the first-launch / existing-DB / corrupted-DB
handling, and the on-disk path.

The relevant code is in `apps/desktop/src-tauri/src/database/`:

- `mod.rs` — the `Database` handle, `open`, `with_conn`,
  `schema_version`, `default_db_path`.
- `migrations.rs` — the migration runner and the `MIGRATIONS` list.

The SQL is in `apps/desktop/src-tauri/migrations/0001_init.sql`.

---

## What the database stores

The schema (`0001_init.sql`) creates four tables:

### `schema_version`

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    label       TEXT    NOT NULL
);
```

Tracks which migrations have been applied. The migration runner
inserts a row after each successful migration inside the same
transaction. The `current_version` helper reads `MAX(version)`.

### `app_settings`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
    key      TEXT PRIMARY KEY,
    value    TEXT NOT NULL
);
```

Key/value. The `Settings` object is stored as a JSON blob under the
key `settings`. Future settings migrations (across `SETTINGS_VERSION`
bumps) live in the Rust `settings` module, not in SQL migrations.

### `task_history`

```sql
CREATE TABLE IF NOT EXISTS task_history (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL,
    label           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    source_files    TEXT NOT NULL,   -- JSON array
    output_files    TEXT,            -- JSON array (nullable)
    error           TEXT,            -- JSON AppError (nullable)
    correlation_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_history_created_at
    ON task_history (created_at DESC);
```

Records recent operations. The schema exists; persistence is not
yet wired up (the task engine keeps tasks in memory for the
foundation). When wired, the `recent_files_limit` setting caps how
many rows are retained.

### `licence_state`

```sql
CREATE TABLE IF NOT EXISTS licence_state (
    key      TEXT PRIMARY KEY,
    value    TEXT NOT NULL
);
```

Placeholder for the local entitlement view. The schema exists; the
real activation flow comes later. The desktop client never trusts
itself for payment truth — see `docs/architecture/licensing.md`.

---

## What the database does NOT store

- **User document contents.** Never. Not even partial. Not even
  for inspection. The inspect path reads `std::fs::metadata` only;
  it does not open the file.
- **Secrets.** No licence keys, no API tokens, no signing keys.
- **Logs.** Logs go to `%LOCALAPPDATA%/app.paperu.desktop/logs/`,
  not to the database.
- **Cached file contents.** There is no blob storage; no `BLOB`
  columns anywhere.

This is enforced by code review and by the schema: there is no
table that could hold document contents. Adding one would require
Integrator approval and a security review.

---

## Database path

On Windows, the database lives at:

```
%LOCALAPPDATA%\app.paperu.desktop\paperu.db
```

`%LOCALAPPDATA%` resolves to `C:\Users\<user>\AppData\Local`. The
Tauri `app_local_data_dir()` API returns this path; the `runtime::run`
hook in `src/lib.rs` resolves it via `app.path().app_local_data_dir()`.
If that fails (rare), the fallback is `std::env::temp_dir().join("paperu")`.

The directory is created on first launch by the `setup` hook:

```rust
std::fs::create_dir_all(&app_data_dir).ok();
```

SQLite also creates the `-wal` and `-shm` companion files in WAL
mode.

---

## Pragmas

`Database::open` sets three pragmas:

- `journal_mode = WAL` — write-ahead logging. Readers do not block
  the writer; the writer does not block readers. Suitable for a
  single-user desktop app where the UI reads settings while a
  background task writes progress.
- `synchronous = NORMAL` — safe with WAL; fsyncs only at checkpoint
  rather than on every commit. The risk of losing the last few
  transactions on a power loss is acceptable for app-state data
  (no user document contents are at stake).
- `foreign_keys = ON` — SQLite enforces foreign key constraints.
  The foundation schema does not yet declare any, but the pragma
  is on so future migrations can rely on it.

These pragmas are set every time the database is opened (not just
on creation) because they are per-connection.

---

## Migration system

`migrations.rs::run` is the migration runner. The design:

### Migrations are embedded SQL files

Each migration is a `.sql` file under
`apps/desktop/src-tauri/migrations/`. The runner embeds them at
compile time via `include_str!`:

```rust
const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    label: "init",
    sql: include_str!("../../migrations/0001_init.sql"),
}];
```

`LATEST_VERSION = 1` is the highest known version. Adding a
migration:

1. Add `migrations/000N_label.sql`.
2. Add it to the `MIGRATIONS` list in order.
3. Bump `LATEST_VERSION`.
4. Add a migration test asserting it is idempotent.

This is Integrator-controlled (see `AGENT_HANDOFF.md`).

### The `schema_version` table is bootstrapped

`ensure_schema_version_table` creates the table with
`CREATE TABLE IF NOT EXISTS` on every open. It is the only table
that exists before any migration runs.

### Pending migrations run in order inside a transaction

```rust
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
        tx.commit().map_err(|e| migration_failure(e, m.version, m.label))?;
        tracing::info!(version = m.version, label = m.label, "applied migration");
    }
}
```

A migration that fails is rolled back; the schema version row is
not inserted; the user sees a structured
`database.migration_failed` error.

### Refuses to downgrade

If the database's `current_version` is greater than `LATEST_VERSION`
(the DB is from a newer build than the running code), the runner
refuses with `database.migration_failed` and a user-facing detail:

> Update Paperu to the latest version to continue.

This prevents silent corruption from running old code against a
newer schema.

### Idempotent

Re-running `run` on a fully-migrated database is a no-op: the
`m.version > current` check skips every migration. The test
`migrations_are_idempotent` asserts this.

---

## First launch, existing DB, corrupted DB

### First launch

The database file does not exist. `Connection::open` creates it.
`ensure_schema_version_table` creates the `schema_version` table.
`run` applies migration `1 (init)`, which creates the other tables
via `CREATE TABLE IF NOT EXISTS`. The settings table is empty, so
`settings::load` returns `Settings::default()`.

### Existing DB, older schema

The database exists at an older `current_version`. `run` applies
each pending migration in order. The user sees no interruption;
the migrations are fast (small DDL).

### Existing DB, current schema

The database exists at `LATEST_VERSION`. `run` is a no-op. The app
opens normally.

### Existing DB, newer than build

The database's `current_version` is greater than `LATEST_VERSION`.
`run` refuses with `database.migration_failed` and a detail telling
the user to update Paperu.

### Corrupted DB

If the database file is corrupted (SQLite cannot open it), `open`
returns an error that `map_db_error` translates to either
`database.unavailable` (when SQLite reports `CannotOpen`) or
`database.init_failed` (otherwise). The `setup` hook in
`src/lib.rs` propagates this as a fatal error and the app does not
start. A future hardening pass may quarantine the corrupted file
and start fresh; for the foundation, the user is told to delete
the file and relaunch.

### Unreadable settings blob

If the `app_settings` row exists but its JSON is corrupt (manual
edit, disk corruption), `settings::load` logs a warning and falls
back to `Settings::default()`. The app starts normally; the user's
customised settings are lost but the app is usable. This is the
graceful-degradation choice — a corrupt settings blob is not a
crash.

### Migration failure mid-way

Each migration runs inside a transaction. If `execute_batch` fails,
the transaction is rolled back; the schema is unchanged; the
`schema_version` row is not inserted. The user sees a structured
`database.migration_failed` error. The next launch will attempt
the same migration again.

---

## Connection management

The `Database` struct guards a single `Connection` behind a
`std::sync::Mutex`:

```rust
pub struct Database {
    conn: Mutex<Connection>,
}
```

`with_conn(f)` locks the mutex and runs `f(&Connection)`. This
serializes access — SQLite in default config is single-writer and
the app is single-user, so this is sufficient. A future
hardening pass may use a connection pool for read-only access if
concurrency becomes a bottleneck.

The `DATABASE_UNAVAILABLE` error code is returned if the mutex is
poisoned (a previous panic left it locked) — this is a recoverable
error in principle, but in practice it indicates a bug that should
not happen.

---

## Tests

`migrations.rs` has three unit tests:

- `runs_migrations_on_fresh_db` — opens an in-memory DB, runs
  migrations, asserts `current_version == LATEST_VERSION`.
- `migrations_are_idempotent` — runs migrations twice; the second
  run is a no-op; version is unchanged.
- `refuses_downgrade` — runs migrations, tampers with
  `schema_version` to insert version 999 (from the future), asserts
  that `run` returns an error.

These tests run on every platform (Linux CI included) because the
core crate compiles without `tauri-runtime`.
