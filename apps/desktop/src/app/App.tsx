/**
 * Paperu application shell (layout route).
 *
 * Sticky header, flex main (Outlet) that pushes the footer to the
 * bottom naturally, and a sticky footer. Loads app info + settings
 * from Rust on mount and applies the resolved theme.
 */

import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import type { AppInfo, Settings } from "@paperu/contracts";
import { DEFAULT_SETTINGS } from "@paperu/contracts";
import { readAppInfo, readSettings } from "@/lib/ipc";
import { useTheme } from "@/hooks/useTheme";
import { AppInfoBadge } from "@/components/AppInfoBadge";
import { PrivacyFooter } from "@/components/PrivacyFooter";

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

      <main className="paperu-shell__main" role="main">
        <Outlet />
      </main>

      <PrivacyFooter />
    </div>
  );
}
