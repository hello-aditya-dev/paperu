# Paperu — Capability Provenance and Legal Audit

This document records the provenance of every benchmarked capability in
Paperu. It exists to ensure that Paperu never improperly reuses
proprietary source code, assets, UI, icons, illustrations, logos,
screenshots, trade dress, or marketing copy from other products.

**Principle**: Paperu studies functionality and user problems from
benchmark products. Paperu implements all capabilities independently
using original code, original UI, and original assets. Publicly
documented functionality may be used as a product benchmark, but
proprietary expression is never copied.

---

## Benchmark products studied

| Product | Category | What we study | What we do NOT copy |
|---|---|---|---|
| Adobe Acrobat | PDF | Feature categories, workflow patterns | Source code, UI layout, icons, trade dress |
| PDF Expert | PDF | Feature categories, UX patterns | Source code, UI, assets |
| XnConvert | Image/batch | Batch processing concepts, pipeline model | Source code, UI, assets |
| ShareX | Capture/screenshot | Capture concepts, annotation types | Cloud-upload philosophy, source code, assets |
| Recordly | Screen recording | Recording concepts, zoom/cursor ideas | Source code (AGPL concern), cursor assets, wallpapers, project format |
| PowerToys | OS utilities | Utility concepts, integration patterns | Source code, assets |
| Peek / Quick Look | File preview | Preview UX concepts | Source code, assets |
| Hazel | Automation | Watch-folder concepts, rule model | Source code, assets |
| Swipe | Business/invoicing | Business document categories, GST concepts | AI features, source code, UI, templates, assets |

---

## Dependency provenance

### pdf-lib

| Field | Value |
|---|---|
| Version | 1.17.1 |
| Licence | MIT |
| Source | https://github.com/Hopding/pdf-lib |
| Purpose | PDF creation/manipulation: load, re-save, merge, split, embed images, draw text/shapes |
| Execution context | Tauri webview (frontend) |
| Commercial use | ✅ MIT — permissive, commercial-safe |
| Bundled | Yes, into Vite production build |
| Transitive deps | @pdf-lib/standard-fonts (MIT), @pdf-lib/fontkit (MIT), pako (MIT), fast-xml-parser (MIT) |
| CSP impact | None — pure JS, no eval, no workers, no WASM |
| Provenance | Independently maintained open-source library. No code copied from any benchmark product. |
| Status | Added to apps/desktop/package.json. ADR 0011 requests Integrator approval. |

### pdfjs-dist

| Field | Value |
|---|---|
| Version | 4.8.69 |
| Licence | Apache-2.0 |
| Source | https://github.com/mozilla/pdf.js |
| Purpose | PDF page rendering: rasterize pages to canvas for PDF→Images, Sign/Fill preview, and Stage-3 target-size compression |
| Execution context | Tauri webview (frontend) |
| Commercial use | ✅ Apache-2.0 — permissive, commercial-safe |
| Bundled | Yes. Worker loaded via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` |
| Transitive deps | node-ensure (polyfill, dev-only), web-streams-polyfill (MIT) |
| Optional deps | canvas (Node.js only, never used in webview, build script ignored) |
| CSP impact | ⚠️ Requires `worker-src 'self'` for the web worker. If not added, pdfjs falls back to main-thread rendering (slower but functional). **Integrator decision required.** |
| Security implications | The worker runs locally, processes local file bytes, makes no network calls. No remote code execution surface. |
| Bundle impact | Worker chunk: ~1.37 MB (separate file, lazy-loaded). Main pdfjs chunk: ~317 KB (93 KB gzipped). |
| Provenance | Mozilla's open-source PDF renderer. No code copied from any benchmark product. |
| Alternatives considered | Rust-native PDF rendering (pdfium-render) — would require bundling a C++ binary + Integrator approval for the native dependency. Deferred to future native-optimization phase. |
| Status | Added to apps/desktop/package.json. ADR 0011 requests Integrator approval. |

---

## Asset provenance

| Asset type | Source | Licence | Notes |
|---|---|---|---|
| Typography (display/title) | Source Serif 4 (Google Fonts) | SIL OFL 1.1 | Redistributable. Used via design tokens. |
| Typography (UI/body) | Inter (Google Fonts) | SIL OFL 1.1 | Redistributable. Used via design tokens. |
| Typography (mono) | JetBrains Mono (Google Fonts) | SIL OFL 1.1 | Redistributable. Used via design tokens. |
| Design tokens | Original Paperu | Proprietary | Created by Integrator. No tokens copied from benchmark products. |
| UI components | Original Paperu (@paperu/ui) | Proprietary | Built from scratch. No component libraries copied. |
| Icons | Lucide (lucide-react) | ISC | Permissive. Line-based, low-detail. No vendor-branded icons. |
| App icon | Original Paperu "P" mark | Proprietary | Simple geometric mark. Not copied from any product. |
| Cursor assets | Not yet created | — | Future Capture Studio will use system cursors or original assets. **No Recordly cursor assets will be reused.** |
| Backgrounds/wallpapers | Not yet created | — | Future Capture Studio will use original Paperu presets. **No Recordly wallpapers will be reused.** |

---

## Code provenance by module

| Module | Original? | Based on? | Notes |
|---|---|---|---|
| packages/contracts | ✅ Original | Integrator-authored | Typed IPC contract source of truth |
| packages/design-tokens | ✅ Original | Integrator-authored | Semantic CSS tokens |
| packages/ui | ✅ Original | Integrator-authored | Button, Card, VisuallyHidden |
| apps/desktop/src-tauri (Rust) | ✅ Original | Integrator + Builder | Commands, filesystem, errors, tasks |
| apps/desktop/src/engines/pdf-engine.ts | ✅ Original | Builder | Uses pdf-lib + pdfjs APIs. Algorithm independently designed. |
| apps/desktop/src/engines/image-engine.ts | ✅ Original | Builder | Uses Canvas API. Algorithm independently designed. |
| apps/desktop/src/features/* | ✅ Original | Builder | All UI independently designed. No benchmark UI copied. |
| apps/desktop/src/lib/working-file.ts | ✅ Original | Builder | Composable workflow store |
| apps/desktop/src/lib/platform.ts | ✅ Original | Builder | Cross-platform utilities |

---

## Recordly / Capture Studio provenance

The doctrine specifies that Paperu will eventually build a Capture
Studio benchmarked against Recordly-class applications. The following
constraints apply:

1. **No source code reuse.** Recordly repositories contain differing
   licence declarations, including AGPL-3.0. AGPL is a strong copyleft
   licence that is incompatible with Paperu's proprietary commercial
   distribution. No Recordly source code will be reused.

2. **No asset reuse.** Recordly cursor assets, wallpapers, shaders,
   renderers, native helpers, project formats, and icons will not be
   reused. Paperu Capture will use original assets or system-provided
   assets.

3. **Functional benchmark only.** Paperu may study Recordly's publicly
   documented functionality (recording, zoom, cursor smoothing, etc.)
   as a product benchmark, then implement equivalent capabilities
   independently using Paperu's own architecture, UI, branding, and code.

4. **Project format.** Paperu Capture will use an original project
   format (e.g. `.paperu` or `.paperucapture`), NOT `.recordly`.

5. **Extension architecture.** If Paperu Capture eventually supports
   extensions, a proper security model must exist before public
   extension execution is allowed. An unrestricted plugin system in a
   file-processing desktop application would be a security risk.

6. **Integrator audit required.** Before any Capture Studio code is
   written, the Integrator must perform a complete licence/provenance
   audit of any dependency, asset, or implementation approach that
   could conflict with Paperu's commercial distribution.

---

## OCR provenance

The doctrine (§26) notes that many modern OCR engines use
machine-learning/neural models internally. Paperu's "no AI" constraint
(doctrine §25) prohibits LLMs, generative AI, and ML models.

If OCR is implemented:
- The Integrator must document the chosen OCR approach before it ships.
- If no acceptable non-AI OCR implementation meets Paperu's quality
  standards, OCR is deferred rather than violating the product promise.
- No OCR engine will be quietly shipped and labeled "non-AI" if it
  internally uses ML models.

**Current status**: OCR is **Missing** and **deferred**.

---

## Update protocol

- When a new dependency is proposed, add it to the Dependency Provenance
  section with full licence/provenance information.
- When a new asset is created, add it to the Asset Provenance section.
- When a capability is benchmarked against a new product, add the
  product to the Benchmark Products section.
- This file is updated in the same commit as the dependency/asset/capability
  it documents.
