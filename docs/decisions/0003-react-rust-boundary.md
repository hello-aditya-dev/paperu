# ADR 0003: The React / Rust boundary

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src/lib/ipc.ts`,
  `apps/desktop/src-tauri/src/commands/**`,
  `packages/contracts/**`,
  `apps/desktop/src-tauri/src/contracts/**`,
  `apps/desktop/src-tauri/src/errors/**`

## Context

Paperu's frontend is React 19 + TypeScript. The backend is Rust.
They communicate over Tauri's `invoke` IPC channel. Without a
deliberate boundary discipline, two failure modes are guaranteed
over time:

1. **Drift.** A field renamed on one side breaks the other silently.
   A missing optional becomes a runtime crash. A new enum variant
   added on one side but not the other produces a `serde` error only
   when the variant actually flows.
2. **Untyped escape hatches.** If the frontend ever calls `invoke()`
   with a raw string command name and an `any` payload, the IPC
   surface grows invisible: there is no compile-time check that the
   shape matches what Rust expects. Bugs hide in the untyped gap.

The boundary also has a security dimension. The frontend runs in a
webview; the backend runs as the native process. The frontend is
*treated as untrusted input* by the backend, even though both are
shipped together. The Rust layer must re-validate every path, every
size, every setting the frontend sends. The frontend's checks are
UX, not security.

## Decision

The React / Rust boundary is defined by four rules.

### 1. Typed IPC contracts in `@paperu/contracts`

`packages/contracts` is the single source of truth for every value
that crosses the boundary: request shapes, response shapes, the
`AppError` envelope, task progress, the operation catalogue,
settings, branded primitives (`FilePath`, `TaskId`, `CorrelationId`,
`EditionId`).

The Rust mirror lives in `apps/desktop/src-tauri/src/contracts/` and
serializes to identical JSON. Both sides import the same shapes (TS
directly, Rust by mirroring). Contract tests assert both sides accept
the canonical JSON fixtures in `packages/test-fixtures/src/contracts/`.

See ADR `0005-typed-ipc-contracts.md` for the full contracts
rationale.

### 2. No `any` on the frontend IPC surface

The frontend's typed IPC client (`apps/desktop/src/lib/ipc.ts`) is
the only sanctioned way to call native code. It:

- imports types from `@paperu/contracts`;
- wraps every `invoke()` call in a typed function;
- narrows rejections to `AppError`;
- wraps unknown failures as `internal.unknown` so the UI never sees
  raw text.

`no-explicit-any` is an ESLint error across the workspace (see
`eslint.config.js` and `CONTRIBUTING.md`'s "Code style" section).
Component tests mock commands via the `__mockCommand` registry; the
production code path never mocks and uses the real `invoke`.

### 3. Structured errors

Every IPC failure is serialized as an `AppError`
(`packages/contracts/src/errors.ts`,
`apps/desktop/src-tauri/src/errors/mod.rs`). The shape:

- `code` — a stable, namespaced identifier
  (e.g. `filesystem.file_not_found`). Never reused for a different
  meaning.
- `category` — one of `filesystem`, `validation`, `unsupported`,
  `permission`, `processing`, `database`, `cancellation`,
  `resource`, `licensing`, `internal`.
- `severity` — `info`, `warning`, `error`, `critical`.
- `recoverability` — `retryable`, `action_required`, `fatal`.
- `message` — a safe, user-facing string (localisation-ready). Never
  contains secrets, never contains file contents.
- `detail?`, `technical?`, `cause?` — optional context. `technical`
  is engineer-facing and never contains file contents.
- `correlationId?`, `taskId?` — for tracing.

Conversions exist from `std::io::Error` and `serde_json::Error` to
`AppError`. The `AppError::unknown` constructor wraps any
`Display`-able failure as a structured `internal.unknown` error so
the UI never sees raw text. Panics are caught at the command
boundary.

### 4. Rust re-validates all input

The frontend is treated as untrusted input. Every command
re-validates its arguments in Rust:

- Paths go through `filesystem::paths::validate_input_path`, which
  enforces non-empty, absolute, Windows-reserved-name and
  Windows-reserved-character checks on every platform (so Linux CI
  catches Windows-only bugs).
- Sizes, enums, optional fields are re-checked at the deserialization
  boundary via serde's strict typing.
- The frontend may not assume the path is trusted. The Rust layer
  canonicalizes, validates, and (for future scoped operations)
  enforces traversal prevention.

See `docs/architecture/file-handling.md` for the path-validation
rules and `docs/architecture/contracts.md` for the full contract
discipline.

## Consequences

### Positive

- **Compile-time checks on both sides.** Adding a field to a request
  requires a matching change on both sides; the contract tests fail
  otherwise. The boundary is explicit, not implicit.
- **The error envelope is uniform.** The UI has one error type to
  render, one shape to log, one set of fields to map to user
  guidance. There is no "raw string error" path.
- **Security review is tractable.** "What can the frontend ask the
  backend to do?" is answerable by reading the contracts package
  and the capability file. There is no second, untyped surface.
- **The frontend is replaceable in principle.** A future alternative
  frontend (mobile, CLI) that imports `@paperu/contracts` and speaks
  the same JSON can drive the same backend. The contract is the
  API.

### Negative

- **More ceremony for new operations.** A new operation is a
  contract change: TS contract, Rust mirror, JSON fixture, both-side
  contract tests, Integrator sign-off. This is intentional; it is
  the price of the invariant.
- **Two parallel type definitions to maintain.** The Rust mirror is
  hand-written, not generated. The contract tests catch divergence,
  but the mirror must be updated alongside every contract change.
  Code generation (eg. `ts-rs`) was considered and deferred — the
  surface is small enough that hand-mirroring is clearer and avoids
  a new build dependency.
- **The frontend is untrusted, which can be surprising.** A
  contributor who adds a check in the frontend and assumes it holds
  in the backend is wrong. The Rust layer re-validates; the
  frontend checks are UX only. This must be communicated to new
  contributors (see `CONTRIBUTING.md`).

## Non-goals

- **No runtime schema validation on the frontend.** The frontend
  trusts the contract types. If a future contributor wants runtime
  parsing (eg. `zod`), that is a separate ADR.
- **No code generation from one side to the other.** Hand-mirroring
  with contract tests is the chosen discipline.

## References

- `apps/desktop/src/lib/ipc.ts` — the typed IPC client.
- `packages/contracts/src/index.ts` — the contract surface.
- `apps/desktop/src-tauri/src/contracts/mod.rs` — the Rust mirror.
- `apps/desktop/src-tauri/src/errors/mod.rs` — the `AppError`
  envelope.
- `docs/architecture/contracts.md` — full contract discipline.
- `docs/architecture/file-handling.md` — path validation.
- `docs/decisions/0005-typed-ipc-contracts.md` — contracts as source
  of truth.
- `CONTRIBUTING.md` — "Code style" (no `any`, ESLint flat config).
