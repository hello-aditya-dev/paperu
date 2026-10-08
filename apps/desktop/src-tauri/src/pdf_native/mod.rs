//! PDF page operations — Rust-native, via `lopdf` (MIT, OSS harvest).
//!
//! Unlocks 3 previously-ABSENT features (master prompt §35):
//!   - rotate_pages  (90 / 180 / 270, all or selected pages)
//!   - delete_pages   (remove selected page numbers)
//!   - extract_pages (keep only the selected pages)
//!
//! All operations take the source BYTES (the frontend already read them
//! via the canonical readFileBytes) and return the modified BYTES. The
//! frontend then finalizes via finalizeOutput(absoluteSourcePath, …).
//! Source-safety §22: the original file is never modified — the engine
//! works on an in-memory copy.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use lopdf::{Document, Object, ObjectId};
use std::io::Cursor;

/// Rotate pages by a multiple of 90°. `pages` is 1-based; empty = all pages.
/// The rotation is cumulative (adds to any existing /Rotate value) and
/// normalized to [0, 360).
pub fn rotate_pages(bytes: &[u8], angle: u16, pages: &[u32]) -> Result<Vec<u8>> {
    if !angle.is_multiple_of(90) || angle > 270 {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Rotation angle must be 90, 180, or 270 degrees.",
        )
        .build());
    }
    let mut doc = load_doc(bytes)?;
    let all_pages = doc.get_pages();
    let angle_i64 = i64::from(angle);
    let target_set: std::collections::HashSet<u32> = if pages.is_empty() {
        all_pages.keys().copied().collect()
    } else {
        pages.iter().copied().collect()
    };
    for (&page_num, &page_id) in &all_pages {
        if !target_set.contains(&page_num) {
            continue;
        }
        let page_dict = doc
            .get_object_mut(page_id)
            .and_then(|obj| obj.as_dict_mut())
            .map_err(|e| {
                AppError::builder(
                    code::PROCESSING_FAILED,
                    ErrorCategory::Processing,
                    "Paperu couldn't read a page in that PDF.",
                )
                .technical(e.to_string())
                .build()
            })?;
        let current = page_dict
            .get(b"Rotate")
            .and_then(|obj| obj.as_i64())
            .unwrap_or(0);
        page_dict.set("Rotate", (current + angle_i64) % 360);
    }
    save_doc_to_bytes(doc)
}

/// Delete the specified 1-based page numbers. Out-of-range pages are
/// silently skipped (no error) — the caller's page-count check surfaces
/// the issue. The remaining pages keep their relative order.
pub fn delete_pages(bytes: &[u8], pages: &[u32]) -> Result<Vec<u8>> {
    let mut doc = load_doc(bytes)?;
    // lopdf's delete_pages expects a sorted, deduplicated slice.
    let mut sorted: Vec<u32> = pages.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    doc.delete_pages(&sorted);
    save_doc_to_bytes(doc)
}

/// Keep ONLY the specified 1-based page numbers (delete the complement).
/// The kept pages retain their original order; the result is renumbered.
pub fn extract_pages(bytes: &[u8], pages: &[u32]) -> Result<Vec<u8>> {
    if pages.is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Select at least one page to keep.",
        )
        .build());
    }
    let mut doc = load_doc(bytes)?;
    let all_pages = doc.get_pages();
    let keep: std::collections::HashSet<u32> = pages.iter().copied().collect();
    // Delete every page NOT in the keep set.
    let to_delete: Vec<u32> = all_pages
        .keys()
        .copied()
        .filter(|n| !keep.contains(n))
        .collect();
    if !to_delete.is_empty() {
        let mut sorted = to_delete;
        sorted.sort_unstable();
        sorted.dedup();
        doc.delete_pages(&sorted);
    }
    save_doc_to_bytes(doc)
}

/// Get the page count of a PDF (bytes). Returns 0 for an empty/invalid doc.
pub fn page_count(bytes: &[u8]) -> u32 {
    match load_doc(bytes) {
        Ok(doc) => doc.get_pages().len() as u32,
        Err(_) => 0,
    }
}

// ── PDF metadata (inspect / remove) — 90% §24 ─────────────────────

/// The metadata fields Paperu inspects + can remove. All optional.
#[derive(Debug, Clone, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub creation_date: Option<String>,
    pub mod_date: Option<String>,
}

/// Inspect the PDF Info dictionary (Title/Author/Subject/Keywords/
/// Creator/Producer/CreationDate/ModDate). Never reads page contents —
/// metadata only. Used for the privacy/sharing report.
pub fn inspect_metadata(bytes: &[u8]) -> Result<PdfMetadata> {
    let doc = load_doc(bytes)?;
    let info_id = match doc.trailer.get(b"Info") {
        Ok(Object::Reference(id)) => Some(*id),
        _ => None,
    };
    let mut meta = PdfMetadata::default();
    if let Some(id) = info_id {
        if let Ok(info) = doc.get_object(id) {
            if let Ok(dict) = info.as_dict() {
                // lopdf stores PDF strings as Object::String(Vec<u8>, StringFormat).
                // as_str() returns &[u8]; we decode lossily (metadata is text).
                let read_field = |field: &[u8]| -> Option<String> {
                    dict.get(field)
                        .ok()
                        .and_then(|o| o.as_str().ok())
                        .map(|b| String::from_utf8_lossy(b).to_string())
                };
                meta.title = read_field(b"Title");
                meta.author = read_field(b"Author");
                meta.subject = read_field(b"Subject");
                meta.keywords = read_field(b"Keywords");
                meta.creator = read_field(b"Creator");
                meta.producer = read_field(b"Producer");
                meta.creation_date = read_field(b"CreationDate");
                meta.mod_date = read_field(b"ModDate");
            }
        }
    }
    Ok(meta)
}

/// Remove the PDF Info dictionary fields (privacy: strip Author/Title/
/// Creator/Producer/etc.). The Info dict is left as an empty dictionary
/// so the trailer stays valid; the fields are gone. The original is never
/// modified — this works on an in-memory copy.
pub fn remove_metadata(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut doc = load_doc(bytes)?;
    if let Some(info_id) = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| o.as_reference().ok())
    {
        // Replace the Info dict with an empty dictionary (preserves the
        // trailer reference; clears all metadata fields).
        doc.set_object(info_id, lopdf::Dictionary::new());
    }
    save_doc_to_bytes(doc)
}

// ── Page geometry (set page size) — 90% §23 ────────────────────────

/// Standard page sizes (width × height in PDF points, 1pt = 1/72").
pub const A4_W: f64 = 595.28;
pub const A4_H: f64 = 841.89;
pub const LETTER_W: f64 = 612.0;
pub const LETTER_H: f64 = 792.0;
pub const LEGAL_W: f64 = 612.0;
pub const LEGAL_H: f64 = 1008.0;

/// Set the MediaBox of every (or selected) page to a custom size.
/// `pages` is 1-based; empty = all pages. The MediaBox is [0 0 width height].
/// No distortion — the page content isn't scaled, only the page boundary
/// changes. (For fit-to-page scaling, the caller uses pdf-lib embedPages.)
pub fn set_page_size(bytes: &[u8], width: f64, height: f64, pages: &[u32]) -> Result<Vec<u8>> {
    if width <= 0.0 || height <= 0.0 {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Page width and height must be positive.",
        )
        .build());
    }
    let mut doc = load_doc(bytes)?;
    let all_pages = doc.get_pages();
    let target: std::collections::HashSet<u32> = if pages.is_empty() {
        all_pages.keys().copied().collect()
    } else {
        pages.iter().copied().collect()
    };
    let media_box = vec![
        Object::Integer(0),
        Object::Integer(0),
        Object::Real(width as f32),
        Object::Real(height as f32),
    ];
    for (&page_num, &page_id) in &all_pages {
        if !target.contains(&page_num) {
            continue;
        }
        let page_dict = doc
            .get_object_mut(page_id)
            .and_then(|obj| obj.as_dict_mut())
            .map_err(|e| {
                AppError::builder(
                    code::PROCESSING_FAILED,
                    ErrorCategory::Processing,
                    "Paperu couldn't read a page in that PDF.",
                )
                .technical(e.to_string())
                .build()
            })?;
        page_dict.set("MediaBox", Object::Array(media_box.clone()));
    }
    save_doc_to_bytes(doc)
}

// ── Reorder / reverse pages — 90% §22 ─────────────────────────────

/// Reorder pages to the given 1-based order. `order` must contain every
/// page number exactly once (a permutation). The page tree's Kids array
/// is rebuilt in the new order. Returns an error if `order` is not a
/// valid permutation of 1..=N.
pub fn reorder_pages(bytes: &[u8], order: &[u32]) -> Result<Vec<u8>> {
    let mut doc = load_doc(bytes)?;
    let all_pages = doc.get_pages(); // BTreeMap<u32, ObjectId> in page order
    let n = all_pages.len() as u32;
    if order.len() as u32 != n {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "The reorder list must include every page exactly once.",
        )
        .technical(format!("got {} entries, expected {}", order.len(), n))
        .build());
    }
    // Validate it's a permutation of 1..=n.
    let mut sorted: Vec<u32> = order.to_vec();
    sorted.sort_unstable();
    let expected: Vec<u32> = (1..=n).collect();
    if sorted != expected {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "The reorder list must include every page exactly once (no duplicates, no gaps).",
        )
        .build());
    }
    // Build the reordered Kids array from the page object IDs.
    let mut kids: Vec<Object> = Vec::with_capacity(order.len());
    for &page_num in order {
        if let Some(&page_id) = all_pages.get(&page_num) {
            kids.push(Object::Reference(page_id));
        }
    }
    // Find the Pages root + set its Kids.
    let pages_root = doc.trailer.get(b"Root").and_then(|o| o.as_reference()).ok();
    if let Some(root_id) = pages_root {
        if let Ok(root) = doc.get_object_mut(root_id) {
            if let Ok(catalog) = root.as_dict_mut() {
                if let Ok(Object::Reference(pages_id)) = catalog.get(b"Pages") {
                    let pages_id = *pages_id;
                    if let Ok(pages_dict) = doc.get_object_mut(pages_id) {
                        if let Ok(pd) = pages_dict.as_dict_mut() {
                            pd.set("Kids", Object::Array(kids));
                        }
                    }
                }
            }
        }
    }
    save_doc_to_bytes(doc)
}

/// Reverse the page order (last page first). Convenience over reorder_pages.
pub fn reverse_pages(bytes: &[u8]) -> Result<Vec<u8>> {
    let n = page_count(bytes);
    if n == 0 {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "That PDF has no pages to reverse.",
        )
        .build());
    }
    let order: Vec<u32> = (1..=n).rev().collect();
    reorder_pages(bytes, &order)
}

// ── helpers ────────────────────────────────────────────────────────

fn load_doc(bytes: &[u8]) -> Result<Document> {
    Document::load_mem(bytes).map_err(|e| {
        AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "Paperu couldn't open that PDF — it may be corrupt or password-protected.",
        )
        .technical(e.to_string())
        .severity(ErrorSeverity::Warning)
        .build()
    })
}

fn save_doc_to_bytes(doc: Document) -> Result<Vec<u8>> {
    let mut buf = Cursor::new(Vec::new());
    let mut owned = doc;
    owned.save_to(&mut buf).map_err(|e| {
        AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "Paperu couldn't write the modified PDF.",
        )
        .technical(e.to_string())
        .build()
    })?;
    Ok(buf.into_inner())
}

// Lopdf's ObjectId/Object are imported to satisfy the trait bounds used
// by the public functions above; keep them referenced so unused-import
// doesn't fire when the only usage is in a closure arg type.
#[allow(dead_code)]
fn _trait_bounds(_id: ObjectId, _o: &Object) {}

// ── base64 encoding (for the Tauri command responses) ─────────────
// Lives here (non-gated) so it's unit-testable on Linux without
// tauri-runtime — the commands/*.rs files are only compiled on Windows CI.

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encode a byte slice as a base64 string (standard alphabet + padding).
pub fn bytes_to_base64(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        let b0 = bytes[i];
        let b1 = if i + 1 < len { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < len { bytes[i + 2] } else { 0 };
        s.push(B64[(b0 >> 2) as usize] as char);
        s.push(B64[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        s.push(if i + 1 < len {
            B64[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        s.push(if i + 2 < len {
            B64[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
        i += 3;
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    /// Build a minimal N-page PDF in-memory for testing page operations.
    fn build_test_pdf(num_pages: u32) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_root_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let mut page_ids: Vec<ObjectId> = Vec::new();
        for i in 0..num_pages {
            let content = lopdf::content::Content {
                operations: vec![
                    lopdf::content::Operation::new("BT", vec![]),
                    lopdf::content::Operation::new("Tf", vec!["F1".into(), 24.into()]),
                    lopdf::content::Operation::new("Td", vec![100.into(), 700.into()]),
                    lopdf::content::Operation::new(
                        "Tj",
                        vec![Object::string_literal(format!("Page {}", i + 1))],
                    ),
                    lopdf::content::Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(lopdf::Stream::new(
                dictionary! {},
                content.encode().unwrap(),
            ));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_root_id,
                "Resources" => resources_id,
                "Contents" => content_id,
            });
            page_ids.push(page_id);
        }
        let kids: Vec<Object> = page_ids.into_iter().map(Object::Reference).collect();
        doc.set_object(
            pages_root_id,
            dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => num_pages,
            },
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_root_id,
        });
        doc.trailer.set("Root", catalog_id);
        let mut buf = Cursor::new(Vec::new());
        doc.save_to(&mut buf).unwrap();
        buf.into_inner()
    }

    #[test]
    fn page_count_of_test_pdf() {
        let bytes = build_test_pdf(3);
        assert_eq!(page_count(&bytes), 3);
    }

    #[test]
    fn rotate_all_pages_preserves_count() {
        let bytes = build_test_pdf(3);
        let rotated = rotate_pages(&bytes, 90, &[]).unwrap();
        assert_eq!(
            page_count(&rotated),
            3,
            "rotation must not change page count"
        );
        // Re-loading + re-rotating 90 three more times = 360 = back to 0.
        let r2 = rotate_pages(&rotated, 90, &[]).unwrap();
        let r3 = rotate_pages(&r2, 90, &[]).unwrap();
        let r4 = rotate_pages(&r3, 90, &[]).unwrap();
        assert_eq!(page_count(&r4), 3);
    }

    #[test]
    fn rotate_selected_page_only() {
        let bytes = build_test_pdf(3);
        let rotated = rotate_pages(&bytes, 180, &[2]).unwrap();
        assert_eq!(page_count(&rotated), 3);
        // Verify page 2 has /Rotate = 180, others have none (or 0).
        let doc = Document::load_mem(&rotated).unwrap();
        let pages = doc.get_pages();
        let p1 = doc.get_object(*pages.get(&1).unwrap()).unwrap();
        let p2 = doc.get_object(*pages.get(&2).unwrap()).unwrap();
        let p3 = doc.get_object(*pages.get(&3).unwrap()).unwrap();
        let p1_rotate = p1
            .as_dict()
            .unwrap()
            .get(b"Rotate")
            .and_then(|o| o.as_i64())
            .unwrap_or(0);
        let p2_rotate = p2
            .as_dict()
            .unwrap()
            .get(b"Rotate")
            .and_then(|o| o.as_i64())
            .unwrap_or(0);
        let p3_rotate = p3
            .as_dict()
            .unwrap()
            .get(b"Rotate")
            .and_then(|o| o.as_i64())
            .unwrap_or(0);
        assert_eq!(p1_rotate, 0);
        assert_eq!(p2_rotate, 180);
        assert_eq!(p3_rotate, 0);
    }

    #[test]
    fn delete_pages_reduces_count() {
        let bytes = build_test_pdf(5);
        let after = delete_pages(&bytes, &[2, 4]).unwrap();
        assert_eq!(page_count(&after), 3, "deleting pages 2 and 4 leaves 3");
    }

    #[test]
    fn extract_pages_keeps_only_selected() {
        let bytes = build_test_pdf(5);
        let after = extract_pages(&bytes, &[1, 3, 5]).unwrap();
        assert_eq!(
            page_count(&after),
            3,
            "extract keeps only the selected pages"
        );
    }

    #[test]
    fn extract_single_page() {
        let bytes = build_test_pdf(4);
        let after = extract_pages(&bytes, &[2]).unwrap();
        assert_eq!(page_count(&after), 1);
    }

    #[test]
    fn rotate_invalid_angle_rejected() {
        let bytes = build_test_pdf(2);
        assert!(
            rotate_pages(&bytes, 45, &[]).is_err(),
            "45° is not a multiple of 90"
        );
        assert!(rotate_pages(&bytes, 360, &[]).is_err(), "360 > 270");
    }

    #[test]
    fn extract_empty_pages_rejected() {
        let bytes = build_test_pdf(2);
        assert!(
            extract_pages(&bytes, &[]).is_err(),
            "must select at least one page"
        );
    }

    #[test]
    fn operations_on_empty_bytes_fail_gracefully() {
        assert!(load_doc(&[]).is_err());
        assert_eq!(page_count(&[]), 0);
    }

    #[test]
    fn bytes_to_base64_encodes_correctly() {
        // Empty → empty.
        assert_eq!(bytes_to_base64(&[]), "");
        // "Man" → "TWFu" (the canonical base64 example).
        assert_eq!(bytes_to_base64(b"Man"), "TWFu");
        // "M" → "TQ==" (one byte → padded).
        assert_eq!(bytes_to_base64(b"M"), "TQ==");
        // "Ma" → "TWE=" (two bytes → one pad).
        assert_eq!(bytes_to_base64(b"Ma"), "TWE=");
        // Round-trip a 3-byte block.
        assert_eq!(bytes_to_base64(b"abc"), "YWJj");
    }

    // ── metadata / page geometry / reorder tests (90% §22-24) ───────

    #[test]
    fn inspect_metadata_on_test_pdf_returns_none_fields() {
        // The build_test_pdf helper creates no Info dict → all fields None.
        let bytes = build_test_pdf(2);
        let meta = inspect_metadata(&bytes).unwrap();
        assert!(meta.title.is_none());
        assert!(meta.author.is_none());
        assert!(meta.producer.is_none());
    }

    #[test]
    fn remove_metadata_preserves_page_count() {
        let bytes = build_test_pdf(3);
        let out = remove_metadata(&bytes).unwrap();
        assert_eq!(page_count(&out), 3, "metadata removal must not drop pages");
    }

    #[test]
    fn set_page_size_a4_changes_mediabox() {
        let bytes = build_test_pdf(2);
        let out = set_page_size(&bytes, A4_W, A4_H, &[]).unwrap();
        assert_eq!(page_count(&out), 2);
        // Re-load + verify the MediaBox is [0 0 595.28 841.89].
        let doc = Document::load_mem(&out).unwrap();
        let pages = doc.get_pages();
        for page_id in pages.values() {
            let page = doc.get_object(*page_id).unwrap();
            let dict = page.as_dict().unwrap();
            let mbox = dict.get(b"MediaBox").unwrap();
            let arr = mbox.as_array().unwrap();
            assert_eq!(arr[0].as_i64().unwrap(), 0);
            assert_eq!(arr[1].as_i64().unwrap(), 0);
            // width is Real(595.28) — check it's > 590.
            let w = match &arr[2] {
                Object::Real(r) => f64::from(*r),
                Object::Integer(i) => *i as f64,
                _ => 0.0,
            };
            assert!((w - A4_W).abs() < 1.0, "MediaBox width ≈ A4 width");
        }
    }

    #[test]
    fn set_page_size_rejects_nonpositive() {
        let bytes = build_test_pdf(1);
        assert!(set_page_size(&bytes, 0.0, 100.0, &[]).is_err());
        assert!(set_page_size(&bytes, -1.0, 100.0, &[]).is_err());
    }

    #[test]
    fn reverse_pages_preserves_count() {
        let bytes = build_test_pdf(4);
        let out = reverse_pages(&bytes).unwrap();
        assert_eq!(page_count(&out), 4);
    }

    #[test]
    fn reorder_pages_validates_permutation() {
        let bytes = build_test_pdf(3);
        // Wrong length.
        assert!(reorder_pages(&bytes, &[1, 2]).is_err());
        // Duplicate.
        assert!(reorder_pages(&bytes, &[1, 1, 3]).is_err());
        // Gap.
        assert!(reorder_pages(&bytes, &[1, 2, 4]).is_err());
        // Valid permutation succeeds.
        assert!(reorder_pages(&bytes, &[3, 1, 2]).is_ok());
        assert!(reorder_pages(&bytes, &[2, 3, 1]).is_ok());
    }

    #[test]
    fn reverse_pages_on_empty_pdf_errors() {
        // An empty byte slice isn't a valid PDF → load_doc fails → page_count=0.
        assert!(reverse_pages(&[]).is_err());
    }

    /// 90% §1D: reorder must genuinely change the visual page order (the
    /// Kids array of the Pages root), not just pass save_to(). Build a
    /// 3-page PDF with distinct page object IDs, reorder to [3, 1, 2], and
    /// verify the Kids array reflects the new order + the document re-loads
    /// validly (page count preserved, structure sound).
    #[test]
    fn reorder_genuinely_changes_visual_page_order() {
        let bytes = build_test_pdf(3);
        // Capture the original page object IDs in order (1, 2, 3).
        let original_doc = Document::load_mem(&bytes).unwrap();
        let original_pages = original_doc.get_pages(); // BTreeMap<u32, ObjectId>
        let original_ids: Vec<ObjectId> =
            (1..=3).map(|n| *original_pages.get(&n).unwrap()).collect();
        // Reorder to [3, 1, 2].
        let reordered = reorder_pages(&bytes, &[3, 1, 2]).unwrap();
        // Re-load — must succeed (valid document structure).
        let new_doc = Document::load_mem(&reordered).unwrap();
        assert_eq!(new_doc.get_pages().len(), 3, "page count preserved");
        // Read the Kids array from the Pages root + verify the order.
        let root_id = new_doc
            .trailer
            .get(b"Root")
            .and_then(|o| o.as_reference())
            .unwrap();
        let catalog = new_doc.get_object(root_id).unwrap().as_dict().unwrap();
        let pages_id = catalog
            .get(b"Pages")
            .and_then(|o| o.as_reference())
            .unwrap();
        let pages_dict = new_doc.get_object(pages_id).unwrap().as_dict().unwrap();
        let kids = pages_dict.get(b"Kids").unwrap().as_array().unwrap();
        // The Kids array must be [page3_id, page1_id, page2_id] — the visual
        // order genuinely changed.
        assert_eq!(kids.len(), 3, "Kids array has 3 entries");
        assert_eq!(
            kids[0].as_reference().unwrap(),
            original_ids[2],
            "first kid is original page 3"
        );
        assert_eq!(
            kids[1].as_reference().unwrap(),
            original_ids[0],
            "second kid is original page 1"
        );
        assert_eq!(
            kids[2].as_reference().unwrap(),
            original_ids[1],
            "third kid is original page 2"
        );
    }

    /// 90% §1D: a single-page PDF reorders to itself (identity permutation).
    #[test]
    fn reorder_single_page_is_identity() {
        let bytes = build_test_pdf(1);
        let out = reorder_pages(&bytes, &[1]).unwrap();
        assert_eq!(page_count(&out), 1);
    }
}
