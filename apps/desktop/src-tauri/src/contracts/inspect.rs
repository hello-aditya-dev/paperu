//! Local File Inspect contract (Rust mirror of `inspect.ts`).

use serde::{Deserialize, Serialize};

use super::common::{ByteSize, FileKind, FilePath, IsoTimestamp};

/// Request to inspect a local file by absolute path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectFileRequest {
    /// Absolute path to a file on the local filesystem.
    pub path: FilePath,
}

/// Real metadata about a local file, gathered from the filesystem.
/// Every field is derived from the actual file on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectFileResponse {
    /// Canonical absolute path that was inspected.
    pub path: FilePath,
    /// File name component (with extension).
    pub file_name: String,
    /// File stem (name without extension), where determinable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_stem: Option<String>,
    /// Lowercased extension without the leading dot, e.g. "pdf".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    /// Coarse detected file kind.
    pub kind: FileKind,
    /// MIME type guess, where determinable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Exact byte size and human-readable form.
    pub size: ByteSize,
    /// Last modification time (ISO-8601 UTC), where available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<IsoTimestamp>,
    /// Creation/birth time (ISO-8601 UTC), where available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<IsoTimestamp>,
    /// Last access time (ISO-8601 UTC), where available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessed_at: Option<IsoTimestamp>,
    /// True when the file is read-only at the OS level.
    pub read_only: bool,
    /// True when the file resides in a known synced folder (OneDrive).
    pub in_synced_folder: bool,
    /// Whether the file currently exists on disk (defensive).
    pub exists: bool,
}
