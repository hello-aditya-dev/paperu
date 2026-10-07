/**
 * Tests for the PDF engine's pure-logic helpers (range parser).
 * The engine itself (pdf-lib/pdfjs) is integration-tested via the
 * desktop shell; these tests cover the deterministic logic.
 */

import { describe, expect, it } from "vitest";
import { parsePageRanges } from "../pdf-engine";

describe("parsePageRanges", () => {
  it("parses a single page", () => {
    expect(parsePageRanges("5", 10)).toEqual([4]);
  });

  it("parses a range", () => {
    expect(parsePageRanges("1-3", 10)).toEqual([0, 1, 2]);
  });

  it("parses mixed ranges and singles", () => {
    expect(parsePageRanges("1-3, 5, 8-10", 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it("the spec example 1-2, 5 yields 3 pages", () => {
    expect(parsePageRanges("1-2, 5", 6)).toEqual([0, 1, 4]);
  });

  it("deduplicates overlapping ranges", () => {
    expect(parsePageRanges("1-3, 2-4", 10)).toEqual([0, 1, 2, 3]);
  });

  it("rejects empty input", () => {
    expect(() => parsePageRanges("", 10)).toThrow();
  });

  it("rejects whitespace-only input", () => {
    expect(() => parsePageRanges("   ", 10)).toThrow();
  });

  it("rejects out-of-bounds page", () => {
    expect(() => parsePageRanges("11", 10)).toThrow(/out of bounds/);
  });

  it("rejects out-of-bounds range", () => {
    expect(() => parsePageRanges("1-11", 10)).toThrow(/out of bounds/);
  });

  it("rejects backwards range", () => {
    expect(() => parsePageRanges("5-3", 10)).toThrow(/backwards/);
  });

  it("rejects garbage", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow();
  });

  it("rejects negative numbers", () => {
    expect(() => parsePageRanges("-1", 10)).toThrow();
  });
});
