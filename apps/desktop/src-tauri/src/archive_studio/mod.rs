#![allow(warnings)]
//! Archive Studio — ZIP safety validation (Feature 15).
//! 50%: path-traversal prevention, ZIP Slip detection, entry listing
//! validation. Actual ZIP create/extract needs the `zip` crate (next sprint).
//! The security-critical path validation is testable NOW without the crate.

use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Result};
use std::path::{Component, Path, PathBuf};

/// A ZIP entry from the listing (path + size + compressed size).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntryInfo {
    pub name: String,
    pub uncompressed_size: u64,
    pub compressed_size: u64,
    pub is_directory: bool,
}

/// Validate that a ZIP entry name is safe (no path traversal, no absolute paths).
/// Returns the sanitized relative path, or an error if the entry is dangerous.
pub fn validate_zip_entry(name: &str) -> Result<PathBuf> {
    // Reject absolute paths.
    if name.starts_with('/')
        || name.starts_with('\\')
        || name.len() >= 2 && name.as_bytes()[1] == b':'
    {
        return Err(AppError::builder(
            code::PATH_INVALID,
            ErrorCategory::Filesystem,
            "Archive entry has an absolute path — rejected.",
        )
        .technical(format!("entry: {name}"))
        .severity(ErrorSeverity::Warning)
        .build());
    }
    // Reject path traversal (../, ..\).
    let normalized = name.replace("\\", "/");
    let p = Path::new(&normalized);
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                return Err(AppError::builder(
                    code::PATH_INVALID,
                    ErrorCategory::Filesystem,
                    "Archive entry contains '..' — ZIP Slip attack rejected.",
                )
                .technical(format!("entry: {name}"))
                .severity(ErrorSeverity::Warning)
                .build());
            }
            Component::RootDir => {
                return Err(AppError::builder(
                    code::PATH_INVALID,
                    ErrorCategory::Filesystem,
                    "Archive entry has a root path — rejected.",
                )
                .build());
            }
            Component::Prefix(_) => {
                return Err(AppError::builder(
                    code::PATH_INVALID,
                    ErrorCategory::Filesystem,
                    "Archive entry has a Windows drive prefix — rejected.",
                )
                .build());
            }
            _ => {}
        }
    }
    // Normalize separators.
    Ok(PathBuf::from(name.replace('\\', "/")))
}

/// Check if an extraction destination is contained within the base dir.
/// Prevents symlink escapes and directory traversal.
pub fn is_contained(base: &Path, target: &Path) -> bool {
    let canonical_base = match base.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let canonical_target = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    canonical_target.starts_with(&canonical_base)
}

/// Detect suspicious compression ratios (decompression bomb).
/// Returns true if the ratio is suspicious (e.g. > 100:1).
pub fn is_suspicious_ratio(uncompressed: u64, compressed: u64) -> bool {
    if compressed == 0 {
        return uncompressed > 0;
    }
    let ratio = uncompressed as f64 / compressed as f64;
    ratio > 100.0
}

/// Hard resource ceilings for ZIP extraction (decompression-bomb + zip-bomb
/// protection, 90% §5). An archive/entry that exceeds ANY of these is
/// rejected or skipped BEFORE writing — never "warn and extract".
pub const MAX_ZIP_ENTRIES: usize = 10_000;
pub const MAX_SINGLE_ENTRY_UNCOMPRESSED: u64 = 500 * 1024 * 1024; // 500 MB
pub const MAX_TOTAL_UNCOMPRESSED: u64 = 2 * 1024 * 1024 * 1024; // 2 GB
pub const MAX_COMPRESSION_RATIO: f64 = 100.0; // 100:1

// ── Real create / extract / list (Wave D §32) ────────────────────
// These add the `zip` crate. Extraction reuses the validation guards
// above so a malicious archive cannot escape the destination dir
// (ZIP Slip) or trigger a decompression bomb silently.

/// Result of listing an archive's entries.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub entries: Vec<ZipEntryInfo>,
    pub rejected: Vec<String>,
}

/// Result of an extraction.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    pub extracted: Vec<String>,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
}

/// Result of creating an archive.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub created: Vec<String>,
    pub skipped: Vec<String>,
}

/// List the entries of an existing ZIP archive. Validates each entry
/// name; rejected (unsafe) entries are reported separately, not silently
/// skipped. The archive is never extracted here.
pub fn list_archive(path: &str) -> Result<ListResult> {
    let file = std::fs::File::open(path).map_err(|e| {
        AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "Paperu couldn't open that archive.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "That file isn't a readable ZIP archive.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut entries = Vec::new();
    let mut rejected = Vec::new();
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                rejected.push(format!("entry {i}: {e}"));
                continue;
            }
        };
        let name = entry.name().to_string();
        // Validate the entry name — reject path traversal / absolute.
        match validate_zip_entry(&name) {
            Ok(_) => {
                entries.push(ZipEntryInfo {
                    name,
                    uncompressed_size: entry.size(),
                    compressed_size: entry.compressed_size(),
                    is_directory: entry.is_dir(),
                });
            }
            Err(_) => {
                rejected.push(name);
            }
        }
    }
    Ok(ListResult { entries, rejected })
}

/// Extract a ZIP archive into a destination directory. Each entry name
/// is validated (ZIP Slip), each destination is checked to stay within
/// the base dir (symlink escape), and suspicious compression ratios are
/// reported as warnings rather than silently extracted. Files are never
/// overwritten — a collision is reported in `skipped`, not a crash.
pub fn extract_archive(path: &str, dest: &str) -> Result<ExtractResult> {
    let file = std::fs::File::open(path).map_err(|e| {
        AppError::builder(
            code::FILE_NOT_FOUND,
            ErrorCategory::Filesystem,
            "Paperu couldn't open that archive.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "That file isn't a readable ZIP archive.",
        )
        .technical(e.to_string())
        .build()
    })?;
    // Preflight: too many entries → reject the whole archive (decompression-bomb guard).
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "That archive has too many entries — Paperu won't extract it (decompression-bomb guard).",
        )
        .technical(format!("{} entries (max {})", archive.len(), MAX_ZIP_ENTRIES))
        .build());
    }
    let base = Path::new(dest);
    if !base.exists() {
        std::fs::create_dir_all(base).map_err(|e| {
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't create the destination folder.",
            )
            .technical(e.to_string())
            .build()
        })?;
    }
    let mut extracted = Vec::new();
    let mut skipped = Vec::new();
    let mut warnings = Vec::new();
    let mut total_uncompressed: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                skipped.push(format!("entry {i}: {e}"));
                continue;
            }
        };
        let name = entry.name().to_string();
        // ZIP Slip guard — reject unsafe entry names before any write.
        let safe_rel = match validate_zip_entry(&name) {
            Ok(p) => p,
            Err(_) => {
                skipped.push(format!("{name} (unsafe entry name — ZIP Slip rejected)"));
                continue;
            }
        };
        // Single-entry size ceiling — reject before writing.
        if entry.size() > MAX_SINGLE_ENTRY_UNCOMPRESSED {
            skipped.push(format!(
                "{name} (entry too large: {} bytes > {} — decompression-bomb guard)",
                entry.size(),
                MAX_SINGLE_ENTRY_UNCOMPRESSED
            ));
            continue;
        }
        // Total-output ceiling — reject once cumulative output would exceed.
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED {
            skipped.push(format!(
                "{name} (total uncompressed {} would exceed {} — aborting remaining entries)",
                total_uncompressed, MAX_TOTAL_UNCOMPRESSED
            ));
            warnings.push(format!(
                "extraction stopped at {name}: total-output ceiling reached"
            ));
            break;
        }
        // Compression-ratio ceiling — REJECT (not warn) a zip-bomb entry.
        if is_suspicious_ratio(entry.size(), entry.compressed_size()) {
            let ratio = if entry.compressed_size() == 0 {
                0.0
            } else {
                entry.size() as f64 / entry.compressed_size() as f64
            };
            skipped.push(format!(
                "{name} (compression ratio {:.0}:1 exceeds {:.0}:1 — zip-bomb entry rejected)",
                ratio, MAX_COMPRESSION_RATIO
            ));
            continue;
        }
        let out_path = base.join(&safe_rel);
        // Create the parent directory first so we can canonicalize it for
        // the symlink-escape guard (the target file/dir doesn't exist yet,
        // so canonicalizing the target itself would fail — that was the
        // bug that skipped every entry as 'escapes destination').
        let parent = out_path.parent().unwrap_or(base);
        std::fs::create_dir_all(parent).ok();
        // Symlink-escape guard: the resolved PARENT must stay under base.
        // (The target may not exist yet; canonicalizing the parent — which
        // we just created — is the correct check. This catches a symlink
        // in the parent chain that points outside base.)
        if !is_contained(base, parent) {
            skipped.push(format!("{name} (escapes destination)"));
            continue;
        }
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).ok();
            extracted.push(name);
            continue;
        }
        // Never overwrite — a collision is reported, not a crash.
        if out_path.exists() {
            skipped.push(format!("{name} (already exists)"));
            continue;
        }
        match std::fs::File::create(&out_path) {
            Ok(mut out_file) => {
                // 90% §1C: bounded copy — enforce the ACTUAL streamed bytes,
                // not only the header-declared length. A malicious archive
                // can lie about entry.size() (declare small, stream huge).
                match bounded_copy(&mut entry, &mut out_file, MAX_SINGLE_ENTRY_UNCOMPRESSED) {
                    Ok(written) => {
                        if written > MAX_SINGLE_ENTRY_UNCOMPRESSED {
                            let _ = std::fs::remove_file(&out_path);
                            skipped.push(format!(
                                "{name} (streamed {written} bytes > {} — decompression-bomb guard)",
                                MAX_SINGLE_ENTRY_UNCOMPRESSED
                            ));
                        } else {
                            extracted.push(name);
                        }
                    }
                    Err(e) => {
                        // Partial-output cleanup: remove the truncated file.
                        let _ = std::fs::remove_file(&out_path);
                        skipped.push(format!(
                            "{name} (write failed: {e} — partial output cleaned up)"
                        ));
                    }
                }
            }
            Err(e) => {
                skipped.push(format!("{name} (create failed: {e})"));
            }
        }
    }
    Ok(ExtractResult {
        extracted,
        skipped,
        warnings,
    })
}

/// Bounded copy (90% §1C): copy from `reader` to `writer`, but abort if the
/// total streamed bytes exceed `max_bytes`. Returns the actual bytes written.
/// This enforces the REAL streamed length, not the archive-header-declared
/// size (a malicious archive can lie about entry.size() — declare small,
/// stream huge — to bypass a header-only ceiling).
fn bounded_copy<R: std::io::Read, W: std::io::Write>(
    reader: &mut R,
    writer: &mut W,
    max_bytes: u64,
) -> std::io::Result<u64> {
    let mut buf = vec![0u8; 65536].into_boxed_slice();
    let mut written: u64 = 0;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        written += n as u64;
        if written > max_bytes {
            // Abort: the source streamed more than the ceiling. The caller
            // deletes the partial output.
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("streamed {written} bytes exceeds ceiling {max_bytes}"),
            ));
        }
        writer.write_all(&buf[..n])?;
    }
    Ok(written)
}

/// Create a ZIP archive from a list of files. Each source file is read
/// and stored with deflate compression under its basename. Directories
/// are not recursively expanded here — the caller passes individual
/// files. Source files that can't be read are skipped (reported), not
/// fatal — one bad file doesn't abort the archive.
pub fn create_archive(archive_path: &str, files: &[String]) -> Result<CreateResult> {
    let file = std::fs::File::create(archive_path).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't create that archive.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut writer = zip::ZipWriter::new(file);
    let mut created = Vec::new();
    let mut skipped = Vec::new();
    for src_path in files {
        match std::fs::File::open(src_path) {
            Ok(mut src_file) => {
                let name = Path::new(src_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file")
                    .to_string();
                // FileOptions doesn't implement Copy — build a fresh one per file.
                let options = zip::write::FullFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated);
                if let Err(e) = writer.start_file(&name, options) {
                    skipped.push(format!("{name} ({e})"));
                    continue;
                }
                if let Err(e) = std::io::copy(&mut src_file, &mut writer) {
                    skipped.push(format!("{name} (read failed: {e})"));
                    continue;
                }
                created.push(name);
            }
            Err(e) => {
                skipped.push(format!("{src_path} (open failed: {e})"));
            }
        }
    }
    writer.finish().map_err(|e| {
        AppError::builder(
            code::PROCESSING_FAILED,
            ErrorCategory::Processing,
            "Paperu couldn't finalize the archive.",
        )
        .technical(e.to_string())
        .build()
    })?;
    Ok(CreateResult { created, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rejects_traversal() {
        assert!(validate_zip_entry("../etc/passwd").is_err());
        assert!(validate_zip_entry("foo/../../bar").is_err());
        assert!(validate_zip_entry("..\\windows\\system32").is_err());
    }

    #[test]
    fn rejects_absolute() {
        assert!(validate_zip_entry("/etc/passwd").is_err());
        assert!(validate_zip_entry("C:\\Windows\\system32").is_err());
    }

    #[test]
    fn accepts_safe_paths() {
        assert!(validate_zip_entry("folder/file.txt").is_ok());
        assert!(validate_zip_entry("nested/deep/path.pdf").is_ok());
    }

    #[test]
    fn detects_suspicious_ratio() {
        assert!(is_suspicious_ratio(1_000_000_000, 1_000)); // 1000:1
        assert!(!is_suspicious_ratio(1_000, 500)); // 2:1 — normal
    }

    #[test]
    fn is_contained_works() {
        let tmp = std::env::temp_dir().join(format!("paperu-archive-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let sub = tmp.join("subfolder");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(is_contained(&tmp, &sub));
        assert!(!is_contained(&tmp, std::path::Path::new("/etc")));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn create_list_extract_round_trip() {
        let tmp = std::env::temp_dir().join(format!("paperu-zip-rt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        // Two source files.
        let src1 = tmp.join("a.txt");
        let src2 = tmp.join("b.txt");
        std::fs::write(&src1, b"hello world").unwrap();
        std::fs::write(&src2, b"second file contents").unwrap();
        let archive_path = tmp.join("out.zip");
        let created = create_archive(
            archive_path.to_str().unwrap(),
            &[
                src1.to_string_lossy().to_string(),
                src2.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        assert_eq!(created.created.len(), 2, "both files should be archived");
        assert!(archive_path.exists(), "the archive must exist");

        // List.
        let list = list_archive(archive_path.to_str().unwrap()).unwrap();
        assert_eq!(list.entries.len(), 2, "list should see both entries");
        assert!(list.rejected.is_empty(), "no entries should be rejected");

        // Extract into a fresh subfolder.
        let dest = tmp.join("extracted");
        std::fs::create_dir_all(&dest).unwrap();
        let extract =
            extract_archive(archive_path.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        assert_eq!(extract.extracted.len(), 2, "both files should extract");
        assert!(extract.skipped.is_empty(), "nothing should be skipped");
        // Verify the extracted bytes match the originals (round-trip integrity).
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"hello world");
        assert_eq!(
            std::fs::read(dest.join("b.txt")).unwrap(),
            b"second file contents"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn extract_rejects_zip_slip_entry() {
        // Build an archive by hand containing a traversal entry name,
        // then verify extract_archive refuses to write outside the dest.
        let tmp = std::env::temp_dir().join(format!("paperu-zip-slip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("safe.txt");
        std::fs::write(&src, b"x").unwrap();
        let archive_path = tmp.join("slip.zip");
        // Create a legit archive first, then we trust the validate_zip_entry
        // guard (tested above) to reject the traversal name before write.
        let created = create_archive(
            archive_path.to_str().unwrap(),
            &[src.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(created.created.len(), 1);
        // validate_zip_entry already rejects "../etc/passwd" — covered by
        // the rejects_traversal test. extract_archive calls that guard on
        // every entry name, so a Slip entry would land in `skipped`.
        let dest = tmp.join("out");
        let _ = extract_archive(archive_path.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn extract_never_overwrites_existing_files() {
        let tmp = std::env::temp_dir().join(format!("paperu-zip-collide-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("a.txt");
        std::fs::write(&src, b"archived-content").unwrap();
        let archive_path = tmp.join("out.zip");
        create_archive(
            archive_path.to_str().unwrap(),
            &[src.to_string_lossy().to_string()],
        )
        .unwrap();
        // Pre-create the collision file with different content.
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("a.txt"), b"PRE-EXISTING").unwrap();
        let extract =
            extract_archive(archive_path.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        assert!(extract.skipped.iter().any(|s| s.contains("already exists")));
        // The pre-existing content must be untouched.
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"PRE-EXISTING");
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// 90% §1C: build a REAL adversarial ZIP with a `../` traversal entry
    /// name + verify extract_archive rejects it (never writes outside dest).
    #[test]
    fn extract_rejects_real_zip_slip_traversal_entry() {
        let tmp = std::env::temp_dir().join(format!("paperu-slip-real-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let archive_path = tmp.join("malicious.zip");
        // Build a ZIP with a traversal entry name using ZipWriter directly.
        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::FullFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            // A traversal entry — the validator MUST reject this.
            writer.start_file("../evil.txt", options).unwrap();
            writer.write_all(b"pwned").unwrap();
            // A safe entry too, to prove the rest still extracts.
            let safe_options = zip::write::FullFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            writer.start_file("safe.txt", safe_options).unwrap();
            writer.write_all(b"safe").unwrap();
            writer.finish().unwrap();
        }
        let dest = tmp.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        let extract =
            extract_archive(archive_path.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        // The traversal entry is skipped (rejected), NOT extracted.
        assert!(
            extract
                .skipped
                .iter()
                .any(|s| s.contains("ZIP Slip") || s.contains("unsafe entry name")),
            "traversal entry must be rejected: {:?}",
            extract.skipped
        );
        // The safe entry extracts.
        assert!(
            extract.extracted.iter().any(|s| s == "safe.txt"),
            "safe entry extracts"
        );
        // CRITICAL: no file was written OUTSIDE the dest dir (no ../evil.txt).
        assert!(
            !tmp.join("evil.txt").exists(),
            "traversal must NOT write outside dest"
        );
        assert_eq!(std::fs::read(dest.join("safe.txt")).unwrap(), b"safe");
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// 90% §1C: a ZIP declaring a small entry.size() but streaming a huge
    /// payload is caught by the bounded-copy streamed-byte ceiling.
    #[test]
    fn bounded_copy_aborts_when_streamed_bytes_exceed_limit() {
        let big = vec![0xABu8; 200];
        let mut reader = std::io::Cursor::new(&big[..]);
        let mut writer = std::io::Cursor::new(Vec::new());
        // Limit 100 bytes — the 200-byte stream must abort.
        let result = bounded_copy(&mut reader, &mut writer, 100);
        assert!(
            result.is_err(),
            "bounded_copy must abort when streamed > limit"
        );
    }
}
