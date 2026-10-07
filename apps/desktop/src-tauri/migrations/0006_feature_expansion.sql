-- Paperu migration 0006 — Zero→50% feature expansion.
-- Tables for Citation Studio, Study Packs, Folder Organizer rules,
-- Rename presets, Clipboard History, Backup Recipes, Timer Jobs,
-- Watch Folders. All store ONLY metadata — never document bytes.

-- Citation Studio: local citation library.
CREATE TABLE IF NOT EXISTS citation (
    id              TEXT PRIMARY KEY,
    source_type     TEXT NOT NULL,   -- book|journal|website|thesis|report
    authors         TEXT NOT NULL,   -- JSON array of {last, first}
    editors         TEXT,            -- JSON array, nullable
    year            TEXT,
    title           TEXT NOT NULL,
    publisher       TEXT,
    volume          TEXT,
    issue           TEXT,
    pages           TEXT,
    url             TEXT,
    doi             TEXT,
    isbn            TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citation_created ON citation (created_at DESC);

-- Study Packs: persistent local study collections.
CREATE TABLE IF NOT EXISTS study_pack (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    subject         TEXT,
    semester        TEXT,
    description     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_pack_item (
    id              TEXT PRIMARY KEY,
    pack_id         TEXT NOT NULL,
    file_path       TEXT,            -- nullable for note-link items
    file_name       TEXT,
    file_kind       TEXT,
    note_id         TEXT,            -- nullable: link to a Paperu Note
    label           TEXT NOT NULL,
    section         TEXT,            -- folder within the pack
    pinned          INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    FOREIGN KEY (pack_id) REFERENCES study_pack(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_study_pack_item_pack ON study_pack_item (pack_id, sort_order);

-- Folder Organizer: persisted rules.
CREATE TABLE IF NOT EXISTS organizer_rule (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    source_folder   TEXT NOT NULL,
    dest_folder     TEXT NOT NULL,
    condition_type  TEXT NOT NULL,   -- extension|filename_contains|prefix|suffix|size|modified_age
    condition_value TEXT NOT NULL,
    action          TEXT NOT NULL,   -- move|copy
    enabled         INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_organizer_rule_order ON organizer_rule (sort_order);

-- Rename Studio: saved presets.
CREATE TABLE IF NOT EXISTS rename_preset (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    config          TEXT NOT NULL,   -- JSON: {prefix, suffix, numbering, find, replace, case, ...}
    created_at      TEXT NOT NULL
);

-- Clipboard History: opt-in local clipboard log.
CREATE TABLE IF NOT EXISTS clipboard_history (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,   -- text|image_path|file_path
    content         TEXT,            -- text content (nullable for image/file)
    file_path       TEXT,            -- path to stored image/file (nullable)
    pinned          INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clipboard_created ON clipboard_history (created_at DESC);

-- Backup Recipes: persisted backup definitions.
CREATE TABLE IF NOT EXISTS backup_recipe (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    sources         TEXT NOT NULL,   -- JSON array of source paths
    destination     TEXT NOT NULL,
    include_patterns TEXT,           -- JSON array, nullable
    exclude_patterns TEXT,           -- JSON array, nullable
    last_run        TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- Timer Jobs: persisted scheduled jobs.
CREATE TABLE IF NOT EXISTS timer_job (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    schedule_kind   TEXT NOT NULL,   -- one_time|daily|weekly
    schedule_expr   TEXT NOT NULL,   -- cron-like or ISO datetime for one_time
    action_type     TEXT NOT NULL,   -- backup_recipe|organizer_rule|rename_preset
    action_id       TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run        TEXT,
    next_run        TEXT,
    created_at      TEXT NOT NULL
);

-- Watch Folders: persisted folder automation.
CREATE TABLE IF NOT EXISTS watch_folder (
    id              TEXT PRIMARY KEY,
    folder_path     TEXT NOT NULL,
    condition_type  TEXT NOT NULL,   -- extension|filename|size
    condition_value TEXT NOT NULL,
    action_type     TEXT NOT NULL,   -- backup_recipe|organizer_rule|rename_preset
    action_id       TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);
