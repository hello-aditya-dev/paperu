# Paperu bug severity and current status

This file defines the bug severity levels used across the project and
records the current open-bug status. It is the source of truth for
whether a change may be merged into a release.

The handoff (which agent owns which bug, on which branch) is in
`AGENT_HANDOFF.md`. The regression suite is in `REGRESSIONS.md`.

---

## Severity definitions

### P0 — release blocker

A P0 bug blocks any release. It must be fixed or the offending
change must be reverted before `main` can be considered releasable.

A bug is P0 when any of the following are true:

- **Data loss.** The operation destroys or corrupts a user file that
  the user did not explicitly consent to lose.
- **Corrupted files.** The application produces a malformed output
  (e.g. a PDF that cannot be opened, an image with truncated bytes)
  and presents it as a success.
- **The app will not start.** A crash on launch, a panic loop, or a
  missing required system component that the app does not gracefully
  degrade from.
- **Security or privacy violation.** Any code path that violates the
  local-first threat model in `SECURITY.md`:
  - User document contents are sent off the machine for a core
    operation.
  - A network client is reachable from the core file-operation path
    without an explicit opt-in.
  - Telemetry or analytics are sent without explicit opt-in.
  - The CSP is bypassable, or the Tauri capabilities grant more than
    `core:default` + `dialog:allow-open` without an approved ADR.
  - A panic surfaces raw Rust panic text to the user (instead of a
    structured `AppError`).
  - A path-validation bypass (e.g. traversal that escapes the
    validated base, reserved-name handling that succeeds on
    Windows).
- **`#![forbid(unsafe_code)]` is removed or bypassed.**

A red `main` (CI failing on the `frontend`, `rust-core` or
`windows-build` job) is treated as a P0 until proven otherwise.

### P1 — major workflow broken

A P1 bug breaks a major user workflow but does not lose data, does
not corrupt files, and does not violate a security invariant. The
app starts.

Examples:

- The Local File Inspect command returns the wrong byte size for
  files larger than 2 GiB.
- A settings patch silently fails to persist.
- The cancel button on a running task does not actually cancel the
  task.
- A contract test fixture diverges from the Rust serialization,
  meaning the contract is broken (but no user-facing failure yet).

A P1 may be merged into `main` (the project continues) but **may not
be merged into a release**. If a P1 is discovered during release
prep, the release is held.

### P2 — important usability or performance

A P2 bug degrades the experience or performance but does not break
the core workflow. The user can complete the task, but the experience
is worse than it should be.

Examples:

- The drop zone does not give feedback while a file is being
  inspected (the user thinks the app is hung).
- A 100 MB file takes 8 seconds to inspect when it should take well
  under 1 second.
- The dark theme has insufficient contrast on one component.
- The privacy footer overflows on a 720px-wide window.

P2 bugs may be merged into `main` and may ship in a release if they
are documented in `KNOWN_LIMITATIONS.md` and there is a planned fix.

### P3 — polish and minor

A P3 bug is cosmetic or minor. The product is fully usable; the bug
is about polish.

Examples:

- A typo in an error message.
- A focus ring is the wrong colour on one button.
- A tooltip does not disappear when the cursor leaves rapidly.

P3 bugs may ship in any release. They are tracked but not blocking.

---

## Release policy

- **No P0 or P1 bug may be knowingly merged into a release.** If a
  P0 or P1 is discovered during release preparation, the release is
  held until the bug is fixed or the bug is formally reclassified
  (with rationale, recorded in this file).
- A red `main` is a P0 and is fixed or reverted immediately.
- P2 and P3 bugs may ship if they are documented in
  `KNOWN_LIMITATIONS.md` and the Integrator accepts the trade-off.
- A release is cut by the Integrator on a `release/x.y.z` branch,
  verified by the Guardian, and tagged. See `docs/releases/workflow.md`.

---

## Current status

**There are no known bugs at any severity.**

The foundation (`0.1.0`) is green on `main`:

- `pnpm check` passes (typecheck, lint, vitest, `cargo fmt --check`,
  `cargo clippy -- -D warnings`, `cargo test`).
- CI is green on all three jobs: `frontend`, `rust-core`,
  `windows-build` (which produces an unsigned Tauri build on
  Windows).
- The Local File Inspect proof works end-to-end against a real file
  on disk.
- Contract fixtures in `packages/test-fixtures/src/contracts/` are
  accepted by both the Rust serialization tests and the TypeScript
  parse tests.
- The temp-workspace tests pass (stale cleanup, atomic finalize,
  refuse-without-overwrite).
- The migration tests pass (idempotent, refuses a newer-than-build
  DB).

### Open bugs

| ID | Severity | Summary | Owner | Status |
| -- | -------- | ------- | ----- | ------ |
| _(none)_ | — | — | — | — |

### Recently closed bugs

| ID | Severity | Summary | Fixed in |
| -- | -------- | ------- | -------- |
| _(none — foundation release)_ | — | — | — |

---

## Reporting a bug

If you believe you have found a bug:

1. Reproduce it. Capture the minimal reproduction: the file path (or
   a synthetic equivalent), the action, the expected behaviour and
   the actual behaviour.
2. Assign a severity using the definitions above. If unsure, default
   to P2 and let the Guardian triage.
3. Record it in `AGENT_HANDOFF.md` under the appropriate agent
   (Builder if a fix is being prepared, Guardian if a regression
   test is being written).
4. If the bug is a security or privacy issue, follow the disclosure
   process in `SECURITY.md` instead of opening a public issue.

The Guardian owns the regression test for any bug fix. The
regression entry is recorded in `REGRESSIONS.md`.

---

## Reclassification

A bug may be reclassified by the Integrator with a recorded
rationale. Reclassification is recorded as a new row in the open or
closed bug table above, with the prior severity noted in the summary
column. Reclassifying a P0 down to a P2 because the release
schedule is tight is **not** acceptable — the bug must be fixed.
