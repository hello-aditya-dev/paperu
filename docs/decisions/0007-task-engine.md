# ADR 0007: Cancellable async task engine

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/src/tasks/**`,
  `apps/desktop/src-tauri/src/engines/**` (future),
  `apps/desktop/src-tauri/src/commands/**` (future task commands),
  `packages/contracts/src/tasks.ts`,
  `apps/desktop/src-tauri/src/contracts/tasks.rs`

## Context

Future Paperu operations — compress a PDF, convert an image, batch
merge a folder — are long-running. They take seconds to minutes, not
milliseconds. If those operations are run on the Tauri command thread
synchronously, the UI freezes; if they are run fire-and-forget, the
user cannot cancel, cannot see real progress, and cannot be told
when the operation actually finished.

The requirements for the task model:

1. **The UI thread is never blocked by a native operation.** A
   long-running task must not freeze the React render loop or the
   webview's input handling.
2. **Cancellation is a first-class primitive, not an afterthought.**
   A user who clicks "Cancel" must see the operation actually stop,
   not be told "cancellation is not supported for this operation."
3. **Progress is real.** Derived from the operation (bytes
   processed, pages written). Never fabricated, never a fake
   indeterminate spinner dressed up as a percentage.
4. **A task always reaches a terminal state.** `completed`,
   `failed`, or `cancelled`. There is no "stuck in running forever"
   state; the registry forgets the task only after it reaches a
   terminal state.
5. **Tasks are observable from the UI.** The UI can poll or listen
   for a task's status, progress, and final outcome (success or
   structured error).

The alternatives considered:

- **Run everything synchronously on the command thread.** Rejected:
   blocks the UI.
- **Spawn a raw `tokio::task` per operation with no registry.**
   Loses cancellation, loses progress, loses observability. The UI
   would have to invent its own progress channel.
- **A full job queue with persistence.** Premature. The
   `task_history` SQLite table exists for future persistence; for
   the foundation, in-memory tracking is sufficient.

## Decision

Paperu uses a **cancellable async task engine** built on `tokio` and
`tokio_util::sync::CancellationToken`. Tasks are tracked in an
in-memory `TaskRegistry`; future persistence to the `task_history`
SQLite table is wired in later.

### `TaskId`

Every task has a unique `TaskId` (UUID v4, exposed as a branded
string via `@paperu/contracts`). The `TaskId` is the only handle the
UI holds; it uses it to poll status, subscribe to progress events,
and request cancellation.

### Lifecycle states

A task's `TaskStatus` is one of:

- `queued` — registered but not yet started.
- `running` — the engine has begun work.
- `completed` — the engine finished successfully.
- `failed` — the engine returned a structured `AppError`.
- `cancelled` — the user requested cancellation and the engine
  observed the cancellation token.

A task always reaches one of `completed`, `failed`, or `cancelled`.
There is no "stuck" state: the `TaskRegistry::finish` method is the
only way a task leaves the live registry, and it requires a terminal
status.

### `TaskRegistry`

`tasks::TaskRegistry` is the in-memory registry. It is held in the
Tauri `AppState` and injected into commands via `tauri::State`. Its
API:

- `register(kind, label, source_files, correlation_id) -> (TaskId, CancellationToken)`
  — creates the task in `queued` state and returns its id plus the
  cancellation token the engine should check cooperatively.
- `mark_running(id)` — transitions to `running`, sets `started_at`.
- `report_progress(id, fraction, message)` — updates the task's
  `TaskProgress` snapshot.
- `cancel(id) -> bool` — signals the cancellation token. Returns
  `false` if the task is not live (already finished).
- `finish(id, status)` — sets the terminal status, sets
  `completed_at`, and removes the task from the live registry.
- `get(id) -> Option<TaskInfo>` — snapshots the task by id.

The registry is `Clone` (an `Arc<AsyncMutex<HashMap<TaskId, RunningTask>>>`),
so it can be cheaply cloned into a task's owned future.

### Cancellation

Each registered task gets a `tokio_util::sync::CancellationToken`.
The engine receives the token (or a cloned child token) and is
expected to check it cooperatively at natural checkpoints (eg.
between pages of a PDF, between files in a batch). When the user
requests cancellation:

1. `TaskRegistry::cancel(id)` calls `token.cancel()`.
2. The engine observes `token.is_cancelled()` at its next checkpoint
   and returns a `cancellation.requested` `AppError`.
3. The command layer (or the engine itself) calls
   `TaskRegistry::finish(id, TaskStatus::Cancelled)`.

Cancellation is best-effort: an engine that does not check its token
cannot be force-killed. This is a deliberate trade-off —
force-killing a task mid-write could leave a corrupt temp file. The
engine contract will require cooperative cancellation checks; an
engine that ignores the token is a bug.

### Progress

`TaskProgress` carries:

- `fraction: Option<f64>` — `0.0..=1.0`. `None` means
  indeterminate (the engine cannot estimate total work).
- `message: Option<String>` — a human-readable status line
  (localisation-ready).
- `processed_bytes: Option<u64>` and `total_bytes: Option<u64>` —
  byte-level progress where the operation has a meaningful byte
  count.
- `updated_at: IsoTimestamp`.

Progress is reported by the engine via `report_progress`. It is
**always derived from the operation**, never fabricated. If the
engine cannot estimate progress, it reports `fraction: None` and the
UI shows an indeterminate indicator — not a fake percentage.

### `TaskInfo`

`TaskInfo` is the public snapshot of a task:

- `id`, `kind`, `status`, `label`
- `created_at`, `started_at?`, `completed_at?`
- `source_files`, `output_files?`
- `progress?`, `error?` (a serialized `AppError`)
- `correlation_id`

The UI uses `TaskInfo` to render the task list, the progress bar,
and the final outcome.

### Persistence

The `task_history` SQLite table exists in the schema
(`0001_init.sql`). It is not yet wired up — the registry is
in-memory for the foundation. When wired:

- `finish(id, status)` writes the task to `task_history`.
- `recent_files_limit` setting caps how many rows are retained.
- The UI's "recent operations" view reads from `task_history`.

This is a future concern; the schema is in place.

### Engines

The engines module (`apps/desktop/src-tauri/src/engines/`) is empty
in the foundation (`ENGINES_AVAILABLE = false`). When the first
engine lands, it will:

1. Receive the typed operation request.
2. Allocate a temp file via `TempWorkspace::new_file`.
3. Register a task via `TaskRegistry::register`.
4. Mark running, report progress cooperatively, check the
   cancellation token at natural checkpoints.
5. On success, validate the output (per the non-destructive
   pipeline — ADR `0006-non-destructive-file-handling.md`) and call
   `atomic_finalize`.
6. On failure or cancellation, leave the temp file for the startup
   cleanup pass.
7. Call `finish(id, status)` with the terminal status.

See `docs/architecture/engines.md` for the integration plan.

## Consequences

### Positive

- **The UI thread is never blocked.** Tasks run on the tokio
  runtime; the command thread returns the `TaskId` immediately and
  the UI polls or listens for updates.
- **Cancellation works.** The user can cancel a long operation; the
  engine observes the token at its next checkpoint and returns a
  structured `cancellation.requested` error.
- **Progress is honest.** The UI shows real progress when the engine
  can estimate it; an indeterminate indicator when it cannot. No
  fake percentages.
- **Tasks always reach a terminal state.** The registry forgets a
  task only via `finish(id, terminal_status)`. There is no "stuck
  forever" path.
- **The schema is ready for persistence.** `task_history` exists;
  wiring it up is a future, non-breaking change.

### Negative

- **Engines must cooperate with cancellation.** An engine that
  ignores its token cannot be cancelled. The engine contract must
  require cooperative checks; an engine that violates this is a bug.
- **Best-effort cancellation is not force-kill.** A misbehaving
  engine can run past a cancellation request. This is a deliberate
  trade-off: force-killing mid-write could corrupt a temp file.
- **The registry is in-memory.** A crash loses the live task list.
  The `task_history` table is the future persistence layer; for the
  foundation, in-memory is sufficient because the engines module is
  empty and there are no live long-running tasks yet.
- **`tokio` is a non-trivial dependency.** It is permissively
  licensed (MIT) and is the standard async runtime for Rust. See
  `DEPENDENCIES.md`.

## Non-goals

- **No distributed task queue.** Tasks are local to the running
  desktop process. There is no worker pool across machines.
- **No task priorities.** The foundation has one task at a time in
  practice. A future scheduling layer is a separate ADR.
- **No task retries.** A failed task stays failed; the user can
  re-run the operation. Automatic retry is a separate ADR.
- **No force-kill.** Cancellation is cooperative.

## References

- `apps/desktop/src-tauri/src/tasks/mod.rs` — the `TaskRegistry`,
  `TaskSnapshotStore`, the `register_and_cancel` test.
- `packages/contracts/src/tasks.ts` — `TaskStatus`, `TaskProgress`,
  `TaskInfo`, `TaskOutcome`, task commands.
- `apps/desktop/src-tauri/src/contracts/tasks.rs` — the Rust mirror.
- `apps/desktop/src-tauri/src/state.rs` — `AppState.tasks`.
- `apps/desktop/src-tauri/migrations/0001_init.sql` — the
  `task_history` table.
- `docs/architecture/engines.md` — the engines integration plan.
- `docs/architecture/database.md` — the `task_history` schema.
- `docs/decisions/0006-non-destructive-file-handling.md` — the
  pipeline the engines follow.
