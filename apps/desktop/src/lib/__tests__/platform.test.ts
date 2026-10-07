/**
 * Tests for the platform utility helpers (pure-logic parts).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  basename,
  dirname,
  formatShortcut,
  formatShortcutSpec,
  pathSeparator,
} from "../platform";

describe("basename", () => {
  it("extracts from a Unix path", () => {
    expect(basename("/home/paperu/report.pdf")).toBe("report.pdf");
  });
  it("extracts from a Windows path", () => {
    expect(basename("C:\\Users\\paperu\\report.pdf")).toBe("report.pdf");
  });
  it("handles a bare filename", () => {
    expect(basename("report.pdf")).toBe("report.pdf");
  });
  it("handles Unicode filenames", () => {
    expect(basename("/home/paperu/दस्तावेज़.pdf")).toBe("दस्तावेज़.pdf");
  });
  it("handles spaces", () => {
    expect(basename("/home/paperu/my report.pdf")).toBe("my report.pdf");
  });
});

describe("dirname", () => {
  it("extracts from a Unix path", () => {
    expect(dirname("/home/paperu/report.pdf")).toBe("/home/paperu");
  });
  it("extracts from a Windows path", () => {
    expect(dirname("C:\\Users\\paperu\\report.pdf")).toBe("C:\\Users\\paperu");
  });
  it("returns empty for a bare filename", () => {
    expect(dirname("report.pdf")).toBe("");
  });
});

describe("formatShortcut", () => {
  beforeEach(() => {
    vi.stubEnv("navigator", {});
  });

  it("formats a simple shortcut", () => {
    // The format depends on the test environment's navigator; just verify
    // it returns a non-empty string containing the key.
    const result = formatShortcut("1");
    expect(result).toContain("1");
    expect(result.length).toBeGreaterThan(1);
  });
});

describe("formatShortcutSpec", () => {
  it("formats mod+shift+S", () => {
    const result = formatShortcutSpec(["mod", "shift"], "S");
    expect(result).toContain("S");
    expect(result.length).toBeGreaterThan(1);
  });

  it("formats a single mod", () => {
    const result = formatShortcutSpec(["mod"], "K");
    expect(result).toContain("K");
  });
});

describe("pathSeparator", () => {
  it("returns a single character", () => {
    const sep = pathSeparator();
    expect(sep.length).toBe(1);
    expect(["/", "\\"].includes(sep)).toBe(true);
  });
});
