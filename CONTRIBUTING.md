# Contributing to Paperu

Paperu is developed under a three-agent model: Builder, Guardian and
Integrator. This document describes how to contribute changes that an
Integrator can accept, and how the workflow keeps `main` always green
and always releasable.

If you are an agent picking up work, also read `AGENTS.md` (role
definitions), `AGENT_HANDOFF.md` (current live status) and
`BUGS.md` (severity definitions).

---

## Branch naming

All work happens on branches off `main`.

| Prefix      | Use                                                                  |
| ----------- | -------------------------------------------------------------------- |
| `feature/`  | New capability or user-visible behaviour. Example: `feature/pdf-compress`. |
| `fix/`      | A bug fix. Example: `fix/inspect-reserved-name`.                     |
| `release/`  | Release preparation branches and tags. Example: `release/0.2.0`.    |
| `docs/`     | Documentation-only changes. Example: `docs/threat-model-clarification`. |
| `chore/`    | Tooling, dependency bumps (Integrator-approved), refactors that do not change behaviour. |
| `test/`     | Guardian-driven regression test additions.                            |

Branch names use `kebab-case`. They never include the author's name,
the date, or ticket numbers in the branch name itself (use the PR body
for traceability).

---

## Commit conventions

- Write commits in the imperative mood: "Add path validation to
  inspect command", not "Added path validation".
- Keep the subject line under 72 characters.
- Add a body when the change is non-trivial. Explain *why*, not *what*
  (the diff already shows what).
- One logical change per commit. A feature may be several commits; a
  bug fix is usually one commit plus a regression test commit.
- Reference the relevant ADR or architecture doc when a change
  touches contracts, security or architecture.
- Do not commit generated files: `dist/`, `target/`,
  `src-tauri/gen/`, `coverage/`, `node_modules/`.
- Do not commit secrets, licence keys, real user documents or large
  binary fixtures (see `docs/architecture/testing.md`).

Squash-merging is the default for PRs that are not split into reviewable
commits. Integrator decides per PR.

---

## The three-agent model

| Role        | Owns                                                  | Can do                                                       | Cannot do                                                       |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Builder     | Feature branches.                                     | Implement features and fixes; write tests for own work.      | Merge to `main`. Touch Integrator-controlled files without sign-off. |
| Guardian    | Regression tests, breaking tests, verification.      | Add regression fixtures; debug; run the full `pnpm check`; verify Builder's PR. | Merge to `main`. Touch Integrator-controlled files without sign-off. |
| Integrator  | `main`, architecture, contracts, deps, migrations, CI, releases. | Approve and merge to `main`; bump deps; add migrations; cut releases. | Approve own feature work without Guardian verification. |

The full role definitions live in `AGENTS.md`. The handoff state
(current branch, current SHA, blockers) lives in `AGENT_HANDOFF.md`.

---

## What requires Integrator approval

Changes to any of the following files or directories must be reviewed
and merged by the Integrator. A Builder or Guardian may prepare a
branch that touches these, but they cannot merge it themselves.

- `package.json` (root scripts, devDeps, engines)
- `pnpm-workspace.yaml`
- `Cargo.toml`
- `Cargo.lock`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/capabilities/**`
- `packages/contracts/**` (the IPC contract source of truth)
- `apps/desktop/src-tauri/src/contracts/**` (the Rust contract mirror)
- `apps/desktop/src-tauri/migrations/**` and
  `apps/desktop/src-tauri/src/database/migrations.rs`
- `packages/design-tokens/**` (semantic tokens are shared)
- `.github/workflows/**` (CI pipelines)
- `rust-toolchain.toml`
- `eslint.config.js`, `tsconfig.base.json`
- Any file under `docs/decisions/` (ADRs)
- Any file that changes the security or privacy invariants
  (`src-tauri/src/security/`, `tauri.conf.json` CSP,
  `capabilities/default.json`).

This list is mirrored in `AGENT_HANDOFF.md`. When in doubt, treat the
file as Integrator-controlled and ask first.

---

## What requires Guardian verification

A Builder's PR is not ready for Integrator review until the Guardian
has run `pnpm check` on the branch and either:

- confirmed the full gate passes, or
- documented why a specific failure is expected and out of scope.

The Guardian additionally verifies:

- New contract shapes have a JSON fixture in `packages/test-fixtures/`
  and both the Rust serialization test and the TypeScript parse test
  accept it.
- New error codes are covered by a contract fixture and an
  end-to-end UI test where applicable.
- Non-destructive file operations are exercised by a temp-workspace
  test that asserts the source is unchanged.
- No test commits real user documents, secrets, or paths from the
  contributor's machine.

---

## Testing expectations

`pnpm check` is the canonical gate. It runs:

1. `pnpm run typecheck` — TypeScript across every package.
2. `pnpm run lint` — ESLint with `--max-warnings 0`.
3. `pnpm run test` — vitest across every package.
4. `pnpm run fmt:rust:check` — `cargo fmt --check`.
5. `pnpm run clippy` — `cargo clippy --all-targets -- -D warnings`
   on the core crate (without `tauri-runtime`).
6. `pnpm run test:rust` — `cargo test` on the core crate.

For Windows release validation, CI additionally runs the same gate
with `--features tauri-runtime` and produces a Tauri build on a
`windows-latest` runner (see `.github/workflows/ci.yml`).

### Rust unit tests

Live inside each module under `#[cfg(test)] mod tests`. They run on
every platform because the core crate compiles without
`tauri-runtime`. Tests that need a temp filesystem use
`std::env::temp_dir()` joined with a UUID to avoid collisions.

### TypeScript contract tests

Live under `apps/desktop/src/lib/__tests__/contracts.test.ts` and
related `__tests__/` directories. They parse JSON fixtures from
`packages/test-fixtures/src/contracts/` and assert the typed contracts
accept them. Both Rust and TypeScript tests must accept the same
fixture.

### Component tests

Live next to their component (e.g.
`apps/desktop/src/features/inspect/__tests__/InspectView.test.tsx`).
They use `@testing-library/react` and the mock registry in
`src/lib/ipc.ts` (`__mockCommand` / `__clearMocks`) to simulate the
native backend. Production never mocks.

### Adding regression tests

When fixing a bug, the Guardian adds a regression test that fails on
the unpatched code and passes on the patched code. The regression is
recorded in `REGRESSIONS.md` with: the bug id, the failing input, the
expected behaviour and the test path. See `REGRESSIONS.md` for the
format.

### Synthetic fixtures only

Never commit private, personal or copyrighted documents as fixtures.
Use `@paperu/test-fixtures`'s `SYNTHETIC_PAYLOAD` or generate test
data programmatically. See `docs/architecture/testing.md`.

---

## Pull request workflow

1. **Builder** opens a `feature/` or `fix/` branch.
2. **Builder** runs `pnpm check` locally until it passes.
3. **Builder** opens a pull request against `main`. The PR body lists:
   - what changed and why,
   - which contracts (if any) are affected,
   - which Integrator-controlled files (if any) are touched,
   - the corresponding ADR (if a decision was made or revised),
   - the Guardian verification status.
4. **Guardian** runs `pnpm check`, reviews the diff, adds regression
   tests if appropriate, and posts the verification result.
5. **Integrator** reviews for architecture, contracts, security and
   release-readiness, then merges (squash by default) or requests
   changes.
6. CI re-runs on `main` after merge. A red `main` is a P0 and is
   treated per `BUGS.md`.

---

## Code style

- **TypeScript:** ESLint flat config (`eslint.config.js`). `no-explicit-any`
  is an error. Consistent type imports are required.
- **Rust:** `#![forbid(unsafe_code)]` at the crate root. `clippy::all`,
  `clippy::pedantic` and `clippy::cargo` are warned. CI runs `clippy`
  with `-D warnings`. `cargo fmt` is enforced.
- **CSS:** consume design tokens via `var(--paperu-*)`. Never invent
  raw hex values or one-off spacing in components. See
  `packages/design-tokens/src/tokens.css`.
- **Naming:** TS modules use `camelCase` for files, `PascalCase` for
  components and types. Rust modules use `snake_case`.

---

## Release expectations

- No P0 or P1 bug may be knowingly merged into a release (see `BUGS.md`).
- A release branch (`release/x.y.z`) is cut from `main` by the
  Integrator, verified by the Guardian, and tagged.
- The Windows artifact is produced by `pnpm tauri build --features tauri-runtime`
  on a Windows runner.
- No code-signing certificate is in the repository today. CI sets
  `TAURI_SIGNING_PRIVATE_KEY=""`. See `docs/releases/workflow.md` for
  the signing plan.

---

## Questions and escalation

- Architecture and contract questions: Integrator.
- Test strategy and regression ownership: Guardian.
- Feature implementation details: Builder (author of the feature
  branch).
- Security concerns: see `SECURITY.md` and follow the disclosure
  process described there.
