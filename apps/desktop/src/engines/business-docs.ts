/**
 * Business Documents engine — money-safe invoice/quote/receipt generator.
 *
 * Why this file exists (master prompt P0-D):
 *   1. Integer-cents arithmetic — every monetary value is stored as an
 *      integer count of the currency's minor unit (1 dollar = 100
 *      cents, 1 yen = 1 minor unit). No `parseFloat` of currency in
 *      totals — the classic float drift (`0.1 + 0.2 ===
 *      0.30000000000000004`) is eliminated at the type boundary.
 *   2. Document numbering — per-prefix sequence (INV-0001, QUO-0001)
 *      persisted in localStorage (frontend-only for V1; the Rust DB
 *      is not touched for this surface area).
 *   3. Presets — named bundles of from/to/tax/currency saved to
 *      localStorage so the user doesn't re-type them every time.
 *   4. Pagination — when line items overflow a single A4 page, the
 *      generator flows them onto additional pages with a repeated
 *      column header and a "Page X of Y" footer.
 *   5. Text wrapping — long descriptions wrap within the description
 *      column (manual word-wrap on font metrics; pdf-lib's drawText
 *      does not wrap on its own).
 *
 * Privacy: all PDF generation is local. No network. The bytes are
 * handed to the canonical `saveFileAs` IPC by the route.
 */

import type {
  PDFDocument,
  PDFFont,
  PDFPage,
  PDFPageDrawTextOptions,
} from "pdf-lib";
import type * as PdfLibNS from "pdf-lib";

// ── Currencies ────────────────────────────────────────────────────────

export type CurrencyCode =
  | "USD" | "EUR" | "GBP" | "INR" | "JPY"
  | "CNY" | "AUD" | "CAD" | "CHF" | "SGD";

export interface CurrencyDef {
  readonly code: CurrencyCode;
  readonly symbol: string;
  /** Number of decimal places (JPY = 0, most others = 2). */
  readonly decimals: number;
  /** Locale used for grouping separators. */
  readonly locale: string;
}

export const CURRENCIES: ReadonlyArray<CurrencyDef> = [
  { code: "USD", symbol: "$", decimals: 2, locale: "en-US" },
  { code: "EUR", symbol: "€", decimals: 2, locale: "de-DE" },
  { code: "GBP", symbol: "£", decimals: 2, locale: "en-GB" },
  { code: "INR", symbol: "₹", decimals: 2, locale: "en-IN" },
  { code: "JPY", symbol: "¥", decimals: 0, locale: "ja-JP" },
  { code: "CNY", symbol: "¥", decimals: 2, locale: "zh-CN" },
  { code: "AUD", symbol: "A$", decimals: 2, locale: "en-AU" },
  { code: "CAD", symbol: "C$", decimals: 2, locale: "en-CA" },
  { code: "CHF", symbol: "CHF", decimals: 2, locale: "de-CH" },
  { code: "SGD", symbol: "S$", decimals: 2, locale: "en-SG" },
];

export function getCurrency(code: CurrencyCode): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!;
}

// ── Integer-cents arithmetic ──────────────────────────────────────────

/**
 * Money is always an integer count of the currency's minor unit.
 *   - USD: $12.34 → 1234 cents.
 *   - JPY: ¥1234  → 1234 minor units (decimals = 0).
 *
 * All totals are sums of integers → no IEEE-754 drift.
 */
export type Money = number;

const NUM_RE = /^(?!$|\.)-?\d+(\.\d+)?$/;
const DOT_PREFIX_RE = /^(?!$)-?\.\d+$/;
const DOT_SUFFIX_RE = /^(?!$)-?\d+\.$/;
const INT_RE = /^-?\d+$/;

/**
 * Parse a user-typed money string into integer minor units.
 * Returns null when the input is not a valid number (the route uses
 * this to highlight invalid fields red — we never silently coerce
 * "garbage" to 0).
 *
 * Examples (decimals = 2):
 *   parseMoney("12.34") → 1234
 *   parseMoney("12")    → 1200
 *   parseMoney("12.3")  → 1230
 *   parseMoney("12.")   → 1200
 *   parseMoney(".5")    → 50
 *   parseMoney("")      → null
 *   parseMoney("abc")   → null
 *   parseMoney("1.234") → 123   (rounds half-up to the minor unit)
 *
 * Examples (decimals = 0, JPY):
 *   parseMoney("1234", 0) → 1234
 *   parseMoney("12.5", 0) → 13    (rounds)
 *   parseMoney("abc", 0)  → null
 */
export function parseMoney(input: string, decimals: number): Money | null {
  const s = input?.trim() ?? "";
  if (s === "" || s === "-" || s === "." || s === "-.") return null;
  if (!NUM_RE.test(s) && !DOT_PREFIX_RE.test(s) && !DOT_SUFFIX_RE.test(s)) return null;
  const f = Number(s);
  if (!Number.isFinite(f)) return null;
  const scale = Math.pow(10, decimals);
  // Math.round on the float multiplication is safe — the float drift
  // is on the order of 1e-15, far below the 0.5 rounding threshold.
  return Math.round(f * scale);
}

/**
 * Format integer minor units into a display string with the currency
 * symbol, grouping separators, and the correct number of decimals.
 *
 * Examples:
 *   formatMoney(1234, USD) → "$12.34"
 *   formatMoney(1234, JPY) → "¥1,234"
 *   formatMoney(0, USD)    → "$0.00"
 */
export function formatMoney(amount: Money, currency: CurrencyDef): string {
  const scale = Math.pow(10, currency.decimals);
  const major = Math.abs(amount) / scale;
  const num = new Intl.NumberFormat(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
    useGrouping: true,
  }).format(major);
  // Place the minus sign BEFORE the currency symbol so a negative
  // amount reads "-$5.00" rather than "$-5.00". (The route's
  // discount display uses the positive value with an explicit −
  // prefix, so this branch is only hit for refunds / adjustments.)
  return amount < 0 ? `-${currency.symbol}${num}` : `${currency.symbol}${num}`;
}

/** Integer addition — never drifts. */
export function addMoney(a: Money, b: Money): Money {
  return a + b;
}

/** Multiply a money amount by a decimal factor, rounding to the
 * nearest minor unit. Used for line totals (qty × unitPrice) and for
 * percentage discounts/taxes. The intermediate float is bounded by
 * Math.round, so the stored result is always an integer. */
export function multiplyMoney(amount: Money, factor: number): Money {
  return Math.round(amount * factor);
}

/**
 * Parse a quantity (hours, items, kilograms). Unlike money, quantity
 * stays a float — it's a multiplier, not a stored value. Returns null
 * on invalid input so the route can flag the field red.
 *
 *   parseQuantity("1")   → 1
 *   parseQuantity("1.5") → 1.5
 *   parseQuantity("0.1") → 0.1
 *   parseQuantity("")    → null
 *   parseQuantity("xx")  → null
 */
export function parseQuantity(input: string): number | null {
  const s = input?.trim() ?? "";
  if (s === "") return null;
  if (!NUM_RE.test(s) && !DOT_PREFIX_RE.test(s) && !DOT_SUFFIX_RE.test(s)) return null;
  const f = Number(s);
  if (!Number.isFinite(f)) return null;
  return f;
}

/**
 * Parse an integer-only field (discount %, next number). Returns null
 * on invalid input.
 */
export function parseIntField(input: string): number | null {
  const s = input?.trim() ?? "";
  if (s === "") return null;
  if (!INT_RE.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

// ── Document types & numbering ────────────────────────────────────────

export type DocType = "invoice" | "quote" | "receipt";

export interface DocTypeDef {
  readonly id: DocType;
  readonly label: string;
  readonly prefix: string;
}

export const DOC_TYPES: ReadonlyArray<DocTypeDef> = [
  { id: "invoice", label: "Invoice", prefix: "INV" },
  { id: "quote", label: "Quote", prefix: "QUO" },
  { id: "receipt", label: "Receipt", prefix: "REC" },
];

export function getDocType(id: DocType): DocTypeDef {
  return DOC_TYPES.find((d) => d.id === id) ?? DOC_TYPES[0]!;
}

/** Format a sequence number as a zero-padded display string. */
export function formatDocNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// ── localStorage persistence (frontend-only, V1) ─────────────────────

const LS_PREFIX = "paperu:bizdoc";

function lsKey(suffix: string): string {
  return `${LS_PREFIX}:${suffix}`;
}

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    /* localStorage may be unavailable (private mode, SSR) — fail
     * silently. Persistence is a quality-of-life feature, not a
     * correctness one. */
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ── Sequence numbers (per-prefix) ─────────────────────────────────────

function seqKey(prefix: string): string {
  return lsKey(`seq:${prefix}`);
}

/** Get the next sequence number for a doc-type prefix (default 1). */
export function getSeqNumber(prefix: string): number {
  const raw = safeGet(seqKey(prefix));
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Set the next sequence number (used when the user overrides it). */
export function setSeqNumber(prefix: string, n: number): void {
  if (!Number.isFinite(n) || n < 1) return;
  safeSet(seqKey(prefix), String(Math.floor(n)));
}

/** Advance the sequence after a successful generation. Returns the
 * new next number. */
export function advanceSeqNumber(prefix: string): number {
  const next = getSeqNumber(prefix) + 1;
  setSeqNumber(prefix, next);
  return next;
}

// ── Presets ───────────────────────────────────────────────────────────

export type DiscountMode = "none" | "percent" | "flat";

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly docType: DocType;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly toName: string;
  readonly toAddress: string;
  readonly taxRate: string;
  readonly currency: CurrencyCode;
  readonly discountMode: DiscountMode;
  readonly discountValue: string;
}

const PRESETS_KEY = lsKey("presets");

export function loadPresets(): Preset[] {
  const raw = safeGet(PRESETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPreset);
  } catch {
    return [];
  }
}

function isPreset(v: unknown): v is Preset {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.docType === "string" &&
    typeof p.fromName === "string" &&
    typeof p.fromAddress === "string" &&
    typeof p.toName === "string" &&
    typeof p.toAddress === "string" &&
    typeof p.taxRate === "string" &&
    typeof p.currency === "string" &&
    typeof p.discountMode === "string" &&
    typeof p.discountValue === "string"
  );
}

export function savePreset(preset: Preset): Preset[] {
  const all = loadPresets().filter((p) => p.id !== preset.id);
  all.unshift(preset);
  const next = all.slice(0, 50);
  safeSet(PRESETS_KEY, JSON.stringify(next));
  return next;
}

export function deletePreset(id: string): Preset[] {
  const next = loadPresets().filter((p) => p.id !== id);
  safeSet(PRESETS_KEY, JSON.stringify(next));
  return next;
}

// ── Recent drafts ─────────────────────────────────────────────────────

export interface DraftLineItem {
  readonly description: string;
  readonly quantity: string;
  readonly price: string;
}

export interface Draft {
  readonly id: string;
  readonly docType: DocType;
  readonly docNumber: string;
  readonly title: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly toName: string;
  readonly toAddress: string;
  readonly date: string;
  readonly currency: CurrencyCode;
  readonly items: readonly DraftLineItem[];
  readonly taxRate: string;
  readonly discountMode: DiscountMode;
  readonly discountValue: string;
  readonly savedAt: number;
}

const DRAFTS_KEY = lsKey("drafts");
const MAX_DRAFTS = 20;

export function loadDrafts(): Draft[] {
  const raw = safeGet(DRAFTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraft).slice(0, MAX_DRAFTS);
  } catch {
    return [];
  }
}

function isDraft(v: unknown): v is Draft {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.docType === "string" &&
    typeof d.docNumber === "string" &&
    typeof d.title === "string" &&
    typeof d.fromName === "string" &&
    typeof d.fromAddress === "string" &&
    typeof d.toName === "string" &&
    typeof d.toAddress === "string" &&
    typeof d.date === "string" &&
    typeof d.currency === "string" &&
    typeof d.taxRate === "string" &&
    typeof d.discountMode === "string" &&
    typeof d.discountValue === "string" &&
    typeof d.savedAt === "number" &&
    Array.isArray(d.items)
  );
}

export function saveDraft(draft: Draft): Draft[] {
  const filtered = loadDrafts().filter((d) => d.id !== draft.id);
  filtered.unshift(draft);
  const next = filtered.slice(0, MAX_DRAFTS);
  safeSet(DRAFTS_KEY, JSON.stringify(next));
  return next;
}

export function deleteDraft(id: string): Draft[] {
  const next = loadDrafts().filter((d) => d.id !== id);
  safeSet(DRAFTS_KEY, JSON.stringify(next));
  return next;
}

export function clearAllDrafts(): void {
  safeRemove(DRAFTS_KEY);
}

// ── Totals (the money-safe core) ──────────────────────────────────────

export interface ValidatedLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly priceCents: Money;
}

export interface DiscountSpec {
  readonly mode: DiscountMode;
  /**
   * For "percent": valueCents is the percent value as an integer (e.g.
   *   10 for 10%, 25 for 25%). Fractional percent like 8.5% is not
   *   supported in V1 (the field is integer-only).
   * For "flat": valueCents is the flat amount in the currency's minor
   *   units (e.g. 500 = $5.00 USD).
   */
  readonly valueCents: number;
}

export interface Totals {
  readonly subtotal: Money;
  readonly discountAmount: Money;
  readonly taxableBase: Money;
  readonly taxAmount: Money;
  readonly total: Money;
}

/**
 * Compute totals entirely in integer minor units.
 *
 *  subtotal       = Σ round(qty × priceCents)
 *  discountAmount = mode === "percent"
 *                     ? round(subtotal × valueCents / 100)
 *                     : min(valueCents, subtotal)        (flat)
 *  taxableBase   = subtotal − discountAmount
 *  taxAmount     = round(taxableBase × taxRatePct / 100)
 *  total         = taxableBase + taxAmount
 *
 * Every intermediate value is an integer → no float drift even
 * across hundreds of line items.
 */
export function computeTotals(
  items: readonly ValidatedLineItem[],
  taxRatePct: number,
  discount: DiscountSpec | null,
): Totals {
  let subtotal = 0;
  for (const it of items) {
    subtotal = addMoney(subtotal, multiplyMoney(it.priceCents, it.quantity));
  }

  let discountAmount = 0;
  if (discount && discount.valueCents > 0) {
    if (discount.mode === "percent") {
      discountAmount = multiplyMoney(subtotal, discount.valueCents / 100);
    } else if (discount.mode === "flat") {
      discountAmount = Math.min(discount.valueCents, subtotal);
    }
  }

  const taxableBase = subtotal - discountAmount;
  const taxAmount = taxRatePct > 0 ? multiplyMoney(taxableBase, taxRatePct / 100) : 0;
  const total = taxableBase + taxAmount;
  return { subtotal, discountAmount, taxableBase, taxAmount, total };
}

// ── PDF generation ────────────────────────────────────────────────────

/** The lazy-loaded pdf-lib module shape. */
type PdfLib = typeof PdfLibNS;

let pdfLibPromise: Promise<PdfLib> | null = null;

/**
 * Lazy-load pdf-lib. The original route imported it eagerly at the top
 * of the file, which made the entire ~200 KB bundle load even when the
 * user never opened Business Documents. Lazy import defers that cost to
 * the first Generate click.
 */
function getPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) pdfLibPromise = import("pdf-lib");
  return pdfLibPromise;
}

// A4 portrait in PDF points (1/72 inch).
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 50;
const FOOTER_Y = 30;
const PAGE_BOTTOM_LIMIT = FOOTER_Y + 30; // never draw below this

// Column geometry for the items table.
const DESC_X = MARGIN;
const QTY_X = MARGIN + 290;
const PRICE_X = MARGIN + 360;
const TOTAL_X = MARGIN + 460;
const DESC_WIDTH = QTY_X - DESC_X - 8;

interface PdfInput {
  readonly docType: DocTypeDef;
  readonly docNumber: string;
  readonly title: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly toName: string;
  readonly toAddress: string;
  readonly date: string;
  readonly currency: CurrencyDef;
  readonly items: readonly ValidatedLineItem[];
  readonly taxRatePct: number;
  readonly discount: DiscountSpec | null;
  readonly totals: Totals;
}

/** A small color factory built from the lazy-loaded lib. */
type RgbFactory = (r: number, g: number, b: number) => PDFPageDrawTextOptions["color"];
interface ColorLib {
  rgb: RgbFactory;
}
function gray(c: ColorLib, g: number): NonNullable<PDFPageDrawTextOptions["color"]> {
  return c.rgb(g, g, g) as NonNullable<PDFPageDrawTextOptions["color"]>;
}

/**
 * Wrap a (possibly multi-paragraph) string into an array of lines
 * that fit within `maxWidth` at the given font/size. Splits on word
 * boundaries; words longer than the width are hard-split by character
 * (rare, but ensures we never overflow the column).
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  if (!text) return [""];
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = words[0]!;
    line = hardSplitOverlong(line, font, size, maxWidth, out);
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        out.push(line);
        line = words[i]!;
        line = hardSplitOverlong(line, font, size, maxWidth, out);
      }
    }
    out.push(line);
  }
  return out;
}

/** Push character-split chunks of an over-long word, return the
 * remainder as the new working line. */
function hardSplitOverlong(
  line: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  out: string[],
): string {
  while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
    let cut = line.length - 1;
    while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) {
      cut--;
    }
    out.push(line.slice(0, cut));
    line = line.slice(cut);
  }
  return line;
}

interface DrawCtx {
  readonly doc: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  readonly colors: ColorLib;
  readonly currency: CurrencyDef;
  readonly pages: PDFPage[];
  pageIndex: number;
  pageY: number;
}

function startNewPage(ctx: DrawCtx): void {
  const page = ctx.doc.addPage([A4_W, A4_H]);
  ctx.pages.push(page);
  ctx.pageIndex = ctx.pages.length - 1;
  ctx.pageY = A4_H - MARGIN;
  drawTableHeader(page, ctx);
  ctx.pageY -= 18;
}

function drawTableHeader(page: PDFPage, ctx: DrawCtx): void {
  const { bold, pageY: y, colors } = ctx;
  const gc = gray(colors, 0.4);
  page.drawText("Description", { x: DESC_X, y, size: 9, font: bold, color: gc });
  page.drawText("Qty", { x: QTY_X, y, size: 9, font: bold, color: gc });
  page.drawText("Price", { x: PRICE_X, y, size: 9, font: bold, color: gc });
  page.drawText("Total", { x: TOTAL_X, y, size: 9, font: bold, color: gc });
  page.drawLine({
    start: { x: MARGIN, y: y - 4 },
    end: { x: A4_W - MARGIN, y: y - 4 },
    thickness: 0.5,
    color: gray(colors, 0.8),
  });
}

function ensureSpace(ctx: DrawCtx, needed: number): void {
  if (ctx.pageY - needed < PAGE_BOTTOM_LIMIT) {
    startNewPage(ctx);
  }
}

/**
 * Generate a paginated, wrapped, money-safe business document PDF.
 * The bytes are returned for the route to hand to `saveFileAs`.
 *
 * Algorithm:
 *   1. Lazy-import pdf-lib.
 *   2. Embed Helvetica + HelveticaBold.
 *   3. Create page 1, draw the title / from / to / date / number
 *      header. Set up the items-table cursor.
 *   4. For each line item, wrap the description, draw qty / price /
 *      line-total, advancing y. When y drops below the page floor,
 *      start a new page (with repeated column header).
 *   5. After all items, draw the totals block (subtotal / discount /
 *      tax / total), advancing to a new page if needed.
 *   6. Stamp "Page X of Y" + privacy footer on every page in a final
 *      pass (we know Y only after the layout is done).
 */
export async function generateBusinessPdf(input: PdfInput): Promise<Uint8Array> {
  const lib = await getPdfLib();
  const doc = await lib.PDFDocument.create();
  doc.setTitle(`${input.docType.label} ${input.docNumber}`);
  doc.setProducer("Paperu");
  doc.setCreator("Paperu Business Documents");
  doc.setCreationDate(new Date());
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const colors: ColorLib = { rgb: lib.rgb };

  const ctx: DrawCtx = {
    doc,
    font,
    bold,
    colors,
    currency: input.currency,
    pages: [],
    pageIndex: -1,
    pageY: 0,
  };
  startNewPage(ctx); // page 1

  // ── Title block ──
  const page = ctx.pages[0]!;
  page.drawText(input.docType.label.toUpperCase(), {
    x: MARGIN,
    y: ctx.pageY,
    size: 24,
    font: bold,
    color: lib.rgb(0.18, 0.31, 0.45),
  });
  ctx.pageY -= 30;
  page.drawText(input.title || `${input.docType.label} ${input.date}`, {
    x: MARGIN,
    y: ctx.pageY,
    size: 12,
    font,
    color: gray(colors, 0.4),
  });
  ctx.pageY -= 20;
  page.drawText(`No: ${input.docNumber}`, {
    x: MARGIN,
    y: ctx.pageY,
    size: 10,
    font: bold,
  });
  page.drawText(`Date: ${input.date}`, {
    x: MARGIN + 200,
    y: ctx.pageY,
    size: 10,
    font,
  });
  ctx.pageY -= 20;

  // ── From / To block ──
  const gc4 = gray(colors, 0.4);
  const gc5 = gray(colors, 0.5);
  page.drawText("From:", { x: MARGIN, y: ctx.pageY, size: 10, font: bold, color: gc4 });
  page.drawText(input.fromName, { x: MARGIN + 40, y: ctx.pageY, size: 10, font });
  ctx.pageY -= 14;
  if (input.fromAddress) {
    const lines = wrapText(input.fromAddress, font, 9, A4_W - 2 * MARGIN - 40);
    for (const ln of lines) {
      page.drawText(ln, { x: MARGIN + 40, y: ctx.pageY, size: 9, font, color: gc5 });
      ctx.pageY -= 12;
    }
  }
  ctx.pageY -= 8;
  page.drawText("To:", { x: MARGIN, y: ctx.pageY, size: 10, font: bold, color: gc4 });
  page.drawText(input.toName, { x: MARGIN + 40, y: ctx.pageY, size: 10, font });
  ctx.pageY -= 14;
  if (input.toAddress) {
    const lines = wrapText(input.toAddress, font, 9, A4_W - 2 * MARGIN - 40);
    for (const ln of lines) {
      page.drawText(ln, { x: MARGIN + 40, y: ctx.pageY, size: 9, font, color: gc5 });
      ctx.pageY -= 12;
    }
  }
  ctx.pageY -= 16;

  // ── Items table ──
  drawTableHeader(ctx.pages[ctx.pageIndex]!, ctx);
  ctx.pageY -= 18;

  const fmtMoney = (m: Money): string => formatMoney(m, input.currency);
  for (const it of input.items) {
    const descLines = wrapText(it.description, font, 9, DESC_WIDTH);
    const rowHeight = Math.max(14, descLines.length * 11);
    ensureSpace(ctx, rowHeight + 2);
    const curPage = ctx.pages[ctx.pageIndex]!;
    let dy = ctx.pageY;
    for (const ln of descLines) {
      curPage.drawText(ln, { x: DESC_X, y: dy, size: 9, font });
      dy -= 11;
    }
    const lineTotal = multiplyMoney(it.priceCents, it.quantity);
    curPage.drawText(formatQty(it.quantity), { x: QTY_X, y: ctx.pageY, size: 9, font });
    curPage.drawText(fmtMoney(it.priceCents), { x: PRICE_X, y: ctx.pageY, size: 9, font });
    curPage.drawText(fmtMoney(lineTotal), { x: TOTAL_X, y: ctx.pageY, size: 9, font });
    ctx.pageY -= rowHeight;
  }

  // ── Totals block ──
  ctx.pageY -= 6;
  const totalsPage = ctx.pages[ctx.pageIndex]!;
  totalsPage.drawLine({
    start: { x: MARGIN, y: ctx.pageY },
    end: { x: A4_W - MARGIN, y: ctx.pageY },
    thickness: 0.5,
    color: gray(colors, 0.8),
  });
  ctx.pageY -= 16;
  const totalsBlockHeight = 14 * 4 + 10;
  ensureSpace(ctx, totalsBlockHeight);
  const curPage3 = ctx.pages[ctx.pageIndex]!;
  const t = input.totals;
  const totalsLabelX = TOTAL_X - 90;
  const drawTotalRow = (label: string, value: Money, isBold = false): void => {
    curPage3.drawText(label, {
      x: totalsLabelX,
      y: ctx.pageY,
      size: 9,
      font: isBold ? bold : font,
    });
    curPage3.drawText(fmtMoney(value), {
      x: TOTAL_X,
      y: ctx.pageY,
      size: 9,
      font: isBold ? bold : font,
    });
    ctx.pageY -= isBold ? 14 : 12;
  };
  drawTotalRow("Subtotal:", t.subtotal);
  if (t.discountAmount > 0) drawTotalRow("Discount:", -t.discountAmount);
  if (input.taxRatePct > 0) {
    drawTotalRow(`Tax (${formatTaxRate(input.taxRatePct)}%):`, t.taxAmount);
  }
  ctx.pageY -= 2;
  drawTotalRow("Total:", t.total, true);
  ctx.pageY -= 20;

  // ── Footer pass: stamp "Page X of Y" + privacy line ──
  const totalPages = ctx.pages.length;
  for (let i = 0; i < totalPages; i++) {
    const p = ctx.pages[i]!;
    p.drawText(`Page ${i + 1} of ${totalPages}`, {
      x: A4_W - MARGIN - 80,
      y: FOOTER_Y,
      size: 8,
      font,
      color: gray(colors, 0.55),
    });
    p.drawText("Generated locally by Paperu — 0 bytes uploaded.", {
      x: MARGIN,
      y: FOOTER_Y,
      size: 8,
      font,
      color: gray(colors, 0.55),
    });
  }

  const bytes = await doc.save({ useObjectStreams: true });
  // pdf-lib's `save` returns Uint8Array<ArrayBufferLike>; normalize to a
  // plain Uint8Array so the IPC layer's base64 helper sees a clean view.
  return new Uint8Array(bytes);
}

function formatQty(q: number): string {
  // Show whole quantities without a decimal; otherwise trim trailing
  // zeros so "1.5" stays "1.5" and "1.50" becomes "1.5".
  if (Number.isInteger(q)) return String(q);
  return String(Number(q.toFixed(4)));
}

function formatTaxRate(pct: number): string {
  // 8.5 → "8.5"; 8 → "8"; 8.25 → "8.25"
  if (Number.isInteger(pct)) return String(pct);
  return String(Number(pct.toFixed(4)));
}
