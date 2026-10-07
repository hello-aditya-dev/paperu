/**
 * Tests for corrupted/malformed input handling (doctrine §22, §23).
 *
 * Verifies that Paperu's engine functions reject invalid input cleanly
 * rather than producing fake success or crashing.
 *
 * Synthetic fixtures: random bytes, truncated PDFs, empty files, and
 * a fake.pdf (misleading extension). No real user documents.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  validatePdfBytes,
  parsePageRanges,
} from "../pdf-engine";

describe("corrupted input handling", () => {
  it("rejects random bytes as PDF", async () => {
    const garbage = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) garbage[i] = (i * 7) & 0xff;
    const result = await validatePdfBytes(garbage);
    expect(result.valid).toBe(false);
  });

  it("rejects empty bytes as PDF", async () => {
    const result = await validatePdfBytes(new Uint8Array(0));
    expect(result.valid).toBe(false);
  });

  it("rejects a truncated PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const full = await doc.save();
    // Truncate to 25% — should be invalid.
    const truncated = full.slice(0, Math.floor(full.length / 4));
    const result = await validatePdfBytes(truncated);
    expect(result.valid).toBe(false);
  });

  it("rejects a PDF with a corrupted header", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const bytes = await doc.save();
    // Corrupt the %PDF- header.
    bytes[0] = 0x00;
    bytes[1] = 0x00;
    bytes[2] = 0x00;
    bytes[3] = 0x00;
    bytes[4] = 0x00;
    const result = await validatePdfBytes(bytes);
    expect(result.valid).toBe(false);
  });

  it("accepts a minimal valid PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const bytes = await doc.save();
    const result = await validatePdfBytes(bytes);
    expect(result.valid).toBe(true);
    expect(result.pageCount).toBe(1);
  });

  it("rejects a file with a .pdf extension but random content", async () => {
    // This simulates "fake.pdf" containing random bytes — the engine
    // must not reach success just because the extension says PDF.
    const fakePdf = new Uint8Array(512);
    // Start with %PDF- to look like a PDF at first glance.
    fakePdf[0] = 0x25; // %
    fakePdf[1] = 0x50; // P
    fakePdf[2] = 0x44; // D
    fakePdf[3] = 0x46; // F
    fakePdf[4] = 0x2d; // -
    // Fill the rest with garbage.
    for (let i = 5; i < 512; i++) fakePdf[i] = (i * 13) & 0xff;
    const result = await validatePdfBytes(fakePdf);
    // Even with a %PDF- header, the content is garbage and pdf-lib
    // should reject it.
    expect(result.valid).toBe(false);
  });
});

describe("range parser edge cases (doctrine §9)", () => {
  it("rejects page 0", () => {
    expect(() => parsePageRanges("0", 10)).toThrow();
  });

  it("rejects negative-looking input", () => {
    expect(() => parsePageRanges("-1", 10)).toThrow();
  });

  it("rejects page beyond count", () => {
    expect(() => parsePageRanges("25", 24)).toThrow(/out of bounds/);
  });

  it("rejects range ending beyond count", () => {
    expect(() => parsePageRanges("1-25", 24)).toThrow(/out of bounds/);
  });

  it("rejects backwards range", () => {
    expect(() => parsePageRanges("5-3", 24)).toThrow(/backwards/);
  });

  it("accepts the spec example on a 24-page PDF", () => {
    expect(parsePageRanges("1-3, 5, 8-10", 24)).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it("accepts the full range of a 24-page PDF", () => {
    const indices = parsePageRanges("1-24", 24);
    expect(indices.length).toBe(24);
    expect(indices[0]).toBe(0);
    expect(indices[23]).toBe(23);
  });

  it("rejects floating point pages", () => {
    expect(() => parsePageRanges("1.5-3", 10)).toThrow();
  });

  it("rejects letters", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow();
  });

  it("rejects empty input", () => {
    expect(() => parsePageRanges("", 10)).toThrow();
  });
});
