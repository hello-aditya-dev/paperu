# Paperu Integrator Worklog

This is the canonical worklog at `/home/z/my-project/worklog.md` per project conventions.

---
Task ID: 1
Agent: Integrator (Z.ai Code, sandbox environment)
Task: Convert the Next.js sandbox at `/home/z/my-project` to the conditions of the Paperu repo (`https://github.com/hello-aditya-dev/paperu`) so that real Integrator/Guardian gate-runs can be executed locally.

Work Log:
- Probed sandbox capabilities: Debian 13 trixie, x86_64, 2 vCPU / 4 GB RAM / 8 GB free disk, no passwordless sudo, network OK.
- Installed Rust toolchain user-space via rustup (cargo 1.99.0, rustc 1.99.0, rustfmt 1.10.0, clippy 0.1.99). Channel matches `rust-toolchain.toml` pin.
- Installed `pnpm` 12.9.1 user-space (matches `packageManager` field in Paperu `package.json`).
- Installed `gh` CLI 2.44.1 user-space at `~/.local/bin/gh` (NO push credentials configured — `gh auth status` would fail; cannot push to `hello-aditya-dev/paperu`).
- Moved the existing Next.js project aside to `/home/z/my-project.nextjs.bak` (the `upload` mount point could not be moved and stays in place).
- Cloned `https://github.com/hello-aditya-dev/paperu` into `/home/z/my-project`. Fetched all 20 remote branches (`main`, 3 `agent/*`, 16 `feature/*`). No tags.
- Ran `pnpm install --frozen-lockfile` (371 packages, lockfile passes supply-chain policy, 406 entries). No drift.
- Discovered and worked around an external automation in the sandbox that auto-restores `HEAD` to `main` between Bash invocations. Workaround: prefix every gate command with `git checkout agent/builder &&`.
- Ran the full gate set on `main` (HEAD = 9b93afa) and on `agent/builder` (HEAD = 20a67fad). Real results recorded in the report below.
- Inspected the Builder delta (37 commits, 68 files, 10,711 insertions), the ADR set, the security docs, the capability matrix, the module registry, the pdfjs worker loading code, and the production CSP.

Stage Summary:
- Sandbox successfully converted: `/home/z/my-project` IS now the Paperu repo clone with Rust + pnpm + gh installed and ALL non-Tauri-runtime gates executable.
- All gates actually run (not assumed): typecheck, lint, frontend tests, frontend build, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` — all GREEN on both `main` and `agent/builder`.
- **Real test counts**: main = 5 TS + 7 Rust tests; agent/builder = **86 TS + 22 Rust tests** (the prompt's "86 / 22" claim is accurate; an earlier "5 / 7" reading was a sandbox HEAD-revert bug I caught and corrected).
- **Architectural findings confirmed**: (1) ADR 0011 still "Awaiting Integrator approval"; (2) capability matrix falsely marks Merge + Split as "Guardian Verified" while `agent/guardian` is still at foundation; (3) two different canonical threat models exist (`threat-model.md` 351 lines vs `THREAT_MODEL.md` 177 lines) with conflicting content; (4) Save As is NOT implemented (zero matches); (5) production CSP has no `worker-src` directive — pdfjs worker loads as a same-origin URL with a documented main-thread fallback.
- **Hard blockers remaining**: no GitHub push credentials → cannot push `agent/integration` candidate SHA; no Windows runner → cannot trigger/inspect Windows Tauri CI; no `webkit2gtk` system deps (no sudo) → cannot run `cargo build --release` for the Tauri shell. The core crate compiles cleanly without it because `default = []` excludes the `tauri-runtime` feature.

---
Task ID: 2
Agent: Builder (Z.ai Code, sandbox environment — authenticated with PAT)
Task: Paperu Master Prompt 3 — Mature Core UX + Command Center + Shelf + Desktop Lifecycle. Build the interaction foundation that turns Wave-1 tools into one coherent desktop application.

Work Log:
- Authenticated `gh` with the user-supplied PAT (`repo` scope). Configured git credentials via `gh auth setup-git`.
- Worked around the sandbox's HEAD-auto-revert-to-main behaviour by prefixing every git operation with `git checkout agent/builder &&` and committing work to feature branches first, then merging into agent/builder.
- Built and pushed (to origin/agent/builder) the following coherent commits:

  1. `fc6566a refactor(registry): drive nav from module catalogue + Command Center + Shelf foundation`
     - Expanded ModuleEntry with glyph, navOrder, visibleInNav, visibleInCommand, pinnable, usableAsNextAction, contextualPriority.
     - Removed hardcoded NAV array from App.tsx; derive from getNavModules().
     - Fixed keyboard shortcut handler to look up by module.shortcut field (decouples shortcut from nav order).
     - CommandCenter component (Ctrl/⌘+K) with deterministic search, keyboard nav, TOOLS + RECENT FILES sections.
     - Shelf component + ShelfStore (session-scoped, no persistence).

  2. `7de46c1 merge feature/mature-core-ux-styling` — command.css + shelf.css + 11 Command Center tests.

  3. `d8435eb fix(types): remove unused helper/import, fix shelf-store array swap` — typecheck green.

  4. `c31a4ad test(command): fix two assertion invariants` — 100 TS tests pass.

  5. `b40dfda feat(history): add persistent recent work store (migration 0002)` — Rust side:
     - migration 0002_recent_work.sql (recent_work table, indexes, privacy-safe metadata only).
     - contracts/recent_work.rs (RecentWorkEntry + AddRecentWorkRequest, i64 sizes for SQLite).
     - recent_work/mod.rs (add/list/remove/clear + 5 tests: round-trip, ordering, remove, clear, pruning at MAX_ENTRIES=200).
     - commands/recent_work.rs (Tauri wrappers, feature-gated).
     - Database::from_conn constructor for in-memory test databases.

  6. `a2b07c6 feat(history): add HistoryRoute + persistent recent-work frontend` — TS side:
     - packages/contracts/src/recent_work.ts (RecentWorkEntry, AddRecentWorkRequest, RecentWorkCommand).
     - ipc.ts: addRecentWork / listRecentWork / removeRecentWork / clearRecentWork.
     - lib/recent-work.ts: useRecentWork Zustand store mirroring to both persistent SQLite AND in-memory recent-files.
     - routes/HistoryRoute.tsx: Open/Repeat/Remove per entry, Clear-all, graceful fallback when Rust unavailable.
     - routes/index.tsx: registered /history.

  7. `3d57f32 feat(actions): add Smart Action Palette (third core UX pillar)` — ActionPalette.tsx + 10 tests (PDF context, image context, unsupported file, missing selection, keyboard, rapid open/close). Dedupes system Inspect when module registry already provides it.

  8. `bf9cff0 perf(startup): lazy-load heavy feature routes + add History CSS` — React.lazy for 9 feature routes. Initial bundle dropped from ~395 kB gzip to ~114 kB gzip (3.5× improvement). pdf-engine chunk (179 kB gzip) now loads only on PDF routes.

Stage Summary:
- agent/builder advanced from `20a67fad` → `bf9cff0` (8 new commits, all pushed to origin/agent/builder).
- Real gate results on the final state:
  - TypeScript typecheck: ✅ green (5 packages)
  - ESLint: ✅ green (5 packages, --max-warnings 0)
  - TypeScript tests: ✅ **110 tests** pass (was 86; +14 Command Center tests, +10 Action Palette tests; 100 + 10 = 110)
  - Frontend production build: ✅ green, ~114 kB gzip initial JS
  - cargo fmt --check: ✅ green
  - cargo clippy -D warnings: ✅ zero warnings
  - cargo test: ✅ **27 Rust tests** pass (was 22; +5 recent_work: round-trip, most-recent-first, remove-by-id, clear-all, pruning-at-MAX_ENTRIES)
- Features delivered (Master Prompt 3 mapping):
  - §3-4, §16: Registry-driven navigation (no hardcoded NAV) ✓
  - §5-12: Command Center (Ctrl+K, deterministic search, keyboard, tests) ✓
  - §13-16, §24: Smart Action Palette (contextual, registry-derived) ✓
  - §17-23: Paperu Shelf (session-scoped, add/remove/reorder/send-to-module) ✓
  - §28-32: Persistent Recent Work (SQLite migration 0002, HistoryRoute, Open/Repeat/Remove) ✓
  - §67-69: Lazy loading + bundle analysis (3.5× smaller initial bundle) ✓
- Still NOT done (honest):
  - §25-27 Save As (Tauri dialog capability + cross-feature integration)
  - §33-37 Workspaces shell + Simple Mode foundation
  - §48-58 Desktop lifecycle (single instance, open-file argument, window state)
  - §59-62 Shutdown behavior, crash marker
  - §64 Performance instrumentation
  - §109 Final polish pass
- Hard environment blockers unchanged: no webkit2gtk (can't build Tauri shell), no Windows runner (can't trigger Windows CI). All non-Tauri-runtime gates are green.

---
Task ID: 3
Agent: Builder (Z.ai Code, sandbox environment — authenticated with PAT)
Task: Finalize Master Prompt 3 sprint — workspaces shell, docs, final gate run.

Work Log:
- Built WorkspaceShell component (editorial list of a workspace's modules).
- Added PdfWorkspaceRoute (/pdf) and ImagesWorkspaceRoute (/images).
- Reorganized the module registry + nav rail per Master Prompt §38: nav rail reduced from 10 items to 4 (Home / Recent work / PDF / Images). The 8 individual tools moved to visibleInNav: false but kept their Ctrl+1..9 shortcuts (handler looks up by module.shortcut field, not nav position).
- Removed legacy 'history' module entry (route collision with 'recent-work' on /history).
- Added workspace.css with warm-paper editorial card layout, blue glyph accent, focus states.
- Ran the FULL final gate set on agent/builder @ 8d5040c:
  - TS typecheck: ✅ green (5 packages)
  - ESLint: ✅ green (5 packages, --max-warnings 0)
  - TS tests: ✅ 110 tests pass in 9 files
  - cargo fmt --check: ✅ green
  - cargo clippy -D warnings: ✅ zero warnings
  - cargo test: ✅ 27 Rust tests pass
  - Frontend production build: ✅ green, ~115 kB gzip initial JS
- Appended 'BUILDER HANDOFF — Master Prompt 3' section to AGENT_HANDOFF.md (Integrator-owned; clearly labeled as Builder's update for review). Maps every delivered feature to its Master Prompt 3 section. Honest list of what's NOT done.
- Appended 'Master Prompt 3 additions' section to KNOWN_LIMITATIONS.md documenting the 9 new limitations (shelf session-scoped, recent_work metadata-only, lazy-route 1-frame fallback, pdf-engine 179 kB gzip lazy, Save As not implemented, lifecycle stubbed, perf instrumentation absent, action palette not yet global-shortcut-wired, future-module stubs).

Stage Summary:
- agent/builder final state: `8d5040c07de0c0b24cb21be2347799bf5bb032d2` on origin.
- 13 coherent commits past `20a67fad` baseline (all pushed to origin/agent/builder):
  1. fc6566a refactor(registry): drive nav from module catalogue + Command Center + Shelf foundation
  2. 58fca5b merge feature/mature-core-ux-foundation
  3. 631daf7 feat(command): Command Center CSS + 11 deterministic-search tests
  4. 7de46c1 merge feature/mature-core-ux-styling
  5. d8435eb fix(types): remove unused helper/import, fix shelf-store array swap
  6. c31a4ad test(command): fix two assertion invariants + add nav/Command visibility tests
  7. b40dfda feat(history): persistent recent work store (migration 0002) — Rust side
  8. a2b07c6 feat(history): HistoryRoute + persistent recent-work frontend
  9. 3d57f32 feat(actions): Smart Action Palette (third core UX pillar)
  10. bf9cff0 perf(startup): lazy-load heavy feature routes + History CSS
  11. 4bb1025 docs(worklog): record Builder Master Prompt 3 progress
  12. 05c2a52 feat(workspaces): PDF + Images workspace shells, slim nav rail
  13. 8d5040c docs(handoff): record Builder Master Prompt 3 handoff + new limitations
- Final gate counts: 110 TS tests (was 86) + 27 Rust tests (was 22), all green. clippy zero warnings. Initial bundle ~115 kB gzip (was ~395 kB).
- NOT done (honest, documented in AGENT_HANDOFF.md + KNOWN_LIMITATIONS.md): Save As (Tauri dialog), Simple Mode toggle, desktop lifecycle (single instance, open-file arg, window state), shutdown/crash-marker, performance instrumentation, final 20-min manual polish pass.
- Hard blockers unchanged: no webkit2gtk (Tauri shell not buildable), no Windows runner (Windows CI not triggerable). All non-Tauri-runtime gates green.

---
Task ID: 4
Agent: Builder (Z.ai Code, sandbox environment — authenticated with PAT)
Task: Paperu Master Prompt 4 — Windows Consumer V1 Release Candidate. Build the consumer product surface (Assignment Studio, Portal Ready, Application Kit, Study Reader, Notes, Print Studio, Batch Studio, Paperu Send, Onboarding) + the Rust + DB foundation they need.

Work Log:
- Wrote 3 new SQLite migrations (0003 application_kit, 0004 notes, 0005 reading_history). Bumped LATEST_VERSION to 5. All idempotent.
- Wrote 3 new Rust logic modules: application_kit (add/list/update/remove), notes (create/list/get/update/autosave/soft_delete/restore/purge_deleted/create_folder/list_folders/search_notes), reading_history (upsert/get_for_path/list/remove/clear).
- Wrote 3 new Rust contracts: application_kit.rs, notes.rs, reading_history.rs (i64 sizes for SQLite storage, camelCase JSON serialization).
- Wrote 3 new Tauri command wrappers (all feature-gated to tauri-runtime): commands/application_kit.rs, commands/notes.rs, commands/reading_history.rs. 19 new commands total.
- Wrote 3 new TS contracts: application_kit.ts, notes.ts, reading_history.ts.
- Extended ipc.ts with 19 new typed IPC functions.
- Wrote 9 new frontend routes (all lazy-loaded):
  - AssignmentStudioRoute (/assignment) — orchestrates imagesToPdf + mergePdfs
  - PortalReadyRoute (/portal) — uses fitPdfToSize/fitImageToSize + compliance card
  - ApplicationKitRoute (/kit) — list/add/remove kit items
  - StudyReaderRoute (/reader) — pdfjs render + page nav + reading-position persistence
  - NotesRoute (/notes) — list/create/edit/autosave/search/soft-delete
  - PrintStudioRoute (/print) — 1/2/4-up via pdf-lib embedPages
  - BatchStudioRoute (/batch) — serial queue with isolated failures
  - PaperuSendRoute (/send) — FEATURE-FLAGGED OUT (honest "not available")
  - OnboardingRoute (/onboarding) — profile choice + reassurance
- Expanded module registry with 9 new entries. Removed duplicate legacy 'notes'/'assignments' stubs.
- Honest feature-flagging per §92: paperu-send and onboarding are available: false (hidden from Command + Nav). Paperu Send needs Tauri runtime + ephemeral session token + path validation + bounded uploads — none runtime-testable here (§0, §46).

Stage Summary:
- agent/builder final state: `308eb26` on origin.
- 4 coherent commits past `d6ec58d` baseline (all pushed to origin/agent/builder):
  1. d08435c feat(consumer-v1): Rust core for Application Kit + Notes + Reading History
  2. 308eb26 feat(consumer-v1): frontend routes for Assignment/Portal/Kit/Reader/Notes/Print/Batch/Send + Onboarding
- Final gate counts:
  - TS typecheck: ✅ green (5 packages)
  - ESLint: ✅ green (5 packages, --max-warnings 0)
  - TS tests: ✅ 110 tests pass (unchanged from last sprint — new routes don't add unit tests; their behavior is engine-backed and would need integration tests that this sandbox can't runtime-run)
  - Frontend production build: ✅ green, ~115 kB gzip initial JS (unchanged — new routes are lazy)
  - cargo fmt --check: ✅ green
  - cargo clippy -D warnings: ✅ zero warnings
  - cargo test: ✅ 40 Rust tests pass (was 27; +13 new: 4 application_kit, 5 notes, 4 reading_history)
- NOT done (honest, environment-blocked):
  - Windows installer (.msi/.exe) — no Windows runner, no Tauri build capability in this sandbox
  - Code signing — no signing certificate
  - Tauri runtime features (single-instance, open-file argument, window state) — no webkit2gtk system deps
  - Save As (Tauri save dialog) — same Tauri-runtime gap
  - Direct printer integration — Print Studio generates print-ready PDF only
  - Grayscale rasterization — needs runtime testing
  - Assignment Studio cover page / page numbers / A4 normalization / signature overlay — need pdf-lib code paths this sandbox can't runtime-verify
  - Study Reader highlights/bookmarks/annotations/tabs — §0: don't ship half-built
  - Notes rich text editor — same §0
  - Paperu Send LAN server — feature-flagged out
  - Performance instrumentation markers (§64)
  - Guardian runtime attack (§88)
  - Manual stranger test (§90)
- Hard environment blockers unchanged: no webkit2gtk, no Windows runner, no signing cert. All non-Tauri-runtime gates green.

---
Task ID: 5
Agent: Builder (Z.ai Code, sandbox environment — authenticated with PAT)
Task: Paperu Master Prompt repair sprint — fix Windows CI, fix file-path architecture, fix Assignment ordering, fix Reader bugs, implement Save As.

Work Log:
- Verified the real Windows CI failure: `fileDropEnabled` (obsolete Tauri 1 key) in tauri.conf.json. Fixed → `dragDropEnabled` (Tauri 2 key).
- Rewrote .github/workflows/ci.yml: added push triggers for agent/builder, agent/integration, agent/guardian + workflow_dispatch. Added Windows artifact upload (NSIS .exe + MSI .msi + raw paperu.exe) via actions/upload-artifact@v4 with if-no-files-found: error. Added SHA-256SUMS.txt generation via Get-FileHash in pwsh. Artifact name: paperu-windows-x64-${{ github.sha }}.
- Fixed pnpm-lock.yaml drift (jsdom→happy-dom switch wasn't reflected in lockfile). Regenerated via `pnpm install --lockfile-only`.
- Fixed ERR_PNPM_IGNORED_BUILDS (canvas@3.2.3 build script): added `--ignore-scripts` to CI install command. Canvas's native bindings aren't needed in the Tauri webview (browser provides Canvas API).
- Created lib/file-picker.ts: canonical pickFiles() (Tauri dialog plugin → absolute paths), pickAndInspectFiles() (inspect_file for real kind detection), readFileBytes() (canonical read_file_bytes wrapper). Replaces the broken <input type=file> + file.name pattern.
- Fixed Assignment Studio ordering bug (§9): was grouping by kind (all images → all PDFs), destroying mixed user order. Now processes each file IN USER ORDER.
- Fixed Study Reader (§19): was using pdfjs.getDocument(path) directly. Now uses readFileBytes(path) → pdfjs.getDocument({data}).
- Fixed Reader history first-time-write (§20): removed the `if (!history) return` guard that prevented new documents from creating a history row.
- Fixed bookmark preservation (§21): Rust upsert was converting None → [] via unwrap_or_default(), clobbering stored bookmarks on every scroll. Now None → SQL NULL → COALESCE preserves existing; Some([]) → explicit clear.
- Added 3 Rust regression tests: none_bookmarks_preserves_existing, some_empty_bookmarks_clears_existing, first_open_creates_history_row.
- Implemented Save As (§32): new commands/save_as.rs Rust module (save_file_as command: validates dest path, atomic write, overwrite protection) + lib/save-as.ts TS helper (Tauri save dialog + invoke). 4 Rust tests.
- Fixed Frontend tests: ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING — changed vitest pool from vmThreads to threads (vmThreads doesn't support dynamic imports which lazy-loaded routes use).
- Fixed Windows Clippy: generate_handler! was using use-imported names; Tauri 2.12 macros need full module paths. Changed to crate::commands::* full paths. Also added 24 new commands to the handler list (save_file_as, application_kit: 4, notes: 10, reading_history: 5, recent_work: 4).

Stage Summary:
- agent/builder advanced from 949ae4d → f1693c0 (8 new commits, all pushed to origin/agent/builder).
- CI progress (iterative Windows debugging per §8):
  - Run 37655813203 (949ae4d): FAILED at install (fileDropEnabled config) — this was the pre-existing failure
  - Run 37657003636 (lockfile fix): FAILED at install (ERR_PNPM_IGNORED_BUILDS, canvas)
  - Run 37658093158 (ignoredBuiltDependencies): FAILED at install (config field didn't suppress error)
  - Run 37658914793 (--ignore-scripts): FAILED at Frontend tests (vmThreads) + Windows Clippy (generate_handler macros)
  - Run triggered by f1693c0: IN PROGRESS — should fix both
- Local gates (all green on final state):
  - TS typecheck: ✅ green
  - ESLint: ✅ green
  - TS tests: ✅ 110 tests pass (threads pool)
  - Rust core clippy: ✅ zero warnings
  - Rust fmt: ✅ clean
  - Rust tests: ✅ 47 tests pass (was 43; +3 reading_history regression + 1 save_as... wait, +4 save_as = 47)
- Real architecture fixes verified:
  - Assignment Studio preserves user order (not grouped by kind)
  - Study Reader uses readFileBytes (not direct pdfjs.getDocument)
  - Reading history creates row on first open
  - Bookmarks preserved on scroll (None ≠ Some([]))
  - Save As: native dialog + atomic write + overwrite protection
  - Canonical file picker: absolute paths via Tauri dialog (not browser File objects)
- Still NOT done (honest):
  - Windows installer artifact (waiting for CI green — the current run should get past Clippy)
  - Batch cancellation (AbortController) — §26
  - Notes autosave flush on close — §25
  - Real Fit Width in Reader — §22
  - Application Kit frontend completion (add/replace/rename) — §16
  - Full Notes rich editor — §24
  - Full Study Reader V1 (highlights/bookmarks/annotations/tabs) — §23
  - Single instance + open-file argument + window state — §33
  - Performance instrumentation — §64

---
Task ID: 6 — WINDOWS CI GREEN + REAL INSTALLER PRODUCED
Agent: Builder (Z.ai Code)

## CI run: 37661450596 — ALL GREEN ✓
- Frontend (typecheck · lint · test · build): ✓ 48s
- Rust core (fmt · clippy · test): ✓ 59s
- Windows Tauri build: ✓ 12m25s (ALL steps passed including Tauri production build)

## Windows artifacts produced (commit c482590):
- NSIS installer: Paperu_0.1.0_x64-setup.exe — 2.67 MB
  SHA-256: DCCEF1770FA0AAC7C2BEA85C786C8A3850496A86A4481E6D0E9E00C0E8302A69
- MSI installer: Paperu_0.1.0_x64_en-US.msi — 3.4 MB
  SHA-256: BFFFCF3AACF53A098E02E3533964B8B5F8C3991A4277F14156F0990547E392B7
- Artifact zip: paperu-windows-x64-c482590c93ef0e4746fa9e5f20408d1e9edea6a0
  Size: 9.03 MB (contains both installers + raw paperu.exe + SHA256SUMS.txt)
  URL: https://github.com/hello-aditya-dev/paperu/actions/runs/37661450596

## Signing status: UNSIGNED
TAURI_SIGNING_PRIVATE_KEY="" in CI. No Authenticode certificate.
This is a 'Windows Release Candidate — unsigned' — functional but
will trigger Windows SmartScreen on first install. Production signing
comes later when a certificate exists.

## What was fixed to reach green (iterative per §8):
1. fileDropEnabled → dragDropEnabled (Tauri 2 config)
2. CI triggers: added agent/builder + agent/integration + agent/guardian + workflow_dispatch
3. pnpm-lock.yaml drift (jsdom→happy-dom not reflected in lockfile)
4. ERR_PNPM_IGNORED_BUILDS (canvas) → --ignore-scripts in CI install
5. ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING → pool: threads (was vmThreads)
6. generate_handler! macros → full module paths (was use-imported names)
7. Unused imports in runtime module + shell.rs → removed / #[allow]

## Local gates (final state):
- TS typecheck: ✅ green
- ESLint: ✅ green
- TS tests: ✅ 110 tests pass
- Rust core clippy: ✅ zero warnings
- Rust fmt: ✅ clean
- Rust tests: ✅ 47 tests pass

## Still NOT done (honest):
- Batch cancellation (AbortController) — §26
- Notes autosave flush on close — §25
- Real Fit Width in Reader — §22
- Application Kit frontend completion (add/replace/rename) — §16
- Full Notes rich editor — §24
- Full Study Reader V1 (highlights/bookmarks/annotations/tabs) — §23
- Single instance + open-file argument + window state — §33
- Performance instrumentation — §64
- Manual Windows smoke test (install + launch + use + close + reopen) — §28
- Code signing (needs Authenticode certificate) — §13

---
Task ID: 7 — IPC CONVERGENCE + WINDOWS CI GREEN
Agent: Builder (Z.ai Code)

## Mission: Wire 7 Rust modules into typed Tauri commands — close the critical IPC gap.

The previous sprint left 7 Rust logic modules (rename, citations, duplicate_finder, downloads_cleaner, organizer, file_rescue, archive_studio) with tests but NO Tauri command wrappers. The frontend couldn't invoke them at runtime. This sprint closes that gap.

## What was done:
1. Wrote 7 Tauri command wrapper files (all #![cfg(feature = "tauri-runtime")]):
   - commands/rename.rs: preview_rename + execute_rename
   - commands/citations.rs: save_citation + list_citations + delete_citation + format_citation
   - commands/duplicate_finder.rs: find_exact_duplicates
   - commands/downloads_cleaner.rs: scan_downloads_folder
   - commands/organizer.rs: save/list/delete rules + dry_run_organizer
   - commands/file_rescue.rs: diagnose_file
   - commands/archive_studio.rs: validate_zip_entry + check_suspicious_ratio + check_destination_contained
2. Registered 7 new modules in commands/mod.rs (feature-gated declarations + re-exports).
3. Added 16 new commands to generate_handler! in lib.rs (full crate:: paths).
4. Wrote 7 TS contract files (rename.ts, citations.ts, duplicate_finder.ts, downloads_cleaner.ts, organizer.ts, file_rescue.ts, archive_studio.ts) + exported from index.ts.
5. Fixed OrganizerRule missing serde::Serialize (Windows Clippy failure).
6. Fixed citations.ts unused FilePath import.

## CI run 37673720669 — ALL GREEN:
- Frontend: ✓ 42s (typecheck + lint + 110 tests + build)
- Rust core: ✓ 49s (fmt + clippy + 80 tests)
- Windows Tauri: ✓ 5m54s (clippy with tauri-runtime + tests with tauri-runtime + Tauri production build + artifact upload)

## Windows artifact: paperu-windows-x64-fe33c60... (produced, uploaded, SHA-256 verified)

## Final state:
- agent/builder: fe33c60
- 16 new Tauri commands registered and Windows-compiled
- 7 Rust modules fully wired: logic → command → generate_handler! → frontend invoke
- 7 TS contracts with typed wrappers
- 80 Rust tests + 110 TS tests + clippy zero + fmt clean + build green
- Windows installer artifact produced (unsigned, validation build)
