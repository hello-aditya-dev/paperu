# Feature: Local File Inspect

- **Status:** Implemented (foundation)
- **Vertical proof:** yes — this is the first end-to-end real
  capability of the Paperu stack.
- **Code:** `apps/desktop/src/features/inspect/`,
  `apps/desktop/src-tauri/src/commands/inspect.rs`,
  `apps/desktop/src-tauri/src/filesystem/inspect.rs`,
  `packages/contracts/src/inspect.ts`,
  `apps/desktop/src-tauri/src/contracts/inspect.rs`
- **Contract fixture:**
  `packages/test-fixtures/src/contracts/inspect-file-response.json`

## What it is

Local File Inspect is the first real vertical proof of the Paperu
architecture. The user drops a file onto the window (or picks one
with the native file dialog). Paperu resolves the path through the
typed IPC client, hands it to a Tauri command, which calls into the
Rust filesystem layer, which reads real filesystem metadata and
returns it. The UI renders the result. The source file is never
modified. Zero bytes are uploaded.

This is the proof that the pipeline works end-to-end:

```
React 19 (InspectView)
   |
   v
Typed IPC client (apps/desktop/src/lib/ipc.ts)
   |  imports InspectFileResponse, CommandName.InspectFile
   |  from @paperu/contracts
   v
Tauri 2 invoke (CommandName.InspectFile = "inspect_file")
   |
   v
#[tauri::command] inspect_file(request: InspectFileRequest)
   |  in apps/desktop/src-tauri/src/commands/inspect.rs
   v
filesystem::inspect::inspect_file(path: &FilePath)
   |  in apps/desktop/src-tauri/src/filesystem/inspect.rs
   |  validates the path via validate_input_path
   |  reads std::fs::metadata (no content read)
   |  detects FileKind from the extension
   |  builds a ByteSize (exact bytes + human-readable)
   |  reads modified/created/accessed timestamps
   |  checks read-only and synced-folder hints
   v
InspectFileResponse
   |
   v
InspectResultCard renders the structured result
```

## User-visible behaviour

1. The Home route renders `InspectView`.
2. `InspectView` shows a drop zone ("Drop a file to inspect it") and a
   "Choose a file" button.
3. The user can either:
   - drag a file onto the window (Tauri emits
     `tauri://drag-drop` with the dropped file paths); or
   - click "Choose a file" to open the native file dialog
     (`tauri-plugin-dialog` `open()`).
4. Only the *path* is passed to Rust. No file content crosses the
   boundary.
5. While the inspect is in flight, the UI shows a "Reading {path}…"
   card.
6. On success, `InspectResultCard` renders:
   - file kind label (eg "PDF document")
   - file name (with the path as a tooltip)
   - exact byte size + human-readable size (eg "1.0 MB
     (1,048,576 bytes)")
   - extension (eg ".pdf") and MIME type (eg "application/pdf")
   - the canonical absolute path
   - modified, created, accessed timestamps (each optional; not all
     platforms expose all three)
   - read-only flag (Yes/No)
   - synced-folder flag (Yes (OneDrive) / No)
7. On failure, `ErrorCard` renders the structured `AppError` —
   `message` (user-facing), `detail` (longer explanation), and a
   retry hint.
8. A privacy footer at the bottom of `InspectView` repeats the
   promise: "Processed on this PC. 0 bytes uploaded."

## What the Rust layer does

`filesystem::inspect::inspect_file(path: &FilePath) ->
Result<InspectFileResponse>` is the implementation. It:

1. **Validates the path** via `filesystem::paths::validate_input_path`.
   This enforces non-empty, absolute, Windows-reserved-name and
   Windows-reserved-character checks on every platform (so Linux CI
   catches Windows-only bugs). The path is canonicalized; symlinks,
   `..`, `.` are resolved. When the file does not exist
   (`NotFound`), the canonical form falls back to the lexical
   absolute so the inspect can still report `exists: false` rather
   than failing.
2. **Calls `std::fs::metadata(&resolved)`.**
   - On `NotFound`, returns `filesystem.file_not_found` with a
     user-facing detail ("The path no longer exists. It may have
     been moved or deleted.") and an engineer-facing `technical`
     ("std::fs::metadata returned NotFound for ...").
   - On other IO errors, propagates a structured `AppError` via the
     `From<std::io::Error>` conversion.
3. **Asserts the path is a file** (not a directory). Directories are
   rejected with `validation.invalid_input` and the user-facing
   detail "Paperu works with files. Choose a file rather than a
   folder."
4. **Extracts file name, stem, lowercased extension.**
5. **Detects the coarse `FileKind`** via `detect_kind(extension)`.
   The map covers `pdf`, common image formats, archives, text,
   spreadsheets, documents, audio, video, executables, and signature
   files. Unknown extensions fall back to `FileKind::Other`.
6. **Guesses the MIME type** via a small curated map. No external
   `mime_guess` crate is pulled in (keeps deps lean — see ADR
   `0008-dependency-policy.md`).
7. **Builds a `ByteSize`** with the exact byte count
   (`meta.len()`) and the human-readable form. The human form uses
   binary units (`KB`/`MB`/`GB`) with one decimal of precision
   (eg `1.0 MB`). The Rust and TypeScript formatters agree on this
   — the contract fixture asserts the canonical
   `inspect-file-response.json` produces `"1.0 MB"` for
   `1_048_576` bytes.
8. **Reads `modified`, `created`, `accessed` timestamps** (each is
   optional; not all platforms expose all three). Each is converted
   to an ISO-8601 UTC string with second precision.
9. **Computes `read_only`** — Unix: owner write bit; Windows:
   `permissions().readonly()`. The `#[cfg(unix)]` / `#[cfg(not(unix))]`
   split means the same code runs correctly on both, and CI on
   Linux verifies the Unix branch.
10. **Checks `is_in_synced_folder`** — returns `true` when the path
    contains `onedrive` (case-insensitive). This is a UX hint, not a
    security control. It only causes the UI to display "Yes
    (OneDrive)" in the inspect result card. It never causes an
    upload or a network call.
11. **Returns `InspectFileResponse { ..., exists: true }`.**

No file *content* is read. The source file is never opened for
writing. The inspect path is the proof that the pipeline works
end-to-end against a real file on disk.

## The contract

`packages/contracts/src/inspect.ts` defines:

- `InspectFileRequest` — `{ readonly path: FilePath }`.
- `InspectFileResponse` — `{ path, fileName, fileStem?, extension?,
  kind, mimeType?, size, modifiedAt?, createdAt?, accessedAt?,
  readOnly, inSyncedFolder, exists }`.
- `InspectFileCommand = "inspect_file"` (the string passed to
  `invoke()`).
- `InspectFileArgs` — `{ readonly request: InspectFileRequest }`.

The Rust mirror lives in
`apps/desktop/src-tauri/src/contracts/inspect.rs`. The mirroring
rules (camelCase fields, lowercase enum variants, identical JSON
shape) are described in ADR `0005-typed-ipc-contracts.md`.

The canonical JSON fixture
`packages/test-fixtures/src/contracts/inspect-file-response.json`
is the reference both sides must agree on:

```json
{
  "$schema": "paperu-contract:inspect-file-response",
  "$comment": "Canonical JSON shape for InspectFileResponse...",
  "path": "/home/paperu/fixtures/report.pdf",
  "fileName": "report.pdf",
  "fileStem": "report",
  "extension": "pdf",
  "kind": "pdf",
  "mimeType": "application/pdf",
  "size": { "bytes": 1048576, "humanReadable": "1.0 MB" },
  "modifiedAt": "2026-01-15T09:30:00Z",
  "createdAt": "2026-01-10T14:00:00Z",
  "accessedAt": "2026-01-15T09:30:00Z",
  "readOnly": false,
  "inSyncedFolder": false,
  "exists": true
}
```

Both the TypeScript contract test
(`apps/desktop/src/lib/__tests__/contracts.test.ts`) and the Rust
serialization tests assert this fixture parses correctly.

## The command

`apps/desktop/src-tauri/src/commands/inspect.rs`:

```rust
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn inspect_file(request: InspectFileRequest) -> Result<InspectFileResponse> {
    let path: FilePath = request.path;
    filesystem::inspect::inspect_file(&path)
}
```

The `#[cfg_attr(feature = "tauri-runtime", tauri::command)]`
attribute means the same Rust source is both a plain testable
function (no Tauri) and a Tauri command (with the feature). The
command is registered in `paperu::run`'s `invoke_handler!` macro in
`src/lib.rs`.

## The typed IPC client

`apps/desktop/src/lib/ipc.ts::inspectFile`:

```ts
export async function inspectFile(path: string): Promise<InspectFileResponse> {
  const args: Record<string, unknown> = { request: { path } };
  return call<InspectFileResponse>(CommandName.InspectFile, args);
}
```

The `call` helper:

- checks the mock registry first (test-only);
- imports `invoke` from `@tauri-apps/api/core` lazily, so the module
  loads in a jsdom test environment without Tauri present;
- if no Tauri and no mock, throws a structured `internal.not_implemented`
  `AppError`;
- converts rejections to `AppError` via the `toAppError` normalizer
  (the UI never sees raw text).

## The UI

`apps/desktop/src/features/inspect/`:

- `InspectView.tsx` — the route component. Manages an
  `idle | loading | success | error` state machine. Renders the
  drop zone, the status card, the result card, or the error card.
- `FileDropZone.tsx` — accessible drag/drop + file-picker entry
  point. Listens to Tauri's `tauri://drag-drop` event for native
  drops; falls back to the HTML `onDrop` handler if a path is
  exposed. The "Choose a file" button opens the native dialog via
  `tauri-plugin-dialog` `open()`.
- `InspectResultCard.tsx` — renders the structured
  `InspectFileResponse`. Uses `kindLabel` and `formatTimestamp`
  from `lib/format.ts`. Shows the privacy note "Source file
  untouched. Paperu only read metadata."
- `ErrorCard.tsx` — renders a structured `AppError`. Shows
  `message` (user-facing), `detail` (longer explanation), `code`
  (for support reference), and a retry hint when `recoverability`
  is `retryable` or `action_required`.

## Privacy invariants

This feature is the proof of the local-first promise. Specifically:

- **No file content is read.** The inspect path uses
  `std::fs::metadata` only; it does not even open the file.
- **The source file is never modified.** No write happens anywhere
  in the inspect pipeline.
- **No network call.** No HTTP client in the dependency graph (ADR
  `0002-local-first-processing.md`); no network capability in the
  Tauri capability file; CSP restricts `connect-src` to `'self'
  ipc: http://ipc.localhost`.
- **The path crosses the boundary, not the bytes.** The frontend
  sends only an absolute path; Rust returns only metadata. The
  file's contents never enter the IPC channel.
- **Logs do not contain file contents.** The structured tracing
  log may contain paths (trimmed to 256 characters) for diagnosis,
  but never file contents. See ADR `0002` and ADR
  `0009-no-telemetry.md`.

The privacy footer ("Processed on this PC. 0 bytes uploaded.") is
rendered both in the drop zone hint and at the bottom of
`InspectView`. The wording is deliberate; it is the same wording the
architecture documents use.

## Tests

### Rust unit tests

`src/filesystem/inspect.rs` has tests for `detect_kind` (the curated
extension map). The path validation tests live in
`src/filesystem/paths.rs` and the temp/crash-recovery tests in
`src/filesystem/temp.rs`. These run on every platform because the
core crate compiles without `tauri-runtime`.

### TypeScript contract tests

`apps/desktop/src/lib/__tests__/contracts.test.ts` parses the
canonical `inspect-file-response.json` fixture and asserts the typed
`InspectFileResponse` accepts it. The Rust serialization test
asserts the Rust struct serializes to the same JSON.

### Component tests

`apps/desktop/src/features/inspect/__tests__/InspectView.test.tsx`
renders `InspectView` with the IPC mock registry, drops a synthetic
path, and asserts the result card renders the expected fields. The
mock returns a synthetic `InspectFileResponse` that mirrors the
canonical fixture.

### Smoke test

The smoke test (see `tests/smoke/README.md`) launches the desktop
app on Windows, drops or selects a real file, and asserts the result
card shows the real metadata. This is the end-to-end proof; the
component test is a mocked approximation.

## What this feature does NOT do

- **No file content is read.** Inspect is metadata-only by design.
  A future operation that needs to read content (eg. a PDF
  compressor) will open the source read-only, process it, and write
  to a temp file per the non-destructive pipeline (ADR
  `0006-non-destructive-file-handling.md`).
- **No file is modified.** The source is never opened for writing.
- **No engine runs.** The engines module is empty
  (`ENGINES_AVAILABLE = false`). Inspect is the proof of the
  plumbing; engines will be wired in later (see
  `docs/architecture/engines.md`).
- **No entitlement check.** Inspect is a Free feature; no
  `licensing.feature_not_entitled` is emitted. See ADR
  `0010-commercial-licensing-boundary.md`.

## Why this is the vertical proof

Local File Inspect is the smallest operation that exercises every
layer of the architecture:

- React rendering and state management.
- The typed IPC client and the contracts package.
- The Tauri `invoke` boundary and the capability file.
- The `#[tauri::command]` and the `Result<T, AppError>` return
  convention.
- The Rust filesystem layer, including path validation and
  canonicalization.
- The structured `AppError` model on failure paths.
- The contract test fixture discipline on both sides.
- The local-first, non-destructive invariants.

If the inspect path works end-to-end on a real file on a Windows
machine, the foundation is sound. Every future engine reuses the
same pipeline; the only addition is a temp output, validation, and
`atomic_finalize` (ADR `0006`).

## References

- `apps/desktop/src/features/inspect/InspectView.tsx`
- `apps/desktop/src/features/inspect/FileDropZone.tsx`
- `apps/desktop/src/features/inspect/InspectResultCard.tsx`
- `apps/desktop/src/features/inspect/ErrorCard.tsx`
- `apps/desktop/src/lib/ipc.ts` — `inspectFile`.
- `apps/desktop/src-tauri/src/commands/inspect.rs` — the command.
- `apps/desktop/src-tauri/src/filesystem/inspect.rs` — the
  implementation.
- `apps/desktop/src-tauri/src/filesystem/paths.rs` —
  `validate_input_path`.
- `packages/contracts/src/inspect.ts` — the contract.
- `packages/test-fixtures/src/contracts/inspect-file-response.json`
  — the canonical fixture.
- `docs/decisions/0002-local-first-processing.md` — the privacy
  invariants this feature proves.
- `docs/decisions/0006-non-destructive-file-handling.md` — the
  pipeline this feature is a read-only instance of.
- `tests/smoke/README.md` — the end-to-end smoke test.
