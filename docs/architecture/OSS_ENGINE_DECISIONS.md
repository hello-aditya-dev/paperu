# Paperu — OSS Engine Decisions

**Sprint:** Open-Source Harvest + Integration
**Branch:** `agent/builder`
**Date:** 2026-10-07

Per master prompt §10: for each Paperu feature, the chosen engine strategy and rationale.

Legend:
- **Build** = Paperu's own implementation
- **Direct dep** = published library/crate used directly (Bucket A)
- **Permissive port** = MIT/Apache/BSD code adapted (Bucket B)
- **Reference** = studied but NOT copied (Bucket C — GPL/incompatible)
- **Reject** = not used (Bucket D)

| Feature | Build? | Direct dep? | Permissive port? | Reference only? | Chosen upstream | Reason | Risks | Windows packaging |
|---|---|---|---|---|---|---|---|---|
| ZIP create/extract/list | — | `zip` 2.4.2 (MIT) | — | — | zip-rs/zip2 | Standard pure-Rust ZIP crate; security guards reused from existing Paperu validation | Pure Rust, low risk | None (pure Rust, compiles on MSVC) |
| PDF page ops (rotate/delete/reorder/extract) | — | `lopdf` (MIT) | — | — | J-F-Liu/lopdf | Rust-native PDF object model; unlocks 4 ABSENT features without C++ | Pure Rust, low risk | None |
| Filesystem watching (Watch Folders) | — | `notify` (CC0) + `notify-debouncer-mini` (MIT/Apache) | — | — | notify-rs/notify | The standard Rust fs-watcher; CC0 core; cross-platform native (ReadDirectoryChangesW on Windows) | Thread + lifecycle management | None (pure Rust, uses OS APIs) |
| PDF rendering | — | PDF.js (existing) | — | `pdfium-render` (MIT/Apache) studied | pdfium-render studied | PDF.js already works for Reader + Quick Look; pdfium binary bundling is high-cost for marginal V1 gain | Defer pdfium binary bundling | Defer |
| PDF structure/security (encrypt/decrypt/linearize/repair) | — | — | — | `qpdf` (Apache-2.0) studied | qpdf/qpdf studied | C++ library; bundling requires compiling or shipping a binary. lopdf covers page ops; encryption deferred until justified | C++ build/bundle cost | Defer |
| Heavy image processing | Canvas (existing) | — | — | `ImageMagick` (ImageMagick License) studied | ImageMagick studied | Canvas covers V1 (resize/crop/rotate/convert/strip); ImageMagick is a C library needing system install — high packaging burden for marginal V1 gain | C lib bundling | Defer |
| Duplicate scanning (perceptual) | Paperu exact-hash (existing) | — | — | `czkawka` core (MIT) studied | qarmin/czkawka studied | Paperu's exact-hash duplicate finder works; perceptual similarity is a future enhancement. czkawka core is MIT but the integration surface is non-trivial | Low priority | Defer |
| Backup copy-verify | Paperu `copy_and_verify` (planned) | — | — | `rustic` (Apache-2.0) studied | rustic-rs/rustic studied | rustic is a full backup system — overkill for Paperu V1. Harvest the copy+checksum+verify pattern, implement independently | Overkill | None (Paperu impl) |
| Scanner workflow | Paperu (planned, image-engine based) | — | — | `naps2` (GPL-2.0+) REFERENCE ONLY | cyanfish/naps2 studied | GPL — cannot copy. Study UX, implement independently with Canvas primitives | None (no code copied) | None |
| PDF feature map | Paperu (existing + lopdf) | — | — | `stirling-pdf` (mixed) SELECTIVE | Stirling-Tools/Stirling-PDF studied | Mixed licence — reference only for feature gap; no code copied without per-path licence verification | Licence contamination | None |

## Summary of integration this sprint

**Direct dependencies added (Bucket A):**
1. `zip` 2.4.2 (MIT) — Archive Studio create/extract/list ✓ DONE
2. `lopdf` (MIT) — PDF page operations (rotate/delete/reorder/extract) — IN PROGRESS
3. `notify` + `notify-debouncer-mini` (CC0/MIT/Apache) — Watch Folders — IN PROGRESS

**Permissive ports (Bucket B):** none (using published crates directly is preferred)

**Reference-only (Bucket C):** qpdf, ImageMagick, czkawka, rustic, naps2 (GPL), stirling-pdf (mixed)

**Rejected (Bucket D):** none — all audited projects have a usable classification

## Security boundary (§38)

Third-party engines never dictate file access. Pipeline remains:
USER SELECTS SOURCE → PAPERU VALIDATES SOURCE → PAPERU CREATES TEMP JOB →
ENGINE RECEIVES ALLOWLISTED INPUT → ENGINE WRITES TEMP OUTPUT →
PAPERU VALIDATES OUTPUT → PAPERU ATOMICALLY FINALIZES

No engine accepts arbitrary paths from the webview. All paths flow
through Paperu's typed IPC + Rust validation.
