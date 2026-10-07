-- Paperu migration 0004 — notes.
--
-- Local-first notes with autosave + crash-safe writes (Master Prompt 4 §27-32).
-- Each note's body is stored as a single TEXT blob (Markdown-ish) in a
-- dedicated table. Drafts are autosaved on every keystroke (debounced)
-- via an atomic UPSERT — a crash never loses the last committed state.
--
-- NEVER uploaded. NEVER indexed remotely. Search is local only (§32).

CREATE TABLE IF NOT EXISTS note (
    id              TEXT PRIMARY KEY,    -- uuid v4
    folder_id       TEXT,                -- nullable (root)
    title           TEXT NOT NULL DEFAULT '',
    body            TEXT NOT NULL DEFAULT '',  -- markdown-ish text
    pinned          INTEGER NOT NULL DEFAULT 0,  -- 0|1
    tags            TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,                -- nullable; soft-delete for restore window
    FOREIGN KEY (folder_id) REFERENCES note_folder(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS note_folder (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    parent_id       TEXT,                -- nullable (root)
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES note_folder(id) ON DELETE CASCADE
);

-- Fast most-recent-first listing for the Notes list.
CREATE INDEX IF NOT EXISTS idx_note_updated_at
    ON note (updated_at DESC);
-- Pinned-first within folder.
CREATE INDEX IF NOT EXISTS idx_note_folder_pinned
    ON note (folder_id, pinned DESC, updated_at DESC);
-- Soft-deleted items by deletion time (for "recently deleted" restore).
CREATE INDEX IF NOT EXISTS idx_note_deleted_at
    ON note (deleted_at);
