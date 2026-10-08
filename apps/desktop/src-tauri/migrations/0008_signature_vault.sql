-- 90% §37: Signature Vault — local-only signature file references.
-- Stores ONLY file references + metadata (never signature image bytes in the DB).
-- Variants: full signature, initials, guardian/work slot.
CREATE TABLE IF NOT EXISTS signature_vault_item (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    variant         TEXT NOT NULL,   -- full|initials|guardian|work
    file_path       TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    file_kind       TEXT NOT NULL,   -- image|pdf
    mime_type       TEXT,
    size_bytes      INTEGER,
    notes           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signature_vault_variant ON signature_vault_item (variant);
