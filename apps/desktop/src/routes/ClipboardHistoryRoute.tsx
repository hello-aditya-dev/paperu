/**
 * Clipboard History route — opt-in local clipboard journal (P5, AUTOMATION-05).
 *
 * V1 honesty:
 * - Manual capture: the user clicks "Save current clipboard" to add
 *   an entry. Auto-capture (background polling) needs the Tauri
 *   clipboard plugin + Windows CI validation — V2.
 * - Bounded: 7-day retention (pinned survives), max 100 entries
 *   (oldest unpinned purged).
 * - No network: contents never leave the local DB.
 * - Sensitive data: the user can pause (just don't click Save), pin,
 *   delete individual entries, or clear all.
 *
 * The route reads the clipboard via the standard web
 * `navigator.clipboard.readText()` API (works in the Tauri webview,
 * requires a user gesture which is satisfied by the button click).
 */

import { useCallback, useEffect, useState } from "react";
import type { ClipboardEntry } from "@paperu/contracts";
import {
  addClipboardEntry,
  clearClipboardHistory,
  deleteClipboardEntry,
  listClipboardEntries,
  setClipboardEntryPinned,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

export function ClipboardHistoryRoute(): React.ReactNode {
  const [entries, setEntries] = useState<readonly ClipboardEntry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listClipboardEntries(query.trim() || undefined);
      setEntries(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCaptureCurrent(): Promise<void> {
    try {
      // Read the clipboard via the standard web API. Requires a user
      // gesture (this button click satisfies that). Works in the
      // Tauri webview.
      const text = await navigator.clipboard.readText();
      if (!text) {
        setError("The clipboard is empty.");
        return;
      }
      await addClipboardEntry(text);
      setInfo("Saved current clipboard.");
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't read the clipboard: ${e.message}`
          : String(e),
      );
    }
  }

  async function onPin(id: string, pinned: boolean): Promise<void> {
    try {
      await setClipboardEntryPinned(id, pinned);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDelete(id: string): Promise<void> {
    try {
      await deleteClipboardEntry(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCopyAgain(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setInfo("Copied to clipboard.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onClearAll(): Promise<void> {
    if (!confirm("Delete all clipboard history (including pinned)?")) return;
    try {
      await clearClipboardHistory();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function formatTimestamp(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function preview(content: string | null): string {
    if (!content) return "—";
    const trimmed = content.trim();
    if (trimmed.length <= 200) return trimmed;
    return `${trimmed.slice(0, 200)}…`;
  }

  return (
    <section className="paperu-section" aria-labelledby="clip-heading">
      <header className="paperu-section__header">
        <h1 id="clip-heading" className="paperu-text-display">
          Clipboard History
        </h1>
        <p className="paperu-text-lead">
          Opt-in local clipboard journal. Manual capture (click "Save current
          clipboard"), 7-day retention (pinned survives), max 100 entries. No
          network, no uploads. Auto-capture is V2 (needs Tauri clipboard
          plugin + Windows CI validation).
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
            <Button variant="accent" onClick={onCaptureCurrent}>
              Save current clipboard
            </Button>
            <Button variant="outline" onClick={onClearAll} disabled={entries.length === 0}>
              Clear all
            </Button>
          </div>
          <input
            className="paperu-target__input"
            placeholder="Search history…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginTop: "var(--paperu-space-3)", width: "100%" }}
            aria-label="Search clipboard history"
          />
        </div>
      </Card>

      {loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>Loading…</p>
          </div>
        </Card>
      )}

      {!loading && entries.length === 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>No clipboard entries yet. Click "Save current clipboard" above.</p>
          </div>
        </Card>
      )}

      {entries.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                marginTop: "var(--paperu-space-2)",
                display: "grid",
                gap: "var(--paperu-space-2)",
                maxHeight: "24rem",
                overflowY: "auto",
              }}
            >
              {entries.map((e) => (
                <li
                  key={e.id}
                  style={{
                    border: "1px solid var(--paperu-border-subtle)",
                    borderRadius: "var(--paperu-radius-2)",
                    padding: "var(--paperu-space-2)",
                    background: e.pinned
                      ? "var(--paperu-surface-raised)"
                      : "var(--paperu-surface)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "var(--paperu-space-2)",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        className="paperu-text-code paperu-break-all"
                        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                      >
                        {preview(e.content)}
                      </div>
                      <div className="paperu-text-caption paperu-text-numeric">
                        {formatTimestamp(e.createdAt)}
                        {e.pinned ? " · 📌 pinned" : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "var(--paperu-space-1)",
                        flexShrink: 0,
                      }}
                    >
                      <button
                        type="button"
                        className="paperu-btn paperu-btn--ghost"
                        onClick={() => void onCopyAgain(e.content ?? "")}
                        aria-label="Copy again"
                        title="Copy again"
                      >
                        ⎘
                      </button>
                      <button
                        type="button"
                        className="paperu-btn paperu-btn--ghost"
                        onClick={() => void onPin(e.id, !e.pinned)}
                        aria-label={e.pinned ? "Unpin" : "Pin"}
                        title={e.pinned ? "Unpin" : "Pin (survives retention)"}
                      >
                        {e.pinned ? "↓" : "📌"}
                      </button>
                      <button
                        type="button"
                        className="paperu-btn paperu-btn--ghost"
                        onClick={() => void onDelete(e.id)}
                        aria-label="Delete"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {info && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-3)" }}>
            <span className="paperu-stamp paperu-stamp--success">✓ {info}</span>
          </div>
        </Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">
              !
            </span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}
