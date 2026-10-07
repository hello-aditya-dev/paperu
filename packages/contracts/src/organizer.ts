export interface OrganizerRule {
  readonly id?: string | null;
  readonly name: string;
  readonly sourceFolder: string;
  readonly destFolder: string;
  readonly conditionType: string;
  readonly conditionValue: string;
  readonly action: string;
  readonly enabled?: boolean | null;
  readonly sortOrder?: number | null;
}
export interface MatchedFile {
  readonly path: string; readonly name: string; readonly matches: boolean;
  readonly action: string; readonly destPath: string;
}
export interface DryRunResult {
  readonly matchedFiles: readonly MatchedFile[];
  readonly skipped: readonly string[];
  readonly errors: readonly string[];
}
export const OrganizerCommand = {
  Save: "save_organizer_rule", List: "list_organizer_rules",
  Delete: "delete_organizer_rule", DryRun: "dry_run_organizer",
} as const;
