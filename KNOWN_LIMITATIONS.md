# Paperu known limitations

This file documents what the Paperu foundation (`0.1.0`) does **not**
yet do, and the platform constraints that contributors and users
should be aware of. Items here are not bugs (see `BUGS.md`) — they
are intentional scope boundaries or unmet dependencies.

When a limitation is removed, it is struck through here (kept for
history) and added to `CHANGELOG.md`.

---

## Platform constraints

### Tauri build requires platform-specific system dependencies

Building Paperu with the `tauri-runtime` cargo feature requires
Tauri 2's native system libraries. These differ by platform:

- **Windows** (the release target): the MSVC build tools (Visual
  Studio Build Tools 2022 with the "Desktop development with C++"
  workload) and the WebView2 runtime. Windows 11 ships WebView2;
  Windows 10 may need the Evergreen Bootstrapper.
- **Linux** (development / CI for core only): GTK, webkit2gtk,
  `libayatana-appindicator3-dev` and related packages. The
  `rust-core` CI job does not enable `tauri-runtime`, so these are
  not required for core verification.
- **macOS** (development only): the system webview is included in
  macOS. macOS is not a release target today.

See `docs/architecture/overview.md` for the `tauri-runtime` feature
flag rationale.

### The `tauri-runtime` cargo feature gates the desktop shell

The desktop shell (Tauri IPC, the React frontend running inside the
webview, native dialogs) only compiles when the `tauri-runtime`
feature is enabled. Without it, the core modules (errors, contracts,
filesystem, database, settings, tasks, logging, security, licensing)
compile and test on any platform.

This is how CI verifies core logic on Linux without GTK or webkit
dependencies. The `rust-core` CI job runs `cargo test` without
`tauri-runtime`; the `windows-build` CI job runs `cargo test
--features tauri-runtime` and the full Tauri production build on a
Windows runner.

The implication for developers: a `cargo check` or `cargo test` on
Linux or macOS exercises the core, not the Tauri command
implementations. To exercise the full command surface, use a Windows
machine or a Windows CI runner.

### Rust toolchain pinning

The Rust toolchain is pinned to channel `1.99.0` via
`rust-toolchain.toml`, with `rustfmt`, `clippy` and the
`x86_64-pc-windows-msvc` target. A different Rust version may build
the project but is not officially supported and may fail clippy or
fmt checks.

### pnpm and Node version requirements

`package.json` declares `engines.node: ">=20.0.0"` and
`packageManager: "pnpm@12.9.1"`. Use `corepack enable` and
`corepack prepare pnpm@12.9.1 --activate` to install the correct
pnpm. Other package managers (npm, yarn) are not supported because
the workspace relies on pnpm's `workspace:*` protocol.

---

## Feature scope

### No real processing engines implemented yet

The `apps/desktop/src-tauri/src/engines/mod.rs` module is a
placeholder. It exposes a single constant:

```rust
pub const ENGINES_AVAILABLE: bool = false;
```

Future engines (PDF compress, image resize, metadata removal,
signing, etc.) will live behind this module, wired into the task
runner, and speak the typed operation contracts defined in
`packages/contracts/src/operations.ts`. The contracts already
define the request/response shapes for these operations; the
implementations do not yet exist.

Any operation that would require an engine must return
`internal.not_implemented` rather than pretending to succeed. See
`docs/architecture/engines.md` for the integration plan.

### Only Local File Inspect is implemented as a real proof

The first end-to-end real capability is **Local File Inspect**: the
user selects or drops a file, the path goes through the typed IPC
contract, Rust inspects the real filesystem metadata, and the UI
displays the file name, extension, byte size, human-readable size,
path and timestamps. The source file is never modified. Zero bytes
are uploaded. See `docs/features/local-file-inspect.md`.

The other operations in `packages/contracts/src/operations.ts`
(`pdf.compress`, `pdf.merge`, `pdf.split`, `image.resize`,
`metadata.remove`, `sign.apply`, etc.) are **contract shapes only**.
They are defined so that future engines can conform to them, not
because they are implemented.

### Task engine is a foundation, not a full scheduler

The task engine (`apps/desktop/src-tauri/src/tasks/mod.rs`) provides:

- A `TaskRegistry` with `register`, `mark_running`,
  `report_progress`, `cancel`, `finish` and `get`.
- A `CancellationToken` (from `tokio_util`) for cooperative
  cancellation.
- A synchronous `TaskSnapshotStore` for tests.

It does **not** yet:

- Persist task history to the `task_history` SQLite table (the
  schema exists; the persistence layer is not wired up).
- Emit Tauri events on progress and completion (the
  `paperu://task/progress` and `paperu://task/finished` event
  names are reserved in the contracts but not yet emitted).
- Run real long-running operations (no engines wired in).

### Licensing is a placeholder

The licensing module (`apps/desktop/src-tauri/src/licensing/mod.rs`)
defines the `Edition` enum (`Free`, `Personal`, `Business`) and the
`Entitlement` struct. The `current_entitlement()` function always
returns the default (Free, not activated). The local entitlement
view is intentionally minimal; the desktop client never trusts
itself for payment truth. See `docs/architecture/licensing.md`.

There are no production licence keys, no Razorpay integration, no
activation flow. The `licence_state` SQLite table exists in the
schema for the future local entitlement view.

---

## Release engineering

### No code-signing certificate yet

Paperu does not yet hold an Authenticode code-signing certificate.
The Tauri config sets `bundle.windows.certificateThumbprint` to
`null`. CI sets `TAURI_SIGNING_PRIVATE_KEY=""` and produces an
unsigned installer for validation only.

When a certificate is procured, the plan in
`docs/releases/workflow.md` will be executed: the certificate will
be injected via the CI secrets store at release time, the NSIS and
MSI installers will be signed with Authenticode, and the
`timestampUrl` (already set to Sectigo's RFC 3161 service) will be
used for timestamping. No certificate or private key will be
committed.

### Tauri updater is disabled

`tauri.conf.json` sets `createUpdaterArtifacts: false`. The Tauri
updater is not enabled in the foundation. When it is enabled, it
will require signed update artifacts and the desktop client will
verify signatures against a pinned public key. Auto-install will
never be supported (`Settings.updatePreference` only allows `off`
or `notify`).

### No telemetry or crash reporting

There is no analytics SDK, no crash reporter that uploads, no remote
logging sink. Local logs are written to
`%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log` with daily
rotation. `Settings.allowDiagnostics` defaults to `false`. See
`docs/decisions/0009-no-telemetry.md`.

---

## Database

### SQLite stores app state only, never document contents

The SQLite database at `%LOCALAPPDATA%/app.paperu.desktop/paperu.db`
holds only: the schema version, the app settings (a single JSON
blob), the task history (when persisted) and the licence state
(placeholder). It never stores user document contents. See
`docs/architecture/database.md`.

### No automated database backup

The database is a single file. The user may back it up manually by
copying it. There is no automated backup or sync. If the file is
deleted or corrupted, Paperu recreates the schema on next launch
and falls back to default settings; no user data is lost (because
the database stores no user data).

---

## Frontend

### The frontend is only useful inside the Tauri shell

The React frontend (`apps/desktop/src/**`) is built to run inside
the Tauri webview. Running `pnpm dev` (Vite only) is useful for
frontend iteration against mocked IPC, but the typed IPC client in
`src/lib/ipc.ts` returns a structured `internal.not_implemented`
error when `window.__TAURI_INTERNALS__` is absent (i.e. outside
Tauri). Component tests use the mock registry (`__mockCommand`) to
simulate the native backend.

### No internationalization yet

The UI strings are in English. The Tauri bundle config sets
`windows.nsis.languages: ["English"]` and
`displayLanguageSelector: false`. A future i18n pass will introduce
locale-aware strings and Tauri installer language selection.

### Reduced-motion and dark theme are best-effort

The design tokens define light and dark themes, and the
`prefers-reduced-motion` media query disables transitions in CSS.
The `Settings.reducedMotion` flag exists in the contract but is
applied best-effort (it sets the `data-paperu-theme` attribute and
the reduced-motion CSS handles the rest). It is not yet wired to
all custom animations.

---

## Tests and fixtures

### Synthetic fixtures only

`packages/test-fixtures` provides synthetic test payloads and JSON
contract fixtures. No real user documents, no copyrighted content,
no personal data. Future regression fixtures must follow the same
rule. See `docs/architecture/testing.md`.

### No end-to-end UI test against the real Tauri shell

There is no Playwright/Selenium/WebDriver test that launches the
real Tauri desktop app and drives it. Component tests use
`@testing-library/react` against the mocked IPC. A future test
pass may add a Tauri-driver test on Windows; this is not yet
implemented.

---

## Documentation

### This is the foundation pass

The docs in `docs/` describe the foundation as it exists today.
ADRs under `docs/decisions/` record the architectural choices made
for `0.1.0`. As features are added, the corresponding docs are
updated and new ADRs are appended.
