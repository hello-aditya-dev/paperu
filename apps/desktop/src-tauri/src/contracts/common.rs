//! Shared primitive contract types (Rust mirror of `common.ts`).

use serde::{Deserialize, Serialize};

/// Coarse classification of a file's detected kind. Serializes to a
/// lowercase string identical to the TypeScript `FileKind` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileKind {
    #[serde(rename = "pdf")]
    Pdf,
    #[serde(rename = "image")]
    Image,
    #[serde(rename = "archive")]
    Archive,
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "spreadsheet")]
    Spreadsheet,
    #[serde(rename = "document")]
    Document,
    #[serde(rename = "audio")]
    Audio,
    #[serde(rename = "video")]
    Video,
    #[serde(rename = "executable")]
    Executable,
    #[serde(rename = "signature")]
    Signature,
    #[serde(rename = "other")]
    Other,
}

/// An exact file/content size in bytes plus a human-readable form.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteSize {
    /// Exact number of bytes.
    pub bytes: u64,
    /// Human-readable rounded representation, e.g. "1.4 MB".
    pub human_readable: String,
}

impl ByteSize {
    pub fn new(bytes: u64) -> Self {
        Self {
            bytes,
            human_readable: format_bytes(bytes),
        }
    }
}

/// Format a byte count into a stable human-readable string using
/// binary units (KiB, MiB) displayed with the common `KB`/`MB`
/// suffix for user familiarity, with one decimal of precision.
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.1} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

/// An ISO-8601 UTC timestamp string (RFC 3339).
pub type IsoTimestamp = String;

/// A filesystem path string as observed on the host OS. Always
/// absolute. Stored as a String for transport; converted to
/// `PathBuf` internally where validation happens.
pub type FilePath = String;

/// A unique task identifier (UUID v4 string).
pub type TaskId = String;

/// A correlation id for tracing a single user-initiated operation.
pub type CorrelationId = String;

/// An edition identifier.
pub type EditionId = String;
