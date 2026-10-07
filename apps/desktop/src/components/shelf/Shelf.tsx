/**
 * Paperu Shelf — temporary multi-file workspace (Master Prompt 3 §17-23).
 *
 * Users can collect several files and then run an operation across them
 * (typically Merge for PDFs, Images→PDF for images). The shelf is
 * session-scoped — no sensitive file lists are persisted until an
 * explicit privacy/storage policy is approved (§20).
 *
 * The shelf stores safe local file REFERENCES (path + metadata), never
 * copies of file contents (§19).
 *
 * UI: a collapsible bottom dock (§21). Summoned with a button in the
 * footer, dismissed with Esc or a close button.
 *
 * Critical workflow (§23): add A,B,C → reorder → send to Merge → Merge
 * opens preloaded with the reordered list. No file-picking repeated.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ShelfStore, type ShelfItem } from "@/lib/shelf-store";
import { getModulesForKind } from "@/lib/module-registry";

export interface ShelfProps {
  /** Optional controlled-open state. If not provided, the dock is self-managed. */
  open?: boolean;
  /** Optional callback when the user asks to close. */
  onClose?: () => void;
}

export function Shelf({ open, onClose }: ShelfProps): React.ReactNode {
  const [isOpen, setIsOpen] = useState(open ?? false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const items = ShelfStore((s) => s.items);
  const remove = ShelfStore((s) => s.remove);
  const reorder = ShelfStore((s) => s.reorder);
  const clear = ShelfStore((s) => s.clear);
  const clearSelection = ShelfStore((s) => s.clearSelection);
  const navigate = useNavigate();

  // Sync internal open state if the parent controls it.
  useEffect(() => {
    if (open !== undefined) setIsOpen(open);
  }, [open]);

  // Escape closes the shelf when it's open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (selected.length > 0) {
          setSelected([]);
          clearSelection();
        } else {
          setIsOpen(false);
          onClose?.();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, selected, clearSelection, onClose]);

  const toggleSelect = (id: string) => {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  };

  // Compute the most-restrictive input kind for the selection.
  const selectionKind = computeSelectionKind(items, selected);

  // Modules that accept the selection's kind.
  const compatibleModules = selectionKind
    ? getModulesForKind(selectionKind)
    : [];

  const sendToModule = (route: string) => {
    if (!route || route.startsWith("#")) return;
    // Encode the selected items' paths into the route query.
    const selectedItems = items.filter((i) => selected.includes(i.id));
    if (selectedItems.length === 0) return;
    const paths = selectedItems.map((i) => i.path);
    const qs = paths
      .map((p) => `paths=${encodeURIComponent(p)}`)
      .join("&");
    navigate(`${route}?${qs}`);
    setIsOpen(false);
    onClose?.();
  };

  if (!isOpen) {
    // Show a summon button in the bottom-right when items exist.
    if (items.length === 0) return null;
    return (
      <button
        type="button"
        className="paperu-shelf__summon"
        onClick={() => setIsOpen(true)}
        aria-label={`Open Shelf with ${items.length} file${items.length > 1 ? "s" : ""}`}
      >
        <span className="paperu-shelf__summon-glyph" aria-hidden="true">
          ▤
        </span>
        <span className="paperu-shelf__summon-count">{items.length}</span>
        <span className="paperu-shelf__summon-label">Shelf</span>
      </button>
    );
  }

  return (
    <div className="paperu-shelf paperu-shelf--open" role="region" aria-label="Paperu Shelf">
      <div className="paperu-shelf__header">
        <span className="paperu-shelf__title">Shelf</span>
        <span className="paperu-shelf__count" aria-hidden="true">
          {items.length} file{items.length === 1 ? "" : "s"}
          {selected.length > 0 ? ` · ${selected.length} selected` : ""}
        </span>
        <div className="paperu-shelf__actions">
          <button
            type="button"
            className="paperu-shelf__action"
            onClick={() => {
              setSelected([]);
              clear();
            }}
            disabled={items.length === 0}
          >
            Clear all
          </button>
          <button
            type="button"
            className="paperu-shelf__close"
            onClick={() => {
              setIsOpen(false);
              onClose?.();
            }}
            aria-label="Close shelf"
          >
            ×
          </button>
        </div>
      </div>

      <div className="paperu-shelf__body" role="list">
        {items.length === 0 ? (
          <div className="paperu-shelf__empty">
            Drop files anywhere in Paperu and choose “Add to Shelf”.
          </div>
        ) : (
          <ul className="paperu-shelf__list">
            {items.map((item, idx) => {
              const isSel = selected.includes(item.id);
              const exists = item.missing !== true;
              return (
                <li
                  key={item.id}
                  className={
                    "paperu-shelf__item" +
                    (isSel ? " is-selected" : "") +
                    (exists ? "" : " is-missing")
                  }
                  role="listitem"
                >
                  <button
                    type="button"
                    className="paperu-shelf__reorder paperu-shelf__reorder--up"
                    onClick={() => reorder(idx, Math.max(0, idx - 1))}
                    aria-label={`Move ${item.fileName} up`}
                    disabled={idx === 0}
                  >
                    ▴
                  </button>
                  <button
                    type="button"
                    className="paperu-shelf__select"
                    onClick={() => toggleSelect(item.id)}
                    aria-pressed={isSel}
                  >
                    <span className="paperu-shelf__item-glyph" aria-hidden="true">
                      {item.kind === "pdf" ? "▤" : item.kind === "image" ? "▦" : "•"}
                    </span>
                    <span className="paperu-shelf__item-name">{item.fileName}</span>
                    <span className="paperu-shelf__item-meta">
                      {exists ? item.humanReadableSize : "missing"}
                    </span>
                    {!exists && (
                      <span className="paperu-shelf__item-missing">
                        This file moved or was deleted.
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="paperu-shelf__reorder paperu-shelf__reorder--down"
                    onClick={() => reorder(idx, Math.min(items.length - 1, idx + 1))}
                    aria-label={`Move ${item.fileName} down`}
                    disabled={idx === items.length - 1}
                  >
                    ▾
                  </button>
                  <button
                    type="button"
                    className="paperu-shelf__remove"
                    onClick={() => {
                      setSelected((cur) => cur.filter((x) => x !== item.id));
                      remove(item.id);
                    }}
                    aria-label={`Remove ${item.fileName} from shelf`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <div className="paperu-shelf__footer">
          <span className="paperu-shelf__footer-label">Send to:</span>
          {compatibleModules.length === 0 ? (
            <span className="paperu-shelf__no-actions">
              No compatible action for this selection.
            </span>
          ) : (
            <ul className="paperu-shelf__send">
              {compatibleModules.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="paperu-shelf__send-btn"
                    onClick={() => sendToModule(m.route)}
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compute the most-restrictive input kind for a selection.
 * - Empty selection → null
 * - All same kind → that kind
 * - Mixed → "other" (only modules that accept "any" will match, which
 *   intentionally produces an empty compatible list since no module
 *   accepts arbitrary mixed input — §15).
 */
function computeSelectionKind(
  items: readonly ShelfItem[],
  selected: readonly string[],
): "pdf" | "image" | "other" | null {
  const sel = items.filter((i) => selected.includes(i.id));
  if (sel.length === 0) return null;
  const kinds = new Set(sel.map((i) => i.kind));
  if (kinds.size === 1) {
    const k = kinds.values().next().value as string;
    return k === "pdf" || k === "image" || k === "other" ? k : "other";
  }
  return "other";
}
