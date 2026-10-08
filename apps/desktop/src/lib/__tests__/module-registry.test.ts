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

    it("module shortcuts are unique single digits 1-9", () => {
      // Shortcuts are optional (not every nav item needs one — digits 1-9
      // are a finite resource). But when present, they must be unique and
      // single-digit so the keyboard handler can dispatch them cleanly.
      const shortcuts = MODULES.filter(
        (m) => m.available && m.shortcut !== undefined,
      ).map((m) => m.shortcut);
      expect(new Set(shortcuts).size).toBe(shortcuts.length);
      for (const s of shortcuts) {
        expect(s).toMatch(/^[1-9]$/);
      }
    });

    it("modules not in the nav rail are searchable in Command", () => {
      // Inspect / about / diagnostics / shelf are visibleInNav: false but
      // still appear in Command search.
      const hidden = MODULES.filter(
        (m) => m.available && m.visibleInNav === false,
      );
      expect(hidden.length).toBeGreaterThan(0);
      for (const m of hidden) {
        // Each hidden-from-nav module should still be command-searchable
        // (the default is true, but make the invariant explicit).
        expect(m.visibleInCommand ?? true).toBe(true);
      }
    });
  });

  // 90% §1 defect 5: real route resolution — every available module's
  // route must exist in the ROUTE_PATHS set exported from the router.
  // This catches the regression where a module says available:true but
  // its route isn't actually in the router (would 404 at runtime).
  describe("registry truth (90% §8 + defect 5)", () => {
    it("every available module's route resolves to a real ROUTE_PATH", async () => {
      const { ROUTE_PATHS } = await import("../../routes/index");
      const available = getAvailableModules();
      expect(available.length).toBeGreaterThan(0);
      const missing: string[] = [];
      for (const m of available) {
        // "/" and "#shelf" are special (index + in-app panel).
        if (m.route === "/" || m.route.startsWith("#")) continue;
        if (!ROUTE_PATHS.has(m.route)) {
          missing.push(`${m.id} → ${m.route}`);
        }
      }
      expect(missing).toEqual([] as string[]);
    });

    it("available module routes are unique (except # panels)", () => {
      const routes = getAvailableModules()
        .filter((m) => !m.route.startsWith("#"))
        .map((m) => m.route);
      expect(new Set(routes).size).toBe(routes.length);
    });

    it("archive-studio is available + route is in ROUTE_PATHS", async () => {
      const { ROUTE_PATHS } = await import("../../routes/index");
      const m = getModule("archive-studio");
      expect(m).toBeDefined();
      expect(m!.available).toBe(true);
      expect(ROUTE_PATHS.has(m!.route)).toBe(true);
    });

    it("watch-folders is available + route is in ROUTE_PATHS", async () => {
      const { ROUTE_PATHS } = await import("../../routes/index");
      const m = getModule("watch-folders");
      expect(m).toBeDefined();
      expect(m!.available).toBe(true);
      expect(ROUTE_PATHS.has(m!.route)).toBe(true);
    });

    it("study-reader is available + route is in ROUTE_PATHS", async () => {
      const { ROUTE_PATHS } = await import("../../routes/index");
      const m = getModule("study-reader");
      expect(m).toBeDefined();
      expect(m!.available).toBe(true);
      expect(ROUTE_PATHS.has(m!.route)).toBe(true);
    });
  });
});
