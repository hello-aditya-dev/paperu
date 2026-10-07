//! Reading history contract (Rust mirror of `reading_history.ts`).
//!
//! Records the user's last reading position per document so reopening
//! a PDF lands where they left off (Master Prompt 4 §25). Local only,
//! clearable from the Reader UI. NEVER stores document contents.

use serde::{Deserialize, Serialize};

/// A reading-history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingHistoryEntry {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_kind: String,
    pub last_page: i64,
    pub scroll_y: f64,
    pub zoom_level: f64,
    pub bookmarks: Vec<i64>,
    pub last_opened_at: String,
}

/// Upsert request — called when the user opens a document or scrolls.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReadingHistoryRequest {
    pub file_path: String,
    pub file_name: String,
    pub file_kind: String,
    pub last_page: Option<i64>,
    pub scroll_y: Option<f64>,
    pub zoom_level: Option<f64>,
    pub bookmarks: Option<Vec<i64>>,
}
