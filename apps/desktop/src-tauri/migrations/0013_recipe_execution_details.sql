-- Paperu migration 0013 — Recipe execution details (Prompt 01 §16).
-- Detailed run history: per-run, per-step, per-artifact tables.
-- The existing recipe_run_history table (from 0012) stays as-is;
-- these new tables provide the richer per-step + per-artifact
-- breakdown the UI shows.

-- Per-run summary. One row per execute_recipe call.
CREATE TABLE IF NOT EXISTS recipe_run (
    id              TEXT PRIMARY KEY,   -- UUID run ID (the cancel key)
    recipe_id       TEXT NOT NULL,
    recipe_name     TEXT NOT NULL,       -- snapshot of name at run time
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL,      -- success | failure | skipped | cancelled
    message         TEXT,
    input_count     INTEGER NOT NULL DEFAULT 0,
    output_count    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (recipe_id) REFERENCES recipe(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recipe_run_started ON recipe_run (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_run_recipe ON recipe_run (recipe_id, started_at DESC);

-- Per-step result within a run. One row per step executed.
CREATE TABLE IF NOT EXISTS recipe_run_step (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL,
    step_id         TEXT,               -- nullable: skipped steps may not have a step_id
    step_index      INTEGER NOT NULL,
    kind            TEXT NOT NULL,      -- resize | convert_to_format | ...
    status          TEXT NOT NULL,      -- success | failure | partial | skipped
    message         TEXT,
    files_processed INTEGER NOT NULL DEFAULT 0,
    started_at      TEXT,
    finished_at     TEXT,
    FOREIGN KEY (run_id) REFERENCES recipe_run(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recipe_run_step_run ON recipe_run_step (run_id, step_index);

-- Per-artifact: each output file produced by a step. One row per
-- output file (image, PDF, etc.). Stores the SHA-256 + dimensions
-- for verification.
CREATE TABLE IF NOT EXISTS recipe_run_artifact (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL,
    step_id         TEXT,
    path            TEXT NOT NULL,      -- absolute path to the artifact
    format          TEXT NOT NULL,      -- jpeg | png | pdf | ...
    sha256          TEXT NOT NULL,      -- hex-encoded SHA-256
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    width           INTEGER,             -- nullable for non-image artifacts
    height          INTEGER,             -- nullable for non-image artifacts
    page_count      INTEGER,             -- nullable for non-PDF artifacts
    FOREIGN KEY (run_id) REFERENCES recipe_run(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recipe_run_artifact_run ON recipe_run_artifact (run_id);
