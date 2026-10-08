-- 90% §67: Privacy-safe local analytics (opt-in). No paths/filenames/contents.
CREATE TABLE IF NOT EXISTS analytics_event (
    id          TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,   -- app_started|operation_started|operation_success|operation_failed|upgrade_viewed|license_activated
    timestamp   TEXT NOT NULL,
    detail      TEXT              -- optional coarse detail (never paths/filenames/contents)
);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_event (event_type, timestamp);
