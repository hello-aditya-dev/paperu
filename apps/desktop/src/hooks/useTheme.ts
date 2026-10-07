/**
 * useTheme — applies the resolved Paperu theme to the document root
 * based on the persisted settings preference. Honours the OS reduced
 * motion preference.
 */

import { useEffect } from "react";
import type { ThemePreference } from "@paperu/contracts";

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    const dark =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    return dark ? "dark" : "light";
  }
  return pref;
}

export function useTheme(pref: ThemePreference, reducedMotion: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-paperu-theme", resolveTheme(pref));
  }, [pref]);

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.setAttribute("data-paperu-reduced-motion", "true");
    } else {
      root.removeAttribute("data-paperu-reduced-motion");
    }
  }, [reducedMotion]);
}
