# Paperu — Platform Support Matrix

This document defines the supported platforms + the specific behavior
that differs across them. Paperu is ONE application with native
adapters — no separate implementations per OS.

## Supported platforms

| OS | Architecture | Runner | WebView | File manager |
| --- | --- | --- | --- | --- |
| Windows 10/11 | x64 | `windows-2022` | WebView2 | Explorer |
| macOS (Apple Silicon) | arm64 | `macos-15` | WKWebView | Finder |
| macOS (Intel) | x64 | `macos-13` | WKWebView | Finder |
| Linux (Ubuntu 22.04+) | x64 | `ubuntu-22.04` | WebKitGTK | Nautilus/xdg-open |

## Platform-specific behavior

The `platform` module (`apps/desktop/src-tauri/src/platform/`) uses
`#[cfg(target_os = "...")]` to select the correct adapter. Shared
application logic calls the `PlatformCapabilities` trait; no
platform-specific types leak into shared code.

### Application data directory

| OS | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\paperu` (fallback: `%APPDATA%\paperu`) |
| macOS | `~/Library/Application Support/paperu` |
| Linux | `$XDG_DATA_HOME/paperu` (fallback: `~/.local/share/paperu`) |

### Temp directory

| OS | Path |
| --- | --- |
| Windows | `%TEMP%` (via `std::env::temp_dir()`) |
| macOS | `$TMPDIR` (via `std::env::temp_dir()`) |
| Linux | `$XDG_RUNTIME_DIR` or `/tmp` |

### Reveal in file manager

| OS | Command |
| --- | --- |
| Windows | `explorer.exe /select,<path>` |
| macOS | `open -R <path>` |
| Linux | `xdg-open <parent_dir>` |

### Open with default application

| OS | Command |
| --- | --- |
| Windows | `cmd /c start "" <path>` |
| macOS | `open <path>` |
| Linux | `xdg-open <path>` |

### Hard-link support

| OS | Filesystem | Supports hard links? |
| --- | --- | --- |
| Windows | NTFS | ✅ |
| Windows | FAT/exFAT (USB drives) | ❌ |
| macOS | APFS | ✅ |
| Linux | ext4/xfs/btrfs | ✅ |
| Linux | FAT/network mounts | ❌ |

The `filesystem::publish` module uses `hard_link` for no-overwrite
publication. If the destination filesystem doesn't support hard links
(e.g. a FAT32 USB drive), `publish` returns a structured error —
it never silently falls back to unsafe overwrite.

### Path handling

- All paths use `PathBuf`/`Path`/`OsStr`/`OsString` — never string
  concatenation with `/` or `\\`.
- Windows UNC paths (`\\server\share\...`) are supported.
- Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`)
  are rejected by `filesystem::paths::validate_input_path`.
- Windows long paths (> 260 chars) are supported via the `\\?\`
  prefix (added automatically by the Rust std on Windows).
- macOS Unicode filenames are supported (HFS+/APFS normalize
  differently; we use `OsStr` comparisons).
- Linux case-sensitive filenames are respected (we never lowercase
  paths for comparison).

### External processes

- `std::process::Command` with typed, validated arguments — never
  shell interpolation.
- Bundled executables (e.g. future FFmpeg) are resolved via Tauri's
  app resource directory, not `$PATH`.
- On macOS + Linux, desktop-launched applications may not inherit
  the terminal's PATH — we use absolute paths for bundled binaries.

### Clipboard

- The frontend uses the standard web `navigator.clipboard` API
  (works in all three WebViews: WebView2, WKWebView, WebKitGTK).
- A future `tauri-plugin-clipboard-manager` integration is V2 work
  for auto-capture.

### Single-instance + Open With

- `tauri-plugin-single-instance` handles the single-instance contract.
- On Windows: the first non-flag CLI arg is the file path from
  "Open With". The setup hook validates + emits `paperu://open-file`
  via a delayed async task.
- On macOS: `open -a Paperu <file>` sends the same arg.
- On Linux: `xdg-open <file>` (if Paperu is the default app) does the same.

## Bundle types

| OS | Bundles | Output |
| --- | --- | --- |
| Windows | `nsis,msi` | `paperu_<version>_x64-setup.exe`, `paperu_<version>_x64_en-US.msi` |
| macOS | `app,dmg` | `Paperu.app`, `Paperu_<version>_aarch64.dmg` (or `_x64.dmg`) |
| Linux | `deb,appimage` | `paperu_<version>_amd64.deb`, `paperu_<version>_amd64.AppImage` |

The `tauri.conf.json` uses `"targets": "all"` (the CLI `--bundles`
flag selects the specific bundles per platform in CI).

## Icons

The icon set is at `apps/desktop/src-tauri/icons/`:
- `icon.ico` (Windows)
- `icon.icns` (macOS)
- `32x32.png`, `128x128.png`, `128x128@2x.png` (Linux + fallback)
- Various Windows Store square logos (for MSI/NSIS)
- `icon-source.png` (the high-res source)

To regenerate the icon set from the source:
```bash
cd apps/desktop
pnpm tauri icon src-tauri/icons/icon-source.png
```

## WebView compatibility

Paperu's frontend works with all three WebViews. Audited APIs:
- `navigator.clipboard.readText()` / `writeText()` — supported in all three.
- `canvas` 2D context — supported (pdfjs uses it for rendering).
- `Blob` + `URL.createObjectURL()` — supported; we clean up with `URL.revokeObjectURL()`.
- PDF.js worker — loaded via `new Worker(new URL(...))` (Vite handles the bundling).
- Font rendering — uses the bundled DejaVu Sans Bold TTF for native
  image watermarking (no system font dependency).
- File drag/drop — Tauri's `dragDropEnabled: true` + the
  `onDragDropEvent` API (portable across all three WebViews).

No Chromium-only browser APIs are used in shared code.

## Signing

- **Windows**: unsigned engineering builds are acceptable for CI.
  Production requires an Authenticode certificate (external dependency).
- **macOS**: ad-hoc signing (`codesign -s -`) for engineering builds.
  Production requires Apple Developer ID + notarization (external).
- **Linux**: no signing required for `.deb`/`.AppImage` (checksum-verified).

Signing is documented separately from compilation correctness — see
`docs/qa/90_PERCENT_ACCEPTANCE.md` for the signing status.
