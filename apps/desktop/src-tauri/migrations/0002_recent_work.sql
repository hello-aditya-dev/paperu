-- Paperu migration 0002 — recent work history.
--
-- Tracks the user's recent operations so they can answer "what did I do,
-- to which file, what came out, can I open it again?". This is the
-- persistent layer behind the History view (Master Prompt 3 §28-32).
--
-- Stores ONLY file metadata (paths, sizes, operation id/label).
-- NEVER stores document contents, byte payloads, signature images,
-- or any user-entered text. Privacy: paths are local-only metadata
-- (§82). Cleared via `clear_recent_work` command or the History UI.

CREATE TABLE IF NOT EXISTS recent_work (
    id                          TEXT PRIMARY KEY,    -- uuid v4
    source_path                 TEXT NOT NULL,       -- canonical absolute path
    source_file_name            TEXT NOT NULL,
    file_kind                   TEXT NOT NULL,        -- pdf | image | other
    output_path                 TEXT,                -- nullable: inspect produces none
    output_file_name            TEXT,
    operation_id                TEXT NOT NULL,       -- module id, e.g. "pdf-fit"
    operation_label             TEXT NOT NULL,       -- human label, e.g. "Made PDF fit"
    status                      TEXT NOT NULL,       -- success | error | cancelled
    size_before                 INTEGER,             -- bytes; nullable for sources of unknown size
    size_after                  INTEGER,             -- bytes; nullable for no-output ops
    human_readable_size_before  TEXT,                -- e.g. "3.8 MB"
    human_readable_size_after   TEXT,
    created_at                  TEXT NOT NULL,       -- ISO-8601 UTC
    correlation_id              TEXT NOT NULL
);

-- Most-recent-first index for the History view.
CREATE INDEX IF NOT EXISTS idx_recent_work_created_at
    ON recent_work (created_at DESC);

-- Filter by operation kind (for "show me all my merges").
CREATE INDEX IF NOT EXISTS idx_recent_work_operation
    ON recent_work (operation_id, created_at DESC);
