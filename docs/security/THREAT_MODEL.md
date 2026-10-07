# Paperu — Threat Model

This document describes the threats Paperu is designed to defend
against and the trust boundaries that shape the architecture.

Paperu is a local-first desktop application. The user's files never
leave their machine for core operations. This is not a policy claim —
it is an architectural constraint enforced by the code.

---

## Trust boundaries

```
┌─────────────────────────────────────────────────┐
│  UNTRUSTED                                      │
│  User files (PDFs, images, archives, projects)  │
│  Deep links (paperu://...)                      │
│  Clipboard content                              │
│  Drag-drop payloads                             │
│  Network responses (licence, updates)           │
└──────────────────────┬──────────────────────────┘
                       │ validated, sanitized
                       ▼
┌─────────────────────────────────────────────────┐
│  SEMI-TRUSTED                                   │
│  Tauri webview (React frontend)                 │
│  - No arbitrary filesystem access               │
│  - No arbitrary shell access                    │
│  - No arbitrary network access                  │
│  - Speaks only typed IPC commands               │
└──────────────────────┬──────────────────────────┘
                       │ typed IPC (validated server-side)
                       ▼
┌─────────────────────────────────────────────────┐
│  TRUSTED                                        │
│  Rust backend                                   │
│  - Re-validates every path                      │
│  - Atomic file finalization                     │
│  - #![forbid(unsafe_code)]                      │
│  - No network in core file path                 │
└─────────────────────────────────────────────────┘
```

---

## Threats and mitigations

### T1: Malicious file content (parser exploitation)

**Threat**: A crafted PDF, image, or archive could exploit a parser
vulnerability to achieve arbitrary code execution.

**Mitigation**:
- PDF parsing uses `pdf-lib` (MIT) and `pdfjs-dist` (Apache-2.0), both
  widely deployed and audited libraries.
- `#![forbid(unsafe_code)]` at the Rust crate root — no unsafe Rust.
- File-size limits can be imposed by the engine.
- Cancellation is first-class — long parses can be aborted.
- The webview sandbox limits the blast radius of a parser exploit.

**Residual risk**: A vulnerability in pdfjs or pdf-lib could still
execute within the webview. The Tauri capability surface restricts
what the webview can do (no arbitrary shell, no arbitrary filesystem).

### T2: Path traversal

**Threat**: A user-supplied path could escape the intended directory
(`../` traversal, symlinks, junctions, UNC paths).

**Mitigation**:
- `validate_input_path` canonicalizes every path and rejects relative
  paths, reserved Windows names, and reserved characters.
- Output paths are computed server-side from the source path — the
  frontend never supplies an arbitrary output path.
- `atomic_finalize` refuses existing destinations without explicit
  overwrite.
- Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
  `LPT1-9`) are checked on every platform.

### T3: Source file modification (data loss)

**Threat**: An operation could modify or corrupt the user's original
file.

**Mitigation**:
- Source files are opened read-only.
- Outputs are written to `TempWorkspace` (`%TEMP%/paperu/`), validated,
  then atomically moved into place via `atomic_finalize`.
- A failed operation never touches the source.
- `TempWorkspace.startup_cleanup` removes stale partial outputs on
  every launch.

### T4: Credential/token leakage

**Threat**: Licence tokens, API keys, or encryption keys could leak
into logs, error messages, or the frontend bundle.

**Mitigation**:
- Error messages never embed file contents, licence keys, or tokens
  (documented in the error model).
- Logs never contain file contents or secrets.
- Licence tokens (when implemented) will use OS secure storage
  (keychain/DPAPI), not plaintext JSON.
- The frontend bundle never contains secrets.

### T5: Privacy violation (unintended upload)

**Threat**: User file content, metadata, or filenames could be sent
to an external server without explicit consent.

**Mitigation**:
- `security::REMOTE_UPLOAD_PERMITTED == false` — the core file path
  has no network client.
- No analytics, no crash uploads, no telemetry by default.
- The Tauri CSP restricts `connect-src` to `self` + `ipc:`.
- Future network features (Paperu Send, citation lookup) are explicit,
  user-initiated, and behind separate threat models.

### T6: Archive extraction attacks (Zip Slip, bombs)

**Threat**: A malicious archive could write outside the destination
(Zip Slip) or exhaust disk/memory (decompression bomb).

**Mitigation**:
- Archive extraction (when implemented) must validate every entry path
  against the destination base.
- Decompression limits must be imposed (max entries, max total size,
  max nesting depth).
- This is documented as a P0 release blocker in `BUGS.md`.

### T7: Deep link exploitation

**Threat**: A `paperu://` deep link could trigger destructive actions
without user consent.

**Mitigation**:
- Deep links are untrusted input.
- They must never delete files, execute shell commands, read arbitrary
  paths, or send files without explicit validation/confirmation.
- Deep link handling (when implemented) will validate and prompt.

### T8: WebView content injection

**Threat**: Untrusted web content could gain access to Tauri IPC.

**Mitigation**:
- The webview only loads bundled application code (`default-src 'self'`).
- No arbitrary internet content is displayed inside the privileged
  webview.
- The CSP is restrictive and Integrator-controlled.

---

## Threats not yet fully mitigated

These are tracked as known limitations or future work:

- **Encrypted PDF handling**: The current engine uses
  `ignoreEncryption: true` which handles owner-password-protected PDFs
  but not user-password-protected ones. A user-password PDF will fail
  with a library error that should be caught and presented clearly.
- **Resource exhaustion**: No explicit memory limits on engine
  operations. A 500-page PDF could consume significant memory during
  rasterization. Cancellation is the current mitigation.
- **Fuzzing**: No automated fuzzing of parser boundaries yet
  (doctrine §85). Guardian should manually test malformed inputs.

---

## Update protocol

This threat model is updated when:
- A new feature introduces a new trust boundary or network path.
- A vulnerability is discovered and fixed (add to the regression).
- A new dependency is added (assess its attack surface).
- Guardian identifies a new attack vector during adversarial testing.
