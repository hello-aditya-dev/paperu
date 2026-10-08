/**
 * Typed Recipe Engine contracts (P5e, AUTOMATION-02; P01-2 — all ops native).
 *
 * A Recipe is an ordered list of typed, validated operations that
 * process files deterministically. NO raw shell commands — every
 * operation is a typed variant with validated parameters.
 *
 * The `RecipeOperationKind` discriminated union mirrors the Rust
 * enum in `src-tauri/src/recipes/mod.rs`. Both sides must stay in
 * sync. (Named `RecipeOperationKind` here to avoid a name clash
 * with the unrelated `OperationKind` string union in `operations.ts`.)
 *
 * As of P01-1 / P01-2, all six operations execute natively Rust-side
 * (image ops via the `image` crate, PDF ops via `lopdf`, watermark
 * via `ab_glyph` + DejaVu Sans Bold). The frontend no longer has to
 * keep the window open during a run — recipes run unattended.
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

/**
 * Coarse status of a recipe run (overall) or of a single step.
 * Mirrors the string emitted by the Rust side
 * (`recipes::mod::execute_recipe` / `execute_step`).
 */
export type RecipeRunStatus = "success" | "partial" | "failure" | "skipped";

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
  /**
   * True if this step is fully executed Rust-side. Since P01-1 this
   * is `true` for all six operations — the field is retained for
   * forward-compat with future engine plugs that may delegate to the
   * webview.
   */
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

/**
 * The result of a single step in a recipe run.
 *
 * `outputPaths` carries the absolute paths of any files produced by
 * this step (e.g. a Resize step emits a resized image; a
 * PlaceInOutputDir step emits the copied destination paths). The
 * field is optional on the Rust side: when a step produces no files
 * (e.g. VerifyOutput), or when the Rust version predates the field,
 * the array is absent and the UI gracefully omits the open/reveal
 * buttons.
 */
export interface StepResult {
  readonly stepId: string;
  readonly kind: string;
  /** One of RecipeRunStatus. */
  readonly status: string;
  readonly message: string;
  readonly filesProcessed: number;
  /** Absolute output paths produced by this step (may be absent). */
  readonly outputPaths?: readonly string[];
}

/** The overall result of a recipe run. */
export interface RecipeRunResult {
  /**
   * The canonical run ID. The frontend receives this from
   * `executeRecipe` + passes it to `cancelRecipeRun(runId)`.
   * P02: this field was missing — cancellation was broken because
   * the UI had no run_id to send.
   */
  readonly runId: string;
  /** One of RecipeRunStatus. */
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
  /** One of RecipeRunStatus. */
  readonly status: string;
  readonly message: string | null;
}

/**
 * A progress event emitted during a recipe run. The Rust executor
 * calls its `on_progress` callback before each step; the Tauri
 * command layer (added by the lead separately from P01-2) forwards
 * these as `paperu://recipe-progress` events on the Tauri event bus.
 *
 * The frontend listens via `listenRecipeProgress` in `@/lib/ipc`.
 */
export interface RecipeProgressEvent {
  /** The id of the running recipe. */
  readonly recipeId: string;
  /** The id of the run (used to correlate with the eventual result). */
  readonly runId?: string;
  /** 1-based index of the step about to / just executed. */
  readonly stepIndex: number;
  /** Total number of steps in the recipe. */
  readonly totalSteps: number;
  /** The snake_case kind tag of the step. */
  readonly kind: string;
  /** Human-readable progress message (e.g. "Step 2/3: resize (native)"). */
  readonly message: string;
  /** Optional coarse status when emitting post-step progress. */
  readonly status?: RecipeRunStatus;
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
  /**
   * Cancel an in-flight recipe run by its `recipeId`. The Rust side
   * may not yet implement this command (P01-2 only owns the
   * frontend wrapper); the lead will wire the Rust handler. The
   * frontend calls this on a best-effort basis — if the command is
   * unknown the call surfaces an AppError which the UI displays.
   * One-active-run-per-recipe is the assumed invariant.
   */
  Cancel: "cancel_recipe_run",
} as const;

/**
 * The Tauri event channel name for recipe-run progress events.
 * The Rust side emits `RecipeProgressEvent` payloads on this channel.
 */
export const RECIPE_PROGRESS_EVENT_CHANNEL = "paperu://recipe-progress";
