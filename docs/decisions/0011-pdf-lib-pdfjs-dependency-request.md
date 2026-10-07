# Integrator dependency request — pdf-lib & pdfjs-dist

**From:** Builder
**Branch:** `agent/builder`
**Date:** 2026-10-07
**Status:** Awaiting Integrator approval

## Context

The Builder is porting the Wave-1 product features (PDF Make-It-Fit, Image
Make-It-Fit, PDF Merge, Split, Images↔PDF, Sign, Fill) into the canonical
Paperu repository. The canonical `engines/` Rust module is a placeholder
(`ENGINES_AVAILABLE = false`) and no Rust PDF/image crate is approved yet.

Per the course-correction §6, webview-side processing is permitted when it
is local, non-blocking, non-uploading, bounded, real-validated, and
architecturally reversible. The Builder's previous standalone prototype
proved that `pdf-lib` + `pdfjs-dist` deliver real, honest target-size
compression (verified: 3.63 MB → 477.9 KB at 500 KB target).

This request asks the Integrator to approve these two dependencies so the
Builder can ship the Wave-1 engines as a **feature-local TypeScript engine
service** in the frontend, wired through the canonical contracts and the
canonical Tauri filesystem finalization layer. The engine boundary in
`engines/` is preserved so a future native Rust engine can replace this
implementation without touching contracts or UI.

---

## Request 1: `pdf-lib`

| Field | Value |
|---|---|
| **Package** | `pdf-lib` |
| **Version** | `1.17.1` |
| **Licence** | MIT |
| **Purpose** | Pure-JavaScript PDF creation/manipulation: load + re-save with object streams + metadata strip (lossless structural compression, Stage 1), copy pages (merge), extract pages (split), embed JPEG/PNG images (Images→PDF, Sign, Fill), draw text/rectangles (Fill). |
| **Commercial compatibility** | ✅ MIT — permissive, compatible with proprietary commercial distribution. No copyleft. |
| **Where it runs** | In the Tauri webview (frontend), inside a feature-local engine service. Never in Rust. Never uploads. |
| **Bundled?** | Yes — bundled into the Vite production build (`apps/desktop/dist`), embedded into the Tauri binary by `tauri-build`. |
| **Why existing deps are insufficient** | No existing Paperu dependency can create/manipulate PDF structure. `@tauri-apps/api` is IPC only; `react`/`zustand` are UI. The Rust side has no PDF crate approved. `pdf-lib` is the only permissively-licensed pure-JS PDF library that does not require a worker or WASM eval (it is pure JS, CSP-safe under `script-src 'self'`). |
| **Transitive deps** | `@pdf-lib/standard-fonts`, `@pdf-lib/fontkit`, `pako` (zlib), `fast-xml-parser` — all MIT. |
| **CSP impact** | None. `pdf-lib` is pure JS, no `eval`, no workers, no WASM. Runs under the existing `script-src 'self'`. |

---

## Request 2: `pdfjs-dist`

| Field | Value |
|---|---|
| **Package** | `pdfjs-dist` |
| **Version** | `4.8.69` |
| **Licence** | Apache-2.0 |
| **Purpose** | PDF page rendering: rasterize pages to canvas for (a) PDF→Images, (b) the page-preview canvases in Sign/Fill, and (c) Stage-3 rasterization in the target-size engine (only when lossless + image-recompression cannot meet the target). |
| **Commercial compatibility** | ✅ Apache-2.0 — permissive, compatible with proprietary commercial distribution. No copyleft. |
| **Where it runs** | In the Tauri webview (frontend), inside a feature-local engine service. Never in Rust. Never uploads. |
| **Bundled?** | Yes — bundled into the Vite production build. The worker is loaded via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` which Vite emits as a separate chunk. |
| **Why existing deps are insufficient** | No existing Paperu dependency can render PDF pages to bitmaps. `pdf-lib` can embed images but cannot rasterize. A Rust render crate (e.g. `pdfium-render`) would require bundling a native binary + Integrator approval for the C++ dependency; that is the *future* native optimization path, not the Wave-1 path. |
| **Transitive deps** | `node-ensure` (polyfill, dev-only), `web-streams-polyfill` — MIT. |
| **CSP impact** | ⚠️ **Requires Integrator action.** `pdfjs-dist` uses a Web Worker. The current CSP `script-src 'self'` permits worker scripts from `'self'`, but the worker is emitted by Vite as a separate `.js`/`.mjs` chunk served from `asset.localhost`. The Integrator may need to add `worker-src 'self'` to the CSP in `tauri.conf.json` (Integrator-controlled file). **The Builder will not modify the CSP.** If the Integrator cannot add `worker-src`, the Builder will configure pdfjs to run on the main thread (`disableWorker: true`) which is slower but CSP-safe. |

---

## Reversibility / native-optimization path

Both dependencies live entirely in the frontend. The Builder will wire them
behind a feature-local engine service with a typed interface that mirrors
the `OperationRequest`/`OperationResult` contract shapes. When the
Integrator approves a native Rust PDF crate (e.g. `lopdf`, `pdfium-render`,
or `qpdf` bindings), the engine service can be replaced with Tauri command
calls without touching the UI or the contracts. The `engines/` Rust module
boundary is preserved untouched.

## What the Builder will NOT do

- Will not add the dependencies to any root/workspace `package.json` until
  the Integrator approves. Until then, the Builder will develop on a
  `feature/drop` branch that does not require them (Universal Drop uses
  only the existing `inspect_file` contract).
- Will not modify the CSP, capabilities, `Cargo.toml`, `tauri.conf.json`,
  or any lockfile.
- Will not introduce network calls. Both libraries are fully offline.

## Requested action

1. Approve `pdf-lib@1.17.1` (MIT) as a runtime dependency of
   `@paperu/desktop`.
2. Approve `pdfjs-dist@4.8.69` (Apache-2.0) as a runtime dependency of
   `@paperu/desktop`, and decide on the CSP `worker-src` question.
3. Add both to `apps/desktop/package.json` + `pnpm-lock.yaml` and document
   in `DEPENDENCIES.md` (Integrator-owned files).

Until approved, the Builder will proceed with the Universal Drop port
(which needs no new deps) and prepare the PDF/Image engine code on a
feature branch without committing the dependency changes.
