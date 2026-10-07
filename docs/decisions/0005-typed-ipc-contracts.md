# ADR 0005: Typed IPC contracts as the single source of truth

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `packages/contracts/**`,
  `apps/desktop/src-tauri/src/contracts/**`,
  `packages/test-fixtures/src/contracts/**`,
  `apps/desktop/src/lib/__tests__/contracts.test.ts`

## Context

Paperu has two type systems — TypeScript on the frontend, Rust on the
backend — connected by Tauri's `invoke` IPC channel, which carries
serde-serialized JSON. Without a single source of truth, the two
sides drift over time:

- A field renamed on one side breaks the other silently.
- A missing optional field becomes a runtime crash.
- An enum variant added on one side but not the other produces a
  `serde` error only when the variant actually flows (which may be
  rare, hiding the bug in production).
- The frontend's `invoke()` calls grow a second, untyped surface
  invisible to compile-time checks.

The boundary is also where security and data-integrity invariants
live. The contracts package is the API the frontend is allowed to
call. If it is not in the contracts, the frontend cannot ask for it
through the typed client.

## Decision

`@paperu/contracts` (`packages/contracts/src/`) is the **single
source of truth** for every value that crosses the React/Rust
boundary. The Rust mirror in
`apps/desktop/src-tauri/src/contracts/` must serialize to identical
JSON. Contract tests in both languages assert both sides accept the
canonical JSON fixtures.

### What lives in the contracts package

`packages/contracts/src/index.ts` re-exports:

- `common.ts` — branded primitives (`FilePath`, `TaskId`,
  `CorrelationId`, `EditionId`), helper factories, `ByteSize`,
  `IsoTimestamp`, `Result<T>`, `FileKind`, `CommandName`,
  `EventName`.
- `errors.ts` — the unified `AppError` envelope, `ErrorCategory`,
  `ErrorSeverity`, `Recoverability`, the `ErrorCode` catalogue, the
  `appError` constructor, the `isAppError` guard.
- `inspect.ts` — the Local File Inspect request/response.
- `tasks.ts` — the task engine contract: `TaskStatus`, `TaskProgress`,
  `TaskInfo`, `TaskOutcome`, task commands.
- `operations.ts` — the operation catalogue: `OperationKind`
  (`inspect_file`, `pdf.compress`, `pdf.merge`, etc.),
  `ConflictStrategy`, the concrete request shapes, `OperationResult`,
  `OperationMetrics`.
- `progress.ts` — `OutputMetadata`, the progress/finished event
  payloads.
- `settings.ts` — `SETTINGS_VERSION`, `ThemePreference`,
  `UpdatePreference`, `ConflictStrategy`, `Settings`, `DEFAULT_SETTINGS`,
  `SettingsPatch`, `AppInfo`.

### The Rust mirror

The Rust mirror lives in `apps/desktop/src-tauri/src/contracts/`:

- `mod.rs` — module wiring and re-exports.
- `common.rs` — `FileKind` enum, `ByteSize` struct, `IsoTimestamp`,
  `FilePath`, `TaskId`, `CorrelationId`, `EditionId` aliases,
  `format_bytes`.
- `inspect.rs` — `InspectFileRequest`, `InspectFileResponse`.
- `tasks.rs` — `OperationKind`, `TaskStatus`, `TaskProgress`,
  `TaskInfo`, `CancelTaskArgs`.
- `settings.rs` — `SETTINGS_VERSION`, `ThemePreference`,
  `ConflictStrategy`, `UpdatePreference`, `Settings`, `SettingsPatch`.

The mirroring rules:

1. **Identical JSON shape.** Each Rust struct uses
   `#[serde(rename_all = "camelCase")]` to match the TypeScript
   `camelCase` field names. Optional fields use
   `#[serde(skip_serializing_if = "Option::is_none")]` so they are
   absent from JSON when `None`, matching the TS `field?: T`.
2. **Identical enum variants.** Each variant is
   `#[serde(rename = "...")]` to the exact lowercase string the TS
   union uses (e.g. `TaskStatus::Queued` serializes to `"queued"`).
3. **Identical constant values.** `SETTINGS_VERSION = 1` in both.
   The `OperationKind` enum variants are renamed to the dotted
   strings (`"pdf.compress"`, `"image.resize"`, etc.) exactly
   matching the TS `OperationKind` object.

### Contract test fixtures

The canonical JSON fixtures live in
`packages/test-fixtures/src/contracts/`:

- `inspect-file-response.json` — the canonical
  `InspectFileResponse` payload.
- `app-error.json` — the canonical serialized `AppError`.

Each fixture is a JSON document with a `$schema` and a `$comment`
naming the contract it represents and the rule that both sides must
accept it.

**TypeScript contract tests**
(`apps/desktop/src/lib/__tests__/contracts.test.ts`) use
`readContractFixture` (from `@paperu/test-fixtures`) to parse each
fixture and assert the typed contracts accept it.

**Rust contract tests** (under `#[cfg(test)] mod tests` in each
module) assert the Rust types serialize to / deserialize from the
same JSON. For example, `ByteSize::new(1_048_576)` produces the
string `"1.0 MB"` exactly matching the fixture's `humanReadable`
field.

The `inspect-file-response.json` fixture is the canonical reference
both sides must agree on.

### Adding an operation is a contract change

Adding a new file operation (e.g. a hypothetical `pdf.watermark`)
is a **contract change**. The Integrator must approve it. The steps
(see `docs/architecture/contracts.md` for the full version):

1. Propose the contract. (An ADR if the design is non-trivial.)
2. Add the operation kind to `packages/contracts/src/operations.ts`
   and the request shape to the `OperationRequest` union.
3. Mirror in Rust (`apps/desktop/src-tauri/src/contracts/tasks.rs`).
4. Add a JSON fixture under
   `packages/test-fixtures/src/contracts/`.
5. Extend the TypeScript contract test and add a Rust serialization
   test.
6. Implement the engine under
   `apps/desktop/src-tauri/src/engines/` (or return
   `internal.not_implemented` until implemented).
7. Add the `#[tauri::command]` and register it in
   `paperu::run`'s `invoke_handler!` macro.
8. Extend `apps/desktop/src/lib/ipc.ts` with a typed wrapper.
9. The Guardian verifies `pnpm check` passes and posts verification.
10. The Integrator merges (contracts are Integrator-controlled, see
    `CONTRIBUTING.md`).

Until the engine is implemented, the operation must return
`internal.not_implemented` (not pretend to succeed).

### When a contract changes

Changing an existing contract (renaming a field, removing an
optional, adding a required field, splitting an enum) is a breaking
change. The Integrator decides whether to:

- bump the foundation version (during `0.x`, allowed in a minor),
- add a parallel contract and deprecate the old one,
- or hold the change for `1.0.0`.

In all cases, the fixture is updated in the same PR, and both sides'
tests must pass.

## Consequences

### Positive

- **Compile-time checks on both sides.** Adding a field requires a
  matching change in both `@paperu/contracts` and the Rust mirror;
  the contract tests fail otherwise.
- **The boundary is explicit.** Reviewers can answer "what can the
  frontend ask the backend to do?" by reading the contracts package.
  There is no second, untyped surface.
- **Stable identifiers.** `CommandName` and `EventName` are `as
  const` objects — typos are caught at compile time, not at runtime.
- **Stable error codes.** The `ErrorCode` catalogue is the single
  registry of error identifiers; a code is never reused for a
  different meaning.
- **The contracts package is the API.** A future alternative
  frontend (mobile, CLI) that imports `@paperu/contracts` can drive
  the same backend.

### Negative

- **More ceremony for new operations.** A new operation is a
  contract change requiring Integrator sign-off. This is the price
  of the invariant; it is intentional.
- **Two parallel type definitions to maintain.** The Rust mirror is
  hand-written, not generated. Code generation (eg. `ts-rs`) was
  considered and deferred — the surface is small enough that
  hand-mirroring is clearer and avoids a new build dependency.
- **Fixtures are part of the contract.** Changing a fixture is a
  contract change requiring Integrator sign-off. The fixture is
  canonical; both sides must accept it.

## Non-goals

- **No runtime schema validation on the frontend.** The frontend
  trusts the contract types. If a future contributor wants runtime
  parsing (eg. `zod`), that is a separate ADR.
- **No code generation from one side to the other.** Hand-mirroring
  with contract tests is the chosen discipline.
- **No versioning of the contracts package independent of the
  foundation version.** During `0.x`, contract changes are allowed
  in a minor version. After `1.0.0`, a separate versioning strategy
  will be decided.

## References

- `packages/contracts/src/index.ts` — the contract surface.
- `apps/desktop/src-tauri/src/contracts/mod.rs` — the Rust mirror.
- `packages/test-fixtures/src/contracts/` — canonical JSON fixtures.
- `apps/desktop/src/lib/__tests__/contracts.test.ts` — TS contract
  tests.
- `apps/desktop/src/lib/ipc.ts` — the typed IPC client.
- `docs/architecture/contracts.md` — full contract discipline,
  including how to add an operation.
- `docs/decisions/0003-react-rust-boundary.md` — the boundary
  decision that this ADR refines.
- `CONTRIBUTING.md` — Integrator-controlled file list.
