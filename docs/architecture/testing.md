# Architecture: testing strategy

This document describes how Paperu is tested: the layers, the
tools, the fixtures policy, and how to add a regression fixture.

The canonical gate is `pnpm check`:

```
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run fmt:rust:check
pnpm run clippy
pnpm run test:rust
```

CI runs an equivalent combination across the `frontend`, `rust-core`
and `windows-build` jobs (see `.github/workflows/ci.yml`).

---

## Layers

### 1. Rust unit tests (in-module `#[cfg(test)] mod tests`)

Rust tests live inside the module they test, under
`#[cfg(test)] mod tests`. They run on every platform because the
core crate compiles without `tauri-runtime`. Examples:

- `src/filesystem/temp.rs` — `temp_workspace_creates_and_cleans`,
  `atomic_finalize_refuses_existing_without_overwrite`,
  `atomic_finalize_moves_when_clear`.
- `src/database/migrations.rs` —
  `runs_migrations_on_fresh_db`, `migrations_are_idempotent`,
  `refuses_downgrade`.
- `src/tasks/mod.rs` — `register_and_cancel`.

Run with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
(or `pnpm run test:rust` from the repo root).

The `windows-build` CI job additionally runs `cargo test
--features tauri-runtime` on a Windows runner, exercising the
Tauri command surface that the `#[cfg(feature = "tauri-runtime")]`
gate hides from the Linux run.

### 2. TypeScript contract tests (vitest + JSON fixtures)

Contract tests assert that the typed contracts accept the canonical
JSON fixtures. They live under
`apps/desktop/src/lib/__tests__/contracts.test.ts` and use
`readContractFixture` from `@paperu/test-fixtures`:

```ts
const fixture = await readContractFixture<InspectFileResponse>(
  "inspect-file-response",
);
expect(fixture.path).toBe("/home/paperu/fixtures/report.pdf");
expect(fixture.size.bytes).toBe(1_048_576);
```

The same fixtures are the canonical reference for the Rust
serialization tests. Both sides must accept them. Changing a
fixture is a contract change requiring Integrator sign-off.

Run with `pnpm run test` (or `pnpm --filter @paperu/desktop test`).

### 3. Component tests (vitest + @testing-library/react)

Component tests exercise the React UI with a mocked IPC backend.
They live under each feature's `__tests__/` directory (e.g.
`apps/desktop/src/features/inspect/__tests__/InspectView.test.tsx`).

The mock registry is in `apps/desktop/src/lib/ipc.ts`:

```ts
export function __mockCommand(cmd: string, fn: MockHandler): void;
export function __clearMocks(): void;
```

A test registers a mock for a command name, renders the component,
fires events, and asserts the DOM. Production never mocks — the
`__mockCommand` registry is a no-op when running inside the Tauri
shell (the real `invoke` is used).

Example from `InspectView.test.tsx`:

```ts
__mockCommand(CommandName.InspectFile, () => sampleResponse);
render(<InspectView />);
dropFile("/home/paperu/fixtures/report.pdf");
await waitFor(() => {
  expect(screen.getByText("report.pdf")).toBeInTheDocument();
});
```

The sample response used in tests is a synthetic `InspectFileResponse`
that mirrors the canonical fixture in
`packages/test-fixtures/src/contracts/inspect-file-response.json`.

### 4. The full `pnpm check` gate

`pnpm check` runs all three layers plus the formatting and lint
gates. It is the canonical pre-merge gate. CI runs an equivalent
combination across three jobs.

---

## Fixtures policy

`packages/test-fixtures` is the home for synthetic test data and
canonical JSON contract fixtures.

### What is allowed

- **Synthetic content.** The `SYNTHETIC_PAYLOAD` constant is a
  deterministic non-secret string. Use it for file content where a
  non-empty payload is needed.
- **Canonical JSON fixtures.** Under `src/contracts/`, each fixture
  is a JSON document with a `$schema` field naming the contract and
  a `$comment` field recording the rule that both sides must accept
  it. Examples: `inspect-file-response.json`, `app-error.json`.
- **Generated test data.** Tests may generate data programmatically
  (e.g. `uuid::Uuid::new_v4()` for temp file names). This is
  preferred over committed binary fixtures.
- **Small, deterministic payloads.** Where a file is needed, write
  it in the test using `std::fs::write` to a `TempWorkspace` or to
  `std::env::temp_dir().join("paperu-test-{uuid}")`.

### What is prohibited

- **Real user documents.** Never commit a real PDF, image, document
  or spreadsheet. Even with permission, the file may contain
  metadata (EXIF, author tags, embedded paths) that violates
  privacy.
- **Copyrighted content.** No excerpts from copyrighted works.
- **Personal data.** No names, emails, addresses, phone numbers,
  real paths from a contributor's machine.
- **Secrets.** No licence keys, API tokens, passwords, private
  keys.
- **Large binaries.** Keep the repository lean. Generate large
  payloads in the test, do not commit them.

The Guardian enforces this policy in review.

---

## How to add a regression fixture

When a bug is fixed, the Guardian adds a regression test that fails
on the unpatched code and passes on the patched code. See
`REGRESSIONS.md` for the entry format.

Steps:

1. **Reproduce the bug.** Capture the minimal failing input or
   scenario. Use synthetic data only.
2. **Write the fix.** On a `fix/*` branch.
3. **Write the regression test.** Place it next to the code it
   guards:
   - Rust: a new `#[test]` function inside the relevant module's
     `#[cfg(test)] mod tests` block.
   - TypeScript: a new `it(...)` or `test(...)` in the relevant
     `__tests__/` file.
4. **Confirm the test fails on the unpatched code.** Stash the
   fix, run the test, confirm it fails. Unstash the fix, run the
   test, confirm it passes.
5. **If the regression involves a contract shape** (e.g. a new
   error code, a new optional field), add or update the JSON
   fixture under `packages/test-fixtures/src/contracts/`. Both the
   Rust serialization test and the TypeScript parse test must accept
   it.
6. **Record the regression** in `REGRESSIONS.md` with the entry
   format.
7. The Integrator reviews and merges. The regression entry stays
   in `REGRESSIONS.md` permanently.

### Test naming

- Rust: `snake_case`, descriptive. Example:
  `atomic_finalize_refuses_existing_without_overwrite`.
- TypeScript: a short, human-readable sentence. Example:
  `"renders a structured error when inspect fails"`.

### Test isolation

- Rust tests that touch the filesystem use a unique temp directory
  (`std::env::temp_dir().join(format!("paperu-test-{}", uuid))`)
  and call `purge()` at the end. The `unique_ws()` helper in
  `temp.rs::tests` does this.
- TypeScript tests use `beforeEach(() => __clearMocks())` to reset
  the mock registry between cases.
- No test depends on the state of another test. Each test sets up
  its own world.

---

## The mock registry

`apps/desktop/src/lib/ipc.ts` exposes:

```ts
export function __mockCommand(cmd: string, fn: MockHandler): void;
export function __clearMocks(): void;
```

When a command has a registered mock, the typed IPC client calls
the mock instead of `invoke`. When no mock is registered and Tauri
is not present (`window.__TAURI_INTERNALS__` absent), the client
throws a structured `internal.not_implemented` error. When Tauri
is present, the real `invoke` is called.

This means:

- Component tests run in jsdom without Tauri. They mock the
  commands they need.
- A component test that forgets to mock a command will see the
  `internal.not_implemented` error, which is a clear signal.
- Production code never mocks — the `__mockCommand` registry is
  only consulted when the test calls it.

---

## Coverage

`vite.config.ts` enables vitest coverage with `reporter: ["text",
"html"]` and includes `src/**/*.{ts,tsx}`. Coverage is a guide, not
a gate. The foundation does not enforce a coverage threshold; the
Guardian uses coverage to identify untested paths.

The Rust side does not yet enforce coverage. `cargo tarpaulin` (or
similar) may be added in a future hardening pass.

---

## What is not yet tested

- **End-to-end UI tests against the real Tauri shell.** There is no
  Playwright/WebDriver test that launches the desktop app and drives
  it. Component tests use the mocked IPC.
- **Property-based tests.** The foundation uses example-based tests.
  A future pass may introduce `proptest` for path validation and
  the contract serializers.
- **Mutation testing.** Not yet in place.

These are intentional foundation boundaries. See
`KNOWN_LIMITATIONS.md`.
