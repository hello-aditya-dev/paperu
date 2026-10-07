# Architecture: crash recovery

Paperu is a desktop application. Crashes, power losses, force
quits and OS updates happen. This document describes how the
foundation recovers from each of them, what is preserved, what is
discarded, and how the user is informed.

The relevant code:

- `apps/desktop/src-tauri/src/filesystem/temp.rs` — the temp
  workspace, atomic finalization, startup cleanup.
- `apps/desktop/src-tauri/src/database/mod.rs` and
  `migrations.rs` — SQLite open and migration handling.
- `apps/desktop/src-tauri/src/lib.rs` — the `setup` hook that runs
  the recovery pass.

---

## Principles

1. **Never leave a partial output in the user's chosen location.**
   Outputs are written to the temp workspace first and moved into
   place atomically. A crash mid-operation leaves the partial
   output in the temp workspace, never in the destination.
2. **Never destroy a source file.** Source files are never opened
   for writing. A crash cannot corrupt the source.
3. **Never lose more than the in-flight operation.** Settings are
   persisted atomically. Task history (when persisted) is recorded
   only at terminal states. A crash loses at most the operation
   that was running.
4. **Always reach a terminal state eventually.** A task that was
   running when the crash happened is not silently resumed; it is
   marked failed (when task history persistence lands) or simply
   absent from the in-memory registry (the foundation behaviour).
5. **Graceful degradation.** A corrupt settings blob does not
   crash the app; defaults are used. A corrupt database does not
   silently lose data; the user is told and given a path forward.

---

## Temp workspace cleanup on startup

`TempWorkspace::startup_cleanup` runs on every launch, from the
Tauri `setup` hook in `src/lib.rs`:

```rust
if let Ok(ws) = crate::filesystem::temp::TempWorkspace::ensure() {
    if let Err(err) = ws.startup_cleanup() {
        tracing::warn!(error = %err, "temp cleanup failed");
    }
}
```

The cleanup:

1. Reads the temp workspace directory (`%TEMP%/paperu`).
2. For each entry, attempts `fs::remove_file`.
3. Counts removed files. Logs `removed = N` if N > 0.
4. Missing directory is a no-op (returns `Ok(())`).
5. Per-file removal failures are logged at `warn` and skipped;
   they do not abort the cleanup. A failure typically means another
   process holds the file open or the file has already been removed.

The cleanup is best-effort. The worst case is that some stale temp
files linger — they are in the OS temp dir, not in the user's
chosen output directory, and they contain no user-meaningful
content (they are partial outputs that were never finalized). The
OS will eventually reclaim temp space; Paperu does not need to be
perfect here.

### Why the cleanup is safe

- The temp workspace contains only partial outputs from a previous
  Paperu run. No other application writes there (the directory
  name `paperu` is product-specific).
- Files are named `paperu-{uuid}{suffix}` — UUID v4 makes
  collisions effectively impossible.
- The cleanup removes files only, never directories above the
  workspace root. It does not follow symlinks.
- The cleanup does not touch the user's chosen output directory or
  any source file.

---

## Atomic finalization

`atomic_finalize(temp, dest, overwrite)` is the single canonical
way to move a temp output into place. See
`docs/architecture/file-handling.md` for the full design. The
crash-relevant properties:

- **Same-filesystem rename is atomic.** A crash mid-rename leaves
  either the temp file (operation failed) or the destination
  (operation succeeded) — never both, never neither. The
  destination is never partially written.
- **Existing destination is refused unless `overwrite=true`.** A
  crash cannot clobber a previously-finalized output.
- **Cross-volume fallback is opt-in.** When `rename` fails across
  volumes, Paperu falls back to `copy + delete` *only* if the
  caller has explicitly accepted overwrite semantics. The default
  non-destructive path leaves the temp file for the startup
  cleanup pass and returns a structured error.

### The TOCTOU window

`atomic_finalize` checks `dest.exists()` before renaming. There is
a small window between the check and the rename where another
process could create the destination. For the foundation, this is
acceptable because the only writer to a destination is Paperu
itself. A future hardening pass may use platform-specific atomic
replace (`ReplaceFile` on Windows) when `overwrite=true` is
requested.

---

## Task failure handling

The task engine (`src/tasks/mod.rs`) keeps tasks in an in-memory
registry (`TaskRegistry`). On a crash, the registry is lost. The
foundation's behaviour:

- A task that was `Running` when the crash happened is **not**
  resumed. It is absent from the registry on the next launch.
- A task that had reached a terminal state (`Completed`, `Failed`,
  `Cancelled`) is also absent — terminal tasks are removed from
  the live registry by `finish()`.
- The `task_history` SQLite table exists in the schema to record
  terminal tasks, but persistence is not yet wired up. When wired,
  the engine will write the task snapshot to `task_history` at the
  terminal state, and a future launch will be able to display
  history.

### When engines land

When a real engine runs (e.g. PDF compress), the engine must:

1. Register the task with the `TaskRegistry` and obtain a
   `CancellationToken`.
2. Cooperatively check `cancel.is_cancelled()` at meaningful
   boundaries (per page, per chunk). On cancellation, clean up
   any temp files and call `finish(id, TaskStatus::Cancelled)`.
3. Write the output to a temp file under `TempWorkspace`.
4. Validate the output before finalization.
5. Call `atomic_finalize(temp, dest, overwrite)`.
6. On success, call `finish(id, TaskStatus::Completed)` with the
   output metadata. On failure, call `finish(id,
   TaskStatus::Failed)` with a structured `AppError`.

If the process crashes between steps 3 and 5, the temp file is
left in `%TEMP%/paperu` and removed on the next startup. The
source is untouched. The user simply re-runs the operation.

---

## Database failure graceful degradation

The database holds only app state, never document contents. The
failure modes and their handling:

### First launch (no DB file)

`Connection::open` creates the file. Migrations run. Settings are
default. See `docs/architecture/database.md`.

### Existing DB, current schema

Open normally. No recovery needed.

### Existing DB, older schema

Migrations run in order. Each migration is in a transaction; a
failure rolls back and surfaces `database.migration_failed`.

### Existing DB, newer than build

Refused. The user is told to update Paperu. This prevents silent
corruption from running old code against a newer schema.

### Corrupted DB file

If SQLite cannot open the file, `open` returns an error. The
`setup` hook in `src/lib.rs` propagates it as a fatal error and the
app does not start:

```rust
let db = match crate::database::Database::open(&db_path) {
    Ok(db) => db,
    Err(err) => {
        tracing::error!(error = %err, "database open failed");
        return Err(Box::new(err) as Box<dyn std::error::Error>);
    }
};
```

A future hardening pass may quarantine the corrupted file (rename
it to `paperu.db.corrupt-<timestamp>`) and start fresh, so the
user can at least open the app. For the foundation, the user is
told to delete the file and relaunch.

### Corrupt settings blob

If `app_settings.settings` exists but its JSON is unreadable,
`settings::load` logs a warning and falls back to
`Settings::default()`. The app starts normally; the user's
customised settings are lost but no other state is affected. This
is the graceful-degradation choice.

### Locked DB (another process holds the file)

SQLite returns `CannotOpen`. `map_db_error` translates this to
`database.unavailable` with `recoverability = Retryable`. The
`setup` hook currently treats this as fatal; a future hardening
pass may retry with a backoff.

---

## Logging persistence

Local logs (`%LOCALAPPDATA%/com.paperu/desktop/logs/paperu.log`)
are written via a non-blocking `tracing_appender` with daily
rotation. The `WorkerGuard` stored in a `OnceLock` keeps the
writer flushed for the lifetime of the process. On a crash:

- The most recent log lines may be lost (they are in the
  non-blocking buffer).
- The daily-rotated file is intact up to the last flush.

Logs are not needed for recovery — they are for diagnosis only.
No recovery step depends on log content.

---

## What the user sees after a crash

On the next launch:

1. The Tauri `setup` hook runs.
2. The log directory is created and the tracing subscriber is
   initialised.
3. The SQLite database is opened (and migrated if needed).
4. `TempWorkspace::startup_cleanup` removes any stale partial
   outputs.
5. The `AppState` is created and managed.
6. The app starts at the HomeRoute (Local File Inspect).

There is no "we noticed you crashed" dialog in the foundation. A
future UX pass may add one when engines land and operations can be
in-flight at the time of a crash. For now, the cleanup is silent
(logged at `info` if any files were removed, otherwise silent).

---

## What is not yet implemented

- **Task history persistence.** The `task_history` table exists;
  the engine does not yet write to it.
- **Resume-on-launch.** A task that was running when the crash
  happened is not resumed. The user re-runs it.
- **Quarantine for corrupt DB.** A corrupt DB causes the app to
  fail to start; the user must manually delete the file.
- **Progress events on recovery.** The `paperu://task/progress`
  and `paperu://task/finished` event names are reserved in the
  contracts but not yet emitted.

These are intentional foundation boundaries, not bugs. See
`KNOWN_LIMITATIONS.md`.
