# Architecture: file handling

This document describes Paperu's non-destructive file-handling
model: how a source file is read, how an output is produced, how it
is validated, how it is moved into place, and how the user is
informed. It also covers path validation, reserved-name handling,
long-path handling, traversal prevention and synced-folder detection.

The relevant code is in `apps/desktop/src-tauri/src/filesystem/`:

- `paths.rs` — `validate_input_path`, `is_in_synced_folder`,
  `path_to_file_path`, the reserved-name and reserved-character
  lists.
- `inspect.rs` — `inspect_file`, `detect_kind`, the curated MIME
  map, the read-only and timestamp helpers.
- `temp.rs` — `TempWorkspace`, `atomic_finalize`, the startup
  cleanup pass.

---

## The non-destructive model

Paperu never modifies a source file in place. Every operation that
produces output follows this pipeline:

```
1. source file (validated, untouched)
        │
        ▼
2. engine writes the output to a temp file under
   TempWorkspace::root() = %TEMP%/paperu/paperu-{uuid}{suffix}
        │
        ▼
3. validate the output (well-formed? not truncated? expected kind?)
        │
        ├── on failure → return processing.output_validation_failed,
        │                  temp file is left for startup cleanup
        │
        ▼
4. atomic_finalize(temp, dest, overwrite)
        │
        ├── dest exists and overwrite=false → refuse with
        │   filesystem.already_exists
        │
        ├── same-filesystem rename → atomic, success
        │
        └── cross-volume rename fails:
              ├── overwrite=true → fall back to copy + delete
              └── overwrite=false → return the rename error
        │
        ▼
5. report success (with real output metadata)
```

Invariants:

1. **The source is never opened for writing.** The inspect path
   uses `std::fs::metadata` only; it does not even open the file.
   Future engines that *read* the source will open it read-only.
2. **Outputs land in a temp file first.** A partial output never
   appears in the user's chosen destination.
3. **Finalization is atomic when possible.** `std::fs::rename` is
   atomic on the same filesystem. Cross-volume rename failure falls
   back to copy+delete **only** when the caller has explicitly
   opted in via `overwrite: true`.
4. **Clobbering is opt-in.** `atomic_finalize` refuses an existing
   destination unless `overwrite=true`. The default
   `ConflictStrategy::Rename` produces a unique output name rather
   than overwriting.
5. **Crash recovery is built in.** On startup,
   `TempWorkspace::startup_cleanup` removes stale partial outputs
   left by a previous crash. They live only under
   `%TEMP%/paperu`, never in the user's chosen output directory.

See `docs/architecture/crash-recovery.md` for the recovery design.

---

## Path validation

`filesystem::paths::validate_input_path` is the single canonical
entry point for a user-supplied path. It enforces:

### Non-empty

An empty or whitespace-only path is rejected with
`validation.empty_input`:

```rust
let trimmed = raw.trim();
if trimmed.is_empty() {
    return Err(AppError::builder(
        code::EMPTY_INPUT, ErrorCategory::Validation,
        "Paperu needs a file path to work with.",
    )...build());
}
```

### Absolute

Relative paths are rejected with `filesystem.path_invalid`. The
frontend may not assume the path is trusted; the Rust layer
re-validates it. The error includes a user-facing `detail`:

> Choose a file using the open button or drag a file in.

### Windows reserved names (checked on every platform)

The list `WINDOWS_RESERVED_NAMES` includes `CON`, `PRN`, `AUX`,
`NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`. The check examines the final
component's stem (the part before the first dot):

```rust
if WINDOWS_RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
    return Err(...code::RESERVED_NAME...);
}
```

This runs on every platform — including Linux CI — so behaviour is
consistent and the same validation runs in tests. Without this, a
Linux developer could not catch a reserved-name bug that a Windows
user would hit.

### Windows reserved characters

The list `WINDOWS_RESERVED_CHARS` includes `<`, `>`, `:`, `"`, `/`,
`\`, `|`, `?`, `*`. If any appear in the final component name, the
path is rejected with `filesystem.path_invalid`.

### Canonicalization

The function then attempts `std::fs::canonicalize`. When the file
exists, this returns the canonical absolute path (resolves symlinks,
`..`, `.`). When the file does not exist (`NotFound`), the
function falls back to the lexical absolute form so the inspect path
can still report `exists: false` rather than failing. Other IO
errors propagate as a structured `AppError`.

### Traversal prevention

Because `canonicalize` resolves `..` and `.`, a path that escapes
after canonicalization is detected by comparing the canonicalized
form against the intended base. For the foundation, the inspect path
does not have a base scope — it operates on any absolute path the
user chooses — but the validation infrastructure is in place for
future scoped operations (e.g. "operate only under this folder").

### Long-path handling

On Windows, very long paths are addressed via the extended-length
prefix (`\\?\`) when applied internally. The public `FilePath`
string is the native form returned by `path_to_file_path`. The
`PATH_TOO_LONG` error code exists in the catalogue; a future
hardening pass will surface it for paths that exceed the Windows
`MAX_PATH` limit when the prefix cannot be applied.

---

## Reserved-name and reserved-character lists

```rust
pub const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub const WINDOWS_RESERVED_CHARS: &[char] = &[
    '<', '>', ':', '"', '/', '\\', '|', '?', '*',
];
```

These are checked for the final path component, regardless of the
host OS. This is intentional: behaviour in CI (Linux) must match
behaviour in production (Windows) so a bug caught on one platform
does not slip on the other.

---

## Inspect (the first real operation)

`filesystem::inspect::inspect_file(path: &FilePath) ->
Result<InspectFileResponse>` is the first real operation. It:

1. Validates the path via `validate_input_path`.
2. Calls `std::fs::metadata(&resolved)`.
   - On `NotFound`, returns `filesystem.file_not_found` with a
     user-facing detail ("The path no longer exists...") and an
     engineer-facing `technical` ("std::fs::metadata returned
     NotFound for ...").
3. Asserts the path is a file (not a directory). Directories are
   rejected with `validation.invalid_input`.
4. Extracts the file name, stem, lowercased extension.
5. Detects the coarse `FileKind` via `detect_kind(extension)`.
6. Guesses the MIME type via the curated map (no external
   `mime_guess` crate to keep deps lean).
7. Builds a `ByteSize` with the exact byte count and the
   human-readable form (binary units, displayed with `KB`/`MB`
   suffixes, one decimal of precision).
8. Reads `modified`, `created`, `accessed` timestamps (each is
   optional; not all platforms expose all three).
9. Computes `read_only` (Unix: owner write bit; Windows:
   `permissions().readonly()`).
10. Checks `is_in_synced_folder` for UX awareness (OneDrive).
11. Returns `InspectFileResponse { ..., exists: true }`.

No file *content* is read. The source file is never opened for
writing. The inspect path is the proof that the pipeline works
end-to-end against a real file on disk.

---

## Synced-folder detection

`is_in_synced_folder(path)` returns `true` when the path contains
`onedrive` (case-insensitive). This is a **UX hint**, not a security
control. It only causes the UI to display "Yes (OneDrive)" in the
inspect result card. It never causes an upload or a network call.

Future extensions may add additional synced-folder providers
(iCloud, Google Drive, Dropbox) by extending the heuristic.

---

## Atomic finalization

`filesystem::temp::atomic_finalize(temp, dest, overwrite)` is the
single canonical way to move a temp output into its final
destination:

```rust
pub fn atomic_finalize(temp: &Path, dest: &Path, overwrite: bool) -> Result<()> {
    if dest.exists() && !overwrite {
        return Err(/* filesystem.already_exists */);
    }
    match fs::rename(temp, dest) {
        Ok(()) => Ok(()),
        Err(_err) if overwrite => {
            // Cross-volume fallback for explicit overwrite only.
            fs::copy(temp, dest).map_err(AppError::from)?;
            let _ = fs::remove_file(temp);
            Ok(())
        }
        Err(err) => Err(AppError::from(err)),
    }
}
```

Why this design:

- `fs::rename` is atomic on the same filesystem. A crash mid-rename
  leaves either the temp file (operation failed) or the destination
  (operation succeeded) — never both, never neither.
- Cross-volume renames fail on Windows. The fallback to `copy +
  delete` is **only** taken when the caller has explicitly opted in
  via `overwrite: true`. The default non-destructive path never
  takes the destructive fallback; if the rename fails, the temp
  file is left for the startup cleanup pass and the user sees a
  structured error.
- The `dest.exists()` check is best-effort: there is a TOCTOU window
  between the check and the rename. For the foundation, this is
  acceptable because the only writer to a destination is Paperu
  itself. A future hardening pass may use platform-specific atomic
  replace (e.g. `ReplaceFile` on Windows) when overwrite is
  requested.

### Conflict strategy

The `ConflictStrategy` enum (defined in `packages/contracts/src/operations.ts`
and mirrored in Rust) governs how a name collision is resolved at
the engine layer (before `atomic_finalize` is called):

- `Fail` — return `filesystem.already_exists` immediately.
- `Rename` — append a numeric suffix to the output name
  (`report (1).pdf`, `report (2).pdf`).
- `Overwrite` — call `atomic_finalize(temp, dest, overwrite=true)`.

The default (`Settings.defaultConflictStrategy = "rename"`) is the
non-destructive choice. Overwrite is the explicit opt-in.

---

## Temp workspace

`TempWorkspace::ensure()` creates `%TEMP%/paperu` if missing and
returns a handle. `new_file(suffix)` allocates a unique temp file
path named `paperu-{uuid}{suffix}` (UUID v4). `purge()` removes
the entire workspace (used by tests). `startup_cleanup()` is
called by the Tauri `setup` hook on every launch.

See `docs/architecture/crash-recovery.md` for the recovery design.

---

## What the foundation does not yet do

- The engines module is empty (`ENGINES_AVAILABLE = false`). No
  operation that produces an output is implemented yet; only the
  inspect (read-only) operation exists.
- Conflict resolution (`Rename` suffix computation) is defined in
  the contract but not yet implemented; engines will provide it.
- Output validation is a documented invariant; engines must
  implement it per-operation (e.g. a PDF engine must verify the
  output is a valid PDF before finalization).

See `docs/architecture/engines.md` for the integration plan.
