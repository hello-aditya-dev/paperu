# ADR 0006: Non-destructive file handling

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/src/filesystem/**`,
  `apps/desktop/src-tauri/src/engines/**` (future),
  `apps/desktop/src-tauri/src/commands/**`

## Context

Paperu is a file workspace. Users hand it real documents and ask it
to compress, convert, merge, watermark, or otherwise process them.
The two failure modes that destroy user trust faster than any other
are:

1. **The source file is corrupted or destroyed.** A partial write,
   a truncated output, a rename that overwrote the wrong file, a
   crash mid-operation.
2. **A partial output appears in the user's chosen location.** The
   user sees a half-written file in their folder, believes the
   operation succeeded, and ships it to a customer.

The standard fix for both is the **non-destructive pipeline**: write
to a temp file, validate it, atomically move it into place, refuse
to clobber an existing destination unless the user explicitly opted
in. This is the discipline Paperu adopts.

## Decision

Source files are **never modified**. Every operation that produces
output follows the non-destructive pipeline:

```
source file (validated, untouched)
   |
   v
engine writes the output to a temp file under
TempWorkspace::root() = %TEMP%/paperu/paperu-{uuid}{suffix}
   |
   v
validate the output (well-formed? not truncated? expected kind?)
   |
   +-- on failure -> return processing.output_validation_failed,
   |                  temp file is left for startup cleanup
   |
   v
atomic_finalize(temp, dest, overwrite)
   |
   +-- dest exists and overwrite=false -> refuse with
   |   filesystem.already_exists
   |
   +-- same-filesystem rename -> atomic, success
   |
   +-- cross-volume rename fails:
         +-- overwrite=true -> fall back to copy + delete
         +-- overwrite=false -> return the rename error
   |
   v
report success (with real output metadata)
```

### Invariants

1. **The source is never opened for writing.** The inspect path
   uses `std::fs::metadata` only; it does not even open the file.
   Future engines that *read* the source will open it read-only.
2. **Outputs land in a temp file first.** A partial output never
   appears in the user's chosen destination.
3. **Finalization is atomic when possible.** `std::fs::rename` is
   atomic on the same filesystem. Cross-volume rename failure falls
   back to `copy + delete` **only** when the caller has explicitly
   opted in via `overwrite: true`.
4. **Clobbering is opt-in.** `atomic_finalize` refuses an existing
   destination unless `overwrite=true`. The default
   `ConflictStrategy::Rename` produces a unique output name rather
   than overwriting.
5. **Crash recovery is built in.** On startup,
   `TempWorkspace::startup_cleanup` removes stale partial outputs
   left by a previous crash. They live only under `%TEMP%/paperu`,
   never in the user's chosen output directory.

### `TempWorkspace`

`filesystem::temp::TempWorkspace` manages the temp workspace:

- `ensure()` creates `%TEMP%/paperu` if missing and returns a
  handle.
- `new_file(suffix)` allocates a unique temp file path named
  `paperu-{uuid}{suffix}` (UUID v4).
- `purge()` removes the entire workspace (used by tests).
- `startup_cleanup()` is called by the Tauri `setup` hook on every
  launch. It iterates the workspace and removes every entry, logging
  how many were cleaned. NotFound errors are swallowed; other errors
  are logged but do not abort startup.

### `atomic_finalize`

`filesystem::temp::atomic_finalize(temp, dest, overwrite)` is the
single canonical way to move a temp output into its final destination:

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
  takes the destructive fallback; if the rename fails, the temp file
  is left for the startup cleanup pass and the user sees a
  structured error.
- The `dest.exists()` check is best-effort: there is a TOCTOU window
  between the check and the rename. For the foundation, this is
  acceptable because the only writer to a destination is Paperu
  itself. A future hardening pass may use platform-specific atomic
  replace (e.g. `ReplaceFile` on Windows) when overwrite is
  requested.

### Conflict strategy

The `ConflictStrategy` enum (defined in
`packages/contracts/src/operations.ts` and mirrored in Rust)
governs how a name collision is resolved at the engine layer (before
`atomic_finalize` is called):

- `Fail` — return `filesystem.already_exists` immediately.
- `Rename` — append a numeric suffix to the output name
  (`report (1).pdf`, `report (2).pdf`).
- `Overwrite` — call `atomic_finalize(temp, dest, overwrite=true)`.

The default (`Settings.defaultConflictStrategy = "rename"`) is the
non-destructive choice. Overwrite is the explicit opt-in.

### Path validation

`filesystem::paths::validate_input_path` is the single canonical
entry point for a user-supplied path. It enforces:

- **Non-empty.** Empty or whitespace-only is rejected with
  `validation.empty_input`.
- **Absolute.** Relative paths are rejected with
  `filesystem.path_invalid`.
- **Windows reserved names** (checked on every platform):
  `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`.
  This runs on Linux CI too, so the same validation catches Windows
  bugs in CI.
- **Windows reserved characters:** `<`, `>`, `:`, `"`, `/`, `\`,
  `|`, `?`, `*`.
- **Canonicalization.** `std::fs::canonicalize` resolves symlinks,
  `..`, `.`. When the file does not exist (`NotFound`), the function
  falls back to the lexical absolute form so the inspect path can
  still report `exists: false`.
- **Traversal prevention.** Because `canonicalize` resolves `..`
  and `.`, a path that escapes after canonicalization is detectable
  by comparing against the intended base. For the foundation, the
  inspect path has no base scope (it operates on any absolute path
  the user chooses), but the validation infrastructure is in place
  for future scoped operations.
- **Long-path handling.** On Windows, very long paths are addressed
  via the extended-length prefix (`\\?\`) when applied internally.
  The `PATH_TOO_LONG` error code exists; a future hardening pass
  will surface it for paths that exceed the Windows `MAX_PATH` limit
  when the prefix cannot be applied.

See `docs/architecture/file-handling.md` for the full validation
rules.

## Consequences

### Positive

- **The source is safe.** A failed operation cannot destroy or
  corrupt the source file because the source is never opened for
  writing.
- **A partial output never appears in the user's folder.** Outputs
  land in the temp workspace first; only a validated, finalized
  output is moved into place.
- **Finalization is atomic when possible.** Same-filesystem rename
  is atomic. A crash mid-rename leaves either the temp file (failed)
  or the destination (succeeded) — never both, never neither.
- **Clobbering is opt-in.** The default `ConflictStrategy::Rename`
  produces a unique name. The user must explicitly choose
  `Overwrite` to clobber.
- **Crash recovery is automatic.** Stale temp files from a previous
  crash are cleaned on the next startup; they never leak into the
  user's chosen output directory.

### Negative

- **More disk I/O.** Every output is written twice (temp, then
  renamed). For large files this is one extra copy on the same
  filesystem. Acceptable: correctness > the cost of one rename.
- **Cross-volume writes need the explicit overwrite opt-in.** If the
  temp workspace and the destination are on different volumes, the
  non-destructive default fails the rename. The engine must either
  allocate the temp file on the destination's volume or the user
  must opt into overwrite (which triggers `copy + delete`). A future
  hardening pass may make the temp allocation volume-aware.
- **TOCTOU on the `dest.exists()` check.** The check is best-effort.
  For the foundation this is acceptable (Paperu is the only writer
  to a destination); a future hardening pass may use
  platform-specific atomic replace.
- **Engines must implement output validation.** The pipeline
  documents the invariant; each engine (e.g. a future PDF engine)
  must verify its output is well-formed before calling
  `atomic_finalize`. The foundation has no engines yet
  (`ENGINES_AVAILABLE = false`).

## Non-goals

- **No versioned file system.** Paperu does not keep history of
  previous outputs. If a user wants versioning, they choose
  `ConflictStrategy::Rename` and manage the resulting files.
- **No encrypted outputs.** Outputs are written as plain files. If
  a future feature needs encrypted outputs, that is a separate ADR.
- **No scoped file operations.** The inspect path operates on any
  absolute path the user chooses. Future scoped operations (e.g.
  "operate only under this folder") will use the traversal-prevention
  infrastructure already in `validate_input_path`.

## References

- `apps/desktop/src-tauri/src/filesystem/paths.rs` —
  `validate_input_path`, reserved-name and reserved-character lists.
- `apps/desktop/src-tauri/src/filesystem/inspect.rs` — the first
  read-only operation.
- `apps/desktop/src-tauri/src/filesystem/temp.rs` — `TempWorkspace`,
  `atomic_finalize`, `startup_cleanup`.
- `apps/desktop/src-tauri/src/lib.rs` — the `setup` hook that calls
  `startup_cleanup`.
- `docs/architecture/file-handling.md` — full file-handling design.
- `docs/architecture/crash-recovery.md` — the startup cleanup pass.
- `docs/decisions/0002-local-first-processing.md` — the local-first
  invariant that this ADR operationalizes.
