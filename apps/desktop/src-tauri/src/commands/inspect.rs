//! `inspect_file` command — the first real vertical proof.

use crate::contracts::common::FilePath;
use crate::contracts::inspect::{InspectFileRequest, InspectFileResponse};
use crate::errors::Result;
use crate::filesystem;

/// Inspect a local file and return real metadata.
///
/// The path is re-validated server-side. No file content is read.
/// The original file is never modified.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn inspect_file(request: InspectFileRequest) -> Result<InspectFileResponse> {
    let path: FilePath = request.path;
    filesystem::inspect::inspect_file(&path)
}
