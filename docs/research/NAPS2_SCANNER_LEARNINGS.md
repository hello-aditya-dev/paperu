# NAPS2 — Scanner UX Learnings (Reference Only)

**Sprint:** Open-Source Harvest + Integration
**Repo:** cyanfish/naps2 (commit 9314194d87e6)
**Licence:** GPL-2.0-or-later — **REFERENCE ONLY, NO CODE COPIED**
**Date:** 2026-10-07

Per master prompt §28: study NAPS2 scanner UX and implement Paperu's
scanner independently. NAPS2 is GPL — Paperu does not copy its source.

## Studied UX patterns (concepts, not code)

1. **Page list sidebar** — scanned pages appear as thumbnails in a vertical
   list; user can drag-reorder, delete, rotate individual pages. Paperu's
   Assignment Studio already has a reorder list; the scanner should reuse
   the same composable pattern.

2. **Per-page rotation** — each page has independent 90/180/270 rotation
   applied non-destructively (the source image isn't re-encoded until
   export). Paperu's image-engine `rotateImage` covers this.

3. **Crop workflow** — drag a rectangle over the page preview; crop applies
   to the single page. Paperu's Image Toolbox crop primitive covers this.

4. **Brightness/contrast/threshold** — simple slider adjustments applied
   per-page before export. Canvas can do brightness/contrast via
   pixel-level processing; threshold is a binarize operation.

5. **A4 normalization** — output pages are placed on A4 sheets regardless
   of source dimensions, with margins. Paperu's Assignment Studio already
   produces A4 image-derived pages via `imagesToPdf({ layout: "a4" })`.

6. **Output flow** — combine all pages into one PDF. Paperu's `mergePdfs`
   covers this.

7. **Scanner device errors** — NAPS2 shows clear errors when the scanner
   device is unavailable/disconnected. Paperu doesn't drive hardware
   scanners (that needs a platform API); instead Paperu's "scanner"
   accepts photos/screenshots the user took with their phone/camera and
   runs the same crop/enhance/A4/PDF pipeline.

## Paperu implementation plan (independent)

Paperu's "Document Scanner" (Feature, currently SHELL) will be built
from existing Paperu primitives + Canvas, NOT from NAPS2 code:

  photo input (native picker)
  → per-page crop (image-engine cropImage)
  → per-page rotate (image-engine rotateImage)
  → per-page enhance (Canvas brightness/contrast/threshold)
  → A4 normalization (imagesToPdf layout: "a4")
  → merge (mergePdfs)
  → finalize (finalizeOutput with absolute path)

No NAPS2 source is copied. The pipeline reuses Paperu's existing
image-engine + pdf-engine, which were written independently.
