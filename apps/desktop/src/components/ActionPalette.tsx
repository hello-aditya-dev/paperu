/**
 * Paperu Smart Action Palette — contextual actions for the current
 * selection (Master Prompt 3 §13-16, §24).
 *
 * Three core UX pillars:
 *   Universal Drop     — beginner (drop something)
 *   Smart Action Palette — intermediate (select something → see actions)
 *   Command Center     — expert (tell Paperu what you want)
 *
 * The palette derives actions from the module registry (getModulesForKind)
 * — there is no second hardcoded action table (§16). The only
 * "system actions" (Open, Reveal, Inspect) come from a small system
 * registry alongside the module registry.
 *
 * UX: opens as a popover near the trigger. Closes on Esc / outside click
 * / action selection.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getModulesForKind, type ModuleEntry } from "@/lib/module-registry";
import type { FileKind } from "@paperu/contracts";

/** A selection the palette can show actions for. */
export interface ActionSelection {
  /** Canonical absolute path. */
  readonly path: string;
  /** Display name. */
  readonly fileName: string;
  /** Detected file kind — drives which actions appear. */
  readonly kind: FileKind;
}

export interface ActionPaletteProps {
  /** The current selection. If null, the palette is closed. */
  selection: ActionSelection | null;
  /** Called when the user dismisses the palette. */
  onClose: () => void;
  /** Anchor rect for popover positioning. Optional. */
  anchorRect?: DOMRect | null;
}

interface ActionRow {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly onSelect: () => void;
  readonly kind: "module" | "system";
}

export function ActionPalette({
  selection,
  onClose,
  anchorRect,
}: ActionPaletteProps): React.ReactNode {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset active index when the selection changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [selection?.path]);

  // Escape closes.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, onClose]);

  const rows: readonly ActionRow[] = useMemo(() => {
    if (!selection) return [];
    const out: ActionRow[] = [];

    // Module actions from the registry (single source of truth).
    // The `inspect` module entry already provides the "Inspect file"
    // action, so we do NOT duplicate it as a system action.
    const modules = getModulesForKind(selection.kind);
    const moduleIds = new Set(modules.map((m) => m.id));

    // System actions (§16): Open is always present (it's a native OS
    // shell action, not a module). Inspect is added as a system action
    // only if no module already provides it (avoids duplication).
    out.push({
      id: "sys:open",
      label: "Open file",
      hint: "Default app",
      kind: "system",
      onSelect: () => {
        navigate(`/inspect?path=${encodeURIComponent(selection.path)}`);
        onClose();
      },
    });
    if (!moduleIds.has("inspect")) {
      out.push({
        id: "sys:inspect",
        label: "Inspect file",
        hint: "Metadata",
        kind: "system",
        onSelect: () => {
          navigate(`/inspect?path=${encodeURIComponent(selection.path)}`);
          onClose();
        },
      });
    }

    for (const m of modules) {
      out.push({
        id: `mod:${m.id}`,
        label: m.label,
        hint: m.advancedName ?? m.description,
        kind: "module",
        onSelect: () => sendToModule(m, selection, navigate, onClose),
      });
    }
    return out;
  }, [selection, navigate, onClose]);

  // Scroll active into view. This hook MUST run before any early
  // return to satisfy the rules-of-hooks lint rule.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!selection || rows.length === 0) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[activeIndex]?.onSelect();
    }
  };

  // Position: prefer below the anchor; fall back to fixed centered.
  const style: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        maxHeight: 320,
      }
    : {
        position: "fixed",
        top: "30%",
        left: "50%",
        transform: "translateX(-50%)",
        maxHeight: 320,
      };

  return (
    <div
      className="paperu-action-palette__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="paperu-action-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Actions for the selected file"
        style={style}
      >
        <div className="paperu-action-palette__header">
          <span className="paperu-action-palette__file">
            {selection.fileName}
          </span>
          <span className="paperu-action-palette__kind">
            {selection.kind}
          </span>
        </div>
        <div
          className="paperu-action-palette__body"
          ref={listRef}
          role="listbox"
          aria-label="Available actions"
          onKeyDown={onKeyDown}
          tabIndex={-1}
        >
          <ul className="paperu-action-palette__list">
            {rows.map((row, idx) => (
              <li
                key={row.id}
                data-row-index={idx}
                className={
                  "paperu-action-palette__row" +
                  (idx === activeIndex ? " is-active" : "") +
                  (row.kind === "system" ? " is-system" : "")
                }
                role="option"
                aria-selected={idx === activeIndex}
                onClick={() => row.onSelect()}
                onMouseMove={() => setActiveIndex(idx)}
              >
                <span className="paperu-action-palette__row-label">
                  {row.label}
                </span>
                {row.hint && (
                  <span className="paperu-action-palette__row-hint">
                    {row.hint}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="paperu-action-palette__footer">
          <kbd className="paperu-kbd">↑</kbd>
          <kbd className="paperu-kbd">↓</kbd>
          navigate
          <kbd className="paperu-kbd">↵</kbd>
          select
          <kbd className="paperu-kbd">Esc</kbd>
          close
        </div>
      </div>
    </div>
  );
}

/** Send the current selection into a module via query string. */
function sendToModule(
  m: ModuleEntry,
  selection: ActionSelection,
  navigate: ReturnType<typeof useNavigate>,
  onClose: () => void,
): void {
  if (m.route.startsWith("#")) return;
  navigate(`${m.route}?path=${encodeURIComponent(selection.path)}`);
  onClose();
}
