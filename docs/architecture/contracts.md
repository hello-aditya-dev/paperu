# Architecture: IPC contracts

This document explains why `@paperu/contracts` is the single
source of truth for the React ↔ Rust boundary, how the Rust types
mirror the TypeScript types, how contract test fixtures work, and
how to add a new operation.

---

## Why a single source of truth

Without a single source of truth, the React layer and the Rust layer
will drift. A field renamed on one side breaks the other silently;
a missing optional field becomes a runtime crash; an enum variant
added on one side but not the other produces a `serde` error only
when the variant actually flows.

Paperu prevents this by declaring `@paperu/contracts`
(`packages/contracts/src/`) as the only authority for every value
that crosses the boundary. Both sides import the shapes (TS directly,
Rust by mirroring), and contract tests assert both sides accept the
canonical JSON fixtures.

The frontend's typed IPC client (`apps/desktop/src/lib/ipc.ts`) is
the only sanctioned way to call native code. It imports from
`@paperu/contracts` and converts rejections into structured
`AppError` values. Production never mocks; tests use the
`__mockCommand` registry.

---

## What lives in the contracts package

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

### Branded primitives

`FilePath`, `TaskId`, `CorrelationId` and `EditionId` are
compile-time branded types:

```ts
export type FilePath = string & { readonly __brand: "FilePath" };
```

At runtime they are plain strings. The brand prevents accidentally
mixing an untrusted `string` with a path that has been validated.
The only way to construct one is through the corresponding factory
(`filePath`, `taskId`, `correlationId`, `editionId`). The Rust side
represents them as plain `String` aliases — the brand is a
TypeScript-only construct.

### Stable string identifiers

`CommandName` and `EventName` are `as const` objects with a
derived type. They are the single source of truth for the string
identifiers used in `invoke()` and `listen()`. Centralising them
prevents typos on either side of the boundary.

`CommandName.InspectFile = "inspect_file"` corresponds to the
`#[cfg_attr(feature = "tauri-runtime", tauri::command)]` function
named `inspect_file` in Rust.

---

## How Rust mirrors the TS types

The Rust mirror lives in `apps/desktop/src-tauri/src/contracts/`:

- `mod.rs` — module wiring and re-exports.
- `common.rs` — `FileKind` enum, `ByteSize` struct, `IsoTimestamp`,
  `FilePath`, `TaskId`, `CorrelationId`, `EditionId` aliases,
  `format_bytes`.
- `inspect.rs` — `InspectFileRequest`, `InspectFileResponse`.
- `tasks.rs` — `OperationKind`, `TaskStatus`, `TaskProgress`,
  `TaskInfo`, `CancelTaskArgs`.
- `settings.rs` — `SETTINGS_VERSION`, `ThemePreference`,
  `ConflictStrategy`, `UpdatePreference`, `Settings`,
  `SettingsPatch`.

The mirroring rules:

1. **Identical JSON shape.** The Rust struct's `serde(rename_all =
   "camelCase")` matches the TypeScript `camelCase` field names.
   Optional fields use `#[serde(skip_serializing_if =
   "Option::is_none")]` so they are absent from JSON when `None`,
   matching the TS `field?: T`.
2. **Identical enum variants.** Each variant is `#[serde(rename =
   "...")]` to the exact lowercase string the TS union uses (e.g.
   `TaskStatus::Queued` serializes to `"queued"`).
3. **Identical constant values.** `SETTINGS_VERSION = 1` in both.
   The `OperationKind` enum variants are renamed to the dotted
   strings (`"pdf.compress"`, `"image.resize"`, etc.) exactly
   matching the TS `OperationKind` object.

The Rust side documents this in `src/contracts/mod.rs`:

> These types are the formal mirror of `@paperu/contracts` on the
> TypeScript side. They MUST serialize to identical JSON. Contract
> tests assert the shapes match the canonical fixtures.

---

## Contract test fixtures

The canonical JSON fixtures live in
`packages/test-fixtures/src/contracts/`:

- `inspect-file-response.json` — the canonical
  `InspectFileResponse` payload.
- `app-error.json` — the canonical serialized `AppError`.

Each fixture is a JSON document with a `$schema` and a `$comment`
naming the contract it represents and the rule that both sides
must accept it.

### TypeScript contract tests

`apps/desktop/src/lib/__tests__/contracts.test.ts` uses
`readContractFixture` (from `@paperu/test-fixtures`) to parse each
fixture and assert the typed contracts accept it:

```ts
const fixture = await readContractFixture<InspectFileResponse>(
  "inspect-file-response",
);
expect(fixture.path).toBe("/home/paperu/fixtures/report.pdf");
expect(fixture.size.bytes).toBe(1_048_576);
expect(fixture.size.humanReadable).toBe("1.0 MB");
```

The test imports `isAppError` from `@paperu/contracts` and asserts
the `app-error` fixture is recognised.

### Rust contract tests

The Rust crate has unit tests (under `#[cfg(test)] mod tests` in
each module) that assert the Rust types serialize to / deserialize
from the same JSON. For example, the `ByteSize::new(1_048_576)`
produces the string `"1.0 MB"` exactly matching the fixture's
`humanReadable` field.

The `inspect-file-response.json` fixture is the canonical reference
both sides must agree on.

---

## Adding a new operation

Adding a new file operation (e.g. a hypothetical `pdf.watermark`)
is a contract change. The Integrator must approve it. The steps:

1. **Propose the contract.** Open a PR description (or an ADR if the
   design is non-trivial) describing the request shape, the
   response shape, the conflict strategy options, the operation kind
   identifier, and the file kinds the operation applies to.
2. **Add the operation kind.** In `packages/contracts/src/operations.ts`,
   add the new variant to the `OperationKind` object and to the
   `OperationRequest` discriminated union:
   ```ts
   export const OperationKind = {
     // ...
     PdfWatermark: "pdf.watermark",
   } as const;

   export interface PdfWatermarkRequest extends OperationRequestBase {
     readonly kind: typeof OperationKind.PdfWatermark;
     readonly source: FilePath;
     readonly text: string;
   }
   ```
3. **Mirror in Rust.** In
   `apps/desktop/src-tauri/src/contracts/tasks.rs`, add the variant
   to the `OperationKind` enum:
   ```rust
   #[serde(rename = "pdf.watermark")]
   PdfWatermark,
   ```
4. **Add a JSON fixture.** Under
   `packages/test-fixtures/src/contracts/`, add the canonical
   request/response fixture (e.g. `pdf-watermark-request.json`,
   `pdf-watermark-response.json`). The `$schema` field names the
   contract; the `$comment` records the rule that both sides must
   accept it.
5. **Add contract tests.** Extend
   `apps/desktop/src/lib/__tests__/contracts.test.ts` to parse the
   new fixture and assert the typed contract accepts it. On the
   Rust side, add a `#[cfg(test)] mod tests` block that serializes
   the Rust request/response struct and compares against the
   fixture.
6. **Implement the engine.** Add the engine under
   `apps/desktop/src-tauri/src/engines/` (see
   `docs/architecture/engines.md`). The engine speaks the typed
   operation contract and is wired into the task runner. Until the
   engine is implemented, the operation must return
   `internal.not_implemented` (not pretend to succeed).
7. **Add the command.** Add a `#[tauri::command]` function in
   `apps/desktop/src-tauri/src/commands/` that takes the typed
   request, calls the engine via the task runner, and returns the
   typed result. Register the command in `paperu::run`'s
   `invoke_handler!` macro.
8. **Add the IPC client method.** Extend
   `apps/desktop/src/lib/ipc.ts` with a typed wrapper that calls
   `invoke(CommandName.PdfWatermark, ...)` and returns the typed
   result.
9. **Guard verifies.** The Guardian runs `pnpm check`, confirms both
   the TS contract test and the Rust serialization test accept the
   new fixture, and posts verification.
10. **Integrator merges.** The contract is Integrator-controlled
    (`packages/contracts/**` and `apps/desktop/src-tauri/src/contracts/**`).

### When a contract changes

Changing an existing contract (renaming a field, removing an
optional, adding a required field, splitting an enum) is a breaking
change. The Integrator decides whether to:

- bump the foundation version (during `0.x`, allowed in a minor),
- add a parallel contract and deprecate the old one,
- or hold the change for `1.0.0`.

In all cases, the fixture is updated in the same PR, and both sides'
tests must pass.
