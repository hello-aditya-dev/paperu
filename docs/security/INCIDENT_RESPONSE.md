# Paperu — Incident Response

This document describes how Paperu responds to security incidents,
vulnerability reports, and post-release defects.

---

## Incident severity

| Severity | Definition | Response time | Examples |
|---|---|---|---|
| **Critical (P0)** | Data loss, RCE, credential leak, privacy violation | Immediate — fix or revert within hours | Path traversal, arbitrary shell, file content upload |
| **High (P1)** | Major workflow broken, repeatable crash, significant privacy issue | Before next release | Cancel button doesn't cancel, encrypted note plaintext leak |
| **Medium (P2)** | Usability/performance issue, edge-case defect | Next release cycle | Slow on large files, dark-mode contrast |
| **Low (P3)** | Cosmetic, minor polish | Tracked, not blocking | Typo, focus ring color |

---

## Response process

### 1. Report

- Anyone can report a suspected vulnerability.
- Security/privacy issues follow the disclosure process in
  `SECURITY.md` (not a public issue).
- The Guardian triages and assigns a severity.

### 2. Assess

- The Integrator assesses exposure: is Paperu actually affected? Which
  versions? Which platforms?
- The Guardian verifies reproducibility.

### 3. Fix

- A Builder opens a `fix/security-<short-description>` branch.
- The fix is implemented with a regression test.
- The Guardian verifies the fix and the regression test.
- The Integrator reviews and merges.

### 4. Release

- If the incident is P0: a hotfix release is cut immediately.
- If the incident is P1: the fix ships in the next release.
- If the incident is P2/P3: the fix ships when ready.

### 5. Document

- The incident is recorded in the table below.
- The regression test location is noted.
- If the incident affected a released version, users are notified via
  the changelog and (for P0) a security advisory.

---

## Incident log

| ID | Date | Severity | Summary | Affected versions | Fix | Regression test |
|---|---|---|---|---|---|---|
| _(none — no incidents to date)_ | — | — | — | — | — | — |

---

## Post-incident review

After a P0 or P1 incident is resolved:
1. How was it discovered?
2. How could it have been caught earlier?
3. What test or process change would prevent a recurrence?
4. Is the threat model (`THREAT_MODEL.md`) updated?
5. Are the security invariants (`SECURITY_INVARIANTS.md`) still
   complete?

The review is recorded as a comment in the incident log entry.
