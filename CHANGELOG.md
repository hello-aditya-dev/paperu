# Paperu changelog

Paperu uses [semantic versioning](https://semver.org/). During the
`0.x` series, minor version bumps may include breaking changes;
patch bumps are bug-fix-only. From `1.0.0` onward, the standard
semver contract applies: breaking changes require a major bump.

The format of this changelog is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
adapted to the Paperu three-agent model (Builder / Guardian /
Integrator).

---

## [Unreleased]

No unreleased changes. The next planned release is `0.2.0`, scope to
be set by the Integrator (likely the first real processing engine —
see `docs/architecture/engines.md`).

---

## [0.1.0] — foundation

The `0.1.0` release establishes the Paperu foundation. No real
processing engines are implemented yet; this release is the
infrastructure, the contracts, the first end-to-end real proof
(Local File Inspect), and the Windows packaging configuration.

### Added

- **Typed IPC contracts.** `@paperu/contracts`
  (`packages/contracts/src/`) is the single source of truth for
  every value that crosses the React → Rust boundary. Branded
  primitive types (`FilePath`, `TaskId`, `CorrelationId`,
  `EditionId`), a unified `AppError` envelope, the Local File
  Inspect contract, the task engine contract, the operations
  catalogue, the progress/event shapes and the versioned settings
  contract. The Rust mirror lives in
  `apps/desktop/src-tauri/src/contracts/`.
- **Unified error model.** `AppError` (Rust: `src/errors/mod.rs`)
  with stable `ErrorCategory`, `ErrorSeverity`,
  `Recoverability` and a namespaced `ErrorCode` catalogue. The
  frontend's typed IPC client narrows rejections to `AppError` and
  wraps unknowns as `internal.unknown`. No raw Rust panics surface
  to the UI.
- **Filesystem abstraction.** `src/filesystem/` with
  `validate_input_path` (non-empty, absolute, Windows reserved
  names and characters, traversal prevention), `inspect_file`
  (real metadata from `std::fs::metadata`, no content read) and
  `TempWorkspace` (per-user temp dir under `%TEMP%/paperu`, atomic
  finalization, startup cleanup of stale partial outputs).
- **SQLite state store with migrations.** `src/database/` opens the
  database at
  `%LOCALAPPDATA%/app.paperu.desktop/paperu.db`, sets WAL mode,
  `synchronous=NORMAL`, `foreign_keys=ON`, and runs migrations in
  order inside a transaction. The first migration (`0001_init.sql`)
  creates `schema_version`, `app_settings`, `task_history` and
  `licence_state`. Refuses to downgrade (a newer-than-build DB
  raises `database.migration_failed`). Idempotent on re-run.
- **Settings system.** `src/settings/` loads/saves a versioned
  `Settings` object as a JSON blob in `app_settings`. Falls back
  to defaults on a corrupt blob. `apply_patch` accepts a partial
  `SettingsPatch` (unknown keys rejected). Defaults: theme =
  system, default conflict strategy = rename, recent files limit =
  25, update preference = notify, reduced motion = false,
  allowDiagnostics = false.
- **Task engine.** `src/tasks/` provides `TaskRegistry` with
  register / mark_running / report_progress / cancel / finish / get.
  Cancellation is a first-class `CancellationToken`. The UI thread
  is never blocked. (Task history persistence and progress events
  are reserved for a later release.)
- **Structured logging.** `src/logging/` initialises a
  `tracing_subscriber` with a daily-rotated JSON file appender under
  `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`. In debug
  builds it also mirrors human-readable output to stderr. Local
  only; no remote logging. Logs never embed file contents, secrets
  or tokens. Paths are trimmed to 256 characters.
- **Security invariants in code.** `src/security/` declares
  `LOCAL_FIRST = true`, `REMOTE_UPLOAD_PERMITTED = false`,
  `TELEMETRY_DEFAULT_ON = false` and `privacy_summary()`. The crate
  root is `#![forbid(unsafe_code)]`.
- **Local-first licensing abstraction.** `src/licensing/` defines
  `Edition` (Free, Personal, Business) and `Entitlement`. The
  foundation always reports Free / not activated. The desktop
  client never trusts itself for payment truth.
- **Design tokens.** `packages/design-tokens/src/tokens.css` defines
  a calm, paper-inspired semantic token system: backgrounds,
  surfaces, text, borders, accent, semantic colours, radii, spacing,
  typography, shadows, motion, z-index, layout metrics. Light and
  dark themes. `prefers-reduced-motion` is honoured.
- **Local File Inspect proof.** The first real vertical capability:
  the user drops or selects a file, the path crosses the typed IPC
  boundary, Rust reads real filesystem metadata, the UI displays the
  file name, extension, byte size, human-readable size, path,
  modified / created / accessed timestamps, read-only flag and
  synced-folder hint. The source file is never modified. Zero bytes
  are uploaded. See `docs/features/local-file-inspect.md`.
- **CI pipeline.** `.github/workflows/ci.yml` defines three jobs:
  `frontend` (typecheck, lint, vitest, vite build on Ubuntu),
  `rust-core` (rustfmt check, clippy, `cargo test` on Ubuntu without
  `tauri-runtime`), and `windows-build` (the same Rust gate with
  `--features tauri-runtime`, plus the full Tauri production build on
  a Windows runner, producing an unsigned installer).
- **Windows packaging configuration.** `tauri.conf.json` configures
  NSIS and MSI bundle targets, currentUser install mode, SHA-256
  digest, Sectigo RFC 3161 timestamping, WebView2 download
  bootstrapper. `productName: "Paperu"`, `identifier:
  app.paperu.desktop`.
- **Restrictive Tauri capabilities.** `capabilities/default.json`
  grants only `core:default` and `dialog:allow-open`, scoped to the
  `main` window. No network, shell or broad filesystem scope.
- **Strict CSP.** `default-src 'self'`; `script-src 'self'`;
  `connect-src 'self' ipc: http://ipc.localhost`. No `unsafe-eval`.
- **Synthetic test fixtures.** `packages/test-fixtures/` provides
  `SYNTHETIC_PAYLOAD`, a `readContractFixture` helper and canonical
  JSON fixtures for `inspect-file-response` and `app-error`.
- **Shared UI primitives.** `packages/ui/` exposes token-driven,
  accessible React components (`Card`, `Button`) used by the
  frontend.
- **Documentation set.** `README.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `DEPENDENCIES.md`, `AGENTS.md`, `AGENT_HANDOFF.md`,
  `BUGS.md`, `REGRESSIONS.md`, `KNOWN_LIMITATIONS.md`,
  `CHANGELOG.md`, `docs/architecture/`, `docs/security/`,
  `docs/decisions/0001`–`0010`, `docs/releases/workflow.md`,
  `docs/features/local-file-inspect.md`, `.env.example`.

### Security

- `#![forbid(unsafe_code)]` at the Rust crate root.
- No HTTP client in the core file-operation path.
- No telemetry or analytics; `allowDiagnostics` defaults to `false`.
- Tauri capabilities restricted to `core:default` +
  `dialog:allow-open`.
- Strict CSP enforced in both dev and production.
- All user-supplied paths re-validated server-side in Rust.
- Non-destructive file model: source untouched, atomic finalization,
  startup cleanup of stale temp outputs.
- No code-signing certificate in the repository. CI produces an
  unsigned installer for validation; signing is planned (see
  `docs/releases/workflow.md`).
- No production licence keys, no Razorpay integration, no activation
  flow.

### Operational

- `pnpm check` is the canonical pre-merge gate (typecheck, lint,
  vitest, `cargo fmt --check`, `cargo clippy -- -D warnings`,
  `cargo test`).
- Toolchain pinned: Rust `1.99.0`, pnpm `12.9.1`, Node `>=20.0.0`.
- Lockfiles committed: `Cargo.lock`, `pnpm-lock.yaml`.

### Known limitations

See `KNOWN_LIMITATIONS.md` for the full list. Highlights:

- No real processing engines implemented yet
  (`ENGINES_AVAILABLE = false`).
- The `tauri-runtime` cargo feature gates the desktop shell; core
  logic compiles and tests on any platform, the full desktop app
  requires Windows system libraries for release builds.
- No code-signing certificate yet.
- No Tauri updater yet (`createUpdaterArtifacts: false`).
- Licensing is a placeholder; no activation flow.
