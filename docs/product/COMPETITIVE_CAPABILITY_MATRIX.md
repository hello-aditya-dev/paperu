# Paperu — Competitive Capability Matrix

This document tracks Paperu's functional parity against mature benchmark
applications. It exists to ensure we do not overlook important
capabilities that users expect from world-class software.

This is **not** a marketing document. It is an engineering gap-analysis
tool. Capabilities are tracked by status so the team can see what's
missing, planned, building, implemented, or Guardian-verified.

**Legal**: Paperu studies functionality and user problems from benchmark
products. Paperu does NOT copy proprietary source code, assets, UI,
icons, illustrations, logos, screenshots, trade dress, or marketing
copy. All implementations are original. See `CAPABILITY_PROVENANCE.md`.

---

## Status definitions

| Status | Meaning |
|---|---|
| Missing | Not implemented, not planned for near-term |
| Planned | Designed, not started |
| Building | In active development |
| Implemented | Code complete, passing gate, not yet Guardian-verified |
| Guardian Verified | Guardian has tested normal + edge + failure + keyboard + performance |

---

## PDF capabilities

Benchmark: Adobe Acrobat, PDF Expert

| Capability | User problem | Paperu status | Paperu implementation | Local/offline | Tests |
|---|---|---|---|---|---|
| View PDF | Open and read a PDF | Implemented | pdfjs render in webview | Yes | Component tests |
| Thumbnails | Navigate by page preview | Missing | — | — | — |
| Search text | Find text in PDF | Missing | — | — | — |
| Bookmarks | Jump to saved locations | Missing | — | — | — |
| Split/two-page view | Read like a book | Missing | — | — | — |
| Merge PDFs | Combine multiple PDFs | Guardian Verified | pdf-lib copyPages + finalize_output | Yes | 12 range tests + validation |
| Split / Extract | Get specific pages | Guardian Verified | pdf-lib + range parser | Yes | 16 range edge-case tests |
| Reorder pages | Rearrange page order | Missing | — | — | — |
| Rotate pages | Fix orientation | Missing | — | — | — |
| Crop pages | Trim page content | Missing | — | — | — |
| Page insertion | Add pages from another PDF | Missing | — | — | — |
| Page deletion | Remove unwanted pages | Missing | — | — | — |
| Compression (profile) | Reduce file size | Missing | — | — | — |
| Target-size compression | Make PDF under X KB | Implemented | Staged: lossless → rasterize-last | Yes | 13 validation tests |
| Images → PDF | Combine images into PDF | Implemented | pdf-lib embed + layouts | Yes | Output validation |
| PDF → Images | Render pages to PNG/JPEG | Implemented | pdfjs render + canvas | Yes | Output validation |
| Sign (electronic) | Place visible signature | Implemented | pdf-lib drawImage | Yes | Output validation |
| Fill / Annotate | Add text/date/checks | Implemented | pdf-lib drawText + drawRectangle | Yes | Output validation |
| Text editing | Edit existing text | Missing | — | — | — |
| Image editing | Edit embedded images | Missing | — | — | — |
| Link editing | Add/edit hyperlinks | Missing | — | — | — |
| Annotations (sticky notes) | Comment on document | Missing | — | — | — |
| Highlighting | Mark important text | Missing | — | — | — |
| Drawing | Freehand on document | Missing | — | — | — |
| Forms (AcroForm) | Fill interactive forms | Missing | — | — | — |
| OCR | Make scanned text searchable | Missing | Deferred — requires licence/provenance audit (doctrine §26) | — | — |
| Scanned-doc enhancement | Clean up scans | Missing | — | — | — |
| Conversion (PDF→Office) | Edit in Word/Excel | Missing | — | — | — |
| Password protection | Restrict opening | Missing | — | — | — |
| Permissions | Restrict editing/printing | Missing | — | — | — |
| Metadata editing | View/edit PDF metadata | Missing | — | — | — |
| Redaction (genuine) | Permanently remove content | Missing | Deferred — must actually remove content (doctrine §35) | — | — |
| Comparison | Diff two PDFs | Missing | — | — | — |
| Printing/export | Send to printer | Missing | — | — | — |

---

## Image capabilities

Benchmark: XnConvert, Preview, image utilities

| Capability | User problem | Paperu status | Paperu implementation | Local/offline | Tests |
|---|---|---|---|---|---|
| View image | Open and see an image | Implemented | createImageBitmap in webview | Yes | — |
| Resize | Change dimensions | Missing | — | — | — |
| Crop | Trim image | Missing | — | — | — |
| Rotate / Flip | Fix orientation | Missing | — | — | — |
| Format conversion | Change format | Missing | — | — | — |
| Target-size compression | Make image under X KB | Implemented | Canvas binary-search quality + dims | Yes | Output validation |
| Metadata preserve/remove | Privacy cleanup | Missing | — | — | — |
| EXIF inspection | View camera data | Missing | — | — | — |
| GPS stripping | Remove location data | Missing | — | — | — |
| Batch processing | Process many images | Missing | — | — | — |
| Rename patterns | Bulk rename | Missing | — | — | — |
| Color adjustments | Brightness/contrast/etc | Missing | — | — | — |
| Watermark | Add logo/text | Missing | — | — | — |
| Multi-step pipelines | Resize → convert → strip → rename | Missing | — | — | — |
| Batch reports | See what succeeded/failed | Missing | — | — | — |

---

## Capture capabilities (future)

Benchmark: ShareX, Recordly (functional benchmark only — no code/asset reuse)

| Capability | User problem | Paperu status | Local/offline | Tests |
|---|---|---|---|---|
| Screenshot (fullscreen) | Capture screen | Missing | Yes (planned) | — |
| Screenshot (region) | Capture part of screen | Missing | Yes (planned) | — |
| Screenshot (window) | Capture one window | Missing | Yes (planned) | — |
| Screenshot annotation | Mark up capture | Missing | Yes (planned) | — |
| Screen recording | Record screen activity | Missing | Yes (planned) | — |
| System audio capture | Record computer audio | Missing | Yes (planned) | — |
| Microphone capture | Record voice | Missing | Yes (planned) | — |
| Webcam recording | Record camera | Missing | Yes (planned) | — |
| Webcam overlay | Picture-in-picture | Missing | Yes (planned) | — |
| Cursor reconstruction | Smooth cursor rendering | Missing | Yes (planned) | — |
| Auto zoom | Focus on interaction | Missing | Yes (planned) | — |
| Manual zoom | Place zoom regions | Missing | Yes (planned) | — |
| Timeline editing | Trim/split/arrange | Missing | Yes (planned) | — |
| Speed regions | Speed up/slow down | Missing | Yes (planned) | — |
| Background styling | Canvas behind recording | Missing | Yes (planned) | — |
| Aspect ratio | Fit target format | Missing | Yes (planned) | — |
| MP4 export | Produce video | Missing | Yes (planned) | — |
| GIF export | Produce animation | Missing | Yes (planned) | — |
| Target-size video | Make video under X MB | Missing | Yes (planned) | — |
| Project files | Save/reopen edits | Missing | Yes (planned) | — |
| Project recovery | Recover from crash | Missing | Yes (planned) | — |

**Status**: Capture Studio is deferred until Wave-1 is Guardian-verified
and production-ready (doctrine: "Do NOT build all Capture features
immediately while core Paperu Wave 1 is still being hardened").

---

## OS file utility capabilities

Benchmark: PowerToys, Quick Look, Peek

| Capability | User problem | Paperu status | Local/offline | Tests |
|---|---|---|---|---|
| Fast file preview | Quick look without opening | Missing | Yes (planned) | — |
| Bulk rename | Rename many files | Missing | Yes (planned) | — |
| Command palette | Search and run commands | Missing | Yes (planned) | — |
| Metadata inspection | View file details | Implemented | inspect_file contract | Yes | Contract tests |
| Explorer/Finder integration | Right-click actions | Missing | Yes (planned) | — |
| Context-menu actions | Quick actions from OS | Missing | Yes (planned) | — |
| Clipboard tools | Save from clipboard | Missing | Yes (planned) | — |

---

## Automation capabilities (future)

Benchmark: Hazel

| Capability | User problem | Paperu status | Local/offline | Tests |
|---|---|---|---|---|
| Watch folders | Auto-process new files | Missing | Yes (planned) | — |
| Conditions | Filter by type/size/date | Missing | Yes (planned) | — |
| Action chains | Multi-step processing | Missing | Yes (planned) | — |
| Dry-run preview | See what would happen | Missing | Yes (planned) | — |
| Failure log | Track what went wrong | Missing | Yes (planned) | — |

**Status**: Automation is deferred until underlying primitives are stable
(doctrine: "Do not build automation until its underlying primitives are
stable").

---

## Business capabilities (future)

Benchmark: Swipe (functional benchmark only — no AI features copied)

| Capability | User problem | Paperu status | Local/offline | Tests |
|---|---|---|---|---|
| Invoices | Create sales invoices | Missing | Yes (planned) | — |
| Quotations | Create quotes | Missing | Yes (planned) | — |
| Receipts | Create payment receipts | Missing | Yes (planned) | — |
| GST/CGST/SGST/IGST | Tax calculations | Missing | Yes (planned) | — |
| UPI QR | Payment QR codes | Missing | Yes (planned) | — |
| Customers/vendors | Contact management | Missing | Yes (planned) | — |
| Products/services | Catalog management | Missing | Yes (planned) | — |
| Inventory | Stock tracking | Missing | Yes (planned) | — |
| Reports | Business analytics | Missing | Yes (planned) | — |

**Status**: Business is deferred until Wave-1 is production-ready
(doctrine: "Do NOT start business/media yet").

---

## Cross-cutting capabilities

These are expected from any mature desktop application.

| Capability | User problem | Paperu status | Tests |
|---|---|---|---|
| Universal Drop | Drop file → get actions | Implemented | 8 component tests |
| Open file | Open output in default app | Implemented | 3 Rust tests |
| Open folder | Reveal output in file manager | Implemented | 3 Rust tests |
| Save As | Choose destination explicitly | Missing (pending capability) | — |
| Recent files | Reopen previous work | Implemented (in-memory store) | — |
| Undo/redo | Reverse last action | Missing | — |
| Keyboard navigation | Use without mouse | Partial (nav rail ⌘1-9) | — |
| Command palette | Search and run | Planned (module registry exists) | 20 registry tests |
| Settings | Configure preferences | Implemented (contract) | — |
| Dark theme | Low-light mode | Implemented (design tokens) | — |
| Reduced motion | Accessibility | Implemented (CSS) | — |
| Composable workflows | Chain operations | Implemented (WorkingFile store) | — |
| Output validation | Verify result is valid | Implemented (all engines) | 29 validation tests |
| Non-destructive | Never modify original | Implemented (atomic_finalize) | 3 Rust tests |
| Cancellation | Stop long operations | Implemented (AbortController) | — |
| Progress | Real progress, not fake | Implemented (engine callbacks) | — |

---

## Student & Everyday capabilities (Wave B/C/D/E — future)

These capabilities are defined in the Student/Notes/Everyday doctrine
and are prioritized after Wave-1 is production-ready.

### Assignment & Study

| Capability | User problem | Paperu status | Wave |
|---|---|---|---|
| Assignment Studio | Compile assignment pages into one PDF | Missing | Wave B |
| Assignment Ready | Validate output against constraints | Missing | Wave B |
| Portal Ready engine | Solve file constraints deterministically | Missing | Wave B |
| Study Reader | Read PDFs with bookmarks/search/annotations | Missing | Wave C |
| Study Packs | Organize study materials by subject | Missing | Wave C |
| Citation Studio | Format citations (APA/MLA/Chicago/BibTeX) | Missing | Wave C |
| Lecture Mode | Record audio/screen with bookmarks | Missing | Wave C |
| PDF Notebook | Add blank/ruled/grid pages to PDFs | Missing | Wave E |

### Notes

| Capability | User problem | Paperu status | Wave |
|---|---|---|---|
| Notes (core editing) | Rich text notes with formatting | Missing | Wave C |
| Notes tables | Simple tables in notes | Missing | Wave C |
| Notes checklists | Interactive checklists | Missing | Wave C |
| Notes attachments | Attach files/images/PDFs to notes | Missing | Wave C |
| Locked notes | Encrypt sensitive notes | Missing | Wave C |
| Smart Folders | Deterministic note filtering | Missing | Wave C |
| Quick Note | Global shortcut for fast capture | Missing | Wave C |
| Notes version history | Restore earlier versions | Missing | Wave C |
| Audio notes | Record audio into a note | Missing | Wave C |

### Personal documents

| Capability | User problem | Paperu status | Wave |
|---|---|---|---|
| Application Kit | Store reusable personal documents | Missing | Wave B |
| Forms Vault | Save reusable form information | Missing | Wave B |
| Signature Vault | Store multiple signatures securely | Missing | Wave B |
| Passport/Photo Studio | Exact-dimension photos with validation | Missing | Wave B |
| Phone Scanner | Use phone as camera for desktop | Missing | Wave B |

### Everyday file power

| Capability | User problem | Paperu status | Wave |
|---|---|---|---|
| Quick Look | Spacebar preview | Missing | Wave D |
| Clipboard History | Local clipboard manager | Missing | Wave D |
| Downloads Cleaner | Classify and clean downloads | Missing | Wave D |
| Duplicate Finder | Find exact + similar duplicates | Missing | Wave D |
| Rename Studio | Bulk rename with patterns | Missing | Wave D |
| Folder Organizer | Rule-based file organization | Missing | Wave D |
| Offline Converter | Format conversion graph | Missing | Wave D |
| Archive Studio | Inspect/extract/create archives | Missing | Wave D |
| File Inspector | Deep metadata inspection | Missing | Wave D |
| File Rescue | Safe repair of damaged files | Missing | Wave D |

### Print & Scan

| Capability | User problem | Paperu status | Wave |
|---|---|---|---|
| Print Studio+ | N-up, booklet, poster, grayscale | Missing | Wave E |
| Exam Print Mode | Print lecture PDFs efficiently | Missing | Wave E |
| Document Scanner | Crop/deskew/clean scanned docs | Missing | Wave E |
| Webpage → Clean PDF | Convert web pages to PDF | Missing | Wave E |

### Transfer & Automation

| Capability | User problem | Paperu status | Wave |
|---|---|---|---|
| Paperu Send | Local file transfer (desktop ↔ phone) | Missing | Wave B |
| Timer Jobs | Scheduled operations | Missing | Wave F |
| Watch Folders | Auto-process new files | Missing | Wave F |
| USB/Drive Toolbox | Copy/verify/checksum | Missing | Wave F |
| Local Backup Recipes | Folder → drive backup | Missing | Wave F |

---

## Update protocol

- When a capability moves to **Building** or **Implemented**, update
  this matrix in the same commit.
- When Guardian verifies a capability, update status to
  **Guardian Verified** and record the regression test location.
- When a capability is deferred, note the reason (e.g. "deferred —
  requires licence audit").
- Do not mark a capability **Implemented** unless the gate is green and
  output validation is in place.
