-- Paperu migration 0012 — Typed Recipe Engine (P5e, AUTOMATION-02).
-- A Recipe is an ordered list of typed, validated operations that
-- process files deterministically. NO raw shell commands — every
-- operation is a typed variant with validated parameters.

-- recipe — a named, ordered list of operations.
CREATE TABLE IF NOT EXISTS recipe (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

-- recipe_step — one typed operation in a recipe.
-- operation_kind is one of: resize|convert_to_format|strip_exif|watermark|place_in_output_dir|verify_output
-- params is a JSON blob whose shape depends on operation_kind.
CREATE TABLE IF NOT EXISTS recipe_step (
    id              TEXT PRIMARY KEY,
    recipe_id       TEXT NOT NULL,
    step_order      INTEGER NOT NULL,
    operation_kind  TEXT NOT NULL,
    params          TEXT NOT NULL DEFAULT '{}',   -- JSON params
    created_at      TEXT NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipe(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recipe_step_order ON recipe_step (recipe_id, step_order);

-- recipe_run_history — durable execution log. No file contents are
-- stored here; messages are short, sanitised summaries.
CREATE TABLE IF NOT EXISTS recipe_run_history (
    id           TEXT PRIMARY KEY,
    recipe_id    TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT NOT NULL,
    status       TEXT NOT NULL,   -- success|failure|partial|skipped
    message      TEXT,
    FOREIGN KEY (recipe_id) REFERENCES recipe(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recipe_history_started ON recipe_run_history (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_history_recipe ON recipe_run_history (recipe_id, started_at DESC);
