export interface ZipEntryInfo {
  readonly name: string;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly isDirectory: boolean;
}
/** Result of listing an archive's entries (validated; unsafe entries rejected). */
export interface ListResult {
  readonly entries: readonly ZipEntryInfo[];
  readonly rejected: readonly string[];
}
/** Result of an extraction. Source-safety: never overwrites existing files;
 *  skipped entries are reported, not fatal. */
export interface ExtractResult {
  readonly extracted: readonly string[];
  readonly skipped: readonly string[];
  readonly warnings: readonly string[];
}
/** Result of creating an archive. One bad source file doesn't abort the archive. */
export interface CreateResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}
export const ArchiveCommand = {
  ValidateEntry: "validate_zip_entry",
  CheckRatio: "check_suspicious_ratio",
  CheckContained: "check_destination_contained",
  List: "list_archive",
  Extract: "extract_archive",
  Create: "create_archive",
} as const;
