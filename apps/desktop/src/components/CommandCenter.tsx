/**
 * Paperu Command Center — the canonical "tell Paperu what you want" surface.
 *
 * Opened with Ctrl/⌘ + K (Master Prompt 3 §6). This is one of the three
 * core UX pillars (Universal Drop / Smart Action Palette / Command).
 *
 * Search is DETERMINISTIC. No AI, no LLM, no remote queries.
 * Ranking rules (Master Prompt 3 §8):
 *   - exact label > alias > prefix > substring > description
 *   - multi-word: every token must match (AND)
 *   - ties broken by navOrder (stable, deterministic)
 *
 * Layout (Master Prompt 3 §10):
 *   PAPERU COMMAND
 *   [ What do you want to do? ]
 *   RECENT   — recent files / recent operations
 *   TOOLS    — matching modules
 *
 * Keyboard (Master Prompt 3 §11):
 *   ↑/↓ navigate · Enter select · Esc close · Home/End jump
 *
 * Performance (Master Prompt 3 §12):
 *   Opens instantly. Uses registry METADATA only — never imports module
 *   implementations. Heavy engines are not loaded just because Command
 *   lists them.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { searchModules } from "@/lib/module-registry";
import { useRecentFiles } from "@/lib/recent-files";

export interface CommandCenterProps {
  /** Called when the user picks a module — App navigates to its route. */
  onNavigate: (route: string) => void;
  /** Called when the user dismisses the palette (Esc / backdrop / button). */
  onClose: () => void;
}

interface ResultRow {
  readonly kind: "module" | "file";
  readonly id: string; // unique key
  readonly label: string;
  readonly hint?: string;
  readonly route?: string;
  readonly onSelect: () => void;
}

const MAX_RESULTS = 50;

export function CommandCenter({
  onNavigate,
  onClose,
}: CommandCenterProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recentFiles = useRecentFiles((s) => s.files);

  // Focus the input immediately on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Restore focus to the trigger on close (handled by App; nothing to do here).

  // Esc closes (in addition to the global handler). We stop propagation
  // so the App-level handler doesn't double-process.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(rows.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) row.onSelect();
    }
  };

  // Build the result rows: matching modules + matching recent files.
  const rows: readonly ResultRow[] = useMemo(() => {
    const out: ResultRow[] = [];
    const q = query.trim();

    // Modules (always shown; empty query returns the natural ordered list).
    const modules = searchModules(q);
    for (const m of modules.slice(0, MAX_RESULTS)) {
      out.push({
        kind: "module",
        id: `m:${m.id}`,
        label: m.label,
        hint: m.advancedName ?? m.description,
        route: m.route,
        onSelect: () => {
          if (m.route.startsWith("#")) return;
          onNavigate(m.route);
        },
      });
    }

    // Recent files: filter by query substring (path or fileName).
    if (recentFiles.length > 0) {
      const fq = q.toLowerCase();
      const matches = recentFiles.filter(
        (f) =>
          !fq ||
          f.fileName.toLowerCase().includes(fq) ||
          f.path.toLowerCase().includes(fq) ||
          f.operation.toLowerCase().includes(fq),
      );
      for (const f of matches.slice(0, 10)) {
        out.push({
          kind: "file",
          id: `f:${f.path}`,
          label: f.fileName,
          hint: `${f.operation} · ${f.humanReadableSize}`,
          onSelect: () => {
            // Navigate to inspect with this file. Inspect is the safe,
            // non-destructive default for an unknown file click.
            onNavigate(`/inspect?path=${encodeURIComponent(f.path)}`);
          },
        });
      }
    }

    return out;
  }, [query, recentFiles, onNavigate]);

  // Reset active index when the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll the active row into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Split rows into sections for display: TOOLS first, then FILES.
  const toolRows = rows.filter((r) => r.kind === "module");
  const fileRows = rows.filter((r) => r.kind === "file");
  let runningIndex = 0;
  const indexed = (section: readonly ResultRow[]) =>
    section.map((r) => ({ row: r, index: runningIndex++ }));

  return (
    <div
      className="paperu-command"
      role="dialog"
      aria-modal="true"
      aria-label="Paperu Command"
      onClick={(e) => {
        // Click on backdrop (the outer element) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="paperu-command__panel" role="document">
        <div className="paperu-command__header">
          <span className="paperu-command__title" aria-hidden="true">
            PAPERU COMMAND
          </span>
          <input
            ref={inputRef}
            type="text"
            className="paperu-command__input"
            placeholder="What do you want to do?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search Paperu commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="paperu-kbd paperu-command__esc" aria-hidden="true">
            Esc
          </kbd>
        </div>

        <div
          className="paperu-command__body"
          ref={listRef}
          role="listbox"
          aria-label="Command results"
        >
          {rows.length === 0 ? (
            <div className="paperu-command__empty">
              No matches for "{query}"
            </div>
          ) : (
            <>
              {toolRows.length > 0 && (
                <Section
                  title="TOOLS"
                  rows={indexed(toolRows)}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                />
              )}
              {fileRows.length > 0 && (
                <Section
                  title="RECENT FILES"
                  rows={indexed(fileRows)}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                />
              )}
            </>
          )}
        </div>

        <div className="paperu-command__footer">
          <span className="paperu-command__hint">
            <kbd className="paperu-kbd">↑</kbd>
            <kbd className="paperu-kbd">↓</kbd> navigate
            <kbd className="paperu-kbd">↵</kbd> select
            <kbd className="paperu-kbd">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  rows: readonly { row: ResultRow; index: number }[];
  activeIndex: number;
  onHover: (index: number) => void;
}

function Section({
  title,
  rows,
  activeIndex,
  onHover,
}: SectionProps): React.ReactNode {
  return (
    <section className="paperu-command__section">
      <h3 className="paperu-command__section-title">{title}</h3>
      <ul className="paperu-command__list">
        {rows.map(({ row, index }) => (
          <li
            key={row.id}
            data-row-index={index}
            className={
              "paperu-command__row" +
              (index === activeIndex ? " is-active" : "")
            }
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => row.onSelect()}
            onMouseMove={() => onHover(index)}
          >
            <span className="paperu-command__row-label">{row.label}</span>
            {row.hint && (
              <span className="paperu-command__row-hint">{row.hint}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
