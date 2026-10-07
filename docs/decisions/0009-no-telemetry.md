# ADR 0009: No telemetry

- **Status:** Accepted
- **Date:** Foundation pass (pre-`0.1.0`)
- **Decision owner:** Integrator
- **Affected code:** `apps/desktop/src-tauri/src/security/**`,
  `apps/desktop/src-tauri/src/logging/**`,
  `apps/desktop/src-tauri/src/settings/**`,
  `packages/contracts/src/settings.ts`

## Context

Paperu's trust promise is that user documents are processed locally
and never uploaded (ADR `0002-local-first-processing.md`). That
promise covers *file contents*. There is a parallel question the
user will also ask: "What does Paperu tell the developer about me?"

Without an explicit policy, the default drift is toward "more
telemetry": a contributor adds an analytics event "to understand how
users use the feature," then a crash uploader "to debug field
issues," then a "anonymous usage statistics" toggle that defaults
on, then a "we promise it's anonymous" campaign. Each step is small
and individually defensible. The cumulative result is a product that
phones home constantly.

The threat this ADR defends against is the silent drift toward
surveillance, not the existence of telemetry per se. The decision is
not "telemetry is evil"; it is "telemetry is opt-in, off by default,
and any future change requires a deliberate architecture decision."

## Decision

Paperu ships **no telemetry, no analytics, no crash uploading, no
cloud sync by default.** The constant in `src/security/mod.rs`
codifies the default:

```rust
pub const TELEMETRY_DEFAULT_ON: bool = false;
```

This is consistent with ADR `0002-local-first-processing.md`
(`LOCAL_FIRST = true`, `REMOTE_UPLOAD_PERMITTED = false`) and with
the `Settings.allowDiagnostics` field, which defaults to `false` and
is reserved for a future opt-in diagnostics feature.

### What "no telemetry" means concretely

1. **No analytics events.** The frontend does not call any analytics
   SDK; the Rust backend does not emit analytics events. There is
   no `track()` function in the codebase.
2. **No crash uploading.** Crashes are caught at the command
   boundary, written to the local structured log at
   `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`, and surfaced
   to the user as a structured `AppError`. They are not uploaded.
3. **No cloud sync.** Settings, task history, and licence state are
   local-only (ADR `0004-sqlite.md`). There is no sync.
4. **No "anonymous usage statistics."** No counter is sent anywhere.
5. **No remote logging.** The tracing sink is a local file appender
   only (`tracing-appender`). See ADR
   `0002-local-first-processing.md`.
6. **No third-party SDKs that phone home.** The dependency policy
   (ADR `0008-dependency-policy.md`) gates new dependencies; an
   analytics or telemetry SDK would be rejected at the Integrator
   review.

### What "no telemetry" does NOT prohibit

- **Local logging.** The structured tracing sink writes a
  daily-rotated JSON log locally. This is for the user's own
  diagnosis (and ours, if they choose to share the file with us in
  a support thread). It is not uploaded.
- **Local error rendering.** The UI displays structured `AppError`
  values to the user. This is in-product UX, not telemetry.
- **Future opt-in telemetry.** A future feature may add opt-in
  telemetry. It must satisfy the conditions below.

### Conditions for any future telemetry

Any future feature that sends data to a Paperu-controlled server
must:

1. Be **opt-in**, off by default. The user must take a deliberate
   action to enable it. A checkbox that defaults to "off" is the
   minimum; a "Send anonymous diagnostics" toggle in settings is
   the likely surface.
2. Be gated by a **deliberate architecture decision** — a new ADR
   under `docs/decisions/` that names what is collected, why, where
   it is sent, how long it is retained, and how the user can turn
   it off and delete what was collected.
3. Be **reviewed by the Integrator**. The capability file
   (`apps/desktop/src-tauri/capabilities/default.json`) and the CSP
   (`tauri.conf.json`) are Integrator-controlled; adding network
   scope requires Integrator sign-off.
4. **Never upload file contents.** The local-first invariant (ADR
   `0002`) is not relaxed by enabling telemetry. Telemetry may
   carry structured error metadata, anonymised usage counts, or
   performance samples; it may not carry the user's documents.
5. **Never upload secrets.** No licence keys, no API tokens, no
   paths beyond what is necessary for diagnosis (and even then,
   only with explicit user opt-in for that submission).
6. **Make the data flow visible.** The user can see what was sent
   (a log entry, a "last sent" timestamp, an exportable bundle).

### `Settings.allowDiagnostics`

The `Settings` contract includes `allowDiagnostics: boolean`,
defaulting to `false`. It is reserved for the future opt-in
diagnostics feature described above. Until that feature is
implemented, the field has no effect — nothing reads it.

### Crash handling without uploading

A panic in a Tauri command is caught at the command boundary and
converted to a structured `internal.unknown` `AppError`. The
structured tracing log captures the panic's location and message
locally. The UI shows the user a structured error. No upload
happens.

If the user wants to report a crash, they can:

1. Open the local log file at
   `%LOCALAPPDATA%/app.paperu.desktop/logs/paperu.log`.
2. Manually share it in a support thread or bug report.

This is a deliberate friction. We do not optimise for "every crash
auto-reported to us"; we optimise for "the user controls their own
data."

## Consequences

### Positive

- **The trust promise is simple and uniform.** "0 bytes uploaded"
  applies to file contents; "no telemetry" applies to usage data.
  The user does not have to read two policies to understand what
  the product does.
- **No silent drift toward surveillance.** Any future telemetry
  requires an ADR, an opt-in default-off, and Integrator review.
  The default cannot drift without a deliberate decision.
- **Works offline.** No network connection needed for any core
  operation or for any diagnostic the user might want to inspect
  locally.
- **Smaller attack surface.** No telemetry SDK means no telemetry
  SDK vulnerabilities. No crash uploader means no crash uploader
  vulnerabilities.
- **No data to breach server-side.** If we never collect usage
  data, there is no usage database to leak.

### Negative

- **Field bugs are invisible to us by default.** Without a crash
  uploader, we cannot see what is happening in the field
  automatically. We rely on users to report issues and to share
  their local logs.
- **Feature usage is invisible.** We cannot measure which features
  are used or how. Product decisions are made from explicit user
  feedback, not from instrumentation.
- **The opt-in path is real work.** When the team decides to add
  opt-in diagnostics, it is a non-trivial feature: a settings UI, a
  clear data-flow disclosure, a server endpoint, a retention
  policy, and an ADR.

## Non-goals

- **No ban on local diagnostics.** The local log file is allowed
  and encouraged.
- **No ban on the future opt-in telemetry feature.** This ADR
  establishes the default and the conditions; it does not prohibit
  a future opt-in feature that satisfies them.
- **No position on third-party telemetry SDKs that may be added by
  future dependencies.** The dependency policy (ADR
  `0008-dependency-policy.md`) gates new dependencies; an analytics
  SDK would be rejected at the Integrator review.

## References

- `apps/desktop/src-tauri/src/security/mod.rs` — `TELEMETRY_DEFAULT_ON`,
  `LOCAL_FIRST`, `REMOTE_UPLOAD_PERMITTED`.
- `apps/desktop/src-tauri/src/logging/mod.rs` — the local-only
  tracing sink.
- `apps/desktop/src-tauri/src/settings/mod.rs` — `allowDiagnostics`
  default `false`.
- `packages/contracts/src/settings.ts` — `Settings` contract.
- `apps/desktop/src-tauri/capabilities/default.json` — no network
  capability.
- `apps/desktop/src-tauri/tauri.conf.json` — CSP `connect-src`
  restricts to `'self' ipc: http://ipc.localhost`.
- `docs/decisions/0002-local-first-processing.md` — the local-first
  invariant this ADR extends.
- `docs/decisions/0008-dependency-policy.md` — gates any new SDK.
- `docs/security/threat-model.md` — the threat model.
