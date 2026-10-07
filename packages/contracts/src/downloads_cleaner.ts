export interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly category: string;
  readonly sizeBytes: number;
  readonly humanReadableSize: string;
  readonly modifiedAt: string;
}
export const CleanerCommand = { Scan: "scan_downloads_folder" } as const;
