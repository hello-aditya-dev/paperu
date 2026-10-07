# Paperu — Third-Party Components Ledger

**Sprint:** Open-Source Harvest + Integration
**Branch:** `agent/builder`
**Date:** 2026-10-07

Per master prompt §6: provenance for every external component used by Paperu.

## Bucket A — Direct dependencies (published libraries used directly)

### `zip` crate (Archive Studio)
- **Upstream:** zip-rs/zip2 (https://github.com/zip-rs/zip2)
- **Upstream commit:** a72b210 (shallow clone, 2026-10-07)
- **Version:** 2.4.2 (crates.io)
- **Licence:** MIT (Copyright (c) 2014 Mathijs van de Nes)
- **Integration method:** Cargo dependency (`zip = { version = "2", default-features = false, features = ["deflate", "time"] }`)
- **Paperu files affected:** `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/archive_studio/mod.rs`, `apps/desktop/src-tauri/src/commands/archive_studio.rs`
- **Code copied?** No — used as a published dependency
- **Redistribution requirements:** Include MIT licence notice (see THIRD_PARTY_NOTICES.txt)
- **Licence notice location:** `THIRD_PARTY_NOTICES.txt`

### `lopdf` crate (PDF page operations)
- **Upstream:** J-F-Liu/lopdf (https://github.com/J-F-Liu/lopdf)
- **Upstream commit:** 5099bca (shallow clone, 2026-10-07)
- **Version:** latest on crates.io
- **Licence:** MIT (Copyright (c) 2016 Junfeng Liu)
- **Integration method:** Cargo dependency
- **Paperu files affected:** `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/pdf_native/mod.rs`, `apps/desktop/src-tauri/src/commands/pdf_native.rs`
- **Code copied?** No — used as a published dependency
- **Redistribution requirements:** Include MIT licence notice
- **Licence notice location:** `THIRD_PARTY_NOTICES.txt`

### `notify` crate (filesystem watching)
- **Upstream:** notify-rs/notify (https://github.com/notify-rs/notify)
- **Upstream commit:** e455a21 (shallow clone, 2026-10-07)
- **Version:** latest on crates.io
- **Licence:** CC0-1.0 (core, public domain) + MIT OR Apache-2.0 (notify-types, notify-debouncer-mini)
- **Integration method:** Cargo dependency (`notify` + `notify-debouncer-mini`)
- **Paperu files affected:** `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/watch/mod.rs`, `apps/desktop/src-tauri/src/commands/watch.rs`
- **Code copied?** No — used as a published dependency
- **Redistribution requirements:** CC0 requires no notice (public domain); MIT/Apache helpers require notice
- **Licence notice location:** `THIRD_PARTY_NOTICES.txt`

## Bucket B — Permissive source ports (adapted code)

None this sprint. Using published crates directly (Bucket A) is preferred over copying source.

## Bucket C — Reference only (studied, NOT copied)

### qpdf
- **Upstream:** qpdf/qpdf
- **Upstream commit:** 4eba95899886
- **Licence:** Apache-2.0 (commercially compatible, but not integrated)
- **Reason reference-only:** C++ library; bundling requires compiling C++ or shipping a binary. lopdf covers the page operations Paperu needs; encryption/linearization deferred until justified by a real feature.
- **Used for:** studying PDF structure/security/repair algorithms conceptually.

### ImageMagick
- **Upstream:** ImageMagick/ImageMagick
- **Upstream commit:** e3812ff1c97b
- **Licence:** ImageMagick License (NOASSERTION on GitHub)
- **Reason reference-only:** C library needing system install/bundling; Canvas covers V1 image operations. High packaging burden for marginal V1 gain.
- **Used for:** studying image-processing operation coverage.

### czkawka
- **Upstream:** qarmin/czkawka
- **Upstream commit:** eb8b91d
- **Licence:** MIT (core `czkawka_core`); CC-BY-4 (icons); other licence for app-level code
- **Reason reference-only:** Paperu's exact-hash duplicate finder works; perceptual similarity is a future enhancement. The core crate is MIT but the integration surface is non-trivial for V1.
- **Used for:** studying duplicate-hash pipeline (size pre-group → fast hash → cryptographic hash).

### rustic
- **Upstream:** rustic-rs/rustic
- **Upstream commit:** 143d073f6039
- **Licence:** Apache-2.0 (commercially compatible)
- **Reason reference-only:** Full backup system — overkill for Paperu V1. Harvest the copy+checksum+verify pattern; implement independently.
- **Used for:** studying backup copy-verify architecture.

### naps2
- **Upstream:** cyanfish/naps2
- **Upstream commit:** 9314194d87e6
- **Licence:** GPL-2.0-or-later (NOASSERTION on GitHub) — **REFERENCE ONLY, no code copied**
- **Reason reference-only:** GPL is incompatible with Paperu's licence strategy. Study scanner UX only; implement independently.
- **Used for:** scanner UX, page ordering, crop workflow, output flow — see `docs/research/NAPS2_SCANNER_LEARNINGS.md`.

### stirling-pdf
- **Upstream:** Stirling-Tools/Stirling-PDF
- **Upstream commit:** 973bff865cc1
- **Licence:** Mixed (NOASSERTION on GitHub) — **SELECTIVE/REFERENCE**
- **Reason reference-only:** Mixed licensing across directories. No code copied without per-path licence verification. Used as a feature map.
- **Used for:** feature-gap analysis — see `docs/research/STIRLING_FEATURE_GAP.md`.

### pdfium-render
- **Upstream:** ajrcarey/pdfium-render
- **Upstream commit:** 6cee8b9
- **Licence:** MIT OR Apache-2.0 (the Rust binding)
- **Reason reference-only (this sprint):** The Rust binding is permissive, but pdfium itself is a native binary (Google PDFium, BSD-3-Clause) that must be bundled separately. PDF.js already covers rendering for Reader + Quick Look. Defer binary bundling until justified.
- **Used for:** studying rendering/text-extraction API alternatives to PDF.js.

## Bucket D — Rejected

None this sprint. All audited projects have a usable classification (A, B, or C).

## Rust toolchain decision (master prompt §11)

Paperu's `rust-toolchain.toml` pins **1.99.0**, which IS the current stable.
All candidate crates (lopdf rust-version 1.88, notify rust-version 1.88, zip
rust-version 1.88) require Rust ≥1.88, which 1.99 satisfies. **No MSRV upgrade
needed** — Paperu is already on current stable.
