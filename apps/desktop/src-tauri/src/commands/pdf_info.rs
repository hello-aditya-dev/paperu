//! `pdf_page_count` command — return the page count of a local PDF.
//!
//! Used by the Split view to validate page ranges against the actual
//! page count (doctrine §9: "Validate ranges against: 24, not: 9999").
//! The path is re-validated server-side. Only metadata is read; the
//! source file is never modified.
//!
//! Note: this reads the file in Rust to count pages. A simple approach
//! is to count "/Type /Page" occurrences, but that can overcount. A
//! more robust approach uses a PDF parser. For the foundation, we use
//! a conservative regex-like scan for "/Count N" in the root pages
//! node, falling back to "/Type/Page" counting. This is good enough
//! for validation; the webview engine (pdf-lib) does the authoritative
//! parse during the actual operation.

use crate::contracts::common::FilePath;
use crate::errors::{code, AppError, ErrorCategory, Result};
use crate::filesystem;

/// Request to get a PDF's page count.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageCountRequest {
    /// Absolute path to the PDF. Re-validated server-side.
    pub path: FilePath,
}

/// The page count result.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageCountResponse {
    /// The number of pages, or null if it could not be determined.
    pub page_count: Option<u32>,
}

/// `pdf_page_count` command: return the page count of a local PDF.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn pdf_page_count(request: PdfPageCountRequest) -> Result<PdfPageCountResponse> {
    let path = filesystem::paths::validate_input_path(&request.path)?;
    if !path.exists() {
        return Err(AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "Paperu can't find that file.",
        )
        .build());
    }

    // Read the file and count pages. We look for the "/Count" entry in
    // the Pages root, which is the authoritative count for well-formed
    // PDFs. If that fails, we fall back to counting "/Type /Page"
    // (not /Pages) occurrences.
    let bytes = std::fs::read(&path).map_err(AppError::from)?;

    // Quick check: is it a PDF?
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err(AppError::builder(
            code::UNSUPPORTED_FORMAT,
            ErrorCategory::Unsupported,
            "That file is not a valid PDF.",
        )
        .build());
    }

    let count = count_pdf_pages(&bytes);
    Ok(PdfPageCountResponse { page_count: count })
}

/// Count the pages in a PDF byte slice. Returns None if undeterminable.
fn count_pdf_pages(bytes: &[u8]) -> Option<u32> {
    // Convert to a lossy string for scanning. PDFs are mostly ASCII in
    // the structural parts we care about.
    let text = std::str::from_utf8(bytes).ok()?;

    // Strategy 1: find "/Count N" in the document. The Pages root has
    // a /Count entry. We take the last occurrence (the root count).
    let mut last_count: Option<u32> = None;
    for line in text.lines() {
        if let Some(idx) = line.find("/Count") {
            let rest = &line[idx + 6..];
            // Skip whitespace and parse the number.
            let trimmed = rest.trim_start();
            let num_str: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = num_str.parse::<u32>() {
                last_count = Some(n);
            }
        }
    }
    if last_count.is_some() {
        return last_count;
    }

    // Strategy 2: count "/Type /Page" (not "/Type /Pages").
    // This can overcount if the PDF has nested page tree nodes, but
    // it's a reasonable fallback.
    let mut count = 0u32;
    let mut idx = 0;
    let pattern = b"/Type/Page";
    let pattern_pages = b"/Type/Pages";
    while idx < bytes.len() {
        if bytes[idx..].starts_with(pattern) && !bytes[idx..].starts_with(pattern_pages) {
            count += 1;
        }
        idx += 1;
    }
    if count > 0 {
        Some(count)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_rejects_empty_path() {
        let req = PdfPageCountRequest {
            path: String::new(),
        };
        let result = pdf_page_count(req);
        assert!(result.is_err());
    }

    #[test]
    fn count_parses_count_entry() {
        // A minimal PDF snippet with /Count 3.
        let pdf = b"%PDF-1.4\n/Type /Catalog /Pages 2 0 R\n/Type /Pages /Count 3\n%%EOF";
        assert_eq!(count_pdf_pages(pdf), Some(3));
    }

    #[test]
    fn count_falls_back_to_type_page() {
        // A snippet with /Type/Page (no space, as in real PDFs) but no /Count.
        let pdf = b"%PDF-1.4\n/Type/Page\n/Type/Page\n/Type/Pages\n%%EOF";
        // Should count 2 (the /Page entries, not /Pages).
        assert_eq!(count_pdf_pages(pdf), Some(2));
    }

    #[test]
    fn count_returns_none_for_garbage() {
        assert_eq!(count_pdf_pages(b"not a pdf"), None);
    }
}
