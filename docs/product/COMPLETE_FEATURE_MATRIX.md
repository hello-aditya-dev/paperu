# Paperu — Complete Feature Acceptance Matrix

This is the human-readable companion to `docs/qa/feature-acceptance.json`.
Together they track EVERY advertised feature + subfeature in the
Paperu product, with truthful per-platform acceptance evidence.

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
| BUILD_VERIFIED | Compiles + tests pass on that platform's CI (build-time verification) |
| BLOCKED_EXTERNAL | Requires external resource (certificate/binary/runtime) this sandbox cannot provide |

## Platform status definitions

| Status | Meaning |
| --- | --- |
| UNTESTED | Not yet runtime-tested on this platform |
| BUILD_VERIFIED | CI compiles + `cargo test` with `tauri-runtime` passes |
| VERIFIED | Automated functional test passes on this platform |
| BLOCKED_EXTERNAL | Genuinely blocked by an external dependency |

## Feature matrix (sample — see JSON for the full set)

### A. Core application experience

| Feature | Route | Status | Windows | macOS ARM | macOS Intel | Linux |
| --- | --- | --- | --- | --- | --- | --- |
| Universal Drop | `/` | PARTIAL | UNTESTED | UNTESTED | UNTESTED | UNTESTED |
| File-type detection | (shared) | WORKING | UNTESTED | UNTESTED | UNTESTED | UNTESTED |
| Command Center | (shared) | WORKING | UNTESTED | UNTESTED | UNTESTED | UNTESTED |
| Recent Work | (shared) | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Settings | `/diagnostics` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |

### B. PDF toolbox

| Feature | Route | Status | Windows | macOS ARM | macOS Intel | Linux |
| --- | --- | --- | --- | --- | --- | --- |
| Merge | `/pdf/merge` | WORKING | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Split | `/pdf/split` | WORKING | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Rotate pages | `/pdf/pages` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Insert pages | `/pdf/pages` | WORKING | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Compare (multipage) | `/pdf/compare` | WORKING | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Password protect | — | BLOCKED_EXTERNAL | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Annotations | — | ABSENT | — | — | — | — |
| Redaction | — | ABSENT | — | — | — | — |

### G. Batch processing and automation

| Feature | Route | Status | Windows | macOS ARM | macOS Intel | Linux |
| --- | --- | --- | --- | --- | --- | --- |
| Typed Recipes | `/recipes` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Recipe: Resize | `/recipes` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Recipe: Convert | `/recipes` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Recipe: StripExif | `/recipes` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Recipe: Watermark (image) | `/recipes` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Recipe: Watermark (PDF) | `/recipes` | WORKING | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Recipe: 6-op pipeline | `/recipes` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Watch → Recipe | `/watch` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Timer Jobs (real scheduler) | `/timer` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |

### H. Sharing and media utilities

| Feature | Route | Status | Windows | macOS ARM | macOS Intel | Linux |
| --- | --- | --- | --- | --- | --- | --- |
| Paperu Send (LAN) | `/send` | BLOCKED_EXTERNAL | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Webpage → PDF | `/webpage-pdf` | BLOCKED_EXTERNAL | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| FFmpeg tools | — | BLOCKED_EXTERNAL | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

### J. Commercial and native-platform features

| Feature | Route | Status | Windows | macOS ARM | macOS Intel | Linux |
| --- | --- | --- | --- | --- | --- | --- |
| Analytics (opt-in) | `/diagnostics` | VERIFIED | BUILD_VERIFIED | UNTESTED | UNTESTED | VERIFIED |
| Code signing | — | BLOCKED_EXTERNAL | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Updater (signed) | — | BLOCKED_EXTERNAL | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

## Completion calculation (separate tracks)

1. **Feature implementation coverage:** ~73/93 (the items that have routes + code)
2. **End-to-end functional verification:** ~15/93 (items with automated tests)
3. **Visual/UX acceptance:** 0/93 (not yet started — requires screenshots)
4. **Accessibility acceptance:** 0/93 (not yet started — requires keyboard-nav tests)
5. **Windows runtime verification:** BUILD_VERIFIED for ~8 items; UNTESTED for the rest
6. **macOS ARM verification:** UNTESTED (no CI runner configured yet — the new cross-platform.yml will fix this)
7. **macOS Intel verification:** UNTESTED (same)
8. **Linux runtime verification:** VERIFIED for ~8 items; UNTESTED for the rest
9. **Installation/release readiness:** BLOCKED_EXTERNAL (signing certificates required)

## Product-level user journey tests (§11)

| Journey | Status | Notes |
| --- | --- | --- |
| A — Student assignment (17 images → A4 → compress) | NOT STARTED | Needs Assignment Studio completion |
| B — Application preparation (photo+signature+PDF constraints) | NOT STARTED | Needs Portal Ready + Assignment Studio |
| C — Secure document sharing (EXIF strip → password → Send) | BLOCKED | Paperu Send + PDF password are BLOCKED_EXTERNAL |
| D — Print shop (50 pages → 2-up → print-ready) | NOT STARTED | Needs Print Studio completion |
| E — Batch images (100 JPEGs → resize → compress → rename) | NOT STARTED | Needs Batch Studio completion |
| F — Study session (textbook → highlight → bookmark → pack) | NOT STARTED | Needs Study Reader completion |
| G — Automation (Recipe → Watch → drop → history) | VERIFIED | Watch→Recipe end-to-end test passes |

## Per-feature checks (§2)

For each feature, the following must all be true to earn DONE:

1. ✅ Represented in the module registry
2. ✅ Route resolves
3. ✅ Navigation entry reachable
4. ⬜ Primary action enabled when valid input present
5. ⬜ Controls have working state
6. ✅ IPC/backend operation executes
7. ✅ Produces correct output or persisted result
8. ✅ Output metadata inspected
9. ⬜ Error states understandable
10. ⬜ Cancellation works for long-running operations
11. ⬜ Results accessible after completion
12. ⬜ State persists correctly
13. ⬜ Keyboard navigation works
14. ⬜ Works on supported platforms
15. ⬜ UI matches Paperu design system

The ✅ marks are evidence-based; ⬜ marks are not yet verified. A
feature is DONE only when ALL 15 are ✅.

## Visual acceptance testing (§9)

Not yet started. Requires:
- Playwright component tests for frontend interactions
- Actual Tauri native testing for runtime claims
- Screenshots of: empty state, input populated, options configured, processing, result, error state, dark mode, compact window, large window

## Next steps

1. **Cross-platform CI:** the new `cross-platform.yml` workflow (4 targets) will give us macOS ARM/Intel + Linux BUILD_VERIFIED status for all features.
2. **Visual acceptance:** per-feature screenshots + Playwright component tests.
3. **Journey tests A-F:** complete the remaining flagship workflows (Assignment Studio, Portal Ready, Print Studio, Batch Studio, Study Reader).
4. **BLOCKED_EXTERNAL resolution:** signing certs (Windows Authenticode + macOS Developer ID), qpdf binary, FFmpeg binary, Paperu Send HTTP server.
