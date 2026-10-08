-- 90% §38: Forms Vault — local-only reusable personal field values.
-- Explicitly local/private. Never injects into arbitrary websites.
CREATE TABLE IF NOT EXISTS forms_vault_field (
    id              TEXT PRIMARY KEY,
    field_key       TEXT NOT NULL,   -- name|address|email|phone|dob|roll_no|course|custom:*
    field_value     TEXT NOT NULL,
    label           TEXT,             -- optional custom label
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forms_vault_key ON forms_vault_field (field_key);
