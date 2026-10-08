export interface BackupRecipe {
  readonly id: string;
  readonly name: string;
  readonly sources: readonly string[];
  readonly destination: string;
  readonly includePatterns: string[] | null;
  readonly excludePatterns: string[] | null;
  readonly lastRun: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface CreateRecipeRequest {
  readonly name: string;
  readonly sources: readonly string[];
  readonly destination: string;
  readonly includePatterns?: string[] | null;
  readonly excludePatterns?: string[] | null;
}
export interface BackupRunResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly string[];
  readonly totalBytes: number;
}
export const BackupRecipesCommand = {
  Create: "create_backup_recipe",
  List: "list_backup_recipes",
  Delete: "delete_backup_recipe",
  Run: "run_backup_recipe",
} as const;
