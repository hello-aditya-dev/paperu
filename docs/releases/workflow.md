# Release workflow

This document describes how a change travels from a feature branch
to a tagged Windows release artifact, and how code-signing fits
into the pipeline. It is the operational counterpart to
`CONTRIBUTING.md` (which describes the contribution discipline) and
`AGENT_HANDOFF.md` (which tracks the live release status).

For the three-agent model (Builder, Guardian, Integrator), see
`AGENTS.md`. For bug severity definitions, see `BUGS.md`. For the
list of files that require Integrator approval, see
`CONTRIBUTING.md` and `AGENT_HANDOFF.md`.

---

## Branch model

All work happens on branches off `main`. `main` is always green and
always releasable.

| Prefix      | Use                                                                  |
| ----------- | -------------------------------------------------------------------- |
| `feature/`  | New capability or user-visible behaviour. Example: `feature/pdf-compress`. |
| `fix/`      | A bug fix. Example: `fix/inspect-reserved-name`.                     |
| `release/`  | Release preparation branches and tags. Example: `release/0.2.0`.     |
| `docs/`     | Documentation-only changes. Example: `docs/threat-model-clarification`. |
| `chore/`    | Tooling, dependency bumps (Integrator-approved), refactors.         |
| `test/`     | Guardian-driven regression test additions.                           |

Branch names use `kebab-case`. They never include the author's name,
the date, or ticket numbers in the branch name itself (use the PR
body for traceability).

---

## The path from feature to release

```
feature/foo  ──►  Guardian verifies (pnpm check + regression tests)
                │
                v
                Integrator reviews (architecture, contracts, security,
                release-readiness)
                │
                v
                Squash-merge to main (CI re-runs on main)
                │
                v
                main is green and releasable
                │
                v
                Integrator cuts release/x.y.z from main
                │
                v
                Guardian verifies the release branch
                │
                v
                Integrator tags vX.Y.Z
                │
                v
                Windows runner builds the installer
                (pnpm tauri build --features tauri-runtime)
                │
                v
                (Future) Sign installer + updater artifact
                │
                v
                Publish (manual; no auto-publish)
```

### Step 1: Builder opens a feature branch

The Builder creates a `feature/` (or `fix/`) branch off `main`,
implements the change, writes tests for their own work, and runs
`pnpm check` locally until it passes.

The PR body lists:

- what changed and why;
- which contracts (if any) are affected;
- which Integrator-controlled files (if any) are touched;
- the corresponding ADR (if a decision was made or revised);
- the Guardian verification status (filled in by the Guardian, not
  the Builder).

### Step 2: Guardian verifies

The Builder's PR is not ready for Integrator review until the
Guardian has run `pnpm check` (or `scripts/check.sh`) on the branch
and either:

- confirmed the full gate passes, or
- documented why a specific failure is expected and out of scope.

The Guardian additionally verifies:

- New contract shapes have a JSON fixture in
  `packages/test-fixtures/` and both the Rust serialization test
  and the TypeScript parse test accept it.
- New error codes are covered by a contract fixture and an
  end-to-end UI test where applicable.
- Non-destructive file operations are exercised by a temp-workspace
  test that asserts the source is unchanged.
- No test commits real user documents, secrets, or paths from the
  contributor's machine.
- For a bug fix: a regression test that fails on the unpatched code
  and passes on the patched code, recorded in `REGRESSIONS.md`.

The Guardian posts the verification result on the PR.

### Step 3: Integrator reviews

The Integrator reviews for:

- architecture (does the change fit the layer model? does it cross
  module boundaries cleanly?);
- contracts (is the change to a contract shape justified? is the
  fixture updated?);
- security and privacy (does the change relax an invariant in
  `src/security/`, `capabilities/default.json`, `tauri.conf.json`
  CSP, or the DB schema?);
- release-readiness (does the change introduce a P0 or P1 bug?
  see `BUGS.md`).

The Integrator either:

- merges (squash by default), or
- requests changes.

CI re-runs on `main` after merge. A red `main` is a P0 and is
treated per `BUGS.md`.

### Step 4: Integrator cuts a release branch

When the Integrator decides the foundation (or a feature release)
is ready to tag, they cut a `release/x.y.z` branch from `main`. The
release branch is for last-minute fixes only; feature work continues
on `main`.

### Step 5: Guardian verifies the release branch

The Guardian runs `pnpm check` on the release branch and confirms
the gate is green. Any P0 or P1 bug discovered blocks the release
until fixed.

### Step 6: Integrator tags

The Integrator tags the release branch as `vX.Y.Z`. The tag is the
release artifact's provenance. The tag message references the
release notes (in `CHANGELOG.md`).

### Step 7: Windows runner builds the installer

The Windows CI job runs:

```
pnpm install --frozen-lockfile
pnpm tauri build --features tauri-runtime
```

This produces:

- the MSI / NSIS installer under
  `apps/desktop/src-tauri/target/release/bundle/`;
- (if updater artifacts are enabled) the updater signature file.

Today, the Tauri updater is disabled
(`createUpdaterArtifacts: false`). When enabled, the updater
artifacts will be produced alongside the installer.

### Step 8: Sign (future)

Code-signing is documented below. No certificate is in the
repository today. The CI signing step is documented but not
active.

### Step 9: Publish (manual)

There is **no auto-publish**. The Integrator manually:

1. Downloads the built installer from the Windows CI artifact.
2. Verifies the file hash.
3. (Future) Verifies the Authenticode signature.
4. Uploads to the distribution channel (eg. the Paperu website,
   GitHub Releases).
5. Updates `CHANGELOG.md` and `AGENT_HANDOFF.md` with the release
   version and SHA.

---

## Semantic versioning

Paperu follows [Semantic Versioning 2.0](https://semver.org/), with
the `0.x` caveats explicitly noted:

- **Starting version:** `0.1.0`. The foundation ships as `0.1.0`.
- During `0.x`, **minor versions may include breaking changes**.
  This is the SemVer carve-out for `0.x` software: the public API
  is not yet stable. Breaking changes during `0.x` are recorded in
  `CHANGELOG.md` under the minor version that introduced them.
- After `1.0.0`, breaking changes require a major version bump.

### What counts as a breaking change

For Paperu, a breaking change is any of:

- A change to a contract shape in `packages/contracts/**` that is
  not backward-compatible (renaming a field, removing an optional,
  adding a required field, splitting an enum, changing a constant
  value).
- A change to the on-disk database schema that the running code
  cannot migrate from (eg. dropping a column the prior version
  wrote).
- A change to the application identifier
  (`app.paperu.desktop`) or the install path
  (`%LOCALAPPDATA%/app.paperu.desktop/`).
- A change to a Tauri command's argument shape that the prior
  frontend would not send correctly.

### What does NOT count as a breaking change

- Adding a new optional field to a contract response.
- Adding a new enum variant (the prior frontend ignores it).
- Adding a new command (the prior frontend does not call it).
- Adding a new database migration (the prior binary refuses to
  open a newer-than-build DB; the new binary migrates forward).
- Adding a new error code (the prior frontend renders unknown
  codes as a generic error).

### Version sources

The version is recorded in three places that must agree:

- `package.json` (root) — `version`.
- `apps/desktop/src-tauri/Cargo.toml` — `version`.
- `apps/desktop/src-tauri/tauri.conf.json` — `version`.

A release PR updates all three in the same commit. The Integrator
verifies they agree before tagging.

---

## Code-signing

Code-signing is **not yet active**. The repository contains no
certificate, no signing keys, and no signing password. The CI
secrets store will hold them at release time only. See
`.env.example` for the placeholder secret names.

This section documents the **plan**. Each subsection becomes active
when the corresponding certificate is procured and the secret is set
in CI.

### Authenticode (installer signing)

Authenticode is the Windows code-signing scheme that attaches a
digital signature to an executable or installer. A signed installer:

- displays the publisher ("Paperu") instead of "Unknown publisher"
  in SmartScreen and the UAC prompt;
- allows the installer to be verified as coming from Paperu and not
  tampered with since signing.

The signing flow:

1. The Integrator procures an Authenticode certificate (OV or EV)
   from a trusted CA. EV certificates require hardware storage
   (eg. a USB token or HSM); OV certificates can be a `.pfx` file.
2. The certificate's private key is stored as a CI secret
   (eg. `WINDOWS_SIGNING_CERTIFICATE` base64-encoded and
   `WINDOWS_SIGNING_PASSWORD`).
3. The Windows CI job, after building the installer, signs it with
   `signtool` (Windows SDK) using the certificate.
4. The signed installer is uploaded as a CI artifact.
5. The Integrator downloads the signed installer, verifies the
   signature locally, and publishes it.

The signature is over the installer file as a whole. The end user
verifies the signature implicitly through Windows SmartScreen and
explicitly through the file's Properties > Digital Signatures tab.

### Installer signing vs. binary signing

- The **installer** (MSI / NSIS) is signed with Authenticode.
- The **inner binaries** (`paperu.exe` and any sidecar DLLs) are
  signed with Authenticode as well. Tauri's bundler can sign these
  in the same step.
- The **WebView2 runtime** is a Microsoft system component, not
  signed by Paperu.

### Updater signature verification

The Tauri updater plugin (currently disabled; see
`tauri.conf.json`'s `createUpdaterArtifacts: false`) verifies update
packages cryptographically before applying them. When the updater
is enabled:

1. A signing keypair is generated. The **private key** is stored as
   a CI secret (`TAURI_SIGNING_PRIVATE_KEY`); the **password** for
   the private key is stored as a separate secret
   (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
2. The **public key** is embedded in `tauri.conf.json`'s
   `plugins.updater.pubkey` field. This is committed; it is not a
   secret.
3. The Windows CI job, after building the installer, signs the
   updater artifact (`*.msi.zip` or similar) with the private key.
4. On the user's machine, the running Paperu downloads the updater
   artifact, verifies the signature against the embedded public
   key, and refuses to apply an update whose signature does not
   verify.

This means a compromised download mirror cannot push a malicious
update: the signature would not verify against the public key
embedded in the user's installed copy of Paperu.

Today, `TAURI_SIGNING_PRIVATE_KEY=""` (empty) in CI. The updater
does not run. The signing plan is documented here so that, when the
updater is enabled, the discipline is already in place.

### What is NOT signed today

- The installer is not Authenticode-signed (no certificate yet). The
  CI artifact is unsigned. Users who download it will see "Unknown
  publisher" in SmartScreen. This is acceptable for the foundation's
  internal validation; it is not acceptable for a public release.
- The inner binaries are not signed.
- The updater is disabled; no updater signature exists.

### When signing becomes active

When the Integrator procures a certificate:

1. Add the secret to CI (`WINDOWS_SIGNING_CERTIFICATE`,
   `WINDOWS_SIGNING_PASSWORD`).
2. Add a `signtool` step to the Windows CI job after the Tauri
   build.
3. Update this document and `AGENT_HANDOFF.md` to record that
   signing is active.
4. Cut a release that is signed.

When the updater is enabled:

1. Generate the signing keypair.
2. Add `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to CI secrets.
3. Embed the public key in `tauri.conf.json`'s
   `plugins.updater.pubkey`.
4. Set `createUpdaterArtifacts: true`.
5. Cut a release that produces updater artifacts.
6. Update this document and `AGENT_HANDOFF.md`.

---

## No auto-publish

Paperu does **not** auto-publish. There is no CD pipeline that
pushes a release to users on every merge to `main`. Every release
is a deliberate Integrator action.

The reasons:

1. **Releases are infrequent and deliberate.** The foundation is
   `0.1.0`; subsequent releases are milestone-driven, not
   commit-driven.
2. **Signing is a manual gate today.** Without auto-signing, there
   is no point auto-publishing an unsigned artifact.
3. **The Integrator is the final authority.** A release that breaks
   the local-first invariant, ships a P0 bug, or forgets to update
   `CHANGELOG.md` must not happen automatically.
4. **The updater is disabled.** Even when the updater is enabled,
   publishing an update is a deliberate act: the updater artifact
   is signed, the manifest is updated, the manifest is uploaded to
   the update server.

When the updater is enabled, the auto-publish question may be
revisited (eg. "auto-publish patch releases for P0 fixes"). That
is a separate ADR.

---

## Release checklist

Before tagging `vX.Y.Z`, the Integrator confirms:

- [ ] `main` is green (`pnpm check` passes; CI is green).
- [ ] No P0 or P1 bug is open (see `BUGS.md`).
- [ ] `CHANGELOG.md` is updated with the version, date, and notable
      changes.
- [ ] `package.json`, `Cargo.toml`, and `tauri.conf.json` versions
      agree.
- [ ] The release branch `release/x.y.z` is cut from the agreed
      `main` SHA.
- [ ] The Guardian has verified the release branch.
- [ ] The Windows CI job produced the installer.
- [ ] (Future) The installer is Authenticode-signed.
- [ ] (Future) The updater artifact is signed and the public key is
      embedded in `tauri.conf.json`.
- [ ] `AGENT_HANDOFF.md` is updated with the release version, tag,
      and SHA.
- [ ] The tag `vX.Y.Z` is pushed.

---

## References

- `CONTRIBUTING.md` — the contribution discipline.
- `AGENT_HANDOFF.md` — live release status.
- `CHANGELOG.md` — release history.
- `BUGS.md` — severity definitions.
- `.env.example` — placeholder secret names (none set today).
- `apps/desktop/src-tauri/tauri.conf.json` — Tauri bundle config.
- `.github/workflows/ci.yml` — CI pipeline (CI jobs).
- `docs/decisions/0008-dependency-policy.md` — signing toolchain
  is part of the toolchain pinning.
- `docs/decisions/0009-no-telemetry.md` — the updater must not
  introduce telemetry.
- `docs/decisions/0010-commercial-licensing-boundary.md` — no
  production keys are committed.
