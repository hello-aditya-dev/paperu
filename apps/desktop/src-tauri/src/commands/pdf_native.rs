#![cfg(feature = "tauri-runtime")]
//! Tauri commands for PDF page operations (rotate/delete/extract).
//!
//! Each command takes the source PATH (the Rust side reads the bytes via
//! std::fs — no separate frontend read needed), processes in-memory, and
//! returns the result as base64 so the frontend can pass it straight to
//! finalize_output. Source-safety §22: the original file is never
//! modified; the engine works on an in-memory copy.
//!
//! The base64 encoder lives in `crate::pdf_native` (non-gated, unit-tested)
//! so its index-type correctness is verified on Linux CI, not only on
//! Windows CI where this gated module is compiled.

use crate::errors::Result;
use crate::pdf_native;

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
            bytes_base64: pdf_native::bytes_to_base64(&bytes),
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

#[tauri::command]
pub fn inspect_pdf_metadata(path: String) -> Result<pdf_native::PdfMetadata> {
    let bytes = read_source(&path)?;
    pdf_native::inspect_metadata(&bytes)
}

#[tauri::command]
pub fn remove_pdf_metadata(path: String) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::remove_metadata(&bytes)?;
    Ok(PdfNativeResponse::from_bytes(out))
}

#[tauri::command]
pub fn set_pdf_page_size(
    path: String,
    width: f64,
    height: f64,
    pages: Vec<u32>,
) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::set_page_size(&bytes, width, height, &pages)?;
    Ok(PdfNativeResponse::from_bytes(out))
}

#[tauri::command]
pub fn reorder_pdf_pages(path: String, order: Vec<u32>) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::reorder_pages(&bytes, &order)?;
    Ok(PdfNativeResponse::from_bytes(out))
}

#[tauri::command]
pub fn reverse_pdf_pages(path: String) -> Result<PdfNativeResponse> {
    let bytes = read_source(&path)?;
    let out = pdf_native::reverse_pages(&bytes)?;
    Ok(PdfNativeResponse::from_bytes(out))
}
