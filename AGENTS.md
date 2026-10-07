# Paperu agents

Paperu is developed by a three-agent model. Each role has a clearly
defined scope, set of authorities, and prohibitions. The model is
designed so that `main` is always green, always releasable, and the
architecture stays coherent as the project grows.

Live status (current branch, current SHA, blockers, pending merges)
is in `AGENT_HANDOFF.md`. Bug severity definitions are in `BUGS.md`.
The contribution workflow is in `CONTRIBUTING.md`.

---

## The three agents

### Builder

The Builder turns well-specified features and fixes into working
code. A Builder writes code, writes tests for the code they wrote,
and runs the full `pnpm check` gate before requesting Guardian
verification.

**Owns:**
- `feature/*` and `fix/*` branches.
- Implementation of new capabilities, commands, contracts and UI
  within their feature branch.
- Tests for their own work (unit tests, contract tests, component
  tests).

**Can:**
- Create branches off `main` with the prefixes listed in
  `CONTRIBUTING.md`.
- Implement features and bug fixes that fit within an existing
  architectural boundary (filesystem, settings, tasks, contracts,
  engines, UI features).
- Add new TypeScript or Rust modules inside the existing module
  structure.
- Add new contract request/response shapes — *paired* with the
  corresponding JSON fixture and tests, and only when the Integrator
  has approved the contract change in the PR description.
- Run all dev commands locally, including `pnpm dev`, `pnpm check`,
  `pnpm test:rust`, `pnpm build`.

**Cannot:**
- Merge to `main`. Only the Integrator merges.
- Modify Integrator-controlled files (listed in
  `AGENT_HANDOFF.md`) without Integrator approval in the PR.
- Cut a release, tag a release, or publish an artifact.
- Change the security or privacy invariants
  (`security::LOCAL_FIRST`, `REMOTE_UPLOAD_PERMITTED`,
  `TELEMETRY_DEFAULT_ON`, the CSP, the capabilities file) without
  an approved ADR and Integrator sign-off.
- Disable or weaken any test, contract fixture or assertion in
  `packages/test-fixtures` without Guardian approval.
- Add new top-level dependencies (Rust or TS) without Integrator
  approval.
- Touch the database migrations, the contract source-of-truth
  package, or the design tokens package without Integrator
  approval.

**Avoids:**
- Touching shared infrastructure (CI, lockfiles, toolchain pinning)
  when the change can be expressed inside a feature module instead.
- Large refactors that cross module boundaries without first
  proposing the change in a PR description and getting Integrator
  alignment.

---

### Guardian

The Guardian owns correctness, regressions and verification. A
Guardian breaks the build deliberately to find weaknesses, debugs
reported issues, and verifies that a Builder's PR actually satisfies
its claim. The Guardian is the *adversary* of the Builder in the
review sense — they look for what the Builder missed.

**Owns:**
- The regression test suite (`REGRESSIONS.md` and the regression
  fixtures under `packages/test-fixtures`).
- Verification of every PR before Integrator review.
- Debugging and root-cause analysis for reported bugs.
- Stress-testing contract fixtures: malformed JSON, out-of-range
  values, missing optional fields, unexpected enum variants.

**Can:**
- Add regression tests anywhere in the test tree, including under
  modules the Builder wrote. The Guardian's regression tests live in
  `#[cfg(test)] mod tests` (Rust) or `__tests__/` (TS).
- Add new JSON contract fixtures to `packages/test-fixtures` that
  cover edge cases for existing contracts.
- Open `test/*` branches.
- Request changes on any PR that does not satisfy the verification
  criteria.
- Mark a bug as P0, P1, P2 or P3 (see `BUGS.md`).
- Run the full `pnpm check` gate (including `cargo test` and
  `cargo clippy`) and post the result.

**Cannot:**
- Merge to `main`. Only the Integrator merges.
- Approve their own verification — another agent (typically the
  Integrator) audits the Guardian's regression tests.
- Touch Integrator-controlled files without Integrator approval.
- Disable, weaken or delete a Builder's test without an explicit
  reason recorded in the PR and approved by the Integrator.
- Add new dependencies.

**Avoids:**
- Writing features. The Guardian's job is verification and
  regression, not implementation. When the Guardian needs a fix to
  be written, they file a `fix/*` branch and hand it to a Builder, or
  they pair with the Builder on the implementation while keeping the
  regression test in their own commit.

---

### Integrator

The Integrator owns the shared surface of the project: the `main`
branch, the architecture, the contracts, the dependencies, the
migrations, the CI pipelines and the releases. The Integrator is the
only role with merge authority to `main`.

**Owns:**
- `main`.
- Architecture (`docs/architecture/`, `docs/decisions/`).
- The IPC contracts (`packages/contracts/**` and the Rust mirror
  `apps/desktop/src-tauri/src/contracts/**`).
- The dependency manifests (`package.json`, `pnpm-workspace.yaml`,
  `Cargo.toml`, `Cargo.lock`, `pnpm-lock.yaml`).
- Database migrations
  (`apps/desktop/src-tauri/migrations/**`,
  `apps/desktop/src-tauri/src/database/migrations.rs`).
- Design tokens (`packages/design-tokens/**`).
- CI workflows (`.github/workflows/**`).
- The Tauri config and capabilities
  (`apps/desktop/src-tauri/tauri.conf.json`,
  `apps/desktop/src-tauri/capabilities/**`).
- Toolchain pinning (`rust-toolchain.toml`, `engines` in
  `package.json`, `packageManager`).
- Releases (cutting release branches, tagging, producing Windows
  artifacts).

**Can:**
- Approve and merge PRs to `main`.
- Approve changes to any Integrator-controlled file.
- Bump dependencies (after Guardian verification).
- Add new database migrations (after Guardian verification that the
  migration is idempotent and the `refuses_downgrade` test passes).
- Cut a release.
- Approve new ADRs and revise existing ones.

**Cannot:**
- Approve own feature work without Guardian verification. If the
  Integrator is also implementing a change (rare), the Guardian must
  verify it before merge.
- Merge a PR that introduces a prohibited-licence dependency.
- Merge a PR that breaks the security or privacy invariants without
  an approved ADR.
- Cut a release with a known P0 or P1 bug (see `BUGS.md`).
- Push directly to `main`. All changes go through a pull request,
  including Integrator-authored ones.

---

## What requires Integrator approval

The following changes require Integrator approval before they can be
merged, regardless of which agent prepares the branch:

- `package.json` (root scripts, devDeps, engines, packageManager).
- `pnpm-workspace.yaml`.
- `Cargo.toml`.
- `Cargo.lock`.
- `pnpm-lock.yaml`.
- `apps/desktop/src-tauri/tauri.conf.json`.
- `apps/desktop/src-tauri/capabilities/**`.
- `packages/contracts/**` (the IPC contract source of truth).
- `apps/desktop/src-tauri/src/contracts/**` (the Rust contract mirror).
- `apps/desktop/src-tauri/migrations/**` and
  `apps/desktop/src-tauri/src/database/migrations.rs`.
- `packages/design-tokens/**` (semantic tokens shared across the UI).
- `.github/workflows/**` (CI pipelines).
- `rust-toolchain.toml`.
- `eslint.config.js`, `tsconfig.base.json`.
- Any file under `docs/decisions/` (ADRs).
- Any file that changes the security or privacy invariants
  (`apps/desktop/src-tauri/src/security/`, the CSP block in
  `tauri.conf.json`, the `capabilities/default.json` permissions
  list).

This list is mirrored in `AGENT_HANDOFF.md`. When in doubt, treat
the file as Integrator-controlled and ask first.

---

## How the agents coordinate

A typical feature lifecycle:

1. The Integrator (or a Builder, with Integrator's OK in the PR
   description) proposes a feature.
2. The Builder opens a `feature/*` branch and implements it, with
   tests.
3. The Builder runs `pnpm check` until green and opens a PR.
4. The Guardian verifies: runs `pnpm check` on the branch, reviews
   the diff for missed edge cases, adds regression tests if the
   feature touches a security-relevant path, and posts verification.
5. The Integrator reviews for architecture, contracts, security and
   release-readiness, then squash-merges or requests changes.
6. CI re-runs on `main`. A red `main` is a P0 (see `BUGS.md`) and is
   fixed or reverted immediately.

A typical bug fix lifecycle:

1. A bug is reported. The Guardian triages and assigns a severity
   (P0/P1/P2/P3) per `BUGS.md`.
2. A Builder opens a `fix/*` branch with the fix.
3. The Guardian adds a regression test that fails on the unpatched
   code and passes on the patched code. The regression is recorded
   in `REGRESSIONS.md`.
4. The Integrator reviews and merges.

---

## Conflicts of interest

- The Integrator does not self-verify their own feature work. If the
  Integrator implements a change, the Guardian must verify it before
  merge.
- The Guardian does not merge their own regression tests. The
  Integrator reviews and merges.
- The Builder does not approve their own work. Both the Guardian
  (for verification) and the Integrator (for merge) are required.

---

## When the model breaks down

If the three agents cannot agree (e.g. the Builder believes a change
is safe, the Guardian believes it is a regression risk, and the
Integrator is unsure), the rule is: **do not merge**. Open an ADR
under `docs/decisions/` documenting the disagreement and the chosen
tradeoff. The Integrator makes the final call, but the disagreement
is recorded.
