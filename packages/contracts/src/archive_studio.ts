export interface ZipEntryInfo {
  readonly name: string;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly isDirectory: boolean;
}
export const ArchiveCommand = {
  ValidateEntry: "validate_zip_entry",
  CheckRatio: "check_suspicious_ratio",
  CheckContained: "check_destination_contained",
} as const;
