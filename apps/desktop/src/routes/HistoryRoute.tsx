/**
 * History route — answers:
 *   What did I do? To which file? What came out? Can I open it again?
 *
 * Reads from the persistent recent_work store (SQLite-backed via Rust).
 * If Rust is unavailable, the list is empty (graceful degradation).
 *
 * Privacy controls (Master Prompt 3 §82, §30):
 *   - Clear all button
 *   - Remove individual entries
 *   - No document contents shown — only paths, sizes, operation labels.
 *
 * Click an entry to open the output in Inspect (safe, non-destructive).
 */

import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useRecentWork } from "@/lib/recent-work";

export function HistoryRoute(): React.ReactNode {
  const entries = useRecentWork((s) => s.entries);
  const loading = useRecentWork((s) => s.loading);
  const error = useRecentWork((s) => s.error);
  const load = useRecentWork((s) => s.load);
  const remove = useRecentWork((s) => s.remove);
  const clear = useRecentWork((s) => s.clear);
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, [load]);

  const onOpen = (entry: (typeof entries)[number]) => {
    // Open the OUTPUT if it exists, otherwise the SOURCE. Both go to
    // Inspect (non-destructive) so the user can see real metadata.
    const path = entry.outputPath ?? entry.sourcePath;
    navigate(`/inspect?path=${encodeURIComponent(path)}`);
  };

  const onRepeat = (entry: (typeof entries)[number]) => {
    // Navigate to the operation's module. The user reviews settings
    // before re-running — we don't auto-start processing (§32).
    const moduleId = entry.operationId;
    const routeMap: Record<string, string> = {
      "pdf-fit": "/pdf/fit",
      "image-fit": "/image/fit",
      "pdf-merge": "/pdf/merge",
      "pdf-split": "/pdf/split",
      "images-to-pdf": "/pdf/from-images",
      "pdf-to-images": "/pdf/to-images",
      "sign-pdf": "/pdf/sign",
      "fill-pdf": "/pdf/fill",
    };
    const route = routeMap[moduleId];
    if (route) {
      // Pre-load the source via query param.
      navigate(
        `${route}?path=${encodeURIComponent(entry.sourcePath)}`,
      );
    }
  };

  return (
    <section className="paperu-history">
      <header className="paperu-history__header">
        <div>
          <h1 className="paperu-history__title">Recent work</h1>
          <p className="paperu-history__subtitle">
            What you did, to which file, what came out.
          </p>
        </div>
        <div className="paperu-history__actions">
          <button
            type="button"
            className="paperu-history__action"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            type="button"
            className="paperu-history__action paperu-history__action--danger"
            onClick={() => void clear()}
            disabled={entries.length === 0}
          >
            Clear all
          </button>
        </div>
      </header>

      {error && (
        <div className="paperu-history__notice" role="status">
          History is unavailable on this build. {error}
        </div>
      )}

      {entries.length === 0 && !loading && !error ? (
        <div className="paperu-history__empty">
          No recent work yet. Drop a file anywhere in Paperu to begin.
        </div>
      ) : (
        <ul className="paperu-history__list" role="list">
          {entries.map((entry) => (
            <li key={entry.id} className="paperu-history__item">
              <div className="paperu-history__item-main">
                <span className="paperu-history__item-op">
                  {entry.operationLabel}
                </span>
                <span className="paperu-history__item-file">
                  {entry.sourceFileName}
                  {entry.outputFileName &&
                    entry.outputFileName !== entry.sourceFileName &&
                    ` → ${entry.outputFileName}`}
                </span>
                <span className="paperu-history__item-meta">
                  {entry.humanReadableSizeBefore ?? "—"}
                  {entry.humanReadableSizeAfter &&
                    ` → ${entry.humanReadableSizeAfter}`}
                  {` · ${formatRelativeTime(entry.createdAt)}`}
                </span>
              </div>
              <div className="paperu-history__item-actions">
                <button
                  type="button"
                  className="paperu-history__btn"
                  onClick={() => onOpen(entry)}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="paperu-history__btn"
                  onClick={() => onRepeat(entry)}
                >
                  Repeat
                </button>
                <button
                  type="button"
                  className="paperu-history__btn paperu-history__btn--quiet"
                  onClick={() => void remove(entry.id)}
                  aria-label="Remove this entry from history"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Format an ISO timestamp as a relative "2 minutes ago" string. */
function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  // Beyond a week, fall back to a date.
  return new Date(then).toLocaleDateString();
}
