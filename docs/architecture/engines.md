# Architecture: engines

This document describes the `engines/` Rust module: what it is, what
lives behind it, how engines are wired into the task runner, and why
the foundation ships with `ENGINES_AVAILABLE = false`.

The relevant code is `apps/desktop/src-tauri/src/engines/mod.rs`. It
is intentionally a placeholder today.

---

## What the engines module is

The engines module is the **boundary** where future file-processing
engines (PDF compress, image resize, metadata removal, signing,
etc.) live. An engine:

- Speaks the typed operation contract (request and result shapes
  defined in `packages/contracts/src/operations.ts`).
- Is wired into the task runner (`src/tasks/`) so it runs
  asynchronously with real progress and cancellation.
- Reads the source file (read-only).
- Writes the output to a temp file under `TempWorkspace`.
- Validates the output before finalization.
- Atomically finalizes via `atomic_finalize`.
- Reports real metrics (bytes saved, duration, items processed) —
  never fabricated.

Engines are the only place where file *contents* are read (other
than the read-only metadata in the inspect path). They live behind
a module boundary so that the IPC layer, the contracts and the task
model do not need to change when an engine is added.

---

## Current state

```rust
//! Processing engines (placeholder).

/// Marker: engines are not yet implemented. Any operation that would
/// require an engine must return `internal.not_implemented` rather
/// than pretending to succeed.
pub const ENGINES_AVAILABLE: bool = false;
```

The foundation ships with the boundary in place but no engines
implemented. The first real vertical proof — Local File Inspect —
does not require an engine (it reads only metadata via
`std::fs::metadata`, no file content).

The contract catalogue in `packages/contracts/src/operations.ts`
defines the request shapes for future engines:

- `PdfCompressRequest` — `kind: "pdf.compress"`, `source`,
  `profile: "light" | "balanced" | "strong"`.
- `PdfCompressToTargetSizeRequest` — `kind:
  "pdf.compress_target_size"`, `source`, `targetBytes`.
- `PdfMergeRequest` — `kind: "pdf.merge"`, `sources[]`,
  `outputName?`.
- `PdfSplitRequest` — `kind: "pdf.split"`, `source`,
  `ranges[]`.
- `ImageResizeRequest` — `kind: "image.resize"`, `source`,
  `width`, `height`, `keepAspectRatio`.
- `MetadataRemoveRequest` — `kind: "metadata.remove"`, `source`,
  `scopes[]: "exif" | "gps" | "document"`.

The corresponding `OperationKind` variants are mirrored in Rust in
`src/contracts/tasks.rs`. The shapes are stable; the engines are
not.

---

## How an engine is wired in (the future plan)

When the first engine is implemented (e.g. `pdf.compress`), the
integration follows this sequence:

### 1. The contract is already defined

The `OperationKind::PdfCompress` variant, the `PdfCompressRequest`
struct, and the `OperationResult` shape already exist in the
contracts. No contract change is required for the first engine —
the catalogue was designed upfront.

If a new operation kind is needed (e.g. `pdf.watermark`), follow the
"Adding a new operation" steps in `docs/architecture/contracts.md`.

### 2. Add the engine module

Create `src/engines/pdf_compress.rs` (or a sub-module structure
for a family of engines). The engine exposes a function like:

```rust
pub async fn run(
    request: PdfCompressRequest,
    cancel: CancellationToken,
    progress: impl ProgressSink,
    temp: &TempWorkspace,
) -> Result<OperationResult>;
```

Where `ProgressSink` is a small trait the task runner implements to
forward `report_progress` calls. The engine:

1. Validates the source path (via `validate_input_path`).
2. Resolves the conflict strategy and computes the output path.
3. Opens the source read-only.
4. Streams the source through the compression library, writing to
   `temp.new_file(".pdf")`.
5. Reports progress at meaningful boundaries (per page, per
   chunk).
6. Checks `cancel.is_cancelled()` at each boundary; on
   cancellation, cleans up the temp file and returns
   `cancellation.task_cancelled`.
7. Validates the output (opens the temp PDF, checks it is
   well-formed). On failure, returns
   `processing.output_validation_failed`.
8. Calls `atomic_finalize(temp, dest, overwrite)`.
9. Returns `OperationResult { kind, outputs, metrics }` with real
   metrics (bytes saved, duration, items processed).

### 3. Wire into the task runner

Extend the task runner (or add a small dispatcher in
`src/engines/mod.rs`) so that a request with `kind:
PdfCompress` is dispatched to `pdf_compress::run`. The dispatcher
matches on `OperationKind` and forwards to the right engine.

The task runner:

1. Calls `TaskRegistry::register(kind, label, source_files,
   correlation_id)` to obtain a `TaskId` and a
   `CancellationToken`.
2. Spawns the engine on a Tokio task.
3. The engine reports progress via the `ProgressSink`, which calls
   `TaskRegistry::report_progress`.
4. On completion, the engine returns `OperationResult`; the task
   runner calls `TaskRegistry::finish(id, TaskStatus::Completed)`.
5. On error, the task runner calls
   `TaskRegistry::finish(id, TaskStatus::Failed)` with the
   `AppError`.
6. The task runner emits the `paperu://task/progress` and
   `paperu://task/finished` events (reserved in the contracts;
   not yet emitted by the foundation).

### 4. Add the command

Add a `#[tauri::command]` function in `src/commands/` that takes
the typed request, calls the task runner, and returns the `TaskId`
(or the immediate result for short operations). Register the
command in `paperu::run`'s `invoke_handler!` macro.

### 5. Add the IPC client method

Extend `apps/desktop/src/lib/ipc.ts` with a typed wrapper that
calls `invoke(CommandName.PdfCompress, ...)`.

### 6. Add the UI

Add a feature module under `apps/desktop/src/features/pdf_compress/`
with the file picker, the progress UI, the result card.

### 7. Guardian verifies

The Guardian adds regression tests for the new engine:

- A test that the engine produces a valid output on a synthetic
  source.
- A test that the engine respects cancellation.
- A test that the engine refuses an existing destination without
  `overwrite=true`.
- A test that the engine reports real progress (not fabricated).
- A test that the source file is unchanged after the operation
  (byte-for-byte comparison).

### 8. Flip `ENGINES_AVAILABLE` to `true` (when the first engine
lands)

The marker exists so that the rest of the codebase can guard
engine-dependent behaviour. When the first real engine is
implemented, the Integrator flips the constant and removes the
placeholder notice.

---

## What engines must never do

- **Never read or write outside the validated paths.** The source
  is read-only; the output goes to `TempWorkspace` and is
  finalized via `atomic_finalize`.
- **Never fabricate progress.** Progress is real (bytes processed /
  total bytes) or `null` (indeterminate). Never a fake
  percentage.
- **Never block the UI thread.** Engines run on Tokio tasks; the
  command returns immediately with a `TaskId`.
- **Never ignore cancellation.** Each engine must check
  `cancel.is_cancelled()` at meaningful boundaries and clean up
  on cancellation.
- **Never call the network.** Engines are local-first. A network
  call would violate `REMOTE_UPLOAD_PERMITTED = false` and
  requires an approved ADR.
- **Never log file contents.** Logs may include paths (trimmed)
  and metrics (bytes processed, items count), never file contents
  or secrets.
- **Never trust the frontend's path.** Re-validate via
  `validate_input_path` server-side.

---

## What engines may do

- **Read the source file** (read-only).
- **Spawn helper processes** (e.g. a CLI tool wrapped via
  `std::process::Command`) — but only if the helper is bundled
  with the app and runs locally. Bundling a helper requires
  Integrator approval (it adds to the dependency surface).
- **Use third-party crates** for the actual work (e.g. a PDF
  library). The crate must be permissively licensed (see
  `DEPENDENCIES.md`).
- **Report metrics** that are real and measured, not estimated.

---

## Why the foundation ships without engines

The foundation is the infrastructure. Shipping it without engines
lets the team:

1. Verify the contract boundary is correct before committing to
   engine implementations.
2. Verify the task runner, the temp workspace, the atomic
   finalization and the crash-recovery design end-to-end against
   the Local File Inspect proof.
3. Decide engine dependencies (which PDF library, which image
   library, which metadata-removal approach) per-engine, with each
   choice recorded as an ADR.
4. Keep the foundation release small and auditable.

The first engine implementation will be the first real test of the
contract boundary. If the boundary needs revision, the Integrator
records the change as an ADR and updates the contracts in the same
PR.
