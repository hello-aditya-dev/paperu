-- Paperu migration 0011 — Timer Jobs execution (P0-02).
-- Makes Timer Jobs genuinely executable: claimed occurrences for
-- exactly-once dispatch, persistent success/failure history, and
-- timezone + last_error columns on timer_job itself.

-- Claimed occurrences — exactly-once claiming. The (job_id, occurrence_key)
-- PRIMARY KEY means only one INSERT succeeds per scheduled time, even
-- if two scheduler ticks race. This is the durable "lease" that
-- prevents duplicate runs after a restart.
CREATE TABLE IF NOT EXISTS timer_job_occurrence (
    job_id          TEXT NOT NULL,
    occurrence_key  TEXT NOT NULL,   -- ISO 8601 UTC datetime of the scheduled run time
    claimed_at      TEXT NOT NULL,   -- when the scheduler claimed it
    completed_at    TEXT,            -- when dispatch finished (NULL while running)
    status          TEXT,            -- pending|success|failure|skipped
    message         TEXT,            -- short result/error message (no paths/contents)
    PRIMARY KEY (job_id, occurrence_key),
    FOREIGN KEY (job_id) REFERENCES timer_job(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timer_occurrence_status ON timer_job_occurrence (status, claimed_at);

-- Persistent run history — the user-visible execution log.
CREATE TABLE IF NOT EXISTS timer_job_history (
    id              TEXT PRIMARY KEY,
    job_id          TEXT NOT NULL,
    occurrence_key  TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    finished_at     TEXT NOT NULL,
    status          TEXT NOT NULL,   -- success|failure|skipped
    message         TEXT,
    FOREIGN KEY (job_id) REFERENCES timer_job(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timer_job_history_started ON timer_job_history (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_timer_job_history_job ON timer_job_history (job_id, started_at DESC);

-- Per-job timezone (IANA name; default UTC) and the last dispatch error.
ALTER TABLE timer_job ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE timer_job ADD COLUMN last_error TEXT;
