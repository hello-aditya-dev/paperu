# Smoke tests

This directory holds Paperu's smoke tests: end-to-end checks that
launch the actual desktop application (or its core runtime) and
verify the foundation holds together. Smoke tests are the outermost
layer of the test pyramid; they do not replace the Rust unit tests,
the TypeScript contract tests, or the React component tests
described in `docs/architecture/testing.md`.

Smoke tests are not yet wired into CI as automated checks. This
document defines the smoke-test surface, what each check covers,
how to run them manually today, and how a future agent adds an
automated smoke test.

---

## What smoke tests cover

A smoke test answers one of these questions:

1. **Does the app start?** The Tauri shell boots, the webview
   renders, and the `setup` hook completes without panicking.
2. **Does the database initialize?** On first launch the SQLite
   database is created at
   `%LOCALAPPDATA%/app.paperu.desktop/paperu.db`, migration `1
   (init)` is applied, and the four tables exist.
3. **Does IPC work?** A real `invoke()` call from the frontend
   reaches a `#[tauri::command]` in Rust and returns a typed
   result. The typed IPC client in `apps/desktop/src/lib/ipc.ts`
   successfully calls `read_app_info` and `read_settings`.
4. **Does the local file inspect work end-to-end?** The user drops
   or selects a real file; the path flows through `inspectFile`
   in `apps/desktop/src/lib/ipc.ts` -> the `inspect_file` Tauri
   command -> `filesystem::inspect::inspect_file` in Rust; the UI
   renders the result card with real metadata; the source file is
   untouched.

These are the four foundational smoke tests. Each one exercises a
distinct layer:

| Smoke test         | Layer exercised                                    |
| ------------------ | -------------------------------------------------- |
| App starts         | Tauri shell, webview, `setup` hook, logging sink.  |
| Database init      | SQLite open, migration runner, pragma set.         |
| IPC works          | Tauri `invoke`, typed contracts, `AppError` flow.  |
| Local file inspect | The full vertical: React -> contract -> Tauri -> Rust -> filesystem -> UI. |

---

## How to run smoke tests today (manual)

The smoke tests are manual today because there is no automated
desktop driver (Playwright/WebDriver against the Tauri webview is
not yet wired up). To run them:

### Prerequisites

- Windows 10 or 11 (the release target).
- Node.js >= 20.
- pnpm 12.9.1 (pinned in `package.json`).
- Rust 1.99.0 with the `x86_64-pc-windows-msvc` target (pinned in
  `rust-toolchain.toml`).
- The WebView2 runtime (present on Windows 10/11 by default).

### Step 1: install and verify the foundation

```sh
pnpm install
scripts/check.sh           # or: pnpm check
```

`scripts/check.sh` runs the full validation gate (typecheck, lint,
vitest, `cargo fmt --check`, `cargo clippy`, `cargo test`). If any
step fails, do not proceed to smoke tests.

### Step 2: launch the desktop app

```sh
pnpm dev:tauri
```

This starts the Vite dev server and the Tauri dev shell. The window
should open within a few seconds.

### Step 3: smoke test 1 — the app starts

- Expected: the Paperu window opens.
- Expected: the header shows the brand and the `AppInfoBadge`
  (with the version from `AppInfo`).
- Expected: the privacy footer ("Processed on this PC. 0 bytes
  uploaded.") is visible.
- Expected: no error dialog, no panic in the dev console, no
  `tracing::error!` lines in
  `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`.

### Step 4: smoke test 2 — the database initialized

Open the database file with the `sqlite3` CLI or a SQLite browser:

```sh
sqlite3 "%LOCALAPPDATA%/app.paperu.desktop/paperu.db"
```

Verify:

- `SELECT * FROM schema_version;` returns one row with `version=1`,
  `label="init"`.
- `.tables` lists `schema_version`, `app_settings`, `task_history`,
  `licence_state`.
- `PRAGMA journal_mode;` returns `wal`.
- `PRAGMA synchronous;` returns `1` (NORMAL).
- `PRAGMA foreign_keys;` returns `1` (ON).

### Step 5: smoke test 3 — IPC works

In the running app:

- The `AppInfoBadge` shows the version (eg. `0.1.0`). This proves
  `read_app_info` returned a typed `AppInfo` successfully.
- Open the Settings view (when wired) or inspect the React DevTools
  state — the cached `Settings` object came from `read_settings`.
  This proves `read_settings` returned a typed `Settings`
  successfully.

If the IPC layer is broken, the `AppInfoBadge` will display a
fallback or the app will surface a structured `AppError`.

### Step 6: smoke test 4 — local file inspect works end-to-end

1. On the Home route, the `InspectView` is rendered with the
   `FileDropZone`.
2. Click "Choose a file" and pick any real file (eg. a PDF in your
   Documents folder).
3. Expected: the `InspectResultCard` renders within a second.
4. Verify each field against the real file:
   - File name matches.
   - Byte size matches (right-click the file > Properties in
     Explorer).
   - Human-readable size matches (eg. "1.0 MB" for ~1 MiB).
   - Extension matches.
   - Modified timestamp matches (within a second).
   - Path matches the file's real absolute path.
   - Read-only matches the file's properties.
   - If the file is in OneDrive, "Synced folder" shows
     "Yes (OneDrive)".
5. Open the file from Explorer and confirm the file is unchanged
   (no modification timestamp change, no content change, no extra
   files in the same folder).
6. Repeat with a directory path (drag a folder onto the window):
   expected behaviour is the `ErrorCard` showing
   `validation.invalid_input` with the message "That path is not a
   file."
7. Repeat with a non-existent path (eg. delete a file between
   picking it and inspecting): expected behaviour is the
   `ErrorCard` showing `filesystem.file_not_found` with the
   message "Paperu could not find that file."

### Step 7: check the log file

Open `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`. Verify:

- There is a `Paperu started` line with the version.
- No `error` level lines from the inspect path.
- No file contents are logged (paths may appear, trimmed to 256
  characters; contents must not).

---

## Adding a new smoke test

A future agent adds a smoke test when:

- a new user-visible capability lands that should be verified
  end-to-end (eg. the first PDF engine);
- a regression is found in the field that the existing test layers
  (unit, contract, component) did not catch;
- the team decides to wire automated desktop driving (Playwright
  against the Tauri webview, or `tauri-driver`).

### Naming

A smoke test is named after the capability it covers. Today:

- `smoke-app-starts.md` (described above, step 3).
- `smoke-database-init.md` (step 4).
- `smoke-ipc-works.md` (step 5).
- `smoke-local-file-inspect.md` (step 6).

These are manual checklists today. When automation lands, each
becomes an automated script (eg. `smoke-app-starts.ts`).

### What a smoke test must NOT do

- **Never commit a real user document** as part of the smoke test.
  Use a synthetic file generated at runtime, or a file the tester
  picks from their own machine at test time (never checked in).
  See `tests/fixtures/README.md` for the fixture policy.
- **Never modify the user's real files.** Smoke tests against real
  files use the inspect path (read-only) or write to a temp
  directory. The non-destructive invariant (ADR
  `0006-non-destructive-file-handling.md`) applies to smoke tests
  too.
- **Never upload anything.** The local-first invariant (ADR
  `0002-local-first-processing.md`) applies to smoke tests too.
- **Never depend on a network connection.** Smoke tests must work
  offline. If a smoke test requires a server, it is not a smoke
  test — it is an integration test against a server that is out of
  scope for the foundation.

### What a smoke test must do

- **Verify the user-visible outcome.** Not "the function returned
  without error," but "the result card shows the real file size."
- **Verify the invariants.** Source file untouched. No bytes
  uploaded. No error log lines.
- **Be repeatable.** The same smoke test on the same build on the
  same machine produces the same result.

---

## Wiring automated smoke tests

When the team decides to automate the smoke tests, the likely
stack is:

- `tauri-driver` (a WebDriver implementation that drives the
  Tauri webview) + a WebDriver client (eg. `selenium-webdriver` or
  `playwright` in WebDriver mode).
- Or a Rust integration test in `apps/desktop/src-tauri/tests/`
  that boots the Tauri shell in test mode and exercises the
  `#[tauri::command]` functions directly via the test
  `tauri::test` helpers.

Either approach is a separate ADR. The smoke-test surface defined
in this document is the contract the automation will verify.

---

## References

- `docs/architecture/testing.md` — the full testing strategy.
- `docs/features/local-file-inspect.md` — the feature smoke test 4
  exercises.
- `docs/decisions/0002-local-first-processing.md` — the local-first
  invariant smoke tests must respect.
- `docs/decisions/0006-non-destructive-file-handling.md` — the
  non-destructive invariant smoke tests must respect.
- `tests/fixtures/README.md` — the fixture policy.
- `scripts/check.sh` — the validation gate to run before smoke
  tests.
- `AGENT_HANDOFF.md` — current smoke-test status.
