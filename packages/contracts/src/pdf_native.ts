/**
 * @paperu/contracts — pdf_native.ts
 *
 * Rust-native PDF page operations (rotate / delete / extract / reorder /
 * reverse / page-size / metadata inspect+remove) via lopdf (MIT, OSS
 * harvest). Rust mirror at src/pdf_native/mod.rs.
 */

/** Response from the pdf_native commands: the modified PDF bytes (base64)
 *  + the resulting page count (so the UI can update its page-range UI). */
export interface PdfNativeResponse {
  readonly bytesBase64: string;
  readonly pageCount: number;
}

/** The PDF Info dictionary metadata Paperu inspects + can remove. */
export interface PdfMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly keywords: string | null;
  readonly creator: string | null;
  readonly producer: string | null;
  readonly creationDate: string | null;
  readonly modDate: string | null;
}

export const PdfNativeCommand = {
  Rotate: "rotate_pdf_pages",
  Delete: "delete_pdf_pages",
  Extract: "extract_pdf_pages",
  PageCount: "pdf_native_page_count",
  InspectMetadata: "inspect_pdf_metadata",
  RemoveMetadata: "remove_pdf_metadata",
  SetPageSize: "set_pdf_page_size",
  Reorder: "reorder_pdf_pages",
  Reverse: "reverse_pdf_pages",
} as const;

/** Standard PDF page sizes (width × height in points, 1pt = 1/72"). */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89, label: "A4" },
  letter: { width: 612.0, height: 792.0, label: "Letter" },
  legal: { width: 612.0, height: 1008.0, label: "Legal" },
} as const;
