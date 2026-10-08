# Paperu — Unfinished Work Checkpoint

This document is the master prompt §XII required checkpoint. It is
updated at every meaningful milestone so the next agent/session can
resume without re-auditing.

## Current state

- **Branch:** `agent/builder`
- **Remote HEAD:** `07aa94d` (pushed)
- **Audited baseline:** `de43c67a8f79ff307f3c374b345bcc68c224daa2`
- **Commits ahead of baseline:** 8 (P1, P2, P0-C/D/E/G, P4, P5-Clipboard, Windows clippy fix)
- **Test counts:**
  - Rust: 211/211 ✅
  - Frontend: 195/195 ✅
  - Migrations: 11 (LATEST_VERSION=11)
- **Lint / typecheck / fmt / clippy:** all clean
- **CI:** Windows Tauri build was failing on `92618a1` (multi-line
  import form mismatch between local + CI rustfmt versions); the
  current HEAD `07aa94d` has the single-line form CI wants. CI run
  for `07aa94d` is in progress.

## Completed in this sprint

| Task | Commit | What shipped |
| --- | --- | --- |
| P1 — file output pipeline | 497a75a | New `filesystem::publish` module: destination-local staging, `hard_link` (no-overwrite, atomic, eliminates check-then-write race), `fs::rename` (overwrite, atomic replace), classified errors (ALREADY_EXISTS / DISK_FULL / PERMISSION_DENIED / IO_FAILURE). Refactored `finalize_output`, `save_file_as`, `copy_and_verify` to use it. 17 new publish tests + 5 new save_as tests. |
| P2 — real Timer Jobs scheduler | ae3db83 | Migration 0011 (timer_job_occurrence + timer_job_history + timer_job.timezone/last_error). `Database` is now `#[derive(Clone)]` via `Arc<Mutex<Connection>>`. New `timer_jobs/clock.rs` (Clock trait + SystemClock + TestClock) + `timer_jobs/scheduler.rs` (tick + spawn). New commands: update_timer_job, get_timer_job_history, trigger_timer_job_now. Wired into lib.rs setup. **End-to-end test proves a due backup timer creates a verified dest file WITHOUT opening /timer; second tick does NOT re-run (exactly-once).** |
| P0-C — PDF Compare | d786456 | Full rewrite: multipage navigation (Prev/Next + page input, sync mode), real per-pixel diff detection (offscreen render + differing-pixel count + percentage, classify identical/minor/major), visual diff overlay (red tint on B), per-page summary list (click to jump), handles different page counts (inserted/deleted flagged), comparison report export (pdf-lib → saveFileAs), Cancel button, encrypted-PDF detection, progress indicator. |
| P0-D — Business Docs | 6c057c3 (subagent) | New `engines/business-docs.ts` with integer-cents arithmetic (no float drift), 10 currencies incl. JPY (0 decimals), per-prefix document numbering (INV-0001), persisted presets + drafts in localStorage, pagination across A4 pages with repeated header, manual word-wrap, per-field invalid-state highlighting (red border), discount field, currency selector. 44 unit tests for the arithmetic. |
| P0-E — Windows Open With | 0cf7368 (subagent) | New `commands/open_with.rs` (non-gated `validate_open_with_path` + gated `consume_open_with_event`). Path validation: rejects empty/relative/`..`-traversal, accepts cross-platform Windows drive + UNC paths. `setup` parses initial-launch CLI args + queues them. Single-instance callback validates + emits. New `lib/open-with.ts` listens for `paperu://open-file` event + stages as WorkingFile + navigates to /reader (PDF) / /image/fit (image) / /inspect (other). App.tsx calls the listener on mount. 10 Rust tests + 17 frontend tests. |
| P0-G — derived ROUTE_PATHS | d786456 | Refactored routes/index.tsx: ROUTE_CONFIG is the single source of truth; `collectPaths()` walks it to build the canonical set. No more hand-maintained duplicate set. The router + ROUTE_PATHS both derive from the same config — adding a route is one place, never two. |
| P4 — analytics hardening | d786456 | Separate `allow_diagnostics` + `allow_product_analytics` consent (both default OFF). `log_event` / `log_event_typed` require product_analytics consent; `log_diagnostics_event` requires diagnostics consent (kept separate). Typed `EventAttribute` enum (OperationKind, Outcome, Surface) with allowlists — no arbitrary free-form strings. 11 new tests prove: no events when both off, no product events when only diagnostics on, typed attribute rejects, etc. |
| P5 — Clipboard History | 07aa94d | New `clipboard_history` Rust module (add/list/pin/delete/clear/purge_old/entry_count). Manual capture via `navigator.clipboard.readText()` (no Tauri plugin needed). 7-day retention (pinned survives), max 100 entries (oldest unpinned purged, deterministic rowid tie-breaker). Startup purge. Real UI: save current clipboard, live search, pin/copy-again/delete per entry, clear-all with confirm. Honest notice: auto-capture is V2. 7 Rust tests. |
| Windows clippy fix | 92618a1 | Removed unused `DispatchResult` import from gated `commands/timer_jobs.rs` (only fails on Windows CI where the gated code compiles). |

## Pending P5 items (priority order)

| ID | Item | Status | Effort | Notes |
| --- | --- | --- | --- | --- |
| P5a | PDF Insert pages (PDF/image/blank) | NOT STARTED | M | lopdf can insert PDF+PDF; pdf-lib for image. Add `insert_pages_pdf` + `insert_blank_pages` to pdf_native + new "insert" mode to PdfPageOpsRoute. |
| P5b | PDF Annotations (highlight/underline/strike/text/draw) | NOT STARTED | L | PDF annotation spec is large. pdf-lib has limited annotation support. Honest V1: text annotations only. |
| P5c | PDF Redaction (irreversible) | NOT STARTED | L | Render page → burn redacted region → rebuild. Complex. Honest V1: mark as EXTERNAL_BLOCKER (needs render engine). |
| P5d | PDF Password protect/unlock (qpdf) | NOT STARTED | M | Requires bundling qpdf binary + Windows CI validation. Honest V1: EXTERNAL_BLOCKER. |
| P5e | Typed Recipe Engine | NOT STARTED | L | New Rust module + IPC + UI. Foundation for Watch→Recipe. |
| P5f | Watch Folders → Recipe execution | NOT STARTED | M | Wire existing watch events to recipes. Depends on P5e. |
| P5g | Clipboard History auto-capture | NOT STARTED | M | Needs tauri-plugin-clipboard-manager + Windows CI validation. |
| P5h | Paperu Send (LAN transfer) | NOT STARTED | L | Needs mini-service HTTP server + opaque IDs + path validation. Complex. |
| P5i | Webpage → PDF (isolated Edge/Chromium) | NOT STARTED | L | Needs isolated browser process. Complex. |
| P5j | FFmpeg utility tools | NOT STARTED | L | Needs bundled FFmpeg binary. |
| P5k | Licensing (signed entitlement) | NOT STARTED | L | Needs signing keys. |
| P5l | Updater (signed metadata) | NOT STARTED | L | Needs signing keys. |

## External blockers (genuine, not engineering gaps)

- **RELEASE-02 (Authenticode signing):** requires a code-signing
  certificate. Release candidate is unsigned.
- **RELEASE-03 (Windows runtime QA):** requires a Windows machine for
  hands-on runtime validation. CI builds + tests are green; manual QA
  on a real Windows box is the remaining step.

## Active blockers / risks

- **CI rustfmt version skew:** local rustfmt may produce a different
  form than CI's. The single-line import form is now committed; future
  edits to gated code should be checked with `cargo fmt --all --
  --check` after every edit (which is already the gate).
- **Commands blind-spot:** `#![cfg(feature = "tauri-runtime")]` files
  are only compiled on Windows CI (`--features tauri-runtime`), not
  locally. Non-gated modules (`src/*/mod.rs`) ARE compiled locally.
  This caused the Windows CI failure on `92618a1` (unused
  `DispatchResult` import) — locally invisible.
- **Paperu Send / Webpage→PDF / FFmpeg / Licensing / Updater:** all
  require either external binaries, signing keys, or runtime
  validation that this sandbox cannot do. They are documented as
  EXTERNAL_BLOCKER, not silently shipped broken.

## Exact next commands

```bash
cd /home/z/paperu
git checkout agent/builder
git pull --ff-only origin agent/builder
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
pnpm install --frozen-lockfile
# Verify gates:
cd apps/desktop/src-tauri && cargo test --lib && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings
cd /home/z/paperu && pnpm run typecheck && pnpm run lint && pnpm run test
# Check Windows CI:
gh run list --branch agent/builder --limit 5 --json databaseId,headSha,status,conclusion
```

## Exact next implementation task

1. Confirm the CI run for `07aa94d` is green (Windows Tauri build
   included). If it fails, fix the specific failure before continuing.
2. P5a — PDF Insert pages: add `insert_pages_pdf(source, target,
   source_pages, insert_after)` + `insert_blank_pages(bytes, count,
   insert_after, width, height)` to `pdf_native/mod.rs`. Add the
   corresponding gated Tauri commands. Add an "insert" mode to
   `PdfPageOpsRoute.tsx` with sub-modes for PDF / image / blank.
3. P5e — Typed Recipe Engine: new `recipes/mod.rs` module with typed
   operation steps (resize, convert, watermark, compress, place).
   New migration for `recipe` + `recipe_step` tables. CRUD commands.
   UI in a new `RecipesRoute.tsx`.
4. P5f — Wire Watch Folders events to dispatch recipes (the watch
   module already emits events; add a `watch_rule` table that maps
   events to recipe IDs).

Continue implementing. Do not stop after another small batch to
announce completion.
