# Paperu — Complete Feature Acceptance Matrix

This is the authoritative per-feature acceptance matrix. It tracks
EVERY advertised feature + subfeature in the Paperu product, with
truthful per-platform acceptance evidence.

**Per-feature definition of done** (§15 of the World-Class Product
Acceptance Contract): a feature earns DONE only when ALL 15 conditions
are met — implemented, UI-accessible, connected to real processing,
produces verified results, handles failures, preserves user data,
passes automated tests, passes visual review, passes accessibility
review, builds on all target platforms, passes native runtime tests,
and has no known blocking defects.

## Status definitions

| Status | Meaning |
| --- | --- |
| ABSENT | Not implemented at all |
| SHELL | Route exists but no functionality |
| FOUNDATION | Backend CRUD or frontend shell, no real workflow |
| PARTIAL | Basic end-to-end operation, missing key features |
| WORKING | Useful functional workflow (no automated test) |
| VERIFIED | Automated functional test passes |
| BUILD_VERIFIED | Compiles + tests pass on that platform's CI |
| BLOCKED_EXTERNAL | Requires external resource this sandbox cannot provide |

## Full 93-item acceptance matrix

### A. Core application experience (12 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Home dashboard | `/` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 2 | Universal Drop + file-type detection | `/` | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |
| 3 | Command Center (searchable tools) | shared | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 4 | Recent Work | shared | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 5 | Shelf (staging) | shared | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |
| 6 | Preferences + settings | `/diagnostics` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 7 | Onboarding | `/onboarding` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 8 | Light/dark theme | shared | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 9 | Keyboard shortcuts | shared | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |
| 10 | Window-state persistence | shared | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 11 | Single-instance + Open With | shared | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 12 | History | `/history` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |

### B. PDF toolbox (18 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | Merge PDFs | `/pdf/merge` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 14 | Split PDF | `/pdf/split` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 15 | Rotate pages | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 16 | Delete pages | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 17 | Extract pages | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 18 | Reorder pages | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 19 | Reverse pages | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 20 | Insert pages (PDF/img/blank) | `/pdf/pages` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 21 | Crop pages | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 22 | Set page size | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 23 | PDF metadata inspect/remove | `/pdf/pages` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 24 | PDF watermark | `/pdf/watermark` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 25 | PDF → images | `/pdf/to-images` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 26 | Images → PDF | `/pdf/from-images` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 27 | PDF Compare (multipage diff) | `/pdf/compare` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 28 | PDF Notebook | `/notebook` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 29 | Sign PDF | `/pdf/sign` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 30 | Fill PDF forms | `/pdf/fill` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 31 | PDF password protect | — | BLOCKED | BLK | BLK | BLK | BLK |
| 32 | PDF unlock | — | BLOCKED | BLK | BLK | BLK | BLK |
| 33 | PDF annotations | — | ABSENT | — | — | — | — |
| 34 | PDF redaction | — | ABSENT | — | — | — | — |
| 35 | PDF compression | `/pdf/fit` | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |

### C. Image toolbox (12 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 36 | Image fit (constraints) | `/image/fit` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 37 | Image resize (Recipe) | `/recipes` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 38 | Image convert (Recipe) | `/recipes` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 39 | Strip EXIF (Recipe) | `/recipes` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 40 | Image watermark (Recipe) | `/recipes` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 41 | Metadata Studio | `/metadata-studio` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 42 | Screenshot Bridge | `/screenshot-bridge` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 43 | Document Scanner | `/scanner` | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |
| 44 | Passport Photo | `/passport-photo` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |

### D. Student + application workflows (22 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 45 | Portal Ready | `/portal` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 46 | Assignment Studio | `/assignment` | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |
| 47 | Application Kit | `/kit` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 48 | Study Reader | `/reader` | PARTIAL | UNTESTED | BV | UNTESTED | UNTESTED |
| 49 | Notes | `/notes` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 50 | Study Packs | `/study-packs` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 51 | Citation Studio | `/citations` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 52 | Signature Vault | `/signature-vault` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |
| 53 | Forms Vault | `/forms-vault` | WORKING | VERIFIED | BV | UNTESTED | UNTESTED |

### E. Print + study workspace (included in D)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 54 | Print Studio | `/print` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 55 | Batch Studio | `/batch` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |

### F. File utilities (18 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 56 | Inspect | `/inspect` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 57 | Folder Organizer | `/organizer` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 58 | Archive Studio | `/archive` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 59 | USB Toolbox | `/usb` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 60 | Backup Recipes | `/backup` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 61 | Duplicate Finder | `/duplicates` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 62 | Downloads Cleaner | `/cleaner` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 63 | Quick Look | `/quick-look` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 64 | Clipboard History | `/clipboard` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 65 | File Rescue | `/rescue` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 66 | Rename Studio | `/rename` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 67 | Filename Fixer | `/filename-fixer` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 68 | Metadata Studio | `/metadata-studio` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 69 | Offline Converter | `/converter` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |

### G. Automation + drives (10 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 70 | Watch Folders (events) | `/watch` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 71 | Typed Recipe Engine | `/recipes` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 72 | Watch → Recipe dispatch | `/watch` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 73 | Watch → Organizer dispatch | `/watch` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 74 | Timer Jobs (real scheduler) | `/timer` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 75 | Timer → Backup Recipe | `/timer` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 76 | Timer → Typed Recipe | `/timer` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 77 | Timer → Organizer Rule | `/timer` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |

### H. Sharing + media (included in existing weights)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 78 | Paperu Send (LAN) | `/send` | BLOCKED | BLK | BLK | BLK | BLK |
| 79 | Webpage → PDF | `/webpage-pdf` | BLOCKED | BLK | BLK | BLK | BLK |
| 80 | FFmpeg utility tools | — | BLOCKED | BLK | BLK | BLK | BLK |

### I. Office + business (3 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 81 | Business Documents | `/business-docs` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 82 | PDF Notebook | `/notebook` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 83 | Print Studio | `/print` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |

### J. Commercial + platform (5 weight)

| # | Feature | Route | Status | Linux | Windows | macOS ARM | macOS x64 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 84 | Settings (typed, versioned) | shared | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 85 | Analytics (opt-in, typed) | `/diagnostics` | VERIFIED | VERIFIED | BV | UNTESTED | UNTESTED |
| 86 | Diagnostics route | `/diagnostics` | WORKING | UNTESTED | BV | UNTESTED | UNTESTED |
| 87 | Licensing (signed entitlement) | — | BLOCKED | BLK | BLK | BLK | BLK |
| 88 | Updater (signed metadata) | — | BLOCKED | BLK | BLK | BLK | BLK |
| 89 | Code signing | — | BLOCKED | BLK | BLK | BLK | BLK |
| 90 | Windows installers (NSIS+MSI) | — | BV | BLK | BV | BLK | BLK |
| 91 | macOS bundles (app+dmg) | — | UNTESTED | BLK | BLK | UNTESTED | UNTESTED |
| 92 | Linux bundles (deb+appimage) | — | UNTESTED | UNTESTED | BLK | BLK | BLK |
| 93 | Cross-platform CI (4-target) | — | PARTIAL | VERIFIED | BV | UNTESTED | UNTESTED |

**Legend:** VERIFIED = test passes; BV = BUILD_VERIFIED (CI compiles+tests); UNTESTED = not yet runtime-tested; BLK = BLOCKED_EXTERNAL

## Completion summary

| Track | Count | Status |
| --- | --- | --- |
| Feature implementation coverage | 80/93 | 86% (13 ABSENT/BLOCKED) |
| End-to-end functional verification | 35/93 | 38% |
| Visual/UX acceptance | 0/93 | 0% (not started) |
| Accessibility acceptance | 0/93 | 0% (not started) |
| Windows runtime verification | 80/93 BUILD_VERIFIED | CI compiles+tests |
| macOS ARM verification | 0/93 | UNTESTED (CI queued) |
| macOS Intel verification | 0/93 | UNTESTED (CI queued) |
| Linux runtime verification | 35/93 | VERIFIED for tested items |
| Installation/release readiness | 0/93 | BLOCKED (signing required) |

## Product-level journey tests (§11)

| Journey | Status |
| --- | --- |
| A — Student assignment | NOT STARTED |
| B — Application preparation | NOT STARTED |
| C — Secure document sharing | BLOCKED (Send + PDF password) |
| D — Print shop | NOT STARTED |
| E — Batch images | NOT STARTED |
| F — Study session | NOT STARTED |
| G — Automation | VERIFIED (Watch→Recipe + Timer→Recipe end-to-end) |

## Per-feature 15-point DONE checklist

For each feature, ALL 15 must be ✅ to earn DONE:

1. ✅ Module registry entry
2. ✅ Route resolves
3. ✅ Navigation reachable
4. ⬜ Primary action enabled when valid input
5. ⬜ Controls have working state
6. ✅ IPC/backend executes
7. ✅ Produces correct output
8. ✅ Output metadata inspected
9. ⬜ Error states understandable
10. ⬜ Cancellation works for long ops
11. ⬜ Results accessible after completion
12. ⬜ State persists correctly
13. ⬜ Keyboard navigation works
14. ⬜ Works on all supported platforms
15. ⬜ UI matches design system
