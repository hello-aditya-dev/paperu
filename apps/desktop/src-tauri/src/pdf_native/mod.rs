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
    if angle % 90 != 0 || angle > 270 {
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
}
