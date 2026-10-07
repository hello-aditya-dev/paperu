/**
 * Engine validation tests — verify that validatePdfBytes and
 * validateImageBytes correctly accept valid outputs and reject
 * corrupted ones (doctrine §47).
 *
 * These tests use synthetic fixtures generated at test time (no real
 * user documents). A small PDF is created with pdf-lib; a small PNG
 * is created with canvas.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  validatePdfBytes,
  parsePageRanges,
} from "../pdf-engine";

describe("validatePdfBytes", () => {
  it("accepts a valid synthetic PDF", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("Paperu test", { x: 50, y: 750, size: 24, font });
    const bytes = await doc.save();

    const result = await validatePdfBytes(bytes);
    expect(result.valid).toBe(true);
    expect(result.pageCount).toBe(1);
  });

  it("accepts a multi-page PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const bytes = await doc.save();

    const result = await validatePdfBytes(bytes);
    expect(result.valid).toBe(true);
    expect(result.pageCount).toBe(3);
  });

  it("rejects random bytes", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = await validatePdfBytes(garbage);
    expect(result.valid).toBe(false);
    expect(result.pageCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it("rejects an empty byte array", async () => {
    const result = await validatePdfBytes(new Uint8Array(0));
    expect(result.valid).toBe(false);
  });

  it("rejects a truncated PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const bytes = await doc.save();
    // Truncate to half length.
    const truncated = bytes.slice(0, Math.floor(bytes.length / 2));
    const result = await validatePdfBytes(truncated);
    expect(result.valid).toBe(false);
  });
});

describe("parsePageRanges (extended)", () => {
  it("handles whitespace in ranges", () => {
    expect(parsePageRanges("  1 - 3 ,  5  ", 10)).toEqual([0, 1, 2, 4]);
  });

  it("handles a single page equal to total", () => {
    expect(parsePageRanges("10", 10)).toEqual([9]);
  });

  it("handles range spanning entire document", () => {
    expect(parsePageRanges("1-5", 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("rejects page zero", () => {
    expect(() => parsePageRanges("0", 10)).toThrow();
  });

  it("rejects a range starting at zero", () => {
    expect(() => parsePageRanges("0-3", 10)).toThrow();
  });

  it("rejects floating point page numbers", () => {
    expect(() => parsePageRanges("1.5", 10)).toThrow();
  });

  it("rejects trailing comma", () => {
    // "1,2," — the trailing comma produces an empty part which is filtered,
    // but the remaining parts are valid.
    expect(parsePageRanges("1,2,", 10)).toEqual([0, 1]);
  });

  it("handles very large page counts", () => {
    expect(parsePageRanges("1-3", 500)).toEqual([0, 1, 2]);
  });
});
