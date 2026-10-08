/**
 * Typed Recipe Engine contracts (P5e, AUTOMATION-02).
 *
 * A Recipe is an ordered list of typed, validated operations that
 * process files deterministically. NO raw shell commands — every
 * operation is a typed variant with validated parameters.
 *
 * The `RecipeOperationKind` discriminated union mirrors the Rust
 * enum in `src-tauri/src/recipes/mod.rs`. Both sides must stay in
 * sync. (Named `RecipeOperationKind` here to avoid a name clash
 * with the unrelated `OperationKind` string union in `operations.ts`.)
 */

export type RecipeOperationKind =
  | { readonly kind: "resize"; readonly params: { readonly maxWidth: number } }
  | {
      readonly kind: "convert_to_format";
      readonly params: { readonly format: "pdf" | "jpeg" | "png" };
    }
  | { readonly kind: "strip_exif"; readonly params: null }
  | { readonly kind: "watermark"; readonly params: { readonly text: string } }
  | {
      readonly kind: "place_in_output_dir";
      readonly params: { readonly dir: string };
    }
  | { readonly kind: "verify_output"; readonly params: null };

/** The snake_case kind tag of an operation (one of the RecipeOperationKind variants). */
export type RecipeOperationKindTag = RecipeOperationKind["kind"];

/** A persisted recipe definition. */
export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A step in a recipe. Carries the typed operation. */
export interface RecipeStep {
  readonly id: string;
  readonly recipeId: string;
  readonly stepOrder: number;
  readonly operation: RecipeOperationKind;
  readonly createdAt: string;
}

/** A planned operation in a recipe preview (no execution). */
export interface PlannedOperation {
  readonly stepId: string;
  readonly stepOrder: number;
  readonly kind: string;
  readonly summary: string;
  /** True if this step is fully executed Rust-side in V1. */
  readonly rustExecutable: boolean;
}

/** A preview of a recipe: the recipe + its steps + the planned ops. */
export interface RecipePreview {
  readonly recipe: Recipe;
  readonly steps: readonly RecipeStep[];
  readonly operations: readonly PlannedOperation[];
}

/**
 * Request shape for creating a new typed recipe. Named
 * `CreateTypedRecipeRequest` to disambiguate from the unrelated
 * `CreateRecipeRequest` in `backup_recipes.ts` (which creates a
 * backup-recipe — a different shape: sources + destination +
 * include/exclude patterns).
 */
export interface CreateTypedRecipeRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
}

export interface UpdateRecipeRequest {
  readonly id: string;
  readonly name?: string;
  /**
   * `description` is a double-Option:
   *   undefined = leave as-is
   *   null = clear
   *   string = set
   */
  readonly description?: string | null;
  readonly enabled?: boolean;
}

/** The result of a single step in a recipe run. */
export interface StepResult {
  readonly stepId: string;
  readonly kind: string;
  /** "success" | "partial" | "failure" | "skipped" */
  readonly status: string;
  readonly message: string;
  readonly filesProcessed: number;
}

/** The overall result of a recipe run. */
export interface RecipeRunResult {
  /** "success" | "partial" | "failure" | "skipped" */
  readonly status: string;
  readonly message: string;
  readonly stepResults: readonly StepResult[];
}

/** A row of run history. */
export interface RecipeRunHistory {
  readonly id: string;
  readonly recipeId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** "success" | "partial" | "failure" | "skipped" */
  readonly status: string;
  readonly message: string | null;
}

/** The Tauri command names. */
export const RecipesCommand = {
  Create: "create_recipe",
  List: "list_recipes",
  Get: "get_recipe",
  Update: "update_recipe",
  Delete: "delete_recipe",
  AddStep: "add_recipe_step",
  ListSteps: "list_recipe_steps",
  DeleteStep: "delete_recipe_step",
  ReorderSteps: "reorder_recipe_steps",
  Preview: "preview_recipe",
  Execute: "execute_recipe",
  ListRunHistory: "list_recipe_run_history",
} as const;
