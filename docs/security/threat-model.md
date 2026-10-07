# Threat model

This document is the local-first threat model for Paperu. It
enumerates the assets, the adversaries, the attack surface, the
controls in place, and the residual risk. It is the engineering
reference for `SECURITY.md` and the ADRs under `docs/decisions/`.

---

## Assets

| Asset                          | Where it lives                                              | Sensitivity                              |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------- |
| User document contents         | The user's filesystem (Paperu reads, never uploads)         | High. The defining asset of the model.   |
| User document metadata         | Filesystem metadata (size, timestamps, path)                 | Medium. Surfaced in the UI; may be logged. |
| Application settings           | `%LOCALAPPDATA%/app.paperu.desktop/paperu.db`              | Low. No secrets.                          |
| Local logs                     | `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`       | Medium. May contain paths; never contents. |
| Temp partial outputs           | `%TEMP%/paperu/paperu-{uuid}{suffix}`                     | Medium. Removed on next startup.          |
| Local entitlement view         | `licence_state` table (placeholder)                          | Medium. Subject to offline grace.         |
| Tauri capabilities             | `apps/desktop/src-tauri/capabilities/default.json`           | Critical. Controls frontend authority.     |
| CSP                             | `apps/desktop/src-tauri/tauri.conf.json`                     | Critical. Controls webview origin policy.  |
| Signing certificate (future)   | CI secrets store (not in repo)                              | Critical. Update authenticity.            |

User document **contents** are the highest-sensitivity asset.
Paperu's defining promise is that they do not leave the machine for
core operations.

---

## Adversaries

### A1: A compromised frontend

A malicious or compromised frontend bundle (XSS in the webview,
supply-chain attack on a frontend dependency, attacker-controlled
content rendered into the DOM). The frontend runs inside the Tauri
webview with the capabilities granted by
`capabilities/default.json`.

**Controls:**
- The frontend is granted only `core:default` and `dialog:allow-open`.
  No network scope, no shell scope, no broad filesystem scope.
- Every command re-validates input server-side. The frontend is not
  trusted to provide a sanitised path.
- The CSP restricts `script-src` to `'self'` and `default-src` to
  `'self'`. No `unsafe-eval`. No remote script loading.
- The IPC client (`src/lib/ipc.ts`) narrows rejections to `AppError`
  and wraps unknowns as `internal.unknown`. The UI never receives
  raw Rust panic text.
- The command surface is small and intentional: `inspect_file`,
  `read_settings`, `write_settings`, `read_app_info`. Adding a
  command is a contract change requiring Integrator sign-off.

**Residual risk:** A compromised frontend can call any of the four
commands with arbitrary arguments. The arguments are validated
server-side, so the worst case is the same as a legitimate user
choosing an arbitrary file: the inspect returns metadata for that
file. The frontend cannot write files (no `fs:allow-*` write
permission), cannot execute shell commands, cannot make network
requests.

### A2: A malicious local file

A file the user inspects (or, in the future, processes) that is
crafted to exploit a parser. The current inspect path does not
parse contents — it reads only `std::fs::metadata` — so there is no
parser attack surface today.

**Controls (current):**
- The inspect path does not open the file. No parser is invoked.
- File-kind detection is by extension only. No magic-byte sniffing
  in the foundation.

**Controls (future, when engines land):**
- Engines will parse file contents. Each parser must be a
  permissively-licensed, well-maintained crate (see `DEPENDENCIES.md`).
- Engines must validate the output before finalization (see
  `docs/architecture/file-handling.md`).
- Engines must run on Tokio tasks so a slow or hostile input cannot
  freeze the UI.
- Engines must check `cancel.is_cancelled()` at meaningful
  boundaries.

**Residual risk:** A parser bug in a future engine could crash the
engine (caught by the task runner, surfaced as a structured error)
or, in the worst case, produce a malformed output. The
output-validation step catches the latter; the task runner catches
the former. A parser bug that achieves code execution in the
desktop process is a critical vulnerability and would be treated
as a P0 (see `BUGS.md`).

### A3: A path-traversal input

A user-supplied path designed to escape a validated base, reference
a reserved name, or exploit a platform-specific path quirk.

**Controls:**
- `validate_input_path` (see `docs/architecture/file-handling.md`)
  enforces non-empty, absolute, no Windows reserved names, no
  reserved characters. These checks run on every platform so
  behaviour in CI matches production.
- Canonicalization rejects paths that escape after canonicalization.
  When the file does not exist, the lexical absolute form is used
  so the inspect path can still report `exists: false`.
- The `RESERVED_NAME` and `PATH_INVALID` error codes are covered by
  the contract fixtures and the unit tests.

**Residual risk:** A future scoped operation (e.g. "operate only
under this folder") must enforce the scope after canonicalization.
The foundation's inspect path does not have a scope — it operates
on any absolute path the user chooses — so there is no escape to
attempt.

### A4: A corrupted or hostile local environment

A malicious application on the user's machine that modifies
Paperu's data directory, replaces the database, or holds the temp
workspace open.

**Controls:**
- The database stores only app state, never document contents. A
  modified database cannot leak user documents.
- A corrupt settings blob falls back to defaults (see
  `docs/architecture/database.md`).
- A newer-than-build database is refused (the user is told to
  update Paperu).
- The temp workspace is per-user under `%TEMP%/paperu`. Files are
  named `paperu-{uuid}{suffix}`. Another process holding a temp
  file open is logged and skipped by the startup cleanup; it does
  not abort the cleanup.

**Residual risk:** A malicious local application with the user's
privileges can read or modify anything the user can. This is
inherent to the local-first model — the user trusts their own
machine. Paperu does not defend against an attacker who already
has the user's privileges.

### A5: A network attacker

An adversary on the network path between the desktop client and a
future server (the entitlement server, the update server).

**Controls (current):**
- The foundation makes no network calls. There is no HTTP client in
  the core file-operation path. The `Cargo.toml` does not depend on
  `reqwest`, `hyper`, `ureq` or any other general-purpose HTTP
  client.
- The Tauri capabilities grant no network scope to the frontend.
- The CSP restricts `connect-src` to `'self' ipc:
  http://ipc.localhost` — IPC is the only non-self connection.

**Controls (future):**
- When the entitlement server lands, all communication will be over
  HTTPS to a Paperu-controlled origin.
- When the Tauri updater lands, update artifacts will be signed and
  the desktop client will verify signatures against a pinned public
  key. Auto-install will never be supported.

**Residual risk:** A network attacker cannot read user documents in
the foundation (no network path exists). When network features
land, the residual risk is TLS interception (mitigated by HTTPS
with certificate pinning where appropriate) and update-server
compromise (mitigated by signature verification on the client).

### A6: A supply-chain attacker

An adversary who publishes a malicious version of a dependency
Paperu relies on.

**Controls:**
- Lockfiles are committed (`Cargo.lock`, `pnpm-lock.yaml`). CI
  uses `--frozen-lockfile`.
- The dependency policy (see `DEPENDENCIES.md` and ADR
  `docs/decisions/0008-dependency-policy.md`) restricts the
  dependency surface to permissively-licensed, well-maintained
  crates and packages.
- The Rust toolchain is pinned (`rust-toolchain.toml`).
- `rusqlite` uses the `bundled` feature so SQLite's C source is
  compiled from the crate source, not dynamically linked against a
  system library that could be substituted.
- The Integrator owns dependency changes (see `CONTRIBUTING.md`).

**Residual risk:** A compromised dependency that ships a malicious
payload would still be constrained by the Tauri capabilities and
the CSP. The most dangerous dependencies are those that run during
the build (e.g. a build-script in a Rust crate); the Integrator
reviews new build-dependencies carefully.

---

## The local-first invariant

The defining invariant of the threat model:

> **User document contents never leave the machine for core
> operations.**

This is enforced in code, not just in policy:

- `apps/desktop/src-tauri/src/security/mod.rs` declares
  `LOCAL_FIRST: bool = true` and `REMOTE_UPLOAD_PERMITTED: bool =
  false`.
- There is no HTTP client in the core file-operation path.
- The Tauri capabilities grant no network scope.
- The CSP restricts `connect-src` to IPC.
- The inspect path reads only `std::fs::metadata`.

A future feature that genuinely requires upload must:

1. Flip `REMOTE_UPLOAD_PERMITTED` through an explicit, documented
   ADR.
2. Be opt-in by the user (default off).
3. Be reviewed by the Integrator and the Guardian.
4. Surface the upload explicitly in the UI ("this operation uploads
   your file to <origin>").

Without these, a code path that uploads user document contents is a
P0 security violation (see `BUGS.md`).

---

## No telemetry

`TELEMETRY_DEFAULT_ON = false`. There is no analytics SDK, no crash
reporter that uploads, no remote logging sink.

- Local logs are written to
  `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log` with daily
  rotation. The user can delete them at any time.
- `Settings.allowDiagnostics` defaults to `false`.
- A future opt-in diagnostics feature must be opt-in only, must
  never send document contents, and must be reviewed by the
  Integrator. See ADR `docs/decisions/0009-no-telemetry.md`.

---

## No arbitrary shell access

The Tauri capabilities grant no shell scope. The frontend cannot
invoke `shell:allow-execute`, `shell:allow-spawn` or any
shell-related permission. There is no `Command::new` in the core
file-operation path.

A future feature that genuinely requires a bundled helper process
(e.g. a CLI tool wrapped for a specific engine) must:

1. Add the helper to `bundle.externalBin` in `tauri.conf.json`
   (Integrator-controlled).
2. Spawn it via Tauri's shell plugin (which requires an explicit
   capability grant, scoped to the bundled binary's name).
3. Be reviewed by the Integrator and the Guardian.

Without these, spawning a process from the desktop client is a P0
security violation.

---

## Path validation is server-side

The frontend is not trusted to provide a sanitised path. The Rust
layer re-validates every user-supplied path via
`validate_input_path`. This control is in `SECURITY.md` and
`docs/architecture/file-handling.md`. It runs on every platform so
behaviour in CI matches production.

---

## Output validation before finalization

Before any output is finalized into the user's chosen location, the
engine layer is required to validate it. The
`OUTPUT_VALIDATION_FAILED` error code is reserved for this. The
non-destructive file model (source → temp → validate → atomic move)
ensures a failed validation never leaves a partial output in the
user's destination.

---

## CSP enforcement

The CSP in `tauri.conf.json` is:

```
default-src 'self';
img-src 'self' data: blob: asset: http://asset.localhost;
style-src 'self' 'unsafe-inline';
script-src 'self';
connect-src 'self' ipc: http://ipc.localhost;
font-src 'self' data:
```

- No `unsafe-eval`. No remote script loading.
- `'unsafe-inline'` for `style-src` is required for Vite's HMR and
  React component styles. This is the only relaxation.
- `connect-src` allows only the app's own origin and the Tauri IPC
  scheme. No general network egress from the webview.
- `devCsp` is `null` — development uses the same strict CSP.
- `dangerousDisableAssetCspModification` is `false`.

Changing the CSP requires Integrator approval and a security review.

---

## Tauri capability restrictions

`capabilities/default.json` grants only:

- `core:default` — the Tauri core IPC primitives. No filesystem
  scope, no shell scope, no network scope.
- `dialog:allow-open` — the native file-open dialog. Returns a path
  string that is then re-validated server-side.

The capability is scoped to the `main` window. No other window or
webview is granted any permission.

Adding any permission that grants network, shell or broad
filesystem access requires a new ADR justifying the change and
Integrator sign-off. See `SECURITY.md`.

---

## `#![forbid(unsafe_code)]`

The Rust crate is `#![forbid(unsafe_code)]` at the crate root. No
`unsafe` blocks may be added. This eliminates an entire class of
memory-safety vulnerabilities.

The release profile sets `panic = "abort"` so any panic that does
escape terminates the process rather than leaving the application
in an undefined state.

---

## Residual risk summary

| Risk                                               | Mitigation                                                                                       | Residual                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Compromised frontend                               | Restrictive capabilities, server-side validation, strict CSP, typed `AppError` envelope          | Limited to the four commands' surface area. |
| Malicious local file (parsable contents)            | Inspect does not parse; future engines use permissively-licensed parsers with output validation | A parser bug; caught by the task runner.    |
| Path traversal                                      | `validate_input_path` enforces absolute, non-reserved, no traversal                              | None for the inspect path.                  |
| Corrupted local environment                         | DB stores no document contents; settings fall back to defaults                                   | Inherent to local-first model.              |
| Network attacker                                    | No network client in core path; future TLS + signature verification                                | None for the foundation.                    |
| Supply-chain attacker                                | Lockfiles, pinned toolchain, permissive-licence policy, Integrator-owned dependency changes     | A compromised build-dependency.             |
| Code execution via parser (future engines)          | `#![forbid(unsafe_code)]`, well-maintained parsers, output validation, task runner isolation    | A parser RCE would be a P0.                 |
| Update tampering (future updater)                   | Signed update artifacts, pinned public key, no auto-install                                       | Update-server compromise; mitigated by sig. |

The residual risk profile of the foundation is low because the
attack surface is small (four commands, no network, no shell, no
file writes outside the temp workspace). The risk profile grows
when engines land; each engine must be reviewed against this
threat model and `SECURITY.md`.
