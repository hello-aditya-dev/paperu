# Paperu — Data Classification

This document classifies all data Paperu handles and the protection
applied to each class. It ensures sensitive data receives appropriate
protection (doctrine §62).

---

## Classification levels

| Level | Description | Examples | Protection |
|---|---|---|---|
| **PUBLIC** | Non-sensitive, freely shareable | App version, UI language, theme preference, window size | Stored in settings JSON. No encryption. |
| **SENSITIVE** | Personal but not identity-level | Recent file paths, task history, clipboard history, note titles (unlocked), bookmarks, reading position | Stored in SQLite or settings. No encryption by default. User can clear. |
| **HIGHLY SENSITIVE** | Identity, financial, or biometric | Application Kit documents (passport, ID, certificates), signatures, locked notes, business financial records, licence tokens, API credentials | Encrypted at rest. OS secure storage for keys. Never logged. Never uploaded. |

---

## Data inventory

### Settings (PUBLIC)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| `theme` | PUBLIC | SQLite settings table | No |
| `defaultConflictStrategy` | PUBLIC | SQLite settings table | No |
| `defaultOutputDir` | SENSITIVE | SQLite settings table | No |
| `recentFilesLimit` | PUBLIC | SQLite settings table | No |
| `updatePreference` | PUBLIC | SQLite settings table | No |
| `reducedMotion` | PUBLIC | SQLite settings table | No |
| `allowDiagnostics` | PUBLIC | SQLite settings table | No (defaults to false) |

### Recent files (SENSITIVE)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Path | SENSITIVE | In-memory (Zustand) | No |
| FileName | SENSITIVE | In-memory | No |
| Kind | PUBLIC | In-memory | No |
| Size | PUBLIC | In-memory | No |
| Operation | PUBLIC | In-memory | No |

**Note**: Recent files are in-memory only (reset on restart) in the
current implementation. If persisted to SQLite in the future, paths
remain SENSITIVE (not encrypted, but user can clear).

### Working file / staged output (SENSITIVE)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Path | SENSITIVE | In-memory (Zustand) | No |
| Metadata | SENSITIVE | In-memory | No |

**Note**: The staged file is a reference to a real file on disk. The
file itself is not copied or encrypted by the store.

### Signatures (HIGHLY SENSITIVE)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Signature PNG bytes | HIGHLY SENSITIVE | In-memory only | No (in-memory) |

**Current**: Signatures exist only in memory during the Sign operation.
They are never persisted, never logged, never uploaded.

**Future (Signature Vault)**: When signatures are saved for reuse,
they must be encrypted at rest using OS secure storage for the key.
See doctrine §32.

### Application Kit (HIGHLY SENSITIVE — future)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Passport photo | HIGHLY SENSITIVE | Encrypted local storage | Yes (when implemented) |
| ID documents | HIGHLY SENSITIVE | Encrypted local storage | Yes (when implemented) |
| Resume | HIGHLY SENSITIVE | Encrypted local storage | Yes (when implemented) |
| Forms Vault data | HIGHLY SENSITIVE | Encrypted local storage | Yes (when implemented) |

**Status**: Not yet implemented. When implemented, must use
authenticated encryption with keys from OS secure storage.

### Notes (SENSITIVE / HIGHLY SENSITIVE)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Unlocked note content | SENSITIVE | Local files or SQLite | No |
| Locked note content | HIGHLY SENSITIVE | Encrypted local storage | Yes (when implemented) |
| Note metadata (title, tags) | SENSITIVE | Local files or SQLite | No |

**Status**: Notes are not yet implemented. Locked notes must use
authenticated encryption (doctrine §22).

### Clipboard history (SENSITIVE)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Clipboard text | SENSITIVE | In-memory or SQLite | No |
| Clipboard images | SENSITIVE | In-memory or temp files | No |

**Status**: Not yet implemented. Must be disable-able, with exclusion
mechanisms for password managers (doctrine §90).

### Licence tokens (HIGHLY SENSITIVE — future)

| Field | Classification | Storage | Encryption |
|---|---|---|---|
| Licence token | HIGHLY SENSITIVE | OS secure storage | Yes (keychain/DPAPI) |
| Device ID | SENSITIVE | OS secure storage | Yes |

**Status**: Not yet implemented. Must never be in plaintext JSON or
logs.

---

## Protection requirements by level

### PUBLIC
- No encryption required.
- Safe to include in logs (version, theme).
- Safe to include in anonymous diagnostics (if opt-in).

### SENSITIVE
- No encryption required by default.
- User must be able to clear/delete.
- Not included in diagnostics.
- Paths may appear in logs (truncated) for debugging, but never file
  contents.

### HIGHLY SENSITIVE
- **Encrypted at rest** using authenticated encryption.
- Keys from OS secure storage (macOS Keychain, Windows DPAPI, Linux
  secret-service).
- **Never logged.** No plaintext in logs, error messages, or temp
  files.
- **Never uploaded.** No network transmission without explicit user
  action.
- Thumbnails/preview caches must be cleaned when the source is deleted.
- Search indexes must not leak plaintext from encrypted content.

---

## Data lifecycle

1. **Creation**: Data is created by user action (save a file, add a
   note, store a signature).
2. **Storage**: Data is stored according to its classification.
3. **Use**: Data is accessed only for the user's explicit operation.
4. **Deletion**: When the user deletes data, all derivatives
   (thumbnails, indexes, temp files) are removed.
5. **Honesty**: Ordinary deletion is not guaranteed secure erase on
   SSDs. Paperu does not promise forensic erasure (doctrine §96).
