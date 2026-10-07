-- Paperu migration 0001 — initial schema.
--
-- Stores ONLY application state. Never user document contents.

-- Migration tracking. Each applied migration inserts a row.
CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    label       TEXT    NOT NULL
);

-- App settings, single-row key/value. Values are JSON strings.
CREATE TABLE IF NOT EXISTS app_settings (
    key      TEXT PRIMARY KEY,
    value    TEXT NOT NULL
);

-- Task history (recent operations). Capped by retention in settings.
CREATE TABLE IF NOT EXISTS task_history (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL,
    label           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    source_files    TEXT NOT NULL,   -- JSON array
    output_files    TEXT,            -- JSON array (nullable)
    error           TEXT,            -- JSON AppError (nullable)
    correlation_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_history_created_at
    ON task_history (created_at DESC);

-- Licence state placeholder. The real licensing implementation
-- comes later; this schema records only the local entitlement view.
CREATE TABLE IF NOT EXISTS licence_state (
    key      TEXT PRIMARY KEY,
    value    TEXT NOT NULL
);
