/** AppInfoBadge — shows product name and version from the native side. */

import type { AppInfo } from "@paperu/contracts";

export interface AppInfoBadgeProps {
  info: AppInfo | null;
}

export function AppInfoBadge({ info }: AppInfoBadgeProps): React.ReactNode {
  return (
    <span className="paperu-appinfo" aria-label="Paperu version">
      {info ? (
        <>
          <span className="paperu-appinfo__edition">
            {info.edition.toUpperCase()}
          </span>
          <span className="paperu-appinfo__version">v{info.version}</span>
        </>
      ) : (
        <span className="paperu-appinfo__loading">Paperu</span>
      )}
    </span>
  );
}
