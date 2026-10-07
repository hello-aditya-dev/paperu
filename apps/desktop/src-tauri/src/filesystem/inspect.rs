//! Real local file inspection.
//!
//! Reads actual filesystem metadata for a file and returns it through
//! the typed `InspectFileResponse` contract. No file *content* is
//! read; only metadata. The original file is never modified.

use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Utc};

use crate::contracts::common::{ByteSize, FileKind, FilePath};
use crate::contracts::inspect::InspectFileResponse;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use crate::filesystem::paths::{is_in_synced_folder, validate_input_path};

/// Inspect a local file by absolute path and return real metadata.
///
/// This is the first real vertical proof of the Paperu stack:
/// the value is derived entirely from the filesystem.
pub fn inspect_file(path: &FilePath) -> Result<InspectFileResponse> {
    let resolved = validate_input_path(path)?;

    let meta = match std::fs::metadata(&resolved) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            // The file does not exist. Return a structured error that
            // the UI can present clearly, rather than a raw IO error.
            return Err(AppError::builder(
                code::FILE_NOT_FOUND,
                ErrorCategory::Filesystem,
                "Paperu could not find that file.",
            )
            .detail("The path no longer exists. It may have been moved or deleted.")
            .technical(format!(
                "std::fs::metadata returned NotFound for {}",
                resolved.display()
            ))
            .severity(ErrorSeverity::Error)
            .recoverability(Recoverability::ActionRequired)
            .build());
        }
        Err(err) => return Err(AppError::from(err)),
    };

    if !meta.is_file() {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That path is not a file.",
        )
        .detail("Paperu works with files. Choose a file rather than a folder.")
        .build());
    }

    let file_name = resolved
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let file_stem = resolved
        .file_stem()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());

    let extension = resolved
        .extension()
        .and_then(|n| n.to_str())
        .map(|s| s.to_ascii_lowercase());

    let kind = detect_kind(extension.as_deref());
    let mime_type = extension.as_deref().and_then(mime_guess::from_extension);

    let size = ByteSize::new(meta.len());

    let read_only = is_read_only(&meta);

    let response = InspectFileResponse {
        path: resolved.to_string_lossy().into_owned(),
        file_name,
        file_stem,
        extension,
        kind,
        mime_type,
        size,
        modified_at: to_iso(meta.modified().ok().as_ref()),
        created_at: to_iso(meta.created().ok().as_ref()),
        accessed_at: to_iso(meta.accessed().ok().as_ref()),
        read_only,
        in_synced_folder: is_in_synced_folder(&resolved),
        exists: true,
    };

    Ok(response)
}

/// Detect the coarse file kind from an extension (lowercased, no dot).
pub fn detect_kind(extension: Option<&str>) -> FileKind {
    match extension {
        Some("pdf") => FileKind::Pdf,
        Some("png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "tiff" | "tif" | "heic") => {
            FileKind::Image
        }
        Some("zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz") => FileKind::Archive,
        Some("txt" | "md" | "csv" | "json" | "xml" | "log") => FileKind::Text,
        Some("xlsx" | "xls" | "ods") => FileKind::Spreadsheet,
        Some("docx" | "doc" | "odt" | "rtf") => FileKind::Document,
        Some("mp3" | "wav" | "flac" | "aac" | "ogg") => FileKind::Audio,
        Some("mp4" | "mov" | "avi" | "mkv" | "webm") => FileKind::Video,
        Some("exe" | "msi" | "app") => FileKind::Executable,
        Some("p7s" | "p12" | "pfx" | "cer" | "crt") => FileKind::Signature,
        _ => FileKind::Other,
    }
}

/// Map a MIME guess extension to a MIME type string, if known.
mod mime_guess {
    pub(crate) fn from_extension(ext: &str) -> Option<String> {
        // Avoid pulling the full mime_guess DB to keep deps lean; a
        // small curated map covers the file kinds Paperu touches.
        match ext {
            "pdf" => Some("application/pdf".into()),
            "png" => Some("image/png".into()),
            "jpg" | "jpeg" => Some("image/jpeg".into()),
            "gif" => Some("image/gif".into()),
            "webp" => Some("image/webp".into()),
            "bmp" => Some("image/bmp".into()),
            "txt" => Some("text/plain".into()),
            "csv" => Some("text/csv".into()),
            "json" => Some("application/json".into()),
            "xml" => Some("application/xml".into()),
            "zip" => Some("application/zip".into()),
            "mp3" => Some("audio/mpeg".into()),
            "mp4" => Some("video/mp4".into()),
            _ => None,
        }
    }
}

fn is_read_only(meta: &std::fs::Metadata) -> bool {
    // On Unix, check the owner write bit. On Windows, std surfaces
    // read-only via the readonly metadata field.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o200 == 0
    }
    #[cfg(not(unix))]
    {
        meta.permissions().readonly()
    }
}

fn to_iso(time: Option<&SystemTime>) -> Option<String> {
    let t = time?;
    let dt: DateTime<Utc> = DateTime::<Utc>::from(*t);
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Ensure the inspect module is exercised on the actual `Path` type
/// used by callers; keeps a single canonical entry point.
pub fn inspect_path(path: &Path) -> Result<InspectFileResponse> {
    let path_str: FilePath = path.to_string_lossy().into_owned();
    inspect_file(&path_str)
}
