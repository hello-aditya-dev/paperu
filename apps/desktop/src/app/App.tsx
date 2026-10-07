/**
 * Paperu application shell (layout route).
 *
 * Sticky header, a calm navigation rail, flex main (Outlet) that pushes
 * the footer to the bottom naturally, and a sticky footer. Loads app
 * info + settings from Rust on mount and applies the resolved theme.
 *
 * The nav rail lists the tools that are currently available. Tools that
 * are not yet ported are not shown (the doctrine says: don't clutter the
 * UI with unfinished features).
 */

import { useEffect, useState } from "react";
import { Outlet, NavLink } from "react-router";
import type { AppInfo, Settings } from "@paperu/contracts";
import { DEFAULT_SETTINGS } from "@paperu/contracts";
import { readAppInfo, readSettings } from "@/lib/ipc";
import { useTheme } from "@/hooks/useTheme";
import { AppInfoBadge } from "@/components/AppInfoBadge";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { formatShortcut } from "@/lib/platform";

interface NavItem {
  to: string;
  label: string;
  glyph: string;
  shortcut: string;
  end?: boolean;
}

const NAV: readonly NavItem[] = [
  { to: "/", label: "Home", glyph: "⌂", shortcut: "1", end: true },
  { to: "/pdf/fit", label: "Make PDF fit", glyph: "▾", shortcut: "2" },
  { to: "/image/fit", label: "Make image fit", glyph: "▾", shortcut: "3" },
  { to: "/pdf/merge", label: "Merge PDFs", glyph: "⋑", shortcut: "4" },
  { to: "/pdf/split", label: "Split / Extract", glyph: "⫻", shortcut: "5" },
  { to: "/pdf/from-images", label: "Images → PDF", glyph: "⋐", shortcut: "6" },
  { to: "/pdf/to-images", label: "PDF → Images", glyph: "⫾", shortcut: "7" },
];

export function App(): React.ReactNode {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useTheme(settings.theme, settings.reducedMotion);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [i, s] = await Promise.all([readAppInfo(), readSettings()]);
        if (!cancelled) {
          setInfo(i);
          setSettings(s);
        }
      } catch {
        // Settings are non-fatal; defaults remain in place.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyboard shortcuts: mod+1..5 navigates to the tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          (e.target as HTMLElement).isContentEditable
        ) {
          if (e.key === "Escape") (e.target as HTMLElement).blur();
          return;
        }
      }
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const item = NAV[idx];
        if (item) {
          window.location.hash = item.to === "/" ? "/" : item.to;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="paperu-shell">
      <header className="paperu-header" role="banner">
        <div className="paperu-header__inner">
          <a className="paperu-brand" href="#/" aria-label="Paperu home">
            <span className="paperu-brand__mark" aria-hidden="true">
              P
            </span>
            <span className="paperu-brand__name">Paperu</span>
          </a>
          <AppInfoBadge info={info} />
        </div>
      </header>

      <div className="paperu-shell__body">
        <nav className="paperu-nav" aria-label="Paperu tools">
          <ul className="paperu-nav__list">
            {NAV.map((item) => (
              <li key={item.to} className="paperu-nav__item">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `paperu-nav__link${isActive ? " is-active" : ""}`
                  }
                >
                  <span className="paperu-nav__glyph" aria-hidden="true">
                    {item.glyph}
                  </span>
                  <span className="paperu-nav__label">{item.label}</span>
                  <kbd className="paperu-kbd paperu-nav__shortcut" aria-hidden="true">
                    {formatShortcut(item.shortcut)}
                  </kbd>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="paperu-shell__main" role="main">
          <Outlet />
        </main>
      </div>

      <PrivacyFooter />
    </div>
  );
}
