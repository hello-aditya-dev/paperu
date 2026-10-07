# ADR 0008: Dependency policy

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/Cargo.toml`,
  `apps/desktop/src-tauri/Cargo.lock`,
  `package.json` (root), `apps/desktop/package.json`,
  `packages/*/package.json`, `pnpm-lock.yaml`,
  `DEPENDENCIES.md`

## Context

Paperu ships a single signed Windows installer to end users. Every
dependency in the build graph becomes part of that installer — either
compiled into the binary (Rust crates, bundled SQLite) or bundled
into the webview's JS payload (npm packages). The dependency graph
is therefore a security, licence and maintainability surface, not
just a convenience.

The risks an uncontrolled dependency policy creates:

1. **Licence contamination.** A single GPL-licensed transitive
   dependency can force the entire binary under GPL terms, ending
   the commercial product.
2. **Supply-chain compromise.** Every dependency is a potential
   vector for a malicious update. The larger the graph, the larger
   the attack surface.
3. **Bloated binaries.** Dependencies that overlap in functionality
   (`moment` *and* `date-fns`, `lodash` *and* native methods) inflate
   the installer without benefit.
4. **Silent drift.** Without a single owner, dependencies accrete.
   "Just one more library" becomes thirty over a year.
5. **Reproducibility loss.** Without lockfiles, builds vary between
   machines and over time. A CI build that passes today may fail
   tomorrow because a transitive dep published a breaking version.

## Decision

### 1. Permissive licences only

Permitted licence families:

- MIT
- Apache-2.0
- BSD-2-Clause, BSD-3-Clause
- ISC
- MPL-2.0 (file-level weak copyleft, acceptable)
- Unicode-DFS-2016
- Zlib
- Other OSI-approved permissive licences, subject to Integrator
  review.
- Public domain (eg. SQLite via the SQLite Blessing).

Prohibited licence families:

- **GPL** (GPL-1.0, GPL-2.0, GPL-3.0)
- **AGPL** (AGPL-3.0 and any later)
- **LGPL** for static linking into a closed-source binary.
  LGPL-2.1+ as a dynamically-linked system library (eg. GTK on
  Linux) is acceptable only when not shipped.
- **SSPL** (Server Side Public License)
- **BUSL** (Business Source License) and other source-available but
  not open-source licences
- **Creative Commons NonCommercial** (CC-BY-NC-*) variants
- **Any licence with a "not for commercial use" clause**

### 2. The Integrator controls new dependencies

Adding, removing, or bumping a dependency requires Integrator
approval (see `CONTRIBUTING.md`). The Integrator-controlled file
list explicitly includes:

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/Cargo.lock`
- `package.json` (root)
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `packages/*/package.json`

A Builder or Guardian may prepare a branch that touches these files,
but they cannot merge it themselves.

### 3. Conservative dependency count

Every dependency must have a clear reason. Before adding one, the
contributor must answer:

- What does it do that we cannot reasonably do ourselves?
- Is it actively maintained?
- Is it permissively licensed?
- Is it bundled or a runtime link?
- What is its commercial-use implication?
- Are there existing dependencies that already provide this
  capability?

If the answer is "I do not want to write 50 lines of code," that is
not sufficient reason. The dependency graph is a permanent
liability; the 50 lines are not.

The current graph is documented in `DEPENDENCIES.md`. Notable
choices:

- **`rusqlite` with the `bundled` feature.** Compiles the SQLite
  amalgamation into the binary. SQLite is public domain. Bundling
  avoids any system-library licence surprise and removes the runtime
  dependency on a system `libsqlite3`. See ADR
  `0004-sqlite.md`.
- **No HTTP client in the core file-operation path.** The Rust
  `Cargo.toml` does not depend on `reqwest`, `hyper`, `ureq`, or any
  other general-purpose HTTP client. This is the local-first
  invariant operationalized — see ADR
  `0002-local-first-processing.md`. Adding an HTTP client is a
  contract change requiring an ADR.
- **No `mime_guess` crate.** The inspect path uses a curated MIME
  map rather than pulling a dependency. Fewer deps, smaller binary.
- **No code-generation tool for contracts.** The Rust mirror of
  `@paperu/contracts` is hand-written. Code generation (eg. `ts-rs`)
  was considered and deferred — the surface is small enough that
  hand-mirroring is clearer and avoids a new build dependency. See
  ADR `0005-typed-ipc-contracts.md`.

### 4. Lockfiles are committed and frozen in CI

- `Cargo.lock` and `pnpm-lock.yaml` are checked in.
- CI uses `pnpm install --frozen-lockfile` and the cargo build
  respects the locked lockfile.
- Builds are reproducible. A passing CI build today will pass
  tomorrow.

### 5. Bundled native dependencies preferred

Where a native library is needed, prefer a Rust crate that bundles
the C source (eg. `rusqlite` with `bundled`). This:

- removes the runtime dependency on a system library;
- guarantees a known version;
- avoids any system-library licence surprise;
- simplifies the install story (no "install libsqlite3 first").

### 6. Toolchain is pinned

- `rust-toolchain.toml` pins Rust `1.99.0` with `rustfmt`, `clippy`
  and the `x86_64-pc-windows-msvc` target.
- `package.json` pins `pnpm@12.9.1` and `node >=20.0.0`.

Toolchain bumps are Integrator-controlled.

### 7. Adding a dependency: the flow

1. The Builder proposes the addition in a `chore/deps-add-<name>`
   branch.
2. The Builder records in the PR: name, version, purpose, licence,
   whether bundled, commercial-use implications.
3. The Guardian verifies `pnpm check` still passes and that no
   prohibited licence is introduced (check the lockfile diff and
   the package's `LICENSE`).
4. The Integrator reviews, approves, and merges. The new dependency
   is added to `DEPENDENCIES.md` in the same merge.

For a Rust dependency, the same flow applies, with the additional
check that `cargo audit` (when available) reports no advisories on
the new crate.

## Consequences

### Positive

- **No licence contamination.** The prohibited-licence list keeps
  the binary commercially shippable. The Integrator is the final
  authority and records the decision in `DEPENDENCIES.md`.
- **Reproducible builds.** Committed lockfiles and a pinned
  toolchain mean CI and local builds match.
- **Small, auditable graph.** Every dependency has a documented
  reason in `DEPENDENCIES.md`. The graph is small enough that a
  periodic audit (a few hours) is tractable.
- **No silent accretion.** The Integrator gate ensures every new
  dependency is a deliberate decision.

### Negative

- **Slower to add a dependency.** The flow is real ceremony. This
  is the price of the invariant.
- **Sometimes a dependency is the right call and we still have to
  justify it.** The "clear reason" bar is enforced; a contributor
  who wants a convenience library must argue for it.
- **`cargo audit` is not yet wired into CI.** It is the
  Integrator's responsibility to run it periodically. A future
  hardening pass may add it to CI.

## Non-goals

- **No vendoring of dependencies by default.** Lockfiles are the
  reproducibility mechanism. Vendoring every dep is heavy and
  unnecessary for a small graph.
- **No SBOM generation.** A future hardening pass may add CycloneDX
  or SPDX SBOM generation for the release artifact. Not in scope
  for the foundation.
- **No automatic licence scanning.** The Guardian's manual check is
  the gate. Automated scanning may be added later.

## References

- `DEPENDENCIES.md` — the authoritative list and licence audit.
- `apps/desktop/src-tauri/Cargo.toml` — Rust dependencies.
- `package.json`, `apps/desktop/package.json`,
  `packages/*/package.json` — TypeScript dependencies.
- `rust-toolchain.toml` — pinned Rust toolchain.
- `CONTRIBUTING.md` — Integrator-controlled file list and the
  dependency-add flow.
- `docs/decisions/0002-local-first-processing.md` — the no-HTTP-client
  invariant.
- `docs/decisions/0004-sqlite.md` — the `rusqlite` bundled choice.
- `docs/decisions/0005-typed-ipc-contracts.md` — no code generation.
