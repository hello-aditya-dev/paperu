# Architecture overview

Paperu is a Windows-first, local-first desktop application. This
document describes the high-level architecture: how the layers fit
together, what crosses the boundaries, and why the structure is the
way it is.

For the threat model, see `docs/security/threat-model.md`. For the
architectural decisions, see `docs/decisions/`.

---

## The pipeline

```
React 19 (apps/desktop/src)
   │  the only sanctioned way to call native code is the typed
   │  IPC client at src/lib/ipc.ts, which imports from
   │  @paperu/contracts
   ▼
@paperu/contracts (packages/contracts)
   │  the single source of truth for every value that crosses
   │  the boundary: request shapes, response shapes, the AppError
   │  envelope, task progress, operation catalogue, settings
   ▼
Tauri 2 IPC boundary
   │  capabilities/default.json grants only core:default +
   │  dialog:allow-open to the main window
   ▼
Rust commands (apps/desktop/src-tauri/src/commands)
   │  thin, typed entry points; validate input server-side;
   │  return Result<T, AppError>; never panic into the UI
   ▼
Domain modules (filesystem, settings, tasks, licensing, engines)
   │
   ├──► local filesystem (source untouched, atomic finalization)
   ├──► SQLite state store at
   │    %LOCALAPPDATA%/app.paperu.desktop/paperu.db
   │    (app state only — never document contents)
   ├──► structured local logs at
   │    %LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log
   │    (rotated daily; never remote)
   └──► (future) engines behind src/engines/, wired into the
        task runner
```

---

## Local-first philosophy

The defining property is that **user documents never leave the
machine for core operations**. This is enforced in code, not just in
policy:

- `apps/desktop/src-tauri/src/security/mod.rs` declares
  `LOCAL_FIRST: bool = true` and `REMOTE_UPLOAD_PERMITTED: bool =
  false`.
- There is no HTTP client in the core file-operation path. The
  Rust `Cargo.toml` does not depend on `reqwest`, `hyper`, `ureq`
  or any other general-purpose HTTP client.
- The `inspect_file` command reads only filesystem metadata via
  `std::fs::metadata`. No file *content* is read.
- Tauri capabilities grant no network scope to the frontend.
- The CSP (`tauri.conf.json`) restricts `connect-src` to `'self'
  ipc: http://ipc.localhost` — IPC is the only non-self connection.

A future feature that genuinely requires upload must flip
`REMOTE_UPLOAD_PERMITTED` through an explicit ADR (under
`docs/decisions/`), be opt-in by the user, and never be on by
default. The Integrator is the only role permitted to merge such a
change.

---

## Non-destructive file model

Every operation that produces output writes to a temp workspace
first, validates the output, and atomically moves it into place. A
failed operation never destroys or corrupts the source. The model
is:

```
source file (untouched)
   │
   ▼
engine writes to TempWorkspace (%TEMP%/paperu/paperu-{uuid}{suffix})
   │
   ▼
validate output (well-formed? not truncated?)
   │
   ▼
atomic_finalize(temp, dest, overwrite)
   │  same-filesystem rename is atomic
   │  cross-volume fallback only when overwrite=true
   ▼
report success (or AppError)
```

See `docs/architecture/file-handling.md` for the full design and
`docs/architecture/crash-recovery.md` for the startup cleanup pass.

---

## The `tauri-runtime` feature flag

The `tauri-runtime` cargo feature gates the desktop shell. Without
it, the core modules (errors, contracts, filesystem, database,
settings, tasks, logging, security, licensing) compile and test on
any platform. With it, the Tauri command handlers and the desktop
entry point (`paperu::run()`) are compiled, and the binary links
against the platform's webview and windowing libraries.

```toml
[features]
default = []
tauri-runtime = ["dep:tauri", "dep:tauri-plugin-dialog", "dep:tauri-build"]
custom-protocol = ["tauri/custom-protocol"]
```

This split is what makes the CI matrix work:

- The `rust-core` CI job (Ubuntu) runs `cargo test` without
  `tauri-runtime`. It verifies the entire core logic surface
  (paths, inspect, temp, migrations, settings, tasks) without GTK
  or webkit dependencies.
- The `windows-build` CI job (Windows) runs the same gate with
  `--features tauri-runtime` and produces the Tauri installer.

The `#[cfg_attr(feature = "tauri-runtime", tauri::command)]`
attribute on each command function means the same Rust source is
both a plain testable function (no Tauri) and a Tauri command
(with the feature). The Tauri `setup` hook, the `AppState`
injection and the `invoke_handler!` macro are inside a
`#[cfg(feature = "tauri-runtime")] mod runtime` block in
`src/lib.rs`.

---

## State and injection

When the Tauri shell starts (`src/lib.rs::runtime::run`):

1. The app data directory is resolved via Tauri's
   `app_local_data_dir()`, which on Windows is
   `%LOCALAPPDATA%/app.paperu.desktop`.
2. The directory is created if missing.
3. The log directory (`<app_data>/logs/`) is created and the
   structured tracing subscriber is initialised.
4. The SQLite database (`<app_data>/paperu.db`) is opened and
   migrated.
5. The `TempWorkspace::startup_cleanup` pass removes stale partial
   outputs from a previous crash.
6. The `AppState { db, tasks, app_data_dir }` is created and
   managed by Tauri, ready to be injected into commands.
7. The `invoke_handler!` macro registers the four commands:
   `inspect_file`, `read_settings`, `write_settings`,
   `read_app_info`.

The `AppState` struct (`src/state.rs`) is the only state object
that crosses command boundaries:

```rust
pub struct AppState {
    pub db: Database,
    pub tasks: TaskRegistry,
    pub app_data_dir: PathBuf,
}
```

Commands that need state take `tauri::State<'_, AppState>` as an
argument and Tauri injects it. Commands that do not need state
(like `inspect_file`, which is stateless) take only their typed
request.

---

## The contract boundary

`@paperu/contracts` (`packages/contracts/src/`) is the formal
agreement between React and Rust. Every value that crosses the
boundary is one of the types defined there. The Rust mirror lives
in `apps/desktop/src-tauri/src/contracts/` and must serialize to
identical JSON.

Contract tests (in `apps/desktop/src/lib/__tests__/contracts.test.ts`
and the `#[cfg(test)] mod tests` blocks in Rust) assert that both
sides accept the canonical JSON fixtures in
`packages/test-fixtures/src/contracts/`.

Adding or changing a contract type requires:

1. A matching change on both sides.
2. An updated (or new) JSON fixture.
3. Integrator sign-off (contracts are Integrator-controlled, see
   `CONTRIBUTING.md`).

See `docs/architecture/contracts.md` for the full rationale.

---

## The error model

Every IPC failure is serialized as an `AppError` (Rust:
`src/errors/mod.rs`, TS: `packages/contracts/src/errors.ts`). The
shape:

- `code` — a stable, namespaced identifier (e.g.
  `filesystem.file_not_found`). Never reused.
- `category` — one of `filesystem`, `validation`, `unsupported`,
  `permission`, `processing`, `database`, `cancellation`,
  `resource`, `licensing`, `internal`.
- `severity` — `info`, `warning`, `error`, `critical`.
- `recoverability` — `retryable`, `action_required`, `fatal`.
- `message` — a safe, user-facing string (localised-ready). Never
  contains secrets.
- `detail?`, `technical?`, `cause?` — optional context. `technical`
  is engineer-facing and never contains file contents.
- `correlationId?`, `taskId?` — for tracing.

Conversions exist from `std::io::Error` and `serde_json::Error` to
`AppError`. The `AppError::unknown` constructor wraps any
`Display`-able failure as a structured `internal.unknown` error so
the UI never sees raw text. Panics are caught at the command
boundary.

---

## The database

SQLite is used for **application state only** — never user document
contents. The schema (migration `0001_init.sql`) creates four
tables:

- `schema_version` — migration tracking.
- `app_settings` — key/value, with the `Settings` object stored as
  a JSON blob under the `settings` key.
- `task_history` — recent operations (persistence not yet wired
  up; schema exists).
- `licence_state` — placeholder for the local entitlement view.

The DB lives at `%LOCALAPPDATA%/app.paperu.desktop/paperu.db`.
WAL mode, `synchronous=NORMAL`, `foreign_keys=ON`. Migrations run
in order inside a transaction; a newer-than-build DB is refused.
See `docs/architecture/database.md`.

---

## The task engine

Long-running operations (compression, conversion, batch jobs) will
run as tasks. A task has a unique id, a lifecycle state, real
progress, a cancellation primitive and a structured result/error.
The task engine is the foundation; engines are wired in later.

Design rules:

- The UI thread is never blocked by a native operation.
- Cancellation is a first-class primitive (CancellationToken from
  `tokio_util`), not an afterthought.
- Progress is real, derived from the operation. Never fabricated.
- A task always reaches a terminal state (completed | failed |
  cancelled).

See `docs/architecture/engines.md` for the integration plan.

---

## Logging and diagnostics

`src/logging/mod.rs` initialises a `tracing_subscriber` with a
daily-rotated JSON file appender under
`%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`. In debug
builds it also mirrors human-readable output to stderr. Logs are
local only — no remote logging, no crash uploads.

Content policy:

- Never log file contents.
- Paths may be logged for diagnosis (trimmed to 256 characters).
- Never log secrets, licence keys, tokens.

`Settings.allowDiagnostics` defaults to `false` and is reserved
for a future opt-in diagnostics feature.

---

## Frontend architecture

The frontend (`apps/desktop/src/`) is a Vite + React 19 +
TypeScript application:

- `main.tsx` mounts React.
- `app/App.tsx` is the shell: a sticky header (brand + app info
  badge), a flex `<Outlet />` for routes, and a privacy footer.
  It loads app info and settings on mount and applies the resolved
  theme.
- `routes/` contains the route components (HomeRoute renders the
  Local File Inspect view).
- `features/inspect/` contains the Inspect UI: a file drop zone,
  the result card, an error card.
- `lib/ipc.ts` is the typed Tauri IPC client. It is the only
  sanctioned way for the frontend to call native code. It
  narrows rejections to `AppError` and wraps unknowns as
  `internal.unknown`.
- `lib/format.ts` provides display formatters (timestamps, file
  kind labels).
- `hooks/useTheme.ts` applies the resolved theme + reduced-motion
  attribute.
- `components/` houses small shared components (`AppInfoBadge`,
  `PrivacyFooter`).
- `styles/` contains the global and app CSS. All values come from
  `@paperu/design-tokens` via `var(--paperu-*)`.

State management uses `zustand` for small client-side caches;
settings and app info are fetched from Rust via IPC and cached
locally.

---

## Where to read next

- `docs/architecture/contracts.md` — why contracts are the single
  source of truth and how to add new operations.
- `docs/architecture/file-handling.md` — the non-destructive model.
- `docs/architecture/database.md` — SQLite schema and migrations.
- `docs/architecture/crash-recovery.md` — temp cleanup and atomic
  finalization.
- `docs/architecture/testing.md` — the testing strategy.
- `docs/architecture/licensing.md` — the entitlement abstraction.
- `docs/architecture/engines.md` — the engines module.
- `docs/security/threat-model.md` — the local-first threat model.
- `docs/decisions/` — the ADRs.
