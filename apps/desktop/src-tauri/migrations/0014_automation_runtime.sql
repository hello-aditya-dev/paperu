-- Paperu migration 0014 — Automation runtime (Prompt 02 §8).
-- Extends the existing watch_folder table (from 0006) with
-- recursive/paused/last_triggered/last_status fields.
-- Adds a watch_execution_history table for per-dispatch results.

-- Extend watch_folder with automation-runtime fields.
ALTER TABLE watch_folder ADD COLUMN recursive INTEGER NOT NULL DEFAULT 1;
ALTER TABLE watch_folder ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_folder ADD COLUMN last_triggered_at TEXT;
ALTER TABLE watch_folder ADD COLUMN last_status TEXT;
ALTER TABLE watch_folder ADD COLUMN name TEXT;
ALTER TABLE watch_folder ADD COLUMN updated_at TEXT;

-- Watch execution history: one row per dispatch.
CREATE TABLE IF NOT EXISTS watch_execution_history (
    id              TEXT PRIMARY KEY,
    rule_id         TEXT NOT NULL,
    trigger_file    TEXT NOT NULL,
    trigger_kind    TEXT NOT NULL,   -- create | modify | remove
    run_id          TEXT,            -- nullable: not all actions use run_ids
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL,   -- success | no_change | failure | cancelled | skipped
    message         TEXT,
    output_count    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (rule_id) REFERENCES watch_folder(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watch_exec_history_rule ON watch_execution_history (rule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_exec_history_started ON watch_execution_history (started_at DESC);
