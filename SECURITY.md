# Paperu security policy

Paperu is a local-first desktop application. This document describes
the security and privacy invariants that govern the codebase, the
threat model that justifies them, and the operational rules every
contributor (Builder, Guardian, Integrator) must follow.

For the full architectural rationale, see
`docs/security/threat-model.md` and the relevant ADRs in
`docs/decisions/`.

---

## 1. Local-first threat model

The defining security property of Paperu is that **user documents
never leave the machine for core operations**. This is enforced in
code, not just in policy:

- `apps/desktop/src-tauri/src/security/mod.rs` declares:
  - `LOCAL_FIRST: bool = true`
  - `REMOTE_UPLOAD_PERMITTED: bool = false`
  - `TELEMETRY_DEFAULT_ON: bool = false`
- There is **no HTTP client** in the core file-operation path. The
  `Cargo.toml` does not depend on `reqwest`, `hyper`, `ureq`, `surf`
  or any other general-purpose HTTP client.
- File inspection reads only filesystem metadata (`std::fs::metadata`).
  No file *content* is read by the inspect path.
- The Tauri capabilities granted to the frontend (see
  `apps/desktop/src-tauri/capabilities/default.json`) are:
  - `core:default`
  - `dialog:allow-open`

  No network scope, no arbitrary shell scope, no broad filesystem
  scope, no `fs:allow-*` write permissions.

A future feature that genuinely requires upload must flip
`REMOTE_UPLOAD_PERMITTED` through an explicit, documented
architecture decision (a new ADR under `docs/decisions/`). It must be
opt-in by the user, and it must never be on by default. The Integrator
is the only role permitted to merge such a change.

---

## 2. Safe file operations

Paperu's file-handling model is non-destructive. The full design is in
`docs/architecture/file-handling.md`. Summary of the invariants:

1. **Source files are never modified in place.** Every operation that
   produces output writes to a temp workspace first.
2. **Outputs are validated before finalization.** An engine that
   fails to produce a valid output must never publish a half-written
   file to the user's chosen location.
3. **Finalization is atomic.** `filesystem::temp::atomic_finalize`
   uses `std::fs::rename` (atomic on the same filesystem) and refuses
   to overwrite an existing destination unless the caller explicitly
   opts in via `overwrite: true`.
4. **Crash recovery.** On startup, `TempWorkspace::startup_cleanup`
   removes stale partial outputs left by a previous crash or
   interruption. Leftovers live only under the temp workspace
   (`%TEMP%/paperu`), never in the user's chosen output directory.
5. **Cross-volume fallback is opt-in only.** When `rename` fails
   across volumes, Paperu falls back to copy+delete *only* when the
   caller has explicitly accepted overwrite semantics. The
   non-destructive default never takes the destructive fallback.

---

## 3. Command validation

Every Tauri command is a thin, typed entry point. The rules
(`apps/desktop/src-tauri/src/commands/mod.rs`):

- **Validate all input server-side.** Never trust the frontend.
  The frontend may be replaced, bypassed or compromised; the Rust
  layer is the trust boundary.
- **Return `Result<T, AppError>`.** Commands never panic into the UI.
  Panics are caught at the command boundary and converted into a
  structured `internal.unknown` error.
- **No business logic in commands.** Commands delegate to the
  filesystem, settings, task and licensing layers.

The current command surface is small and intentional:

- `inspect_file` — inspect a local file, return real metadata.
- `read_settings` — read the persisted settings object.
- `write_settings` — apply a partial settings patch.
- `read_app_info` — return product identity and version.

Adding a command is a contract change requiring Integrator sign-off
(see `CONTRIBUTING.md`).

---

## 4. Path validation

`apps/desktop/src-tauri/src/filesystem/paths.rs::validate_input_path`
is the single canonical entry point for user-supplied paths. It
enforces:

- **Non-empty.** Empty/whitespace paths are rejected with
  `validation.empty_input`.
- **Absolute.** Relative paths are rejected with
  `filesystem.path_invalid`. The frontend may not assume the path is
  trusted; the Rust layer re-validates it.
- **No Windows reserved names.** `CON`, `PRN`, `AUX`, `NUL`, `COM1`
  through `COM9`, `LPT1` through `LPT9` are rejected with
  `filesystem.reserved_name`. This check runs on every platform so
  behaviour is consistent in CI.
- **No reserved characters.** `<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`,
  `*` in the final component are rejected with `filesystem.path_invalid`.
- **Traversal prevention.** Canonicalization rejects paths that
  escape after canonicalization. When the file does not exist, the
  lexical absolute form is returned so the inspect path can still
  report `exists: false`.
- **Long-path handling.** On Windows, very long paths are addressed
  via the extended-length prefix (`\\?\`) when applied internally;
  the public `FilePath` string is the native form.

Synced-folder detection (`is_in_synced_folder`) is a *UX* hint, not a
security control. It only checks whether the path contains `onedrive`
(case-insensitive) so the UI can warn the user. It never causes an
upload or network call.

---

## 5. Tauri capability restrictions

The default capability file
(`apps/desktop/src-tauri/capabilities/default.json`) is intentionally
minimal:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open"
  ]
}
```

- `core:default` grants only the Tauri core IPC primitives. No
  filesystem scope, no shell scope, no HTTP scope.
- `dialog:allow-open` allows the frontend to invoke the native file
  open dialog. The dialog returns a path string; the path is then
  re-validated server-side by Rust.
- The capability is scoped to the `main` window. No other window or
  webview is granted any permission.

Changing this file requires Integrator approval (see
`CONTRIBUTING.md`). Adding any permission that grants network, shell
or broad filesystem access requires a new ADR justifying the change.

---

## 6. Content Security Policy

The Tauri config enforces a strict CSP
(`apps/desktop/src-tauri/tauri.conf.json`):

```
default-src 'self';
img-src 'self' data: blob: asset: http://asset.localhost;
style-src 'self' 'unsafe-inline';
script-src 'self';
connect-src 'self' ipc: http://ipc.localhost;
font-src 'self' data:
```

- `default-src 'self'` — only the app's own origin by default.
- `script-src 'self'` — no inline scripts, no `unsafe-eval`, no
  remote script loading.
- `connect-src 'self' ipc: http://ipc.localhost` — IPC is the only
  allowed non-self connection, and only via the Tauri IPC scheme.
- `img-src` allows `data:` and `blob:` for local rendering, and
  `http://asset.localhost` for Tauri's asset protocol.
- `style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` is required
  for runtime-injected styles from Vite's HMR and React component
  styles. This is the only relaxation. No `unsafe-eval`.

`devCsp` is `null` (development uses the same strict CSP).
`dangerousDisableAssetCspModification` is `false`. Changing the CSP
requires Integrator approval and a security review.

---

## 7. IPC attack surface

The IPC attack surface is the set of Tauri commands the frontend can
invoke. Paperu keeps it minimal:

- Every command takes a typed request struct (mirrored from
  `@paperu/contracts`), not a raw bag of values.
- Every command re-validates input server-side. The frontend is not
  trusted.
- Every command returns a typed `Result<T, AppError>`. The
  `AppError` envelope is the only shape Tauri rejects with — the UI
  never receives raw text or a Rust panic message.
- The IPC client (`apps/desktop/src/lib/ipc.ts`) narrows rejections
  with `isAppError`. Anything that does not match the contract shape
  is wrapped as a structured `internal.unknown` error.

Threats considered:

- **Malicious frontend** (compromised bundle, XSS in the webview): the
  frontend can only invoke the small typed command set, and every
  command re-validates. There is no path from a frontend compromise to
  arbitrary file write or shell execution.
- **Path traversal**: rejected by `validate_input_path`.
- **Reserved names / reserved characters**: rejected.
- **Output clobbering**: rejected unless the user explicitly opts in.
- **Rejection-shape fuzzing**: the typed client wraps unknown
  rejections into a structured `internal.unknown` rather than
  propagating raw values.

---

## 8. Output validation

Before any output is finalized into the user's chosen location, the
engine layer is required to validate it. For the foundation, the only
"output" is the inspect response, which is read-only and produces no
file. When real engines land (see `docs/architecture/engines.md`),
each engine must:

- Validate the output is well-formed (e.g. a valid PDF, a decodable
  image) before finalization.
- Return `processing.output_validation_failed` when validation fails.
- Never leave a partial output in the user's chosen directory. The
  temp workspace is the only place a partial output may live, and it
  is cleaned on the next startup.

---

## 9. Temp-file safety

`apps/desktop/src-tauri/src/filesystem/temp.rs` owns the temp
workspace:

- **Location:** `std::env::temp_dir().join("paperu")` (i.e.
  `%TEMP%/paperu` on Windows).
- **Naming:** each temp file is named `paperu-{uuid}{suffix}`. UUIDs
  are v4 (random), generated by the `uuid` crate.
- **Startup cleanup:** `TempWorkspace::startup_cleanup` reads the
  workspace directory and removes every file in it. Missing
  directory is a no-op. Per-file removal failures are logged and
  skipped; they do not abort the cleanup.
- **Atomic finalize:** `atomic_finalize(temp, dest, overwrite)`
  refuses to overwrite an existing destination unless `overwrite` is
  true. On same-volume rename it is atomic. On cross-volume rename
  failure, it falls back to copy+delete only when `overwrite` is
  true.
- **Tests:** the temp module has unit tests that assert stale files
  are removed, that finalization refuses existing destinations
  without overwrite, and that the temp file is consumed on a
  successful finalize.

The temp workspace never contains user document *contents* in a
persistent form — outputs are moved out atomically or removed on the
next startup.

---

## 10. Secrets policy

- **No secrets in the repository.** No production API keys, no
  licence keys, no signing certificates, no `.env` files with real
  values. The foundation does not require any environment variables
  (see `.env.example`).
- **No secrets in errors.** `AppError` messages and `technical`
  fields never embed secrets. Paths may be included (they are not
  secret in the local-first model) but are truncated when very long.
- **No secrets in logs.** The structured logging layer
  (`apps/desktop/src-tauri/src/logging/mod.rs`) never logs file
  contents, licence keys, tokens or other secrets. Paths may be
  logged for diagnosis but are trimmed to 256 characters.
- **No secrets in fixtures.** `packages/test-fixtures` contains
  synthetic content only. The constant `SYNTHETIC_PAYLOAD` is a
  deterministic non-secret string.
- **CI does not inject secrets.** The `windows-build` job in
  `.github/workflows/ci.yml` sets `TAURI_SIGNING_PRIVATE_KEY=""`.
  Releases are documented as unsigned until a certificate is
  procured (see `docs/releases/workflow.md`).

When a real signing certificate or a licence-issuing server key is
introduced, it will be injected via the CI secrets store at release
time and never written to disk in the repository.

---

## 11. No telemetry

`TELEMETRY_DEFAULT_ON = false`. There is no analytics SDK, no crash
reporter that uploads, and no remote logging sink. Local logs are
written to `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log` with
daily rotation. The user can delete them at any time.

`Settings.allowDiagnostics` defaults to `false`. Even when a future
opt-in diagnostics feature is implemented, it will be opt-in only
and will never send document contents. See ADR
`docs/decisions/0009-no-telemetry.md`.

---

## 12. Update security

`tauri.conf.json` currently sets `createUpdaterArtifacts: false`. The
Tauri updater is not enabled in the foundation. When it is enabled:

- Updates will be downloaded over HTTPS from a Paperu-controlled
  origin.
- The updater will require a signature. The signing key lives outside
  the repository (CI secrets store) and is never committed.
- The desktop client will refuse an update whose signature does not
  verify against the pinned public key.
- Auto-install is never supported (`Settings.updatePreference` only
  allows `off` or `notify`).

This plan is documented in `docs/releases/workflow.md`.

---

## 13. Code-signing documentation

Paperu does not yet hold a code-signing certificate. The plan, to be
executed when a certificate is procured:

- **Authenticode** signing of the Windows executables and installers
  (NSIS and MSI). Tauri supports this via
  `bundle.windows.certificateThumbprint` in `tauri.conf.json`, which
  is currently `null`.
- **Installer signing.** Both the NSIS `.exe` and the MSI package
  will be signed with the same certificate.
- **Timestamping.** `bundle.windows.timestampUrl` is already set to
  `http://timestamp.sectigo.com` (Sectivo RFC 3161 timestamping
  service). This ensures signatures remain valid after the
  certificate expires.
- **Digest algorithm.** `bundle.windows.digestAlgorithm` is set to
  `sha256`.
- **Updater signature verification.** When the updater is enabled,
  update artifacts will be signed and the desktop client will verify
  the signature against a pinned public key.

No certificate thumbprint, private key or `.pfx` is committed. CI
injects the signing key via the secrets store at release time only.

---

## 14. Dependency supply-chain risk

Paperu's dependency policy is documented in
`DEPENDENCIES.md` and in ADR `docs/decisions/0008-dependency-policy.md`.
Summary:

- **Permissive licences only.** MIT, Apache-2.0, BSD, ISC, MPL-2.0,
  Unicode-DFS-2016 and similar permissive licences are allowed.
- **GPL, AGPL and other copyleft licences are prohibited.** No
  `gpl*`, `agpl*`, `lgpl*` (with linking exception concerns) or
  StrongCopyleft dependencies may be added.
- **The Integrator owns dependency changes.** Adding, removing or
  bumping a dependency requires Integrator review. `Cargo.lock` and
  `pnpm-lock.yaml` are checked in and reproducible.
- **Bundled dependencies preferred where reasonable.** The SQLite
  `rusqlite` crate uses the `bundled` feature so the C source is
  compiled into the binary and not dynamically linked against a
  system SQLite.
- **Auditable.** `Cargo.lock` is committed. The Rust toolchain is
  pinned (`rust-toolchain.toml`). The pnpm version is pinned
  (`packageManager`). CI uses `--frozen-lockfile`.

When a dependency is found to have a security advisory, the
Integrator coordinates an emergency bump and the Guardian adds a
regression test where feasible.

---

## 15. Reporting a vulnerability

If you believe you have found a security vulnerability in Paperu:

1. Do **not** open a public issue.
2. Contact the Integrator via the project's official channel
   (referenced in `LICENSE`).
3. Provide a minimal reproduction, the affected version, and the
   threat model assumption the issue breaks.

The Integrator will acknowledge receipt within a reasonable window,
coordinate a fix with the Builder and Guardian, and publish a
security advisory once a fix is available.

---

## 16. `unsafe` and panics

- The Rust crate is `#![forbid(unsafe_code)]` at the crate root
  (`apps/desktop/src-tauri/src/lib.rs`). No `unsafe` blocks may be
  added.
- Commands return `Result<T, AppError>` and never panic into the UI.
  Where a third-party API can panic, it is wrapped and converted into
  a structured `internal.unknown` error.
- The release profile sets `panic = "abort"` so any panic that does
  escape terminates the process rather than leaving the application
  in an undefined state.
