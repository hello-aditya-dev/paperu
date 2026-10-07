#![cfg(feature = "tauri-runtime")]
//! Tauri commands for PDF page operations (rotate/delete/extract).
//!
//! Each command takes the source PATH (the Rust side reads the bytes via
//! std::fs — no separate frontend read needed), processes in-memory, and
//! returns the result as base64 so the frontend can pass it straight to
//! finalize_output. Source-safety §22: the original file is never
//! modified; the engine works on an in-memory copy.

use crate::errors::Result;
use crate::pdf_native;

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn bytes_to_base64(bytes: &[u8]) -> String {
    let mut s = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        let b0 = bytes[i];
        let b1 = if i + 1 < len { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < len { bytes[i + 2] } else { 0 };
        s.push(B64[(b0 >> 2) as usize] as char);
        s.push(B64[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        s.push(if i + 1 < len {
            B64[((b1 & 0x0f) << 2) | (b2 >> 6)] as char
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

fn read_source(path: &str) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| {
        crate::errors::AppError::builder(
            crate::errors::code::FILE_NOT_FOUND,
            crate::errors::ErrorCategory::Filesystem,
            "Paperu couldn't read that PDF.",
        )
        .technical(e.to_string())
        .build()
    })
}

/// Response shape for the pdf_native commands.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfNativeResponse {
    pub bytes_base64: String,
    pub page_count: u32,
}

impl PdfNativeResponse {
    fn from_bytes(bytes: Vec<u8>) -> Self {
        let page_count = pdf_native::page_count(&bytes);
        PdfNativeResponse {
            bytes_base64: bytes_to_base64(&bytes),
            page_count,
        }
    }
}

#[tauri::command]
pub fn rotate_pdf_pages(path: String, angle: u16, pages: Vec<u32>) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::rotate_pages(&bytes, angle, &pages)?;
    Ok(PdfNativeResponse::from_bytes(out))
}

#[tauri::command]
pub fn delete_pdf_pages(path: String, pages: Vec<u32>) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::delete_pages(&bytes, &pages)?;
    Ok(PdfNativeResponse::from_bytes(out))
}

#[tauri::command]
pub fn extract_pdf_pages(path: String, pages: Vec<u32>) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::extract_pages(&bytes, &pages)?;
    Ok(PdfNativeResponse::from_bytes(out))
}

#[tauri::command]
pub fn pdf_native_page_count(path: String) -> Result<u32> {
    let bytes = read_source(&path)?;
    Ok(pdf_native::page_count(&bytes))
}
