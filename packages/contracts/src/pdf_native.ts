/**
 * @paperu/contracts — pdf_native.ts
 *
 * Rust-native PDF page operations (rotate / delete / extract) via lopdf
 * (MIT, OSS harvest). Rust mirror at src/pdf_native/mod.rs.
 */

/** Response from the pdf_native commands: the modified PDF bytes (base64)
 *  + the resulting page count (so the UI can update its page-range UI). */
export interface PdfNativeResponse {
  readonly bytesBase64: string;
  readonly pageCount: number;
}

export const PdfNativeCommand = {
  Rotate: "rotate_pdf_pages",
  Delete: "delete_pdf_pages",
  Extract: "extract_pdf_pages",
  PageCount: "pdf_native_page_count",
} as const;
