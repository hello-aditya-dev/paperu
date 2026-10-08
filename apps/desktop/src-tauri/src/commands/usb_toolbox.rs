#![cfg(feature = "tauri-runtime")]
//! USB Toolbox + shared copy+verify Tauri command (90% §52-53).
//! The primitive lives in src/filesystem/copy_verify.rs (non-gated, tested).

use crate::errors::Result;
use crate::filesystem::{copy_and_verify, ConflictPolicy, CopyVerifyResult};

/// Request shape for the IPC boundary.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyVerifyRequest {
    pub source: String,
    pub dest_dir: String,
    pub file_name: String,
    /// "rename" (default) | "skip".
    pub conflict_policy: Option<String>,
}

/// Copy a file to a destination with SHA-256 verification (90% §52).
/// The primitive: source → temp → stream copy → SHA-256 source + temp →
/// compare → atomic rename. Conflict-safe (default Rename, never overwrites).
/// Source is never modified. V1 synchronous (progress/cancel arrive with
/// the task-engine integration).
#[tauri::command]
pub fn copy_and_verify_file(request: CopyVerifyRequest) -> Result<CopyVerifyResult> {
    let policy = match request.conflict_policy.as_deref() {
        Some("skip") => ConflictPolicy::Skip,
        _ => ConflictPolicy::Rename,
    };
    copy_and_verify(
        std::path::Path::new(&request.source),
        std::path::Path::new(&request.dest_dir),
        &request.file_name,
        policy,
        &|| false,  // no cancellation in V1 synchronous
        &|_, _| {}, // no progress callback in V1 synchronous
    )
}
