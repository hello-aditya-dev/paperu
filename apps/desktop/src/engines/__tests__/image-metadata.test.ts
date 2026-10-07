/**
 * EXIF GPS truthfulness tests (master prompt §11 P1-E).
 *
 * The old code reported `hasGps: hasExif` — claiming GPS presence
 * whenever any EXIF segment existed. That was false: EXIF can hold
 * camera settings, timestamps, orientation, etc., without any GPS
 * coordinates. These tests verify the real GPS IFD pointer detection
 * (tag 0x8825 in IFD0) across little-endian and big-endian TIFF
 * headers, with and without the GPS pointer, and for non-JPEG inputs.
 *
 * Synthetic byte buffers exercise the parser directly — no image
 * library needed. Each buffer is a minimal JPEG SOI + APP1 EXIF
 * segment constructed to match (or not match) the GPS pattern.
 */

import { describe, it, expect } from "vitest";
import { detectJpegExifGps } from "@/engines/image-engine";

// ── Helpers to build synthetic JPEG EXIF byte buffers ───────────────

/** "Exif\0\0" signature for the APP1 segment payload. */
const EXIF_SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/**
 * Build a minimal JPEG with one APP1 EXIF segment. The EXIF payload
 * contains a TIFF header + a single-entry IFD0 holding one tag.
 * `gpsPointerValue` of 0 means "no GPS IFD"; non-zero means "GPS present".
 */
function buildJpegWithExifIfd0(
  byteOrder: "II" | "MM",
  ifdEntries: ReadonlyArray<{ tag: number; value: number }>,
): Uint8Array {
  // SOI
  const soi = [0xff, 0xd8];
  // APP1 marker
  const app1Marker = [0xff, 0xe1];

  // Build the EXIF payload: signature + TIFF header + IFD0.
  const tiffHeader: number[] = [];
  if (byteOrder === "II") {
    tiffHeader.push(0x49, 0x49); // "II" little-endian
  } else {
    tiffHeader.push(0x4d, 0x4d); // "MM" big-endian
  }
  // Magic 0x002A (written in the segment's byte order).
  if (byteOrder === "II") {
    tiffHeader.push(0x2a, 0x00);
  } else {
    tiffHeader.push(0x00, 0x2a);
  }
  // Offset to IFD0 = 8 (immediately after the 8-byte TIFF header).
  if (byteOrder === "II") {
    tiffHeader.push(0x08, 0x00, 0x00, 0x00);
  } else {
    tiffHeader.push(0x00, 0x00, 0x00, 0x08);
  }

  // IFD0: count(2) + entries(12 each) + nextIFD offset(4, zero).
  const ifd: number[] = [];
  const writeU16 = (v: number): number[] =>
    byteOrder === "II" ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff];
  const writeU32 = (v: number): number[] => {
    const a = (v >>> 0);
    return byteOrder === "II"
      ? [a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff]
      : [(a >> 24) & 0xff, (a >> 16) & 0xff, (a >> 8) & 0xff, a & 0xff];
  };
  ifd.push(...writeU16(ifdEntries.length));
  for (const entry of ifdEntries) {
    ifd.push(...writeU16(entry.tag));   // tag
    ifd.push(...writeU16(4));           // type = LONG
    ifd.push(...writeU32(1));           // count = 1
    ifd.push(...writeU32(entry.value)); // value/offset
  }
  ifd.push(...writeU32(0)); // next IFD offset = 0 (none)

  const payload = [...EXIF_SIG, ...tiffHeader, ...ifd];
  // APP1 length includes the 2 length bytes themselves. JPEG segment
  // lengths are ALWAYS big-endian (a container concern), independent of
  // the EXIF/TIFF byte order inside the payload.
  const segLen = payload.length + 2;
  const lengthBytes = [(segLen >> 8) & 0xff, segLen & 0xff];

  // EOI to terminate the JPEG safely.
  const eoi = [0xff, 0xd9];
  return new Uint8Array([...soi, ...app1Marker, ...lengthBytes, ...payload, ...eoi]);
}

// ── Tests ──────────────────────────────────────────────────────────

describe("detectJpegExifGps (truthful GPS reporting, §11)", () => {
  it("returns {false, false} for a non-JPEG (PNG signature)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectJpegExifGps(png)).toEqual({ hasExif: false, hasGps: false });
  });

  it("returns {false, false} for a JPEG with no APP1 EXIF segment", () => {
    // SOI + a DQT segment (not APP1) + EOI.
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xdb, 0x00, 0x43, 0x00, /* 67 bytes of DQT data placeholder */ ...Array(65).fill(0),
      0xff, 0xd9,
    ]);
    expect(detectJpegExifGps(jpeg)).toEqual({ hasExif: false, hasGps: false });
  });

  it("detects EXIF without GPS (little-endian, no 0x8825 tag)", () => {
    // IFD0 has a Make tag (0x010F) but no GPS pointer.
    const jpeg = buildJpegWithExifIfd0("II", [{ tag: 0x010f, value: 0 }]);
    expect(detectJpegExifGps(jpeg)).toEqual({ hasExif: true, hasGps: false });
  });

  it("detects EXIF with GPS (little-endian, 0x8825 tag → non-zero offset)", () => {
    const jpeg = buildJpegWithExifIfd0("II", [
      { tag: 0x010f, value: 0 },
      { tag: 0x8825, value: 0x20 }, // GPS IFD at offset 0x20
    ]);
    expect(detectJpegExifGps(jpeg)).toEqual({ hasExif: true, hasGps: true });
  });

  it("detects EXIF with GPS pointer set to zero → hasExif=true, hasGps=false", () => {
    // The GPS tag exists but points to offset 0 → no real GPS IFD.
    const jpeg = buildJpegWithExifIfd0("II", [{ tag: 0x8825, value: 0 }]);
    expect(detectJpegExifGps(jpeg)).toEqual({ hasExif: true, hasGps: false });
  });

  it("detects EXIF without GPS (big-endian, no 0x8825 tag)", () => {
    const jpeg = buildJpegWithExifIfd0("MM", [{ tag: 0x010f, value: 0 }]);
    expect(detectJpegExifGps(jpeg)).toEqual({ hasExif: true, hasGps: false });
  });

  it("detects EXIF with GPS (big-endian, 0x8825 tag → non-zero offset)", () => {
    const jpeg = buildJpegWithExifIfd0("MM", [
      { tag: 0x010f, value: 0 },
      { tag: 0x8825, value: 0x40 },
    ]);
    expect(detectJpegExifGps(jpeg)).toEqual({ hasExif: true, hasGps: true });
  });

  it("walks past a non-EXIF APP1 segment to find the EXIF one", () => {
    // SOI + APP1 (XMP, not EXIF) + APP1 (EXIF with GPS) + EOI.
    const soi = [0xff, 0xd8];
    const xmpMarker = [0xff, 0xe1];
    const xmpPayload = [0x48, 0x4b, ...Array(20).fill(0)]; // "HK..." — not "Exif\0\0"
    const xmpSegLen = xmpPayload.length + 2;
    const xmp = [...xmpMarker, (xmpSegLen >> 8) & 0xff, xmpSegLen & 0xff, ...xmpPayload];
    const exifJpeg = buildJpegWithExifIfd0("II", [{ tag: 0x8825, value: 0x10 }]);
    const combined = new Uint8Array([...soi, ...xmp, ...exifJpeg.subarray(2)]);
    expect(detectJpegExifGps(combined)).toEqual({ hasExif: true, hasGps: true });
  });

  it("bails out safely on a malformed JPEG (no segment length)", () => {
    const malformed = new Uint8Array([0xff, 0xd8, 0xff, 0xe1]);
    expect(detectJpegExifGps(malformed)).toEqual({ hasExif: false, hasGps: false });
  });
});
