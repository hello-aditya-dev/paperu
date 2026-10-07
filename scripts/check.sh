#!/usr/bin/env bash
#
# scripts/check.sh — the canonical Paperu validation gate.
#
# Runs the full validation suite, in order, exiting non-zero on the
# first failure. This is the same gate `pnpm check` runs (see
# package.json) plus an explicit `pnpm install` to make the script
# safe to run on a fresh clone.
#
# Layers (each must pass before the next runs):
#   1. pnpm install         (deps; uses the committed lockfile)
#   2. pnpm typecheck        (TypeScript across every package)
#   3. pnpm lint             (ESLint with --max-warnings 0)
#   4. pnpm test             (vitest across every package)
#   5. cargo fmt --check     (Rust formatting)
#   6. cargo clippy          (Rust lints, -D warnings)
#   7. cargo test            (Rust unit tests, core crate)
#
# The Rust steps run against the core crate WITHOUT the
# `tauri-runtime` feature, so they execute on any platform
# (Linux CI included). The Windows release build runs the same gate
# with `--features tauri-runtime` on a Windows runner; that is a
# CI concern, not this script's.
#
# See:
#   - package.json               (the canonical scripts this wraps)
#   - CONTRIBUTING.md            (the contribution discipline)
#   - docs/architecture/testing.md (the testing strategy)
#   - docs/decisions/0008-dependency-policy.md (toolchain pinning)
#
# Exit codes:
#   0  every step passed
#   1  at least one step failed (see the message above the exit)
#
# Usage:
#   scripts/check.sh                # full gate
#   scripts/check.sh --no-install  # skip `pnpm install` (assumes deps present)
#

set -euo pipefail

# ── Options ────────────────────────────────────────────────────────
RUN_INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-install)
      RUN_INSTALL=0
      shift
      ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "scripts/check.sh: unknown argument: $arg" >&2
      echo "usage: scripts/check.sh [--no-install]" >&2
      exit 2
      ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────

# Print a section banner.
banner() {
  printf '\n\033[1;36m== %s ==\033[0m\n' "$1"
}

# Run a command, capturing its exit code. On failure, print a clear
# message and exit non-zero. `set -e` is on, but this guard makes
# the failure point obvious in the log.
run() {
  local label="$1"
  shift
  banner "$label"
  if "$@"; then
    printf '\033[1;32m   ok: %s\033[0m\n' "$label"
  else
    local rc=$?
    printf '\033[1;31m   FAIL: %s (exit %s)\033[0m\n' "$label" "$rc" >&2
    printf '\033[1;31m   Paperu validation gate failed at: %s\033[0m\n' "$label" >&2
    exit 1
  fi
}

# ── Resolve repo root ──────────────────────────────────────────────
# This script may be invoked from anywhere; resolve the repo root
# from the script's own location so the paths below are stable.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Preflight: toolchain presence ──────────────────────────────────
banner "preflight: toolchain presence"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

if ! have_cmd pnpm; then
  printf '\033[1;31m   FAIL: pnpm not found on PATH.\033[0m\n' >&2
  printf '   Paperu pins pnpm@12.9.1 in package.json. Install it:\n' >&2
  printf '     corepack enable && corepack prepare pnpm@12.9.1 --activate\n' >&2
  exit 1
fi
if ! have_cmd node; then
  printf '\033[1;31m   FAIL: node not found on PATH.\033[0m\n' >&2
  printf '   Paperu requires Node >= 20.0.0 (see package.json).\n' >&2
  exit 1
fi
if ! have_cmd cargo; then
  printf '\033[1;31m   FAIL: cargo not found on PATH.\033[0m\n' >&2
  printf '   Paperu pins Rust 1.99.0 in rust-toolchain.toml.\n' >&2
  printf '   Install Rust via https://rustup.rs/ and the toolchain file\n' >&2
  printf '   will be selected automatically.\n' >&2
  exit 1
fi
printf '\033[1;32m   ok: pnpm, node, cargo present\033[0m\n'

# ── 1. install dependencies (unless --no-install) ─────────────────
if [ "$RUN_INSTALL" -eq 1 ]; then
  # Use the committed lockfile; fail if it is out of sync rather
  # than silently rewriting it.
  run "pnpm install (frozen lockfile)" pnpm install --frozen-lockfile
else
  banner "pnpm install (skipped via --no-install)"
fi

# ── 2. typecheck ──────────────────────────────────────────────────
run "pnpm typecheck" pnpm run typecheck

# ── 3. lint ──────────────────────────────────────────────────────
# ESLint is configured with --max-warnings 0 (see package.json and
# the per-package lint scripts). A warning is a failure.
run "pnpm lint" pnpm run lint

# ── 4. TypeScript tests (vitest) ─────────────────────────────────
# Contract tests, component tests, lib tests. See
# docs/architecture/testing.md.
run "pnpm test" pnpm run test

# ── 5. cargo fmt --check ────────────────────────────────────────
# Refuse to merge if Rust is not formatted. The manifest path is
# pinned so the script works regardless of the current directory.
run "cargo fmt --check" cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check

# ── 6. cargo clippy (-D warnings) ───────────────────────────────
# Clippy runs over all targets with `-D warnings` — every warning
# is a failure. This matches the lint configuration in lib.rs
# (`#![warn(clippy::all, clippy::pedantic, clippy::cargo)]` with a
# curated allow-list) and the CI gate.
run "cargo clippy" cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings

# ── 7. cargo test ───────────────────────────────────────────────
# Rust unit tests, in-module #[cfg(test)] mod tests blocks. Runs
# against the workspace. This compiles the core crate WITHOUT the
# tauri-runtime feature, so it executes on any platform.
run "cargo test" cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace

# ── Summary ──────────────────────────────────────────────────────
banner "Paperu validation gate: PASSED"
printf 'All steps green:\n'
printf '  - pnpm install (frozen lockfile)\n'
printf '  - pnpm typecheck\n'
printf '  - pnpm lint\n'
printf '  - pnpm test\n'
printf '  - cargo fmt --check\n'
printf '  - cargo clippy (-D warnings)\n'
printf '  - cargo test\n'
printf '\n'
printf 'Note: this script runs the core crate WITHOUT the tauri-runtime\n'
printf 'feature. The Windows release gate runs the same suite with\n'
printf '--features tauri-runtime on a Windows runner (see\n'
printf '.github/workflows/ci.yml and docs/releases/workflow.md).\n'
