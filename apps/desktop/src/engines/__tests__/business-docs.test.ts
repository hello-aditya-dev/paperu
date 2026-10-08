/**
 * Business Documents engine — money-safe arithmetic tests (P0-D).
 *
 * The classic float drift bug (`0.1 + 0.2 === 0.30000000000000004`) is
 * eliminated by parsing user input into integer minor units at the
 * boundary and never letting floats back into totals. These tests
 * pin that property — they fail loudly if anyone reintroduces
 * `parseFloat` + JS-number math on monetary values.
 *
 * Coverage:
 *   - parseMoney: USD (2-dec), JPY (0-dec), garbage, edge cases.
 *   - formatMoney: symbol placement, decimals, grouping.
 *   - addMoney: integer addition → no drift.
 *   - multiplyMoney: line totals + percentage discounts + tax.
 *   - computeTotals: end-to-end money-safe totals (the core invariant).
 *   - JPY 0-decimal handling (1 yen = 1 minor unit; no cent conversion).
 *   - Numbering: per-prefix sequence + format.
 *   - wrapText: word-wrap with hard char-split for over-long tokens.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  addMoney,
  advanceSeqNumber,
  computeTotals,
  formatDocNumber,
  formatMoney,
  getCurrency,
  getSeqNumber,
  multiplyMoney,
  parseMoney,
  parseQuantity,
  setSeqNumber,
  wrapText,
  type DiscountSpec,
  type ValidatedLineItem,
} from "@/engines/business-docs";

// Tiny fake PDFFont for the wrapText test — we only need
// widthOfTextAtSize to return a deterministic monotonic-in-string-length
// value so we can assert where lines break. Defined inline in the
// wrapText describe block.
const USD = getCurrency("USD");
const JPY = getCurrency("JPY");

describe("parseMoney — USD (2 decimals)", () => {
  it("parses a normal 2-decimal value", () => {
    expect(parseMoney("12.34", 2)).toBe(1234);
    expect(parseMoney("0.99", 2)).toBe(99);
  });

  it("treats a whole-number input as N.00", () => {
    expect(parseMoney("12", 2)).toBe(1200);
    expect(parseMoney("100", 2)).toBe(10000);
  });

  it("accepts trailing-dot and leading-dot forms", () => {
    expect(parseMoney("12.", 2)).toBe(1200);
    expect(parseMoney(".5", 2)).toBe(50);
  });

  it("accepts a single-decimal value (12.3 → 1230)", () => {
    expect(parseMoney("12.3", 2)).toBe(1230);
  });

  it("rounds half-up when more decimals than minor-unit precision", () => {
    // 12.345 × 100 = 1234.5 → Math.round = 1235
    expect(parseMoney("12.345", 2)).toBe(1235);
    // 12.344 × 100 = 1234.4 → 1234
    expect(parseMoney("12.344", 2)).toBe(1234);
  });

  it("rejects empty / whitespace-only / dash / dot", () => {
    expect(parseMoney("", 2)).toBe(null);
    expect(parseMoney("   ", 2)).toBe(null);
    expect(parseMoney("-", 2)).toBe(null);
    expect(parseMoney(".", 2)).toBe(null);
    expect(parseMoney("-.", 2)).toBe(null);
  });

  it("rejects garbage (no silent NaN→0 coercion)", () => {
    expect(parseMoney("abc", 2)).toBe(null);
    expect(parseMoney("12abc", 2)).toBe(null);
    expect(parseMoney("$12.34", 2)).toBe(null); // no symbols allowed
    expect(parseMoney("1,234.56", 2)).toBe(null); // no grouping allowed
  });

  it("accepts negative values (for refunds / discount displays)", () => {
    expect(parseMoney("-12.34", 2)).toBe(-1234);
  });
});

describe("parseMoney — JPY (0 decimals)", () => {
  it("parses a whole yen amount as-is (1 yen = 1 minor unit)", () => {
    expect(parseMoney("1234", 0)).toBe(1234);
    expect(parseMoney("0", 0)).toBe(0);
  });

  it("rounds fractional yen to nearest integer", () => {
    expect(parseMoney("12.5", 0)).toBe(13);
    expect(parseMoney("12.4", 0)).toBe(12);
  });

  it("rejects garbage for JPY too", () => {
    expect(parseMoney("abc", 0)).toBe(null);
    expect(parseMoney("", 0)).toBe(null);
  });
});

describe("formatMoney", () => {
  it("formats USD with $ symbol and 2 decimals", () => {
    expect(formatMoney(1234, USD)).toBe("$12.34");
    expect(formatMoney(0, USD)).toBe("$0.00");
    expect(formatMoney(99, USD)).toBe("$0.99");
  });

  it("groups thousands on large USD amounts", () => {
    expect(formatMoney(1234567, USD)).toBe("$12,345.67");
  });

  it("formats JPY with ¥ symbol and 0 decimals (no decimal point)", () => {
    expect(formatMoney(1234, JPY)).toBe("¥1,234");
    expect(formatMoney(0, JPY)).toBe("¥0");
    expect(formatMoney(1000000, JPY)).toBe("¥1,000,000");
  });

  it("handles negative amounts (discount display)", () => {
    expect(formatMoney(-500, USD)).toBe("-$5.00");
  });
});

describe("addMoney — no float drift", () => {
  it("adds two integer cents exactly", () => {
    expect(addMoney(1234, 2345)).toBe(3579);
  });

  it("sums 100 entries of $0.10 to exactly $10.00 (no drift)", () => {
    // The classic demonstration: with floats, 0.1 + 0.2 ≠ 0.3. With
    // integer cents, summing any number of $0.10 entries is exact.
    let sum = 0;
    for (let i = 0; i < 100; i++) sum = addMoney(sum, parseMoney("0.10", 2)!);
    expect(sum).toBe(1000); // exactly $10.00
  });

  it("sums 1000 entries of $0.01 to exactly $10.00", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum = addMoney(sum, parseMoney("0.01", 2)!);
    expect(sum).toBe(1000);
  });

  it("round-trips 0.10 + 0.20 = 0.30 exactly (the bug that broke the old code)", () => {
    // Sanity check that floats DO drift on this:
    expect(0.1 + 0.2).not.toBe(0.3);
    // But in integer cents there is no drift:
    const a = parseMoney("0.10", 2)!;
    const b = parseMoney("0.20", 2)!;
    const c = parseMoney("0.30", 2)!;
    expect(addMoney(a, b)).toBe(c);
  });
});

describe("multiplyMoney — line totals and percentages", () => {
  it("multiplies a unit price by an integer quantity (no drift)", () => {
    // 3 × $12.34 = $37.02 → 3702 cents
    expect(multiplyMoney(1234, 3)).toBe(3702);
  });

  it("multiplies by a fractional quantity, rounding to the cent", () => {
    // 1.5 hours × $50.00/hr = $75.00 → 7500 cents
    expect(multiplyMoney(5000, 1.5)).toBe(7500);
    // 0.1 × $1.00 = 0.1 dollar = 10 cents (after rounding the float)
    expect(multiplyMoney(100, 0.1)).toBe(10);
  });

  it("sums many fractional line items exactly to the integer cent", () => {
    // 100 line items of qty=0.1, price=$1.00 → $10.00 exactly
    let sum = 0;
    for (let i = 0; i < 100; i++) sum = addMoney(sum, multiplyMoney(100, 0.1));
    expect(sum).toBe(1000);
  });

  it("computes a percentage discount exactly (15% off $100.00 = $15.00)", () => {
    expect(multiplyMoney(10000, 15 / 100)).toBe(1500);
  });

  it("computes tax exactly (8.5% on $100.00 = $8.50)", () => {
    expect(multiplyMoney(10000, 8.5 / 100)).toBe(850);
  });
});

describe("computeTotals — end-to-end money-safe totals", () => {
  const items: ValidatedLineItem[] = [
    { description: "Widget", quantity: 3, priceCents: 1234 }, // 3702
    { description: "Gadget", quantity: 1.5, priceCents: 5000 }, // 7500
    { description: "Sprocket", quantity: 2, priceCents: 999 }, // 1998
  ];
  // subtotal = 3702 + 7500 + 1998 = 13200 ($132.00)

  it("subtotal is integer cents (no float drift)", () => {
    const t = computeTotals(items, 0, null);
    expect(t.subtotal).toBe(13200);
    expect(t.discountAmount).toBe(0);
    expect(t.taxableBase).toBe(13200);
    expect(t.taxAmount).toBe(0);
    expect(t.total).toBe(13200);
  });

  it("applies a percentage discount before tax", () => {
    const discount: DiscountSpec = { mode: "percent", valueCents: 10 }; // 10% off
    // 10% of 13200 = 1320 → taxableBase = 11880
    const t = computeTotals(items, 8.5, discount);
    expect(t.discountAmount).toBe(1320);
    expect(t.taxableBase).toBe(11880);
    // tax 8.5% on 11880 = 1009.8 → round 1010
    expect(t.taxAmount).toBe(1010);
    expect(t.total).toBe(12890);
  });

  it("applies a flat discount before tax (capped at subtotal)", () => {
    const discount: DiscountSpec = { mode: "flat", valueCents: 500 }; // $5.00 off
    // 13200 - 500 = 12700 → tax 8.5% = 1079.5 → 1080 → total 13780
    const t = computeTotals(items, 8.5, discount);
    expect(t.discountAmount).toBe(500);
    expect(t.taxableBase).toBe(12700);
    expect(t.taxAmount).toBe(1080);
    expect(t.total).toBe(13780);
  });

  it("caps a flat discount at the subtotal (no negative totals)", () => {
    const discount: DiscountSpec = { mode: "flat", valueCents: 999999 };
    const t = computeTotals(items, 8.5, discount);
    expect(t.discountAmount).toBe(13200); // capped
    expect(t.taxableBase).toBe(0);
    expect(t.taxAmount).toBe(0);
    expect(t.total).toBe(0);
  });

  it("with no discount and tax, total = subtotal + tax (the invariant)", () => {
    const t = ComputeTotalsNoDiscount(items, 8.5);
    expect(t.subtotal).toBe(13200);
    expect(t.discountAmount).toBe(0);
    expect(t.taxAmount).toBe(1122); // 8.5% of 13200 = 1122
    expect(t.total).toBe(14322);
  });

  it("JPY 0-decimal flow: integer yen from input to total (no cent conversion)", () => {
    // 3 × ¥1234 = ¥3702, tax 10% = ¥370, total ¥4072 — all integers,
    // no × 100 scaling anywhere.
    const jpyItems: ValidatedLineItem[] = [
      { description: "Lunch", quantity: 3, priceCents: 1234 },
    ];
    const t = computeTotals(jpyItems, 10, null);
    expect(t.subtotal).toBe(3702);
    expect(t.taxAmount).toBe(370); // 10% of 3702 = 370.2 → 370
    expect(t.total).toBe(4072);
    // And it formats cleanly:
    expect(formatMoney(t.subtotal, JPY)).toBe("¥3,702");
    expect(formatMoney(t.total, JPY)).toBe("¥4,072");
  });
});

function ComputeTotalsNoDiscount(items: readonly ValidatedLineItem[], taxRatePct: number) {
  return computeTotals(items, taxRatePct, null);
}

describe("parseQuantity", () => {
  it("parses integer quantities", () => {
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity("100")).toBe(100);
  });

  it("parses fractional quantities", () => {
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity("0.1")).toBe(0.1);
    expect(parseQuantity("0.5")).toBe(0.5);
  });

  it("rejects garbage and empty", () => {
    expect(parseQuantity("")).toBe(null);
    expect(parseQuantity("abc")).toBe(null);
    expect(parseQuantity("1.2.3")).toBe(null);
  });
});

describe("document numbering", () => {
  // These read/write localStorage; ensure a clean slate.
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("paperu:bizdoc:seq:INV");
      localStorage.removeItem("paperu:bizdoc:seq:QUO");
      localStorage.removeItem("paperu:bizdoc:seq:REC");
    }
  });

  it("defaults to 1 when no sequence is stored", () => {
    expect(getSeqNumber("INV")).toBe(1);
  });

  it("formats as zero-padded PREFIX-NNNN", () => {
    expect(formatDocNumber("INV", 1)).toBe("INV-0001");
    expect(formatDocNumber("INV", 42)).toBe("INV-0042");
    expect(formatDocNumber("QUO", 9999)).toBe("QUO-9999");
  });

  it("setSeqNumber + getSeqNumber round-trips", () => {
    setSeqNumber("INV", 7);
    expect(getSeqNumber("INV")).toBe(7);
  });

  it("advanceSeqNumber increments after a generation", () => {
    setSeqNumber("INV", 5);
    expect(advanceSeqNumber("INV")).toBe(6);
    expect(getSeqNumber("INV")).toBe(6);
  });

  it("per-prefix sequences are independent", () => {
    setSeqNumber("INV", 10);
    setSeqNumber("QUO", 1);
    expect(getSeqNumber("INV")).toBe(10);
    expect(getSeqNumber("QUO")).toBe(1);
  });
});

describe("wrapText", () => {
  // Tiny fake PDFFont — we only need widthOfTextAtSize to return a
  // deterministic monotonic-in-string-length value so we can assert
  // where lines break. Each char is 1 unit wide at size 1 → at size
  // S, each char is S units. The `as never` cast sidesteps the
  // real PDFFont type (which has dozens of methods we don't need).
  const font = {
    widthOfTextAtSize(s: string, sz: number): number {
      return s.length * 1 * sz;
    },
  };

  it("returns [''] for empty input", () => {
    expect(wrapText("", font as never, 9, 100)).toEqual([""]);
  });

  it("returns the whole string when it fits", () => {
    expect(wrapText("hi", font as never, 1, 100)).toEqual(["hi"]);
  });

  it("wraps on word boundaries when a word would overflow", () => {
    // maxWidth 5 at size 1 = 5 chars per line. "hello world" (11 chars
    // incl space) → "hello" (5), "world" (5).
    expect(wrapText("hello world", font as never, 1, 5)).toEqual(["hello", "world"]);
  });

  it("preserves explicit newlines", () => {
    expect(wrapText("a\nb", font as never, 1, 100)).toEqual(["a", "b"]);
  });

  it("hard-splits a single over-long word by character", () => {
    // "abcdef" at 1 unit per char, maxWidth 2 → "ab", "cd", "ef"
    expect(wrapText("abcdef", font as never, 1, 2)).toEqual(["ab", "cd", "ef"]);
  });

  it("handles multiple paragraphs", () => {
    const out = wrapText("aa bb\ncc dd", font as never, 1, 3);
    expect(out).toEqual(["aa", "bb", "cc", "dd"]);
  });
});

