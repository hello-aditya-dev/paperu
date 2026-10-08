# Paperu — Development Environment

This document describes the exact toolchain + setup required to build
Paperu on Linux, macOS, and Windows. CI uses the same setup (see
`.github/workflows/cross-platform.yml`).

## Required toolchain

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.x | Required by pnpm + Vite |
| pnpm | 12.9.1 | Pinned via corepack; `pnpm-lock.yaml` is committed |
| Rust | 1.99.0 | Pinned via `apps/desktop/src-tauri/rust-toolchain.toml` |
| Git | 2.40+ | For LFS (font assets) + submodules (none currently) |

## Linux setup (Ubuntu 22.04 / 24.04)

```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.99.0
source "$HOME/.cargo/env"

# 2. Install Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
corepack prepare pnpm@12.9.1 --activate

# 3. Install Tauri native dependencies
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libxdo-dev \
  build-essential \
  pkg-config \
  curl \
  wget \
  file \
  patchelf \
  xdg-utils

# 4. Clone + install
git clone https://github.com/hello-aditya-dev/paperu.git
cd paperu
git checkout agent/builder
pnpm install --frozen-lockfile

# 5. Verify (core logic — no Tauri deps needed)
cd apps/desktop/src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

To build the native Tauri app on Linux:
```bash
cd apps/desktop
pnpm tauri build --features tauri-runtime --bundles deb,appimage
```

## macOS setup (Apple Silicon + Intel)

```bash
# 1. Install Rust (universal installer)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.99.0
source "$HOME/.cargo/env"

# 2. Install Node + pnpm (via Homebrew)
brew install node@20
brew install pnpm
# OR via corepack:
corepack enable
corepack prepare pnpm@12.9.1 --activate

# 3. Install Xcode Command Line Tools (for the native toolchain)
xcode-select --install

# 4. Clone + install
git clone https://github.com/hello-aditya-dev/paperu.git
cd paperu
git checkout agent/builder
pnpm install --frozen-lockfile

# 5. Build native bundles
cd apps/desktop
pnpm tauri build --features tauri-runtime --bundles app,dmg
```

## Windows setup (10/11 x64)

```powershell
# 1. Install Rust
# Download + run https://win.rustup.rs — use default toolchain 1.99.0

# 2. Install Node 20
# Download from https://nodejs.org/en/download/

# 3. Install pnpm
corepack enable
corepack prepare pnpm@12.9.1 --activate

# 4. Install Visual Studio C++ Build Tools (for the MSVC linker)
# Download from https://visualstudio.microsoft.com/visual-cpp-build-tools/
# Select "Desktop development with C++"

# 5. Install WebView2 Runtime (preinstalled on Win11; Win10 may need it)
# Download from https://developer.microsoft.com/microsoft-edge/webview2/

# 6. Clone + install
git clone https://github.com/hello-aditya-dev/paperu.git
cd paperu
git checkout agent/builder
pnpm install --frozen-lockfile

# 7. Build native bundles
cd apps/desktop
pnpm tauri build --features tauri-runtime --bundles nsis,msi
```

## CI setup (GitHub Actions)

See `.github/workflows/cross-platform.yml`. The workflow uses:
- `actions/checkout@v4`
- `actions/setup-node@v4` (Node 20)
- `pnpm/action-setup@v4` (pnpm 12.9.1)
- `dtolnay/rust-toolchain@stable` (the toolchain.toml pins 1.99.0)
- `Swatinem/rust-cache@v2`
- `actions/cache@v4` for pnpm store

The four-target matrix:
| Runner | Label | Bundles | Rust target |
| --- | --- | --- | --- |
| `windows-2022` | windows-x64 | nsis,msi | x86_64-pc-windows-msvc |
| `macos-15` | macos-arm64 | app,dmg | aarch64-apple-darwin |
| `macos-13` | macos-x64 | app,dmg | x86_64-apple-darwin |
| `ubuntu-22.04` | linux-x64 | deb,appimage | x86_64-unknown-linux-gnu |

## Verifying the toolchain

```bash
rustc --version    # should print rustc 1.99.0
cargo --version   # should print cargo 1.99.0
pnpm --version    # should print 12.9.1
node --version    # should print v20.x.x
```

The `rust-toolchain.toml` file in `apps/desktop/src-tauri/` pins
the Rust version. Rustup reads this file when `cargo` is run in that
directory, automatically installing the pinned version if needed.
