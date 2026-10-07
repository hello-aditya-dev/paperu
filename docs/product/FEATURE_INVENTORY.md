# Paperu Feature Inventory

Canonical internal scope ledger. Every non-video Paperu feature is represented.
Statuses: ABSENT | SHELL | FOUNDATION | WORKING | USEFUL | AUTOMATED VERIFIED | WINDOWS COMPILE VERIFIED | REAL WINDOWS VERIFIED | GUARDIAN VERIFIED | REMOVED FROM SCOPE.

## Core Experience
| Feature | Status | Available | Frontend | Backend | Persistence | Tests | Windows Compile | Remaining |
|---|---|---|---|---|---|---|---|---|
| Universal Drop | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | clipboard paste, folder intake |
| Command Center | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | — |
| Action Palette | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | global shortcut wiring |
| Shelf | WORKING | yes | ✅ | ✅ | session-only | — | ✅ | persistence, multi-select send |
| Recent Work | USEFUL | yes | ✅ | ✅ | ✅ SQLite | ✅ | ✅ | — |
| Save As | WORKING | yes | ✅ | ✅ | — | ✅ Rust | ✅ | wire into all result cards |
| Diagnostics | FOUNDATION | yes | ✅ | ✅ | ✅ | — | ✅ | perf instrumentation |

## PDF / Document Toolbox
| Feature | Status | Available | Frontend | Backend | Persistence | Tests | Windows Compile | Remaining |
|---|---|---|---|---|---|---|---|---|
| PDF Make It Fit | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | truthful requirementMet messaging |
| PDF Merge | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | — |
| PDF Split / Extract | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | — |
| Images → PDF | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | — |
| PDF → Images | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | — |
| Sign PDF | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | PKI disclaimer |
| Fill PDF | USEFUL | yes | ✅ | ✅ | — | ✅ | ✅ | — |
| Print Studio | USEFUL | yes | ✅ native paths + AbortController | ✅ | — | — | ✅ | grayscale, passport sheets |
| Study Reader | WORKING | yes | ✅ true fit-width (real container/page calc + resize recalc) | ✅ | ✅ SQLite | — | ✅ | search, bookmarks, annotations |
| PDF Notebook | SHELL | no | ✅ stub | — | — | — | — | page templates, export |
| PDF Metadata | FOUNDATION | no | — | ✅ pdf_info | — | ✅ | ✅ | inspect/edit/remove |
| PDF Annotations | ABSENT | no | — | — | — | — | — | text, highlight, shapes, comments |
| PDF Redaction | ABSENT | no | — | — | — | — | — | genuine destructive redaction |
| PDF Password | ABSENT | no | — | — | — | — | — | encrypt/decrypt |
| PDF Watermark | ABSENT | no | — | — | — | — | — | text/opacity/placement |
| PDF Page Numbers | ABSENT | no | — | — | — | — | — | bottom center/right, start value |
| PDF Rotate | ABSENT | no | — | — | — | — | — | 90/180/270 |
| PDF Crop | ABSENT | no | — | — | — | — | — | page-level crop |
| PDF Reorder | ABSENT | no | — | — | — | — | — | drag-reorder pages |

## Image + Metadata/Privacy
| Feature | Status | Available | Frontend | Backend | Tests | Windows Compile | Remaining |
|---|---|---|---|---|---|---|---|
| Image Make It Fit | USEFUL | yes | ✅ | ✅ | ✅ | ✅ | — |
| Resize | USEFUL | yes (Image Toolbox) | ✅ | ✅ Canvas | — | ✅ | — |
| Crop | USEFUL | yes (Image Toolbox) | ✅ x/y/w/h | ✅ Canvas | — | ✅ | preset ratios, visual selection |
| Rotate | USEFUL | yes (Image Toolbox) | ✅ 90/180/270 | ✅ Canvas | — | ✅ | — |
| Convert | USEFUL | yes (Image Toolbox) | ✅ PNG/JPEG/WebP | ✅ Canvas | — | ✅ | — |
| Metadata Inspect | USEFUL | yes (Image Toolbox) | ✅ real EXIF + GPS IFD | ✅ Canvas | ✅ detectJpegExifGps (9 tests) | ✅ | EXIF field detail |
| EXIF/GPS Strip | USEFUL | yes (Image Toolbox) | ✅ truthful report | ✅ Canvas | ✅ | ✅ | — (truthful: reports only what was present) |
| Watermark | ABSENT | no | — | — | — | — | text/opacity |
| Brightness/Contrast | ABSENT | no | — | — | — | — | simple adjustments |

## Student / Application Workflows
| Feature | Status | Available | Frontend | Backend | Persistence | Tests | Windows Compile | Remaining |
|---|---|---|---|---|---|---|---|---|
| Assignment Studio | USEFUL | yes | ✅ cover/page-numbers/target-size + native paths | ✅ | — | — | ✅ | A4-normalize original PDFs, rotate/crop, signature overlay |
| Portal Ready | USEFUL | yes | ✅ native paths + AbortController + compliance card | ✅ | — | ✅ basename-guard | ✅ | exact dimensions, aspect ratio, multi-constraint pipeline |
| Application Kit | USEFUL | yes | ✅ add/edit/replace/open/reveal/search/missing-file | ✅ CRUD | ✅ SQLite | ✅ Rust | ✅ | — |
| Study Reader | WORKING | yes | ✅ true fit-width + resize recalc | ✅ | ✅ SQLite | ✅ Rust | ✅ | search, bookmarks, annotations |
| Notes | WORKING | yes | ✅ | ✅ | ✅ SQLite | ✅ Rust | ✅ | rich editor, attachments |
| Study Packs | SHELL | no | ✅ stub | ✅ schema | ✅ SQLite | — | ✅ | CRUD, file refs, missing-file handling |
| Citation Studio | USEFUL | yes | ✅ | ✅ | ✅ SQLite | ✅ Rust | ✅ | bibliography export, editors |
| PDF Notebook | SHELL | no | ✅ stub | — | — | — | — | page templates, export |
| Document Scanner | SHELL | no | ✅ stub | — | — | — | — | crop, brightness, A4, combine |
| Screenshot → Assignment | SHELL | no | ✅ stub | — | — | — | — | crop, annotate, bridge |
| Print Studio / Exam Print | WORKING | yes | ✅ | ✅ | — | — | ✅ | grayscale, page range, passport sheets |
| Batch Studio | USEFUL | yes | ✅ native paths + real cancellation (cancelled state) | ✅ | — | ✅ basename-guard | ✅ | queue persistence |
| Passport/College Photo | ABSENT | no | — | — | — | — | — | crop, exact dimensions, print sheets |
| Signature Studio/Vault | ABSENT | no | — | — | — | — | — | draw, upload, reuse |
| Forms Vault | ABSENT | no | — | — | — | — | — | reusable fields |
| Paperu Send | SHELL | no | ✅ stub | — | — | — | — | LAN transfer, QR, security |

## Everyday File-Power Tools
| Feature | Status | Available | Frontend | Backend | Persistence | Tests | Windows Compile | Remaining |
|---|---|---|---|---|---|---|---|---|
| Rename Studio | USEFUL | yes | ✅ | ✅ Rust | — | ✅ Rust | ✅ | undo, date tokens |
| Filename Fixer | WORKING | yes | ✅ | ✅ (reuses rename) | — | shared | ✅ | — |
| Duplicate Finder | USEFUL | yes | ✅ native picker + summary + per-copy reveal/open | ✅ Rust | — | ✅ Rust | ✅ | perceptual hash, safe remove (Rust command) |
| Downloads Cleaner | USEFUL | yes | ✅ native picker + summary + filter + reveal/open | ✅ Rust | — | ✅ Rust | ✅ | move-to action (Rust command) |
| Folder Organizer | USEFUL | yes | ✅ native folder pickers + execute + confirmation | ✅ Rust execute (move/copy + cross-volume fallback) | ✅ SQLite | ✅ Rust (3 execute tests) | ✅ | undo |
| Quick Look | USEFUL | yes | ✅ images + text + PDF preview (lazy pdfjs) + reveal/open | ✅ | — | — | ✅ | thumbnails, audio/video |
| Image Toolbox (Offline Converter) | USEFUL | yes | ✅ convert/resize/crop/rotate/inspect/strip + native paths | ✅ Canvas | — | ✅ detectJpegExifGps (9 tests) | ✅ | batch, visual crop selection |
| Archive Studio | FOUNDATION | no | ✅ stub | ✅ Rust validation | — | ✅ Rust | ✅ | actual ZIP create/extract |
| File Rescue | USEFUL | yes | ✅ diagnose + real recovery (re-encode fresh copy) | ✅ Rust | — | ✅ Rust | ✅ | more recovery strategies |
| File Inspector | USEFUL | yes | ✅ | ✅ Rust | — | ✅ Rust | ✅ | metadata detail, privacy indicators |
| Clipboard History | SHELL | no | ✅ stub | ✅ schema | ✅ SQLite | — | ✅ | capture, search, pin, security review |
| Comparison Tools | ABSENT | no | — | — | — | — | — | PDF/document diff |

## Automation + Drives
| Feature | Status | Available | Frontend | Backend | Persistence | Tests | Windows Compile | Remaining |
|---|---|---|---|---|---|---|---|---|
| Recipes | ABSENT | no | — | — | — | — | — | reusable workflow definitions |
| Local Backup Recipes | SHELL | no | ✅ stub | ✅ schema | ✅ SQLite | — | ✅ | dry-run, run, verify |
| Timer Jobs | SHELL | no | ✅ stub | ✅ schema | ✅ SQLite | — | ✅ | schedule eval, execution history |
| Watch Folders | SHELL | no | ✅ stub | ✅ schema | ✅ SQLite | — | ✅ | watcher, debounce, loop prevention |
| USB / Drive Toolbox | SHELL | no | ✅ stub | — | — | — | ✅ | copy+verify+checksum |

## Commercial / Platform
| Feature | Status | Available | Remaining |
|---|---|---|---|
| Diagnostics | FOUNDATION | yes | perf markers, timing |
| Licensing | ABSENT | no | activation, restore, offline cache |
| Updater | ABSENT | no | update check, download, install |
| Light/Dark Theme | WORKING | yes | — |
| Reduced Motion | WORKING | yes | — |

## Office / Business Document Utilities
| Feature | Status | Available | Remaining |
|---|---|---|---|
| Business Documents | ABSENT | no | invoices, quotations, receipts, templates |

## Removed From Scope
| Feature | Status | Reason |
|---|---|---|
| Video Editor | REMOVED FROM SCOPE | Permanent removal. Paperu is not a video editor. Generic file operations on video files (inspect, hash, copy, rename, archive) remain. |
