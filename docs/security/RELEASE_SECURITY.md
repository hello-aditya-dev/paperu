# Paperu — Release Security

Security requirements that must be satisfied before a Paperu release
is published. These are enforced by the Integrator at release time
and verified by Guardian before the release verdict.

---

## Pre-release security checklist

### Code

- [ ] `pnpm check` green (typecheck, lint, tests, cargo fmt, clippy, cargo test)
- [ ] `#![forbid(unsafe_code)]` intact (no unsafe introduced)
- [ ] No new dependencies without Integrator approval + licence audit
- [ ] No secrets in source code, Git history, or the frontend bundle
- [ ] CSP is restrictive (`default-src 'self'`, no `unsafe-eval`)
- [ ] Tauri capabilities are least-privilege (`core:default` + `dialog:allow-open` only, unless an ADR approved more)

### Signing

- [ ] **Windows**: Authenticode-signed with a stable certificate
- [ ] **macOS**: Developer ID signed, Hardened Runtime, notarized, ticket stapled
- [ ] **Linux**: Checksums published; signatures where practical
- [ ] No signing credentials committed to the repository

### Updates

- [ ] Update artifacts are cryptographically signed
- [ ] The client rejects invalid signatures
- [ ] No configuration switch disables update verification in production
- [ ] Update endpoint uses HTTPS
- [ ] Private update-signing key is not in the repository

### Artifacts

- [ ] SHA-256 checksums generated for all downloadable binaries
- [ ] SBOM (Software Bill of Materials) generated where practical
- [ ] Malware scan run on release artifacts
- [ ] Release artifacts built in CI, not on a local machine
- [ ] False positives investigated, not ignored

### Privacy

- [ ] No analytics, crash uploads, or telemetry sent without explicit opt-in
- [ ] No document contents, filenames, or metadata in diagnostics
- [ ] `allowDiagnostics` defaults to `false`
- [ ] `0 bytes uploaded` claims are technically verifiable

### Network

- [ ] Core file operations have no network calls
- [ ] `security::REMOTE_UPLOAD_PERMITTED == false`
- [ ] Network allowlist is explicit (licence endpoint, update endpoint, user-initiated features only)
- [ ] No arbitrary internet access from the core file path

---

## Release blockers (P0)

A release is **blocked** if any of these are true (see `BUGS.md`):

- Data loss
- Source file corruption
- Remote code execution
- Arbitrary command execution
- Arbitrary file overwrite
- Path traversal
- Credential leak
- Private-data upload
- Licence bypass with security impact
- Update signature bypass
- Protected note exposure
- Application Kit exposure
- Malicious archive escape
- Serious sandbox/capability escape

---

## Release blockers (P1)

A release is **held** (not blocked, but not shipped) if:

- A major advertised workflow is broken
- A serious platform regression exists
- A significant privacy issue exists
- A repeatable crash exists
- Major memory exhaustion exists

---

## Post-release

- Monitor for vulnerability reports
- If a P0 is found post-release: patch immediately or revoke the release
- Record the incident in `INCIDENT_RESPONSE.md`
- Add a regression test for the vulnerability
