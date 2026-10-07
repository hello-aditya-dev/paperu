# ADR 0004: SQLite for local application state

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/src/database/**`,
  `apps/desktop/src-tauri/migrations/**`,
  `apps/desktop/src-tauri/Cargo.toml`

## Context

Paperu needs a local persistence layer for application state: which
migrations have run, what the user's settings are, the recent
operations history, and a place to hold the future local entitlement
view. The requirements:

1. **Single-user, local-only.** One user, one machine, one process.
   No multi-writer concurrency across machines; no server.
2. **Transactional.** Migrations must run inside a transaction so a
   failure leaves the schema unchanged.
3. **Small.** No server process, no separate install, no large
   runtime.
4. **Bundled, not system-linked.** We do not want to depend on the
   user's system `libsqlite3` version.
5. **No document contents.** This is a hard invariant — see ADR
   `0002-local-first-processing.md`. The persistence layer must not
   be a back door for caching file bytes.

The alternatives:

- **A custom file format (eg. JSON-on-disk).** Simple, but loses
  transactions, schema versioning, and queryability. Fine for
  settings; painful for task history.
- **A key-value store (`sled`, `redb`).** Modern Rust options, but a
  smaller ecosystem, weaker tooling for ad-hoc inspection, and a
  weaker story for schema evolution.
- **A remote database.** Rejected on the local-first invariant (ADR
  `0002-local-first-processing.md`).

## Decision

Paperu uses **SQLite** for local application state only, accessed
through the `rusqlite` crate with the `bundled` feature.

### Scope: what the database stores

The schema (migration `0001_init.sql`) creates four tables:

- **`schema_version`** — migration tracking. The migration runner
  inserts a row after each successful migration inside the same
  transaction.
- **`app_settings`** — key/value. The `Settings` object is stored as
  a JSON blob under the `settings` key. Settings-shape evolution
  (across `SETTINGS_VERSION` bumps) lives in the Rust `settings`
  module, not in SQL migrations.
- **`task_history`** — recent operations. The schema exists;
  persistence is not yet wired up (the task engine keeps tasks
  in-memory for the foundation). When wired, the `recent_files_limit`
  setting caps retention.
- **`licence_state`** — placeholder for the future local
  entitlement view. The schema exists; the real activation flow
  comes later.

### Scope: what the database does NOT store

- **User document contents.** Never. Not even partial. Not even for
  inspection. The inspect path reads `std::fs::metadata` only; it
  does not open the file.
- **Secrets.** No licence keys, no API tokens, no signing keys.
- **Logs.** Logs go to `%LOCALAPPDATA%/app.paperu.desktop/logs/`,
  not to the database.
- **Cached file contents.** No `BLOB` columns anywhere in the
  schema.

This is enforced by code review and by the schema: there is no table
that could hold document contents. Adding one would require
Integrator approval and a security review (see ADR
`0002-local-first-processing.md`).

### Bundled via `rusqlite`

`rusqlite` is added with the `bundled` feature, which compiles the
SQLite amalgamation (the public-domain SQLite C source) directly
into the Paperu binary. The desktop app does not dynamically link
against a system SQLite. This:

- removes the runtime dependency on a system `libsqlite3`;
- guarantees a known SQLite version;
- avoids any system-library licence surprise.

SQLite is in the **public domain** (the SQLite Blessing). It is not
GPL. See `DEPENDENCIES.md` for the licence audit.

### Migration system

Migrations are embedded SQL files under
`apps/desktop/src-tauri/migrations/`, embedded at compile time via
`include_str!`. The runner (`src/database/migrations.rs`) executes
pending migrations in version order, each inside a transaction. A
failed migration is rolled back; the `schema_version` row is not
inserted; the user sees a structured `database.migration_failed`
error.

The runner refuses to downgrade: if the DB's `current_version` is
greater than `LATEST_VERSION` (the DB is from a newer build than
the running code), it returns `database.migration_failed` with a
user-facing detail telling the user to update Paperu.

The runner is idempotent: re-running `run` on a fully-migrated
database is a no-op. The `migrations_are_idempotent` test asserts
this.

Adding a migration:

1. Add `apps/desktop/src-tauri/migrations/000N_label.sql`.
2. Add it to the `MIGRATIONS` list in `migrations.rs` in order.
3. Bump `LATEST_VERSION`.
4. Add a migration test asserting it is idempotent.

This is Integrator-controlled (see `AGENT_HANDOFF.md`).

### Database path

On Windows, the database lives at:

```
%LOCALAPPDATA%\app.paperu.desktop\paperu.db
```

`%LOCALAPPDATA%` resolves to `C:\Users\<user>\AppData\Local`. The
Tauri `app_local_data_dir()` API returns this path; the `runtime::run`
hook in `src/lib.rs` resolves it via
`app.path().app_local_data_dir()`. If that fails (rare), the
fallback is `std::env::temp_dir().join("paperu")`.

The directory is created on first launch by the `setup` hook. SQLite
also creates the `-wal` and `-shm` companion files in WAL mode.

### Pragmas

`Database::open` sets three pragmas every time the database is
opened (they are per-connection):

- `journal_mode = WAL` — write-ahead logging. Readers do not block
  the writer; the writer does not block readers. Suitable for a
  single-user desktop app where the UI reads settings while a
  background task writes progress.
- `synchronous = NORMAL` — safe with WAL; fsyncs only at checkpoint
  rather than on every commit. The risk of losing the last few
  transactions on a power loss is acceptable for app-state data (no
  user document contents are at stake).
- `foreign_keys = ON` — SQLite enforces foreign key constraints.

### Connection management

The `Database` struct guards a single `Connection` behind a
`std::sync::Mutex`. `with_conn(f)` locks the mutex and runs
`f(&Connection)`. This serializes access — SQLite in default config
is single-writer and the app is single-user, so this is sufficient.
A future hardening pass may use a connection pool for read-only
access if concurrency becomes a bottleneck.

## Consequences

### Positive

- **No server process.** The DB is a file. Backup, move, inspect —
  standard file operations.
- **Transactions out of the box.** Migrations are atomic; partial
  schemas never appear.
- **Schema versioning built in.** `schema_version` records what has
  been applied; the runner can refuse a downgrade.
- **Bundled SQLite is public domain.** No licence entanglement; no
  system-library surprise. See `DEPENDENCIES.md`.
- **Tooling.** Standard SQLite tooling (`sqlite3` CLI, DB browsers)
  works against the file for ad-hoc inspection during development.

### Negative

- **`rusqlite` with `bundled` adds compile time.** The SQLite
  amalgamation is compiled into the binary on every clean build.
  This is a one-time cost per build, not per run.
- **`synchronous = NORMAL` trades durability for throughput.** The
  last few transactions may be lost on power failure. Acceptable for
  app-state data; would not be acceptable for document contents (but
  we never store document contents — see ADR `0002`).
- **Single-connection mutex serializes access.** Sufficient for
  single-user, but a future read-heavy workload may need a pool.
- **The schema is hand-written SQL.** No ORM. Migrations are SQL
  files reviewed by the Integrator.

## Non-goals

- **No encrypted database.** The DB file is plain SQLite. If a
  future threat model requires at-rest encryption (eg. SQLCipher),
  that is a new ADR.
- **No server-side replication.** The DB is strictly local. Cloud
  sync is a non-goal for the foundation; if added, it is opt-in and
  requires an ADR (see ADR `0002-local-first-processing.md`).
- **No document content cache.** Ever.

## References

- `apps/desktop/src-tauri/src/database/mod.rs` — `Database` handle,
  `open`, `with_conn`, `default_db_path`.
- `apps/desktop/src-tauri/src/database/migrations.rs` — the
  migration runner.
- `apps/desktop/src-tauri/migrations/0001_init.sql` — the schema.
- `apps/desktop/src-tauri/src/lib.rs` — the `setup` hook that opens
  and migrates the DB.
- `docs/architecture/database.md` — the full database architecture.
- `DEPENDENCIES.md` — the licence audit for `rusqlite`.
- `docs/decisions/0002-local-first-processing.md` — what the DB must
  not store.
