# Paperu dependency governance

This document lists every important dependency the Paperu codebase
relies on. It is the authoritative source for the Integrator's
dependency policy and for licence audits.

## Policy

- **Permissive licences only.** MIT, Apache-2.0, BSD-2/3-Clause, ISC,
  MPL-2.0 (file-level weak copyleft, acceptable), Unicode-DFS-2016,
  Zlib and other OSI-approved permissive licences are allowed.
- **GPL, AGPL, LGPL (with linking concerns) and other strong-copyleft
  licences are prohibited.** No dependency under `gpl-*`, `agpl-*` or
  other StrongCopyleft categories may be added to either the Rust or
  the TypeScript dependency graph.
- **The Integrator owns dependency changes.** Adding, removing or
  bumping a dependency requires Integrator approval (see
  `CONTRIBUTING.md`).
- **Lockfiles are committed.** `Cargo.lock` and `pnpm-lock.yaml` are
  checked in. CI uses `pnpm install --frozen-lockfile` and
  `cargo` against the locked lockfile. Builds are reproducible.
- **Bundled native dependencies preferred.** `rusqlite` uses the
  `bundled` feature so SQLite's C source is compiled into the
  binary; the desktop app does not dynamically link against a system
  SQLite.
- **Toolchain is pinned.** `rust-toolchain.toml` pins Rust
  `1.99.0` with `rustfmt`, `clippy` and the `x86_64-pc-windows-msvc`
  target. `package.json` pins `pnpm@12.9.1` and `node >=20.0.0`.

This policy is also recorded as ADR
`docs/decisions/0008-dependency-policy.md`.

---

## Rust dependencies

Source: `apps/desktop/src-tauri/Cargo.toml` (with resolved versions
from `apps/desktop/src-tauri/Cargo.lock`).

| Crate                  | Specifier   | Resolved | Purpose                                                                 | Licence          | Bundled? | Commercial-use notes                                  |
| ---------------------- | ------------ | -------- | ----------------------------------------------------------------------- | ---------------- | -------- | ----------------------------------------------------- |
| `serde`                | `1.0`        | 1.0.229  | Serialization framework for the contract types and the IPC payloads.    | MIT OR Apache-2.0| no       | Permissive.                                           |
| `serde_json`           | `1.0`        | 1.0.151  | JSON serialization used by the IPC and settings persistence.             | MIT OR Apache-2.0| no       | Permissive.                                           |
| `thiserror`            | `2.0`        | 2.0.21   | Derive `Error` for the unified error model and domain error types.      | MIT OR Apache-2.0| no       | Permissive. Note: `1.0.69` is also present transitively. |
| `tokio`                | `1.53` (rt-multi-thread, sync, macros, fs, io-util, time) | 1.53.2 | Async runtime for the task engine and async filesystem operations. | MIT              | no       | Permissive.                                           |
| `tokio-util`           | `0.7`        | 0.7.19   | `CancellationToken` primitive used by the task engine.                  | MIT              | no       | Permissive.                                           |
| `tracing`              | `0.1`        | 0.1.44   | Structured, async-aware diagnostic tracing.                             | MIT              | no       | Permissive.                                           |
| `tracing-subscriber`   | `0.3` (env-filter, fmt, json) | 0.3.23 | Layered tracing subscriber (JSON file appender + optional stderr).   | MIT              | no       | Permissive.                                           |
| `tracing-appender`     | `0.2`        | 0.2.5    | Non-blocking, daily-rotating file appender for local logs.              | MIT              | no       | Permissive.                                           |
| `rusqlite`             | `0.40` (bundled) | 0.40.2 | Local SQLite state store (settings, task history, licence state).     | MIT              | **yes** (bundled SQLite C source) | Bundled SQLite is public domain (see below). |
| `uuid`                 | `1.27` (v4, serde) | 1.27.0 | UUIDv4 generation for task ids and temp file names.                  | MIT OR Apache-2.0| no       | Permissive.                                           |
| `chrono`               | `0.4` (serde) | 0.4.45   | Date/time handling; ISO-8601 UTC timestamps for contracts and logs.     | MIT OR Apache-2.0| no       | Permissive. Includes `iana-time-zone` (MIT OR Apache-2.0) transitively. |
| `tauri`                | `2.12` (optional) | 2.12.1 | The desktop shell + IPC runtime, gated by the `tauri-runtime` feature. | MIT OR Apache-2.0| no       | Permissive. Optional dependency.                      |
| `tauri-plugin-dialog`  | `2.8` (optional) | 2.8.1  | Native file-open dialog used by the inspect UI.                          | MIT OR Apache-2.0| no       | Permissive. Optional dependency.                      |
| `tauri-build`          | `2.7` (build-dep, optional) | 2.7.1 | Tauri build script (resource embedding, context generation).         | MIT OR Apache-2.0| no       | Permissive. Build-time only.                          |

### Notes on transitive Rust dependencies

- **SQLite.** `rusqlite` with the `bundled` feature compiles the
  SQLite amalgamation into the binary. SQLite is in the **public
  domain** (the SQLite Blessing). It is not GPL. Bundling it avoids
  any system-library licence surprise and removes the runtime
  dependency on a system `libsqlite3`.
- **Webview / WRY / TAO.** Tauri 2 depends on `wry` (the webview
  abstraction) and `tao` (the window abstraction). On Windows these
  wrap the WebView2 runtime and Win32 APIs. Their licences are
  permissive (MIT OR Apache-2.0).
- **Native GUI toolkits on Linux.** When building with the
  `tauri-runtime` feature on Linux, Tauri pulls GTK and related
  crates. These are LGPL-licensed system libraries dynamically
  linked; this does not affect the Paperu source licence. Linux
  builds are not shipped — Windows is the only release target today
  (see `KNOWN_LIMITATIONS.md`).
- **`thiserror` 1.x and 2.x** both appear in the lockfile because
  some transitive dependency still pins 1.x. The Paperu source uses
  `thiserror 2.0`. Both versions are MIT OR Apache-2.0 licensed.

---

## TypeScript dependencies

Source: `package.json` (root), `apps/desktop/package.json`,
`packages/contracts/package.json`, `packages/design-tokens/package.json`,
`packages/ui/package.json`, `packages/test-fixtures/package.json`,
with resolved versions from `pnpm-lock.yaml`.

### Runtime dependencies (ship to the user)

| Package                       | Specifier  | Resolved | Purpose                                                              | Licence | Bundled? | Commercial-use notes                              |
| ----------------------------- | ---------- | -------- | -------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------- |
| `react`                       | `^19.3.0`  | 19.3.0   | The React UI runtime used by the desktop frontend.                   | MIT     | bundled into dist | Permissive.                                  |
| `react-dom`                   | `^19.3.0`  | 19.3.0   | React DOM renderer (client side of the webview).                     | MIT     | bundled into dist | Permissive.                                  |
| `react-router`                | `^8.4.0`   | 8.4.0    | Client-side routing (HomeRoute, future feature routes).              | MIT     | bundled into dist | Permissive.                                  |
| `zustand`                     | `^5.0.15`  | 5.0.15   | Lightweight client state store (settings cache, theme).             | MIT     | bundled into dist | Permissive.                                  |
| `@tauri-apps/api`             | `^2.12.1`  | 2.12.1   | Tauri JavaScript IPC bindings (`invoke`, `listen`).                  | MIT OR Apache-2.0 | bundled into dist | Permissive.                          |
| `@tauri-apps/plugin-dialog`   | `^2.8.1`   | 2.8.1    | Dialog plugin JS bindings (`open()`).                                 | MIT OR Apache-2.0 | bundled into dist | Permissive.                          |
| `@paperu/contracts`          | `workspace:*` | local | The IPC contract source of truth (this repo).                        | proprietary | bundled into dist | Owned by Paperu; Integrator-controlled.    |
| `@paperu/design-tokens`      | `workspace:*` | local | Semantic CSS design tokens.                                          | proprietary | bundled into dist | Owned by Paperu; Integrator-controlled.    |
| `@paperu/ui`                 | `workspace:*` | local | Shared UI primitives.                                                | proprietary | bundled into dist | Owned by Paperu; Integrator-controlled.    |

### Build-time / dev dependencies (do not ship)

| Package                       | Specifier  | Resolved | Purpose                                                              | Licence | Commercial-use notes                              |
| ----------------------------- | ---------- | -------- | -------------------------------------------------------------------- | ------- | ------------------------------------------------- |
| `typescript`                  | `^6.0.3`   | 6.0.3    | The TypeScript compiler.                                             | Apache-2.0 | Permissive. Dev-only.                          |
| `vite`                        | `^8.3.3`   | 8.3.3    | The frontend dev server and production bundler.                      | MIT     | Permissive. Dev-only.                             |
| `vitest`                      | `^5.0.3`   | 5.0.3    | The test runner (contract tests, component tests).                   | MIT     | Permissive. Dev-only.                             |
| `@vitejs/plugin-react`        | `^6.1.2`   | 6.1.2    | Vite plugin for React 19 (Fast Refresh, JSX transform).              | MIT     | Permissive. Dev-only.                             |
| `eslint`                      | `^10.12.0` | 10.12.0  | Linter for the TypeScript packages.                                  | MIT     | Permissive. Dev-only.                             |
| `@eslint/js`                  | `^10.0.1`  | 10.0.1   | ESLint recommended JS config.                                        | MIT     | Permissive. Dev-only.                             |
| `typescript-eslint`           | `^8.71.1`  | 8.71.1   | ESLint TypeScript parser and plugin.                                 | MIT     | Permissive. Dev-only.                             |
| `eslint-plugin-react`        | `^7.37.5`  | 7.37.5   | React-specific ESLint rules.                                         | MIT     | Permissive. Dev-only.                             |
| `eslint-plugin-react-hooks`   | `^7.1.1`   | 7.1.1    | Rules of hooks + exhaustive-deps lint.                               | MIT     | Permissive. Dev-only.                             |
| `eslint-plugin-react-refresh`| `^0.5.7`   | 0.5.7    | Fast Refresh boundary lint.                                          | MIT     | Permissive. Dev-only.                             |
| `globals`                     | `^17.13.0` | 17.13.0  | Browser/node globals definitions for ESLint.                          | MIT     | Permissive. Dev-only.                             |
| `@types/node`                 | `^22.10.0` | 22.20.5  | Node.js type definitions for build scripts.                          | MIT     | Permissive. Dev-only.                             |
| `@types/react`                | `^19.0.0`  | 19.3.0   | React 19 type definitions.                                            | MIT     | Permissive. Dev-only.                             |
| `@types/react-dom`            | `^19.0.0`  | 19.3.0   | React DOM 19 type definitions.                                        | MIT     | Permissive. Dev-only.                             |
| `@testing-library/react`     | `^16.3.3`  | 16.3.3   | React component testing utilities.                                   | MIT     | Permissive. Dev-only.                             |
| `@testing-library/jest-dom`   | `^7.0.1`   | 7.0.1    | DOM assertion matchers for vitest.                                   | MIT     | Permissive. Dev-only.                             |
| `jsdom`                        | `^30.1.2`  | 30.1.2   | DOM implementation for vitest's `jsdom` environment.                  | MIT     | Permissive. Dev-only.                             |
| `@tauri-apps/cli`             | `^2.12.1`  | 2.12.1   | The `tauri` CLI (dev server, build, packaging).                      | MIT OR Apache-2.0 | Permissive. Dev-only.                          |
| `@paperu/test-fixtures`      | `workspace:*` | local | Synthetic test payloads + JSON contract fixtures.                    | proprietary | Owned by Paperu. Dev-only.                     |
| `rimraf`                      | `^6.0.1`   | 6.1.3    | Cross-platform `rm -rf` for the `clean` script.                      | ISC     | Permissive. Dev-only.                             |

### Notes on transitive TypeScript dependencies

- **Vite** pulls Rollup, esbuild and PostCSS transitively. All are
  MIT-licensed.
- **jsdom** pulls a small CSS color parser (`@asamuzakjp/css-color`)
  and other DOM-related packages. All are MIT-licensed.
- **The bundle output** is built by Vite into `apps/desktop/dist/`
  and embedded into the Tauri binary by `tauri-build`. Only runtime
  dependencies are in the bundle; dev dependencies do not ship.

---

## Prohibited licences

The following licence families are prohibited for any new dependency,
whether direct or transitive:

- **GPL** (GPL-1.0, GPL-2.0, GPL-3.0)
- **AGPL** (AGPL-3.0 and any later)
- **LGPL** (LGPL-2.0, LGPL-2.1, LGPL-3.0) for static linking into a
  closed-source binary. LGPL-2.1+ as a dynamically-linked system
  library (e.g. GTK on Linux) is acceptable only when not shipped.
- **SSPL** (Server Side Public License)
- **BUSL** (Business Source License) and other source-available but
  not open-source licences.
- **Creative Commons NonCommercial** (CC-BY-NC-*) variants.
- **Any licence with a "not for commercial use" clause.**

When in doubt, the Integrator makes the final call and records the
decision as an ADR.

---

## Adding a dependency

To add a new dependency:

1. The Builder proposes the addition in a `chore/deps-add-<name>`
   branch.
2. The Builder records: name, version, purpose, licence, whether
   bundled, commercial-use implications.
3. The Guardian verifies `pnpm check` still passes and that no
   prohibited licence is introduced (check the lockfile diff and the
   package's `LICENSE`).
4. The Integrator reviews, approves, and merges. The new dependency
   is added to this document in the same merge.

For a Rust dependency, the same flow applies, with the additional
check that `cargo audit` (when available) reports no advisories on
the new crate.

---

## Auditing

- `Cargo.lock` and `pnpm-lock.yaml` are the source of truth for
  resolved versions.
- `cargo tree --manifest-path apps/desktop/src-tauri/Cargo.toml`
  prints the full Rust dependency tree.
- `pnpm why <package>` prints the path a TypeScript dependency enters
  through.
- Periodic audits are the Integrator's responsibility; results are
  recorded as ADRs or release notes.
