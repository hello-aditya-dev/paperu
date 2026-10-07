# Paperu

Paperu is a Windows-first, local-first file workspace. It is a desktop
application built with Tauri 2, Rust, React 19 and TypeScript that runs
privacy-preserving document and file utilities directly on the user's
computer. Core operations never upload user files. The first real
end-to-end capability, Local File Inspect, is implemented and proves the
full stack: React → typed IPC contracts → Tauri command → Rust
filesystem layer → structured result → UI.

This repository contains the foundation: the typed contracts, the
unified error model, the filesystem abstraction, the SQLite state store
with migrations, the settings system, the task engine, structured
logging, design tokens, the Local File Inspect proof, the CI pipeline
and the Windows packaging configuration. Real processing engines (PDF
compress, image resize, metadata removal, signing, etc.) are not yet
implemented; the `engines/` Rust module is reserved as the boundary
where they will live.

- **Product identity:** Paperu (identifier `app.paperu.desktop`).
- **Current version:** `0.1.0` (foundation).
- **Licence:** proprietary. See `LICENSE` and `DEPENDENCIES.md`.

---

## Architecture summary

```
React 19 (apps/desktop/src)
   │  speaks only @paperu/contracts
   ▼
@paperu/contracts (packages/contracts)  ← single source of truth
   │  typed IPC shapes (request/response/error/events)
   ▼
Tauri 2 IPC boundary (apps/desktop/src-tauri/capabilities/default.json)
   │  only core:default + dialog:allow-open
   ▼
Rust commands (apps/desktop/src-tauri/src/commands)
   │  validate every input server-side, return Result<T, AppError>
   ▼
Domain modules: filesystem / settings / tasks / licensing / engines
   │
   ▼
Local filesystem (source untouched, atomic finalization)
SQLite (app state only — never document contents) at
   %LOCALAPPDATA%/app.paperu.desktop/paperu.db
```

Key invariants:

1. **Local-first.** User documents never leave the machine for core
   operations. There is no network client in the core file path.
   `security::REMOTE_UPLOAD_PERMITTED == false`.
2. **Non-destructive.** Operations write to a temp workspace, validate
   the output, and atomically move it into place. A failed operation
   never destroys or corrupts the source. See
   `docs/architecture/file-handling.md`.
3. **Contract-first.** `@paperu/contracts` is the formal agreement
   between React and Rust. Both sides mirror the same types and
   contract tests assert the JSON shapes match canonical fixtures.
4. **Typed errors.** Every IPC failure is a structured `AppError` with
   a stable code, category, severity and recoverability. The UI never
   receives raw strings or Rust panics.
5. **Cancellable tasks.** Long operations run as tasks with a
   lifecycle, real progress and a first-class cancellation primitive.
   The UI thread is never blocked.
6. **No telemetry by default.** `allowDiagnostics` defaults to `false`
   and no diagnostics are sent today. See `docs/decisions/0009-no-telemetry.md`.

The `tauri-runtime` cargo feature gates the desktop shell. Without it,
the core modules (errors, contracts, filesystem, database, settings,
tasks, logging, security, licensing) compile and test on any platform
without GTK or WebView system libraries — this is how CI verifies core
logic on Linux runners.

---

## Prerequisites

| Tool           | Version        | Notes                                                         |
| -------------- | -------------- | ------------------------------------------------------------- |
| Node.js        | 20.0+          | Required by the workspace root `engines` field.               |
| pnpm           | 12.9.1+        | The pinned package manager (`packageManager` field).         |
| Rust           | 1.99.0 (stable)| Pinned via `rust-toolchain.toml`. MSVC target on Windows.     |
| Tauri 2 system deps | per platform | See "Windows dev setup" and "Known limitations".              |

The Rust toolchain is pinned to channel `1.99.0` with `rustfmt` and
`clippy` components and the `x86_64-pc-windows-msvc` target.

---

## Windows dev setup

Windows is the primary target. The CI pipeline at `.github/workflows/ci.yml`
runs the full Tauri production build on `windows-latest`.

1. **Install Rust.** Use `rustup`. The `rust-toolchain.toml` file pins
   the channel and components automatically.

   ```powershell
   rustup default 1.99.0
   rustup target add x86_64-pc-windows-msvc
   ```

2. **Install the MSVC build tools.** Tauri on Windows links against the
   MSVC ABI. Install "Visual Studio Build Tools 2022" with the "Desktop
   development with C++" workload, which provides `cl.exe`, the Windows
   SDK and the MSVC linker.

3. **Install WebView2.** Tauri 2 uses the WebView2 runtime. Windows 11
   ships it; Windows 10 may need the Evergreen Bootstrapper from
   Microsoft. The Tauri bundle config defaults to
   `webviewInstallMode: downloadBootstrapper` for installer builds.

4. **Install Node.js 20+ and pnpm.**

   ```powershell
   corepack enable
   corepack prepare pnpm@12.9.1 --activate
   ```

5. **Install dependencies and run.**

   ```powershell
   pnpm install
   pnpm dev:tauri
   ```

`pnpm dev:tauri` launches the Tauri shell against the Vite dev server
on `http://localhost:1420`. `pnpm dev` runs only the Vite dev server
(useful for frontend iteration without the native shell).

---

## Dev commands

All commands are run from the repository root unless noted.

| Command                  | What it does                                                                |
| ------------------------ | --------------------------------------------------------------------------- |
| `pnpm install`           | Install all workspace dependencies from `pnpm-lock.yaml`.                   |
| `pnpm dev`               | Start the Vite dev server only (frontend iteration, no native shell).       |
| `pnpm dev:tauri`         | Start the full Tauri desktop app (Rust + Vite) on Windows.                   |
| `pnpm typecheck`         | Run `tsc --noEmit` across every workspace package.                         |
| `pnpm lint`              | Run ESLint across every workspace package (`--max-warnings 0`).             |
| `pnpm test`               | Run vitest across every workspace package.                                 |
| `pnpm test:rust`         | Run `cargo test` for the Tauri workspace (core modules, no `tauri-runtime`).|
| `pnpm fmt:rust`          | Format the Rust code with `cargo fmt`.                                     |
| `pnpm fmt:rust:check`    | Verify Rust formatting without writing (`--check`).                        |
| `pnpm clippy`            | Run `cargo clippy --all-targets -- -D warnings` on the core crate.          |
| `pnpm check`             | The full pre-merge gate: typecheck, lint, test, fmt check, clippy, rust tests. |
| `pnpm build`             | Build the frontend production bundle (`tsc --noEmit && vite build`).       |
| `pnpm build:tauri`       | Build the Windows desktop installer (NSIS + MSI) via Tauri.                 |
| `pnpm tauri build`       | Alias used in release notes; equivalent to `pnpm build:tauri`.             |
| `pnpm clean`             | Remove `dist/`, `node_modules/`, `.turbo/` and `target/`.                   |

`pnpm check` is the canonical gate. CI runs an equivalent combination
of these commands across the `frontend`, `rust-core` and
`windows-build` jobs.

---

## Repository structure

```
paperu/
├── package.json                 # workspace root scripts + devDeps
├── pnpm-workspace.yaml          # workspace: apps/* + packages/*
├── pnpm-lock.yaml               # frozen lockfile (CI uses --frozen-lockfile)
├── tsconfig.base.json           # shared TS compiler options
├── eslint.config.js             # shared ESLint flat config
├── rust-toolchain.toml          # pinned Rust channel + components + target
├── LICENSE                      # proprietary commercial licence
├── apps/
│   └── desktop/
│       ├── package.json         # @paperu/desktop (React + Vite)
│       ├── vite.config.ts       # Vite + vitest config, port 1420
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx         # React entry
│       │   ├── app/App.tsx      # shell: header, Outlet, footer
│       │   ├── routes/          # react-router routes
│       │   ├── features/inspect/  # Local File Inspect UI
│       │   ├── lib/ipc.ts       # typed Tauri IPC client
│       │   ├── lib/format.ts    # display formatters
│       │   ├── hooks/useTheme.ts
│       │   ├── components/      # AppInfoBadge, PrivacyFooter
│       │   └── styles/          # global + app CSS
│       └── src-tauri/
│           ├── Cargo.toml      # Rust crate `paperu` (lib + bin)
│           ├── Cargo.lock
│           ├── tauri.conf.json  # Tauri config (productName, CSP, bundle)
│           ├── build.rs        # gates tauri_build behind the feature
│           ├── capabilities/default.json  # core:default + dialog:allow-open
│           ├── migrations/0001_init.sql
│           ├── icons/           # platform icons (Windows, iOS, Android)
│           └── src/
│               ├── main.rs      # bin entry; gates on tauri-runtime
│               ├── lib.rs       # crate root; module wiring; run()
│               ├── state.rs     # AppState { db, tasks, app_data_dir }
│               ├── commands/    # inspect.rs, settings.rs, mod.rs
│               ├── contracts/   # Rust mirror of @paperu/contracts
│               ├── database/    # SQLite open + migrations
│               ├── engines/      # placeholder (ENGINES_AVAILABLE = false)
│               ├── errors/       # unified AppError model
│               ├── filesystem/  # paths, inspect, temp workspace
│               ├── licensing/    # entitlement abstraction
│               ├── logging/      # tracing + rotating file appender
│               ├── security/     # local-first invariants
│               ├── settings/     # typed settings over SQLite
│               └── tasks/        # cancellable task registry
├── packages/
│   ├── contracts/               # @paperu/contracts (TS source of truth)
│   ├── design-tokens/           # @paperu/design-tokens (CSS tokens)
│   ├── ui/                      # @paperu/ui (React primitives)
│   └── test-fixtures/           # @paperu/test-fixtures (synthetic + JSON)
├── .github/workflows/ci.yml     # frontend, rust-core, windows-build
└── docs/                        # architecture, security, decisions, etc.
```

---

## Agent workflow

This repository is developed by a three-agent model. The full roles are
documented in `AGENTS.md` and `CONTRIBUTING.md`. Summary:

- **Builder** — implements features and bug fixes on `feature/*` or
  `fix/*` branches. Cannot merge to `main`. Avoids touching shared
  infrastructure without Integrator approval.
- **Guardian** — owns regression tests, breaks the build deliberately
  to find weaknesses, debugs and verifies. Cannot merge to `main`.
- **Integrator** — owns `main`, the architecture, the contracts, the
  dependencies, the migrations, the CI and the releases. Final merge
  authority.

Files that require Integrator approval before changes are listed in
`AGENT_HANDOFF.md` and include `package.json`, `pnpm-workspace.yaml`,
`Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, the `capabilities/`
directory, anything under `packages/contracts`, database migrations,
design tokens, CI workflows and shared architecture files.

---

## Security and privacy principles

Paperu's threat model is local-first. The full model is documented in
`SECURITY.md` and `docs/security/threat-model.md`. Summary:

1. **User documents never leave the machine for core operations.** No
   network client exists in the core file-operation path.
2. **No telemetry by default.** No analytics, crash uploads or remote
   logging are sent. Local logs are rotated and bounded.
3. **Restrictive Tauri capabilities.** The frontend is granted only
   `core:default` and `dialog:allow-open`. No arbitrary shell, no
   broad filesystem scope, no network scope.
4. **CSP enforced.** `default-src 'self'`; script-src restricted to
   `'self'`; no `unsafe-eval`. See `tauri.conf.json`.
5. **Server-side path validation.** Every user-supplied path is
   re-validated in Rust: absolute, non-empty, no Windows reserved
   names, no reserved characters, traversal prevention.
6. **Non-destructive file model.** Source files are never modified
   in place. Outputs are written to a temp workspace, validated, then
   atomically moved into place.
7. **No secrets in errors or logs.** Error messages and log lines
   never embed file contents, licence keys or tokens.
8. **`#![forbid(unsafe_code)]`** at the crate root. The Rust codebase
   is `unsafe`-free.
9. **Permissive third-party licences only.** GPL/AGPL dependencies are
   prohibited. See `DEPENDENCIES.md` and
   `docs/decisions/0008-dependency-policy.md`.
10. **No code-signing certificate yet.** Releases are documented in
    `docs/releases/workflow.md`. Authenticode signing will be added
    when a certificate is procured; the updater (when enabled) will
    verify signatures.

---

## Documentation map

- `CONTRIBUTING.md` — how to contribute.
- `SECURITY.md` — full security and privacy policy.
- `DEPENDENCIES.md` — every important dependency, version, purpose, licence.
- `AGENTS.md` — the three-agent model.
- `AGENT_HANDOFF.md` — live status and Integrator-controlled files.
- `BUGS.md` — severity definitions; current bug status.
- `REGRESSIONS.md` — regression tracking; currently empty.
- `KNOWN_LIMITATIONS.md` — what the foundation does not yet do.
- `CHANGELOG.md` — semantic versioning; starts at `0.1.0`.
- `docs/architecture/` — overview, contracts, file-handling, database,
  crash-recovery, testing, licensing, engines.
- `docs/security/threat-model.md` — the local-first threat model.
- `docs/decisions/` — ADRs 0001–0010.
- `docs/releases/workflow.md` — release workflow and code-signing plan.
- `docs/features/local-file-inspect.md` — the first vertical proof.

---

## Licence

Copyright © 2026 Paperu. All rights reserved. Proprietary commercial
licence — see `LICENSE`. Third-party dependencies retain their original
licences; see `DEPENDENCIES.md`.
