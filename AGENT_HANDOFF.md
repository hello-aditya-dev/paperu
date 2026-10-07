# Paperu agent handoff

This file is the live status board for the three-agent model. Every
agent reads it before picking up work and updates it before handing
off. The Integrator is the owner of this file; changes to it require
Integrator approval (it is Integrator-controlled).

The intent is that any agent can resume the project from this file
alone, without reading chat logs or external tickets.

---

## CURRENT STABLE SHA

- **Branch:** `main`
- **SHA:** _to be filled in by the Integrator at each handoff_
- **Tag:** none yet (foundation; `0.1.0` is the working version, no
  release tag has been cut)
- **Working version:** `0.1.0` (per `package.json`, `Cargo.toml`,
  `tauri.conf.json`)
- **Last `pnpm check` status:** passing
- **Last CI status:** green (`frontend`, `rust-core`, `windows-build`
  all green; see `.github/workflows/ci.yml`)

When the Integrator hands off, they update this SHA to the latest
`main` commit and confirm the gate is green.

---

## CURRENT RELEASE STATUS

- **Released versions:** none.
- **Next planned release:** `0.1.0` (foundation), not yet tagged.
- **Release blockers (P0):** none. See `BUGS.md`.
- **Release blockers (P1):** none.
- **Code-signing certificate:** not yet procured. See
  `docs/releases/workflow.md`. CI produces an unsigned installer for
  validation; the `TAURI_SIGNING_PRIVATE_KEY` is set to `""` in CI.
- **Tauri updater:** disabled (`createUpdaterArtifacts: false`).
- **Engines:** not implemented (`ENGINES_AVAILABLE = false`). The
  first real vertical proof (Local File Inspect) is implemented;
  see `docs/features/local-file-inspect.md`.

---

## BUILDER

- **Branch:** _(none active)_
- **Current feature:** _(none — foundation complete, awaiting next
  feature assignment)_
- **Handoff SHA:** _(same as CURRENT STABLE SHA)_
- **Next planned work:** _(set by Integrator; e.g. "PDF compress
  engine")_
- **Open questions for Integrator:** none.

---

## GUARDIAN

- **Branch:** _(none active)_
- **Current test target:** `main` at CURRENT STABLE SHA.
- **Blocking bugs:** none. See `BUGS.md`.
- **Open regressions:** none. See `REGRESSIONS.md`.
- **Verification status of last merge:** passing. `pnpm check` is
  green on `main`.
- **Next planned work:** _(set by Integrator; e.g. "write regression
  for path-too-long inspect")_

---

## INTEGRATOR

- **Main status:** green. `main` is releasable.
- **Pending merges:** none.
- **Pending dependency bumps:** none.
- **Pending migrations:** none (only `0001_init` exists).
- **Pending ADRs:** none (ADRs 0001–0010 cover the foundation
  decisions).
- **Pending release actions:** none (release `0.1.0` will be cut
  when the Integrator decides the foundation is ready to tag).
- **Next planned work:** _(e.g. "scope the first engine: PDF
  compress")_

---

## P0 BLOCKERS

None. The foundation is green on `main`.

A P0 is a release blocker: data loss, corrupted files, the app will
not start, or a security/privacy violation. See `BUGS.md` for the
full definition. If a P0 appears, it is the Integrator's
responsibility to either fix it on `main` immediately or revert the
offending commit.

---

## P1 BLOCKERS

None.

A P1 is a major workflow broken (a feature the user needs does not
work, but the app starts and no data is lost). See `BUGS.md`.

---

## FILES REQUIRING INTEGRATOR APPROVAL

The following files and directories require Integrator approval
before changes can be merged, regardless of which agent prepares the
branch. This list is mirrored from `AGENTS.md` and
`CONTRIBUTING.md`.

### Workspace root

- `package.json` (root scripts, devDependencies, `engines`,
  `packageManager`).
- `pnpm-workspace.yaml`.
- `pnpm-lock.yaml`.
- `tsconfig.base.json`.
- `eslint.config.js`.
- `rust-toolchain.toml`.
- `LICENSE`.

### Rust / Tauri

- `apps/desktop/src-tauri/Cargo.toml`.
- `apps/desktop/src-tauri/Cargo.lock`.
- `apps/desktop/src-tauri/tauri.conf.json`.
- `apps/desktop/src-tauri/build.rs`.
- `apps/desktop/src-tauri/capabilities/**` (the capability files —
  only `default.json` today).
- `apps/desktop/src-tauri/migrations/**` (SQL migrations).
- `apps/desktop/src-tauri/src/database/migrations.rs` (the migration
  runner and the `MIGRATIONS` list).
- `apps/desktop/src-tauri/src/security/**` (the local-first security
  invariants).
- `apps/desktop/src-tauri/src/contracts/**` (the Rust contract
  mirror of `@paperu/contracts`).

### Contracts

- `packages/contracts/**` (the TypeScript contract source of truth).
  Includes `src/index.ts`, `src/common.ts`, `src/errors.ts`,
  `src/inspect.ts`, `src/tasks.ts`, `src/operations.ts`,
  `src/progress.ts`, `src/settings.ts`.

### Design tokens

- `packages/design-tokens/**` (semantic CSS tokens shared across the
  UI; `src/tokens.css` is the source of truth).

### Test fixtures

- `packages/test-fixtures/src/contracts/**` (canonical JSON contract
  fixtures — changing a fixture is a contract change).
- `packages/test-fixtures/package.json` (exports map).

### CI

- `.github/workflows/**` (CI pipelines).
- `.github/workflows/ci.yml` (the main CI workflow).

### Documentation that records decisions

- `docs/decisions/**` (ADRs). New ADRs require Integrator review and
  merge.
- `SECURITY.md` (the security policy).
- `DEPENDENCIES.md` (dependency governance).

### Shared architecture files

The Integrator is the final authority on any change that crosses
module boundaries, changes a public Rust API, changes a contract
shape, or changes a security invariant. When in doubt, ask first.

---

## Update protocol

When handing off:

1. The Integrator updates CURRENT STABLE SHA to the latest `main`
   commit and confirms `pnpm check` is green.
2. The Builder updates BUILDER with the branch they were working on,
   the SHA they reached, and what remains.
3. The Guardian updates GUARDIAN with the test target SHA and any
   blocking bugs or open regressions.
4. The Integrator updates P0 BLOCKERS and P1 BLOCKERS, and reviews
   the FILES REQUIRING INTEGRATOR APPROVAL list for additions.

The file is the single source of truth for "where are we". If it is
stale, the agent who notices updates it.

---

## BUILDER HANDOFF — Master Prompt 3 (Mature Core UX + Command Center + Shelf + Desktop Lifecycle)

**Builder branch:** `agent/builder`
**Starting SHA:** `20a67fad1be14ffa1a6a502be44b7391a004dd63`
**Final SHA:** `05c2a520` (commit subject: "feat(workspaces): add PDF + Images workspace shells, slim nav rail")
**Commits added:** 10 (see `git log 20a67fad..05c2a520 --oneline`)

### Features delivered

| Master Prompt 3 § | Feature | Status |
|---|---|---|
| §3-4, §16 | Registry-driven navigation (no hardcoded NAV) | ✅ done |
| §5-12 | Command Center (Ctrl+K, deterministic search, keyboard) | ✅ done |
| §13-16, §24 | Smart Action Palette (contextual, registry-derived) | ✅ done |
| §17-23 | Paperu Shelf (session-scoped, add/remove/reorder/send-to-module) | ✅ done |
| §28-32 | Persistent Recent Work (SQLite migration 0002 + HistoryRoute) | ✅ done |
| §33, §38-40 | PDF + Images workspace shells, slim 4-item nav rail | ✅ done |
| §67-69 | Lazy loading (initial bundle 395 kB → 114 kB gzip, 3.5×) | ✅ done |

### Gate results (actually run, not assumed)

- TypeScript typecheck: ✅ green (5 packages)
- ESLint: ✅ green (5 packages, `--max-warnings 0`)
- TypeScript tests: ✅ **110 tests** pass in 9 files
  - 86 original (engine, contracts, drop, inspect, module-registry, platform)
  - +14 Command Center (empty/exact/alias/prefix/partial/case/whitespace/no-result/ranked/keyboard/recent)
  - +10 Action Palette (PDF/image/unsupported/missing/keyboard/rapid)
- Frontend production build: ✅ green, **~114 kB gzip initial JS** (was ~395 kB)
- `cargo fmt --check`: ✅ green
- `cargo clippy -D warnings`: ✅ zero warnings
- `cargo test`: ✅ **27 Rust tests** pass
  - 22 original (database migrations, filesystem temp, tasks, commands finalize/inspect/shell/read_file/pdf_info)
  - +5 recent_work (round-trip, most-recent-first, remove-by-id, clear-all, pruning-at-MAX_ENTRIES=200)

### Shared architecture changes (require Integrator awareness)

1. **DB migration 0002** (`apps/desktop/src-tauri/migrations/0002_recent_work.sql`):
   new `recent_work` table. Idempotent (existing tests cover double-run). Stores
   ONLY file metadata (paths, sizes, operation id/label) — never document contents.
2. **Database::from_conn** constructor added (small, additive) — enables in-memory
   test databases. Does not change production `Database::open` path.
3. **Module registry expanded** with new fields: `glyph`, `navOrder`, `visibleInNav`,
   `visibleInCommand`, `pinnable`, `usableAsNextAction`, `contextualPriority`.
4. **Nav rail reorganized** to 4 items (Home / Recent work / PDF / Images). The 8
   individual tools now live inside the PDF/Images workspace pages. Direct keyboard
   access (Ctrl+1..9) is preserved — the handler looks up by `module.shortcut`
   field, not by nav position.
5. **New contracts** (`packages/contracts/src/recent_work.ts` + Rust mirror at
   `contracts/recent_work.rs`): `RecentWorkEntry`, `AddRecentWorkRequest`,
   `RecentWorkCommand`. Sizes are `i64` (SQLite storage) — JSON-serialized as
   numbers, lossless for any real-world file size.
6. **New IPC commands**: `add_recent_work`, `list_recent_work`, `remove_recent_work`,
   `clear_recent_work` (all feature-gated to `tauri-runtime`).

### NOT done (honest)

| Master Prompt 3 § | Feature | Why deferred |
|---|---|---|
| §25-27 | Save As (native Tauri save dialog) | Requires Tauri runtime + dialog plugin; needs runtime testing this sandbox cannot do (no webkit2gtk). |
| §36 | Simple Mode foundation | Architecture stubbed (registry supports it via `visibleInNav`), but no toggle/preference yet. |
| §48-58 | Desktop lifecycle (single instance, open-file arg, window state) | Requires Tauri runtime + plugins; needs runtime testing. |
| §59-62 | Shutdown behavior, crash marker | Same — needs Tauri runtime. |
| §64 | Performance instrumentation (local timing markers) | Not yet implemented. |
| §109 | Final 20-min manual polish pass | Not yet done. |

### ADR 0011 status (unchanged)

ADR 0011 (`docs/decisions/0011-pdf-lib-pdfjs-dependency-request.md`) is still
"Awaiting Integrator approval". Builder's position: pdf-lib + pdfjs-dist are
load-bearing for Wave-1 (the entire PDF/image engine depends on them). The
`pdf-engine` chunk is 179 kB gzip, lazy-loaded only on PDF routes. Recommend
Integrator resolve ADR 0011 before Guardian verification.

### Capability matrix

The capability matrix at `docs/product/COMPETITIVE_CAPABILITY_MATRIX.md`
still falsely marks "Merge PDFs" and "Split / Extract" as "Guardian Verified".
`agent/guardian` is still at foundation `1b81e98c` and has tested nothing.
**Integrator should correct these to "Implemented" or "Builder Verified"**.

### Security doc duplication

Two threat-model files still coexist with conflicting content:
- `docs/security/threat-model.md` (351 lines, the older comprehensive version)
- `docs/security/THREAT_MODEL.md` (177 lines, Builder's newer addition)

**Integrator should reconcile these into one canonical threat model.**

### Environment-tested vs not

- ✅ Tested in this sandbox: typecheck, lint, TS tests, frontend build,
  cargo fmt/clippy/test (all on Linux x86_64 without `tauri-runtime`).
- ❌ NOT tested here: Tauri runtime, desktop shell, native dialogs,
  single-instance, open-file argument, actual PDF/image processing at
  runtime, Windows installer build, Windows Tauri CI.

### Recommended next step

1. **Integrator**: review the 10 new commits on `agent/builder`. Resolve ADR 0011.
   Correct the false "Guardian Verified" labels in the capability matrix.
   Reconcile the duplicate threat-model files.
2. **Integrator**: decide whether to merge `agent/builder` into `agent/integration`
   and produce a Guardian candidate SHA.
3. **Guardian**: attack the integration candidate. Verify the 8-module nav
   reorganization didn't break keyboard shortcuts. Verify recent_work persistence
   survives app restart. Verify the lazy-loaded chunks load correctly on first
   visit. Verify Action Palette deduplication logic.
4. **Builder** (next sprint): Save As, Simple Mode toggle, desktop lifecycle
   (single instance, open-file arg, window state), performance instrumentation.
