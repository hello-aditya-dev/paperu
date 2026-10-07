//! Recent work contract (Rust mirror of `recent_work.ts`).
//!
//! Records what the user did, to which file, and what came out.
//! Stores ONLY metadata — never document contents (privacy doctrine §82).

use serde::{Deserialize, Serialize};

/// A single recent-work entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkEntry {
    /// Stable unique id (UUID v4).
    pub id: String,
    /// Canonical absolute path of the source file.
    pub source_path: String,
    /// Display name of the source file.
    pub source_file_name: String,
    /// Coarse kind: "pdf" | "image" | "other".
    pub file_kind: String,
    /// Canonical absolute path of the output (None for inspect-only ops).
    pub output_path: Option<String>,
    /// Display name of the output file.
    pub output_file_name: Option<String>,
    /// Module id, e.g. "pdf-fit".
    pub operation_id: String,
    /// Human label, e.g. "Made PDF fit".
    pub operation_label: String,
    /// "success" | "error" | "cancelled".
    pub status: String,
    /// Source size in bytes (nullable if unknown). i64 because SQLite
    /// stores all integers as i64; JSON serialization is lossless for
    /// any real-world file size.
    pub size_before: Option<i64>,
    /// Output size in bytes (nullable for no-output ops).
    pub size_after: Option<i64>,
    /// Human-readable source size, e.g. "3.8 MB".
    pub human_readable_size_before: Option<String>,
    /// Human-readable output size.
    pub human_readable_size_after: Option<String>,
    /// ISO-8601 UTC timestamp.
    pub created_at: String,
    /// Correlation id.
    pub correlation_id: String,
}

/// Request to add a new recent-work entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRecentWorkRequest {
    pub source_path: String,
    pub source_file_name: String,
    pub file_kind: String,
    pub output_path: Option<String>,
    pub output_file_name: Option<String>,
    pub operation_id: String,
    pub operation_label: String,
    pub status: String,
    pub size_before: Option<i64>,
    pub size_after: Option<i64>,
    pub human_readable_size_before: Option<String>,
    pub human_readable_size_after: Option<String>,
    /// Optional correlation id. If absent, a new UUID v4 is generated.
    pub correlation_id: Option<String>,
}
