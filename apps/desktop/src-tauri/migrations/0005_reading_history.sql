-- Paperu migration 0005 — reading history.
--
-- Records the user's last reading position per document so reopening
-- a PDF lands where they left off (Master Prompt 4 §25). Local only,
-- clearable from the Reader UI.
--
-- NEVER stores document contents — only path, last page, scroll position,
-- zoom level, and timestamp. Privacy doctrine §82.

CREATE TABLE IF NOT EXISTS reading_history (
    id              TEXT PRIMARY KEY,    -- uuid v4
    file_path       TEXT NOT NULL UNIQUE,  -- one entry per path
    file_name       TEXT NOT NULL,
    file_kind       TEXT NOT NULL,        -- pdf|other
    last_page       INTEGER NOT NULL DEFAULT 1,
    scroll_y        REAL NOT NULL DEFAULT 0.0,
    zoom_level      REAL NOT NULL DEFAULT 1.0,
    bookmarks       TEXT NOT NULL DEFAULT '[]',  -- JSON array of page numbers
    last_opened_at  TEXT NOT NULL
);

-- Most-recently-opened-first listing.
CREATE INDEX IF NOT EXISTS idx_reading_history_last_opened
    ON reading_history (last_opened_at DESC);
