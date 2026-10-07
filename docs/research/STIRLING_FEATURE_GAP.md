# Stirling-PDF — Feature Gap Analysis (Selective Reference)

**Sprint:** Open-Source Harvest + Integration
**Repo:** Stirling-Tools/Stirling-PDF (commit 973bff865cc1)
**Licence:** Mixed (NOASSERTION on GitHub) — **SELECTIVE/REFERENCE, NO CODE COPIED**
**Date:** 2026-10-07

Per master prompt §29: use Stirling-PDF as a product-feature map. Do NOT
mass-copy. For any reused file, verify its exact-path licence first.

## Feature comparison

| Stirling feature | Paperu equivalent | Already exists? | Permissive source reusable? | Paperu UX opportunity | Priority |
|---|---|---|---|---|---|
| Merge PDFs | PDF Merge | ✓ USEFUL | n/a (Paperu has it) | — | — |
| Split PDF | PDF Split / Extract | ✓ USEFUL | n/a | — | — |
| Rotate PDF | (planned, lopdf) | ✗ ABSENT | lopdf MIT — direct dep | One-click rotate 90/180/270 all pages | HIGH |
| Delete pages | (planned, lopdf) | ✗ ABSENT | lopdf MIT — direct dep | Remove page ranges | HIGH |
| Reorder pages | (planned, lopdf) | ✗ ABSENT | lopdf MIT — direct dep | Drag-reorder pages | HIGH |
| Page numbers | Assignment Studio | ✓ USEFUL | n/a | — | — |
| PDF compress | PDF Make It Fit | ✓ USEFUL | n/a | — | — |
| Add watermark | PDF Watermark | ✗ ABSENT | build (pdf-lib) | text watermark, opacity, placement | MED |
| Metadata edit | PDF Metadata | ✗ ABSENT | lopdf MIT | inspect + edit Title/Author | MED |
| Password protect | PDF Password | ✗ ABSENT | qpdf (defer) or lopdf | encrypt/decrypt | MED (defer) |
| OCR | — | ✗ ABSENT | REJECT (would need a local OCR engine; out of V1 scope) | — | LOW |
| PDF comparison | Comparison Tools | ✗ ABSENT | build (render + pixel diff) | — | LOW |
| Redaction | PDF Redaction | ✗ ABSENT | build (genuine destructive) | — | LOW |

## Decisions

- **Rotate / Delete / Reorder pages**: implement with `lopdf` (MIT, direct dep).
  These are high-value, Rust-native, and unlock 3 ABSENT features.
- **Watermark**: build with existing `pdf-lib` (already a dep) — no new dep.
- **Metadata edit**: use `lopdf` for inspect + edit.
- **Password protect**: deferred. lopdf has limited encryption support; qpdf is
  the mature choice but is a C++ binary bundling burden. Defer until justified.
- **OCR, comparison, redaction**: out of V1 scope; not copied from Stirling.

## Licence reminder

Stirling-PDF has mixed licensing across directories. NO source code was
copied from Stirling-PDF into Paperu. This document records the feature gap
only. If a specific Stirling file is ever reused, its exact-path licence
must be verified and recorded in `docs/legal/THIRD_PARTY_COMPONENTS.md`
before the copy.
