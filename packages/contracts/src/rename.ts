export interface RenameConfig {
  readonly prefix?: string | null;
  readonly suffix?: string | null;
  readonly numbering?: boolean | null;
  readonly numberingStart?: number | null;
  readonly numberingPadding?: number | null;
  readonly find?: string | null;
  readonly replace?: string | null;
  readonly caseConversion?: string | null;
  readonly trimWhitespace?: boolean | null;
  readonly cleanupIllegal?: boolean | null;
  readonly extensionChange?: string | null;
}
export interface RenamePreview {
  readonly sourcePath: string;
  readonly currentName: string;
  readonly proposedName: string;
  readonly hasCollision: boolean;
  readonly warning: string | null;
}
export interface RenameResult {
  readonly succeeded: readonly string[];
  readonly skipped: readonly string[];
  readonly errors: readonly string[];
}
export const RenameCommand = {
  Preview: "preview_rename",
  Execute: "execute_rename",
} as const;
