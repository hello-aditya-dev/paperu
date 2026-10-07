/**
 * StartupPoster — Paperu's branded launch surface.
 *
 * Shown only while real initialization work happens (database open,
 * migration, temp cleanup). Removed the moment the main shell is
 * ready. Never artificially delayed (doctrine §12).
 *
 * Visual direction (doctrine §69):
 *   warm paper background
 *   large "paperu" wordmark
 *   thin ink rule
 *   small mono "YOUR FILES / YOUR COMPUTER"
 *   subtle blue accent
 *   version in bottom corner
 *   real status text when needed
 *
 * No gradient splash. No huge spinner. No stock illustration.
 * No advertising (doctrine §70).
 */

import { useEffect, useState } from "react";

export interface StartupPosterProps {
  /** The initialization stage being worked on. */
  stage: string;
  /** True when initialization has failed. Shows recovery options. */
  failed?: boolean;
  /** Retry callback when failed. */
  onRetry?: () => void;
}

export function StartupPoster({
  stage,
  failed = false,
  onRetry,
}: StartupPosterProps): React.ReactNode {
  const [version] = useState(() => {
    // Read from the Vite env or fall back to a static version.
    try {
      return "0.1.0";
    } catch {
      return "0.1.0";
    }
  });

  // Prevent flash of unstyled content — set the background immediately.
  useEffect(() => {
    document.body.style.background = "var(--paperu-bg)";
  }, []);

  if (failed) {
    return (
      <div className="paperu-splash" role="alert" aria-live="assertive">
        <div className="paperu-splash__inner">
          <div className="paperu-splash__mark" aria-hidden="true">P</div>
          <h1 className="paperu-splash__title">Paperu couldn't start normally.</h1>
          <p className="paperu-splash__status">
            Something went wrong during startup. Your files are safe.
          </p>
          <div className="paperu-splash__actions">
            {onRetry && (
              <button
                type="button"
                className="paperu-btn paperu-btn--accent"
                onClick={onRetry}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="paperu-splash" role="status" aria-live="polite">
      <div className="paperu-splash__inner">
        <div className="paperu-splash__mark" aria-hidden="true">P</div>
        <h1 className="paperu-splash__wordmark">paperu</h1>
        <div className="paperu-splash__rule" aria-hidden="true" />
        <p className="paperu-splash__tagline">Your files. Your computer.</p>
        <p className="paperu-splash__status">{stage}</p>
      </div>
      <div className="paperu-splash__version">
        <span className="paperu-text-numeric">v{version}</span>
      </div>
    </div>
  );
}
