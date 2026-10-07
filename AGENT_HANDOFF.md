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
