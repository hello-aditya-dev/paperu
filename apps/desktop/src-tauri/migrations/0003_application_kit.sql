-- Paperu migration 0003 — application kit.
--
-- The user's reusable personal documents: photo, signature, initials,
-- resume, ID files, marksheets, certificates, etc. (Master Prompt 4 §18-22).
--
-- Stores ONLY file REFERENCES (paths into Paperu's managed storage
-- directory) + labels. NEVER stores document bytes in the DB itself.
-- NEVER uploads. Privacy doctrine §19, §76: this is sensitive local
-- content; paths are metadata, not contents.

CREATE TABLE IF NOT EXISTS application_kit_item (
    id              TEXT PRIMARY KEY,    -- uuid v4
    kind            TEXT NOT NULL,        -- photo|signature|initials|resume|id|marksheet|certificate|other
    label           TEXT NOT NULL,        -- user-facing label, e.g. "Passport photo"
    file_path       TEXT NOT NULL,        -- path into Paperu's managed kit storage dir
    file_name       TEXT NOT NULL,        -- display name
    file_kind       TEXT NOT NULL,        -- pdf|image|other (coarse)
    mime_type       TEXT,                 -- nullable if unknown
    size_bytes      INTEGER,              -- nullable if unknown
    notes           TEXT,                 -- user notes (e.g. "renewed 2025")
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,        -- ISO-8601 UTC
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_application_kit_kind
    ON application_kit_item (kind, sort_order);
