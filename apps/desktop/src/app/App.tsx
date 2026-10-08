/**
 * Paperu application shell (layout route).
 *
 * Sticky header, a calm navigation rail, flex main (Outlet) that pushes
 * the footer to the bottom naturally, and a sticky footer. Loads app
 * info + settings from Rust on mount and applies the resolved theme.
 *
 * The nav rail is derived from the module registry (getNavModules()).
 * There is no separate hardcoded NAV list (Master Prompt 3 §3, §16).
 *
 * The Command Center overlay is mounted here and is opened with
 * Ctrl/⌘ + K (Master Prompt 3 §6).
 */

import { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router";
import type { AppInfo, Settings } from "@paperu/contracts";
import { DEFAULT_SETTINGS } from "@paperu/contracts";
import { readAppInfo, readSettings } from "@/lib/ipc";
import { useTheme } from "@/hooks/useTheme";
import { AppInfoBadge } from "@/components/AppInfoBadge";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { StartupPoster } from "@/components/StartupPoster";
import { CommandCenter } from "@/components/CommandCenter";
import { Shelf } from "@/components/shelf/Shelf";
import { formatShortcut } from "@/lib/platform";
import { getNavModules, type ModuleEntry } from "@/lib/module-registry";
import { initOpenWithListener } from "@/lib/open-with";

export function App(): React.ReactNode {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [initStage, setInitStage] = useState("Opening Paperu…");
  const [ready, setReady] = useState(false);
  const [initFailed, setInitFailed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const navigate = useNavigate();

  useTheme(settings.theme, settings.reducedMotion);

  // ── Startup initialization ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setInitStage("Opening Paperu…");
    (async () => {
      try {
        setInitStage("Loading settings…");
        const [i, s] = await Promise.all([readAppInfo(), readSettings()]);
        if (cancelled) return;
        setInfo(i);
        setSettings(s);
        setInitStage("Ready");
        // Small delay to let the main shell paint before removing the poster.
        requestAnimationFrame(() => {
          if (!cancelled) setReady(true);
        });
      } catch {
        if (!cancelled) {
          // Settings are non-fatal; defaults remain in place.
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the nav rail once from the registry.
  const NAV_ITEMS: readonly ModuleEntry[] = getNavModules();

  // ── Open With listener (P0-E) ───────────────────────────────────
  // Pops any queued initial-launch path from Rust + listens for live
  // `paperu://open-file` events from subsequent launches. Stages the
  // file as a WorkingFile + navigates to the right route. The listener
  // is a no-op outside Tauri (tests, plain browser).
  useEffect(() => {
    return initOpenWithListener(navigate);
  }, [navigate]);

  // ── Keyboard shortcuts ──────────────────────────────────────────
  // - Ctrl/⌘ + K: open Command Center (global, even inside inputs)
  // - Ctrl/⌘ + 1..9: jump to the module whose `shortcut` field matches
  //   (NOT positional — the digit is the module's stable identity).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
        return;
      }
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
      if (isMod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const item = NAV_ITEMS.find((m) => m.shortcut === e.key);
        if (item) {
          window.location.hash = item.route === "/" ? "/" : item.route;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [NAV_ITEMS]);

  const onCommandNavigate = (route: string) => {
    setCommandOpen(false);
    if (route.startsWith("#")) {
      // Overlay (e.g. shelf) — no navigation.
      return;
    }
    navigate(route);
  };

  // Show the startup poster while real init work happens (doctrine §12).
  // The poster is removed the moment the app is genuinely usable.
  if (!ready) {
    return (
      <StartupPoster
        stage={initStage}
        failed={initFailed}
        onRetry={() => {
          setInitFailed(false);
          setReady(false);
          setInitStage("Opening Paperu…");
          // Trigger re-initialization by reloading.
          window.location.reload();
        }}
      />
    );
  }

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
          <button
            type="button"
            className="paperu-header__command"
            onClick={() => setCommandOpen(true)}
            aria-label="Open Paperu Command"
          >
            <span className="paperu-header__command-label">Search</span>
            <kbd className="paperu-kbd" aria-hidden="true">
              {formatShortcut("K")}
            </kbd>
          </button>
          <AppInfoBadge info={info} />
        </div>
      </header>

      <div className="paperu-shell__body">
        <nav className="paperu-nav" aria-label="Paperu tools">
          <ul className="paperu-nav__list">
            {NAV_ITEMS.map((item) => (
              <li key={item.id} className="paperu-nav__item">
                <NavLink
                  to={item.route}
                  end={item.route === "/"}
                  className={({ isActive }) =>
                    `paperu-nav__link${isActive ? " is-active" : ""}`
                  }
                >
                  <span className="paperu-nav__glyph" aria-hidden="true">
                    {item.glyph ?? "·"}
                  </span>
                  <span className="paperu-nav__label">{item.label}</span>
                  {item.shortcut && (
                    <kbd
                      className="paperu-kbd paperu-nav__shortcut"
                      aria-hidden="true"
                    >
                      {formatShortcut(item.shortcut)}
                    </kbd>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="paperu-shell__main" role="main">
          <Outlet />
        </main>
      </div>

      <Shelf />

      {commandOpen && (
        <CommandCenter
          onNavigate={onCommandNavigate}
          onClose={() => setCommandOpen(false)}
        />
      )}

      <PrivacyFooter />
    </div>
  );
}
