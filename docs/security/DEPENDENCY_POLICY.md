# Paperu — Dependency Security Policy

Every dependency in Paperu is reviewed for security, licence, and
maintenance before it is added. Dependencies are continuously audited.

---

## Policy

### Addition

Before a dependency is added:
1. The Builder proposes it in a `chore/deps-add-<name>` branch.
2. The Builder records: name, version, purpose, licence, maintenance
   state, commercial compatibility, platform support, why existing
   stack cannot solve it.
3. The Guardian verifies `pnpm check` passes and no prohibited licence
   is introduced.
4. The Integrator reviews, approves, and merges. The dependency is
   added to `DEPENDENCIES.md` and `CAPABILITY_PROVENANCE.md` in the
   same merge.

### Prohibited licences

- GPL (1.0, 2.0, 3.0)
- AGPL (3.0 and later)
- LGPL (for static linking into closed-source binary)
- SSPL
- BUSL
- Creative Commons NonCommercial
- Any licence with a "not for commercial use" clause

### Allowed licences

- MIT
- Apache-2.0
- BSD-2/3-Clause
- ISC
- MPL-2.0 (file-level weak copyleft, acceptable)
- Unicode-DFS-2016
- Zlib
- Other OSI-approved permissive licences

### Pinning

- `Cargo.lock` and `pnpm-lock.yaml` are committed and frozen in CI.
- Dependencies are pinned to exact versions in lockfiles.
- Bumps require Guardian verification.

### Auditing

- `cargo tree` prints the full Rust dependency tree.
- `pnpm why <package>` prints the path a TS dependency enters through.
- Periodic audits are the Integrator's responsibility.
- Known vulnerabilities are checked via `cargo audit` (when available)
  and `pnpm audit`.

---

## Current dependency inventory

### Rust dependencies

| Crate | Version | Licence | Purpose | Security notes |
|---|---|---|---|---|
| `serde` | 1.0 | MIT OR Apache-2.0 | Serialization | No network, no unsafe |
| `serde_json` | 1.0 | MIT OR Apache-2.0 | JSON IPC | No network, no unsafe |
| `thiserror` | 2.0 | MIT OR Apache-2.0 | Error derive | No network, no unsafe |
| `tokio` | 1.53 | MIT | Async runtime | No unsafe in used features |
| `tokio-util` | 0.7 | MIT | CancellationToken | No unsafe |
| `tracing` | 0.1 | MIT | Structured logging | No network, no unsafe |
| `tracing-subscriber` | 0.3 | MIT | Log subscriber | No network, no unsafe |
| `tracing-appender` | 0.2 | MIT | Rotating file appender | Writes to local log dir only |
| `rusqlite` | 0.40 (bundled) | MIT | SQLite state store | Bundled SQLite (public domain). No network. |
| `uuid` | 1.27 | MIT OR Apache-2.0 | UUID generation | No network, no unsafe |
| `chrono` | 0.4 | MIT OR Apache-2.0 | Date/time | No network, no unsafe |
| `tauri` | 2.12 (optional) | MIT OR Apache-2.0 | Desktop shell | IPC runtime, gated by feature |
| `tauri-plugin-dialog` | 2.8 (optional) | MIT OR Apache-2.0 | File-open dialog | No filesystem write, no shell |

### TypeScript dependencies (runtime)

| Package | Version | Licence | Purpose | Security notes |
|---|---|---|---|---|
| `react` | 19.3 | MIT | UI runtime | No network, no unsafe |
| `react-dom` | 19.3 | MIT | DOM renderer | No network |
| `react-router` | 8.4 | MIT | Client routing | No network |
| `zustand` | 5.0 | MIT | State store | No network, no persistence by default |
| `@tauri-apps/api` | 2.12 | MIT OR Apache-2.0 | IPC bindings | No arbitrary access |
| `@tauri-apps/plugin-dialog` | 2.8 | MIT OR Apache-2.0 | Dialog JS bindings | No filesystem write |
| `pdf-lib` | 1.17.1 | MIT | PDF manipulation | No network, no eval, no WASM. Pure JS. |
| `pdfjs-dist` | 4.8.69 | Apache-2.0 | PDF rendering | Uses web worker. No network. Worker CSP may need `worker-src 'self'`. |
| `@paperu/contracts` | workspace | proprietary | IPC contracts | No network |
| `@paperu/design-tokens` | workspace | proprietary | CSS tokens | No network |
| `@paperu/ui` | workspace | proprietary | UI primitives | No network |

---

## Supply chain

- CI uses `pnpm install --frozen-lockfile` and `cargo` against locked
  lockfiles.
- Release artifacts are built in CI, not on local machines.
- No production binary comes from an unknown local machine state.
- SBOM generation is planned for future releases.
- Malware scanning of release artifacts is planned for future releases.

---

## Vulnerability response

1. If a vulnerability is reported in a dependency, the Integrator
   assesses severity and exposure.
2. If the vulnerability affects Paperu, the dependency is bumped to a
   patched version in a hotfix.
3. If no patch is available, the Integrator evaluates mitigation
   (feature flag, temporary removal, or advisory).
4. The incident is recorded in `INCIDENT_RESPONSE.md`.
