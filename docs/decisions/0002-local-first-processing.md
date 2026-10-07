# ADR 0002: Local-first processing

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/src/security/**`,
  `apps/desktop/src-tauri/src/filesystem/**`,
  `apps/desktop/src-tauri/src/commands/**`,
  `apps/desktop/src-tauri/tauri.conf.json`,
  `apps/desktop/src-tauri/capabilities/default.json`

## Context

Paperu is a file workspace. Users will hand it real documents —
contracts, statements, medical records, family photos — and ask it to
inspect, compress, convert or otherwise process them. The single most
important trust property the product can offer is that those files do
not leave the user's machine for any core operation.

This is not a marketing claim. It is an architectural invariant. The
invariant must be enforceable in code, auditable by reading the source,
and resistant to silent regression when a future feature tempts a
contributor to add "just one upload."

The threats this ADR defends against:

1. **Accidental exfiltration.** A future contributor adds a telemetry
   or "save to cloud" feature that ships user bytes to a server
   without the user understanding what is happening.
2. **Library-side exfiltration.** A new dependency quietly opens a
   network connection and posts file contents.
3. **Capability drift.** The frontend webview gradually accumulates
   network scope until it can phone home.
4. **Misplaced trust in the local DB.** A future change starts
   caching document contents in SQLite "for performance," breaking
   the invariant that the DB holds only application state.

## Decision

All core file operations run **locally on the user's PC**. No file
content is uploaded to any server. The privacy promise, surfaced in
the UI footer, is:

> Processed on this PC. 0 bytes uploaded.

No telemetry, no analytics, no crash uploading, no cloud sync by
default (see `docs/decisions/0009-no-telemetry.md` for the analytics
policy specifically).

The invariant is enforced in code, not just in policy:

1. **Constant declarations in `src/security/mod.rs`.**
   ```rust
   pub const LOCAL_FIRST: bool = true;
   pub const REMOTE_UPLOAD_PERMITTED: bool = false;
   ```
   These constants exist so that a future contributor who reads the
   source cannot miss the invariant. A future feature that
   legitimately requires upload must flip
   `REMOTE_UPLOAD_PERMITTED` through an explicit ADR, be opt-in by
   the user, and never be on by default.

2. **No HTTP client in the core file-operation path.** The Rust
   `Cargo.toml` does not depend on `reqwest`, `hyper`, `ureq`, or any
   other general-purpose HTTP client. Adding one is a contract change
   requiring Integrator sign-off (see ADR `0008-dependency-policy.md`
   and `CONTRIBUTING.md`).

3. **`inspect_file` reads only metadata.** The first real operation
   uses `std::fs::metadata` — it does not even open the file. Future
   engines that *read* the source will open it read-only.

4. **No network scope for the frontend.** Tauri capabilities grant no
   HTTP or fetch capability to the main window. The CSP restricts
   `connect-src` to `'self' ipc: http://ipc.localhost`. IPC is the
   only non-self connection allowed.

5. **No document contents in the database.** SQLite holds application
   state only — `schema_version`, `app_settings`, `task_history`,
   `licence_state`. There is no table that could hold document
   contents, no `BLOB` columns, no content cache. See ADR
   `0004-sqlite.md`.

6. **Non-destructive file model.** Source files are never modified
   in place. Outputs land in a temp workspace, are validated, and are
   atomically moved into place. See ADR
   `0006-non-destructive-file-handling.md`.

7. **Logs are local only.** The structured tracing sink writes a
   daily-rotated JSON log to
   `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`. No remote
   logging. The content policy forbids logging file contents,
   secrets, licence keys or tokens. Paths may be logged for
   diagnosis (trimmed to 256 characters).

8. **`Settings.allowDiagnostics` defaults to `false`.** The setting
   is reserved for a future opt-in diagnostics feature. The default
   is off.

## Consequences

### Positive

- **The trust promise is auditable.** A reviewer can read
  `src/security/mod.rs`, `Cargo.toml`, `capabilities/default.json`,
  `tauri.conf.json`, the DB schema and the logging module, and
  verify the invariant holds. No "trust us."
- **The invariant resists silent regression.** A future feature that
  wants to upload must add an HTTP client to `Cargo.toml`
  (Integrator-controlled), flip `REMOTE_UPLOAD_PERMITTED`
  (Integrator-controlled, requires an ADR), add a network scope to
  the capabilities (Integrator-controlled), and update the CSP
  (Integrator-controlled). Each step is gated.
- **The product works offline.** No network connection is required
  to inspect a file, run an engine, read settings, or open the DB.
  The only future features that need a network connection are
  entitlement revalidation and (eventually) opt-in cloud sync.
- **No user data at rest in our infrastructure.** Because nothing is
  uploaded, there is no server-side store of user documents to
  breach. The attack surface for "did Paperu leak my files?" is
  limited to the user's own machine.

### Negative

- **No server-side processing.** Operations that genuinely need
  server compute (heavy ML models, OCR on huge files) cannot be
  implemented as core operations without an explicit ADR that flips
  the invariant and a clear opt-in.
- **No collaborative features by default.** Multi-user or
  cross-device sync requires upload by definition. If such a
  feature is added, it must be opt-in, gated behind an explicit
  ADR, and clearly separated from the local-first core.
- **Crash reports stay local.** Without a crash uploader, the team
  cannot see field crashes automatically. Diagnostics are opt-in
  only, and even when opt-in is added, file contents and paths are
  never sent (only structured error metadata; see ADR
  `0009-no-telemetry.md`).
- **The promise must be communicated carefully.** "0 bytes uploaded"
  applies to core operations. A future feature (e.g. entitlement
  revalidation) makes a network connection; the UI must distinguish
  "this operation uploads your file" from "this action contacts
  the Paperu entitlement server with a licence key."

## Future changes that would require a new ADR

- Any new HTTP client in `Cargo.toml`.
- Any new network scope in `capabilities/default.json`.
- Any change to `LOCAL_FIRST` or `REMOTE_UPLOAD_PERMITTED`.
- Any feature that uploads user file content.
- Any feature that adds cloud sync.
- Any opt-in telemetry or diagnostics upload.

Each of these is gated by the Integrator. See `CONTRIBUTING.md` for
the file ownership list.

## References

- `apps/desktop/src-tauri/src/security/mod.rs` — the invariant
  constants.
- `apps/desktop/src-tauri/Cargo.toml` — no HTTP client.
- `apps/desktop/src-tauri/capabilities/default.json` — no network
  capability.
- `apps/desktop/src-tauri/tauri.conf.json` — CSP.
- `docs/architecture/overview.md` — "Local-first philosophy."
- `docs/security/threat-model.md` — the threat model.
- `docs/decisions/0004-sqlite.md` — what the DB does not store.
- `docs/decisions/0006-non-destructive-file-handling.md` — source
  untouched.
- `docs/decisions/0009-no-telemetry.md` — analytics and crash
  uploads.
