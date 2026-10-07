/**
 * Notes route — local-first notes with autosave + soft-delete
 * (Master Prompt 4 §27-32).
 *
 * Lean implementation: a left list + right editor. Body is plain
 * markdown-ish text in a textarea (no rich editor tonight — per §0,
 * don't fake a half-built rich editor). Autosave fires on a debounce
 * via the canonical Rust atomic UPSERT (crash-safe).
 *
 * NEVER uploaded. Search is local, no AI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@paperu/contracts";
import {
  createNote,
  listNotes,
  searchNotes,
  softDeleteNote,
  updateNote,
} from "@/lib/ipc";

export function NotesRoute(): React.ReactNode {
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ title: string; body: string }>({
    title: "",
    body: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listNotes(false);
      setNotes(list);
      if (list.length > 0 && selectedId === null) {
        const first = list[0];
        if (first) setSelectedId(first.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  // When selectedId changes, load its draft from the note in state.
  useEffect(() => {
    if (!selectedId) return;
    const note = notes.find((n) => n.id === selectedId);
    if (note) {
      setDraft({ title: note.title, body: note.body });
    }
  }, [selectedId, notes]);

  // Autosave on draft change (debounced 800ms).
  useEffect(() => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateNote({
          id: selectedId,
          title: draft.title,
          body: draft.body,
        });
        setNotes((cur) =>
          cur.map((n) => (n.id === selectedId ? updated : n)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, selectedId]);

  const onCreate = async () => {
    try {
      const note = await createNote({ title: "New note", body: "" });
      setNotes((cur) => [note, ...cur]);
      setSelectedId(note.id);
      setDraft({ title: note.title, body: note.body });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await softDeleteNote(id);
      setNotes((cur) => cur.filter((n) => n.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length === 0) {
      void load();
      return;
    }
    try {
      const results = await searchNotes(q);
      setNotes(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  return (
    <section className="paperu-notes">
      {error && (
        <div className="paperu-notes__error" role="status">{error}</div>
      )}
      <aside className="paperu-notes__list">
        <header className="paperu-notes__list-header">
          <input
            type="text"
            className="paperu-notes__search"
            placeholder="Search notes"
            value={query}
            onChange={(e) => void onSearch(e.target.value)}
            aria-label="Search notes"
          />
          <button
            type="button"
            className="paperu-notes__new"
            onClick={onCreate}
          >
            + New
          </button>
        </header>
        {loading ? (
          <p className="paperu-notes__loading">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="paperu-notes__empty">
            No notes yet. Click “+ New” to start.
          </p>
        ) : (
          <ul className="paperu-notes__entries">
            {notes.map((n) => (
              <li
                key={n.id}
                className={
                  "paperu-notes__entry" +
                  (n.id === selectedId ? " is-selected" : "")
                }
                onClick={() => {
                  setSelectedId(n.id);
                  setDraft({ title: n.title, body: n.body });
                }}
              >
                <span className="paperu-notes__entry-title">
                  {n.title || "Untitled"}
                </span>
                <span className="paperu-notes__entry-meta">
                  {new Date(n.updatedAt).toLocaleDateString()}
                  {n.pinned ? " · 📌" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="paperu-notes__editor">
        {selectedNote ? (
          <>
            <input
              type="text"
              className="paperu-notes__title"
              placeholder="Note title"
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              aria-label="Note title"
            />
            <textarea
              className="paperu-notes__body"
              placeholder="Start writing…"
              value={draft.body}
              onChange={(e) =>
                setDraft((d) => ({ ...d, body: e.target.value }))
              }
              aria-label="Note body"
            />
            <div className="paperu-notes__editor-footer">
              <span className="paperu-notes__autosave">
                Autosaves as you type.
              </span>
              <button
                type="button"
                className="paperu-notes__delete"
                onClick={() => void onDelete(selectedNote.id)}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <p className="paperu-notes__no-selection">
            Pick a note, or create a new one.
          </p>
        )}
      </main>
    </section>
  );
}
