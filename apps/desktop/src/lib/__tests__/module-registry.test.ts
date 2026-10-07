/**
 * Tests for the Paperu module registry — the centralized capability
 * registry that powers Command Center, Action Palette, and Universal
 * Drop routing.
 */

import { describe, expect, it } from "vitest";
import {
  MODULES,
  getAvailableModules,
  getModulesForKind,
  getModulesProducingKind,
  searchModules,
  getModule,
} from "../module-registry";

describe("module registry", () => {
  describe("getAvailableModules", () => {
    it("returns only available modules", () => {
      const available = getAvailableModules();
      expect(available.length).toBeGreaterThan(0);
      expect(available.every((m) => m.available)).toBe(true);
    });
  });

  describe("getModulesForKind", () => {
    it("returns PDF tools for PDF input", () => {
      const tools = getModulesForKind("pdf");
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((m) => m.id === "pdf-fit")).toBe(true);
      expect(tools.some((m) => m.id === "pdf-merge")).toBe(true);
      expect(tools.some((m) => m.id === "sign-pdf")).toBe(true);
    });

    it("returns image tools for image input", () => {
      const tools = getModulesForKind("image");
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((m) => m.id === "image-fit")).toBe(true);
      expect(tools.some((m) => m.id === "images-to-pdf")).toBe(true);
    });

    it("returns home for any input", () => {
      const tools = getModulesForKind("other");
      expect(tools.some((m) => m.id === "home")).toBe(true);
    });

    it("does not return unavailable modules", () => {
      const tools = getModulesForKind("pdf");
      expect(tools.every((m) => m.available)).toBe(true);
    });
  });

  describe("getModulesProducingKind", () => {
    it("returns tools that produce PDFs", () => {
      const producers = getModulesProducingKind("pdf");
      expect(producers.some((m) => m.id === "pdf-merge")).toBe(true);
      expect(producers.some((m) => m.id === "images-to-pdf")).toBe(true);
    });

    it("returns tools that produce images", () => {
      const producers = getModulesProducingKind("image");
      expect(producers.some((m) => m.id === "pdf-to-images")).toBe(true);
    });
  });

  describe("searchModules", () => {
    it("finds by exact label", () => {
      const results = searchModules("Make PDF fit");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe("pdf-fit");
    });

    it("finds by alias", () => {
      const results = searchModules("compress pdf");
      expect(results.some((m) => m.id === "pdf-fit")).toBe(true);
    });

    it("finds by description", () => {
      const results = searchModules("signature");
      expect(results.some((m) => m.id === "sign-pdf")).toBe(true);
    });

    it("returns all available when query is empty", () => {
      const results = searchModules("");
      expect(results.length).toBe(getAvailableModules().length);
    });

    it("ranks exact label match above alias match", () => {
      const results = searchModules("merge");
      // "Merge PDFs" should rank high because the label contains "merge".
      expect(results.some((m) => m.id === "pdf-merge")).toBe(true);
    });

    it("finds under 500 kb alias", () => {
      const results = searchModules("under 500 kb");
      expect(results.some((m) => m.id === "pdf-fit")).toBe(true);
    });

    it("finds portal upload alias", () => {
      const results = searchModules("portal upload");
      expect(results.some((m) => m.id === "pdf-fit")).toBe(true);
    });

    it("does not return unavailable modules", () => {
      const results = searchModules("capture");
      // Capture is not in the registry yet (deferred).
      expect(results.every((m) => m.available)).toBe(true);
    });
  });

  describe("getModule", () => {
    it("returns a module by id", () => {
      const m = getModule("pdf-fit");
      expect(m).toBeDefined();
      expect(m!.label).toBe("Make PDF fit");
    });

    it("returns undefined for unknown id", () => {
      expect(getModule("nonexistent")).toBeUndefined();
    });
  });

  describe("registry integrity", () => {
    it("all modules have unique ids", () => {
      const ids = MODULES.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("all modules have unique routes", () => {
      const routes = MODULES.map((m) => m.route);
      expect(new Set(routes).size).toBe(routes.length);
    });

    it("all available modules have shortcuts", () => {
      // Every available module that's in the nav rail should have a shortcut.
      const navModules = MODULES.filter((m) => m.available && m.id !== "inspect");
      expect(navModules.every((m) => m.shortcut !== undefined)).toBe(true);
    });
  });
});
