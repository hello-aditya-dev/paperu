# Paperu — Security Invariants

These are the non-negotiable security properties of Paperu. Every
commit must preserve them. Guardian tests them. Integrator enforces
them at merge.

Violating any invariant is a **P0 bug** (see `BUGS.md`).

---

## 1. Local-first core

**Invariant**: Core file operations never send user file content,
metadata, or filenames to any external server.

**Enforcement**:
- `security::REMOTE_UPLOAD_PERMITTED == false`
- No network client in the core file-operation path.
- Tauri CSP `connect-src 'self' ipc: http://ipc.localhost`.
- The `0 bytes uploaded` claim is only shown when technically true.

**Test**: Guardian verifies no network requests occur during a file
operation (network monitoring).

---

## 2. Non-destructive file handling

**Invariant**: Source files are never modified by default. Outputs
are new files.

**Enforcement**:
- Source files opened read-only.
- Outputs written to `TempWorkspace`, validated, then atomically
  finalized via `atomic_finalize`.
- `atomic_finalize` refuses existing destinations without explicit
  overwrite.

**Test**: Byte-for-byte comparison of source before and after
operation (3 Rust tests in `filesystem::temp::tests`).

---

## 3. No unsafe code

**Invariant**: The Rust codebase contains zero `unsafe` blocks.

**Enforcement**: `#![forbid(unsafe_code)]` at the crate root.

**Test**: `cargo build` fails if any `unsafe` is introduced.

---

## 4. Path validation

**Invariant**: Every user-supplied path is re-validated server-side.

**Enforcement**: `validate_input_path` canonicalizes, rejects relative
paths, reserved names, reserved characters. Called by every command
that accepts a path.

**Test**: `shell::tests` (3 tests), `pdf_info::tests` (1 test).

---

## 5. No arbitrary shell execution

**Invariant**: The frontend cannot execute arbitrary shell commands.

**Enforcement**: No `run(commandString)` command exists. Shell actions
are narrow-purpose: `open_path` (opens a file), `reveal_path` (reveals
in file manager). Both validate paths server-side.

**Test**: Guardian reviews the command surface; no general shell
command is registered in `invoke_handler!`.

---

## 6. Typed IPC only

**Invariant**: The frontend speaks only typed Tauri commands. No raw
string commands.

**Enforcement**: Every frontend→Rust call goes through `lib/ipc.ts`
which uses typed wrappers. Commands are registered in
`invoke_handler!` with typed request structs.

**Test**: Contract tests verify JSON shapes match between TS and Rust.

---

## 7. Error messages never leak secrets

**Invariant**: Error messages and logs never contain file contents,
licence keys, tokens, passwords, or signature data.

**Enforcement**: Documented in the error model (`errors/mod.rs`).
Logs use `tracing` with structured fields, never raw content.

**Test**: Guardian reviews error paths; grep for secret patterns in
log output.

---

## 8. Capability least privilege

**Invariant**: The Tauri capability surface grants only the minimum
required permissions.

**Enforcement**: `capabilities/default.json` grants only
`core:default` + `dialog:allow-open`. Any addition requires an
approved ADR.

**Test**: Guardian audits `capabilities/default.json` for scope creep.

---

## 9. CSP integrity

**Invariant**: The Content Security Policy is restrictive and cannot
be bypassed.

**Enforcement**: `default-src 'self'`; `script-src 'self'`; no
`unsafe-eval`. Integrator-controlled.

**Test**: Guardian attempts CSP violations (inline scripts, eval,
external resources).

---

## 10. Atomic finalization

**Invariant**: A failed operation never leaves a partial output in the
user's chosen destination.

**Enforcement**: `atomic_finalize` writes to temp, validates, renames.
On failure, temp is cleaned; destination is untouched.

**Test**: `atomic_finalize_refuses_existing_without_overwrite`,
`atomic_finalize_moves_when_clear` (Rust tests).
