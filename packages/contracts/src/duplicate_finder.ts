export interface DuplicateGroup {
  readonly groupId: string;
  readonly fileSize: number;
  readonly humanReadableSize: string;
  readonly paths: readonly string[];
  readonly potentialSpaceSaved: number;
}
export const DuplicateCommand = { Find: "find_exact_duplicates" } as const;
