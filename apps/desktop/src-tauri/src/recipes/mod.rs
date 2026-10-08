//! Typed Recipe Engine (P5e, AUTOMATION-02).
//!
//! A Recipe is an ordered list of typed, validated operations that
//! process files deterministically. NO raw shell commands — every
//! operation is a typed variant with validated parameters.
//!
//! Schema in migration 0012: `recipe`, `recipe_step`,
//! `recipe_run_history`. The engine persists recipes + steps + run
//! history in SQLite.
//!
//! Honest V1 scope (per the master spec):
//! - Only `PlaceInOutputDir` + `VerifyOutput` are FULLY executed
//!   Rust-side. They reuse the shared `filesystem::copy_and_verify`
//!   primitive (SHA-256 source/dest compare + atomic publish).
//! - The image/PDF operations (`Resize`, `ConvertToFormat`,
//!   `StripExif`, `Watermark`) are RECORDED + previewed but execution
//!   returns a "needs frontend engine" note for those steps. We do not
//!   pretend to do image processing we can't yet do.
//!
//! The frontend (`RecipesRoute.tsx`) renders the preview + history so
//! the user can see exactly what each recipe will do before running it.

use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, Result};
use crate::filesystem::{copy_and_verify, ConflictPolicy};

/// Allowed conversion formats for `ConvertToFormat`.
pub const ALLOWED_FORMATS: &[&str] = &["pdf", "jpeg", "png"];

/// A typed, validated operation kind. Stored as `operation_kind` (the
/// snake_case variant tag) + `params` (the variant's inner params as
/// JSON). Mirrored on the frontend via `@paperu/contracts`.
///
/// Validation (see [`OperationKind::validate`]) rejects pathological
/// values at create time: zero/negative max widths, unknown formats,
/// empty watermark text, etc. The kind itself is an allowlist — any
/// kind string not in the list below is rejected by
/// [`OperationKind::parse`].
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", content = "params")]
pub enum OperationKind {
    /// Resize an image so its width is at most `max_width` (aspect
    /// preserved). Executed by the frontend image engine (canvas);
    /// V1 Rust records "needs frontend" + continues.
    #[serde(rename = "resize")]
    Resize {
        #[serde(rename = "maxWidth")]
        max_width: u32,
    },
    /// Convert a file to one of the allowed formats (pdf|jpeg|png).
    /// V1 Rust records "needs frontend" + continues.
    #[serde(rename = "convert_to_format")]
    ConvertToFormat { format: String },
    /// Strip EXIF metadata from an image. V1 Rust records "needs
    /// frontend" + continues.
    #[serde(rename = "strip_exif")]
    StripExif,
    /// Stamp a text watermark on each page (PDF) or image. V1 Rust
    /// records "needs frontend" + continues.
    #[serde(rename = "watermark")]
    Watermark { text: String },
    /// Copy each input file into `dir` via the shared
    /// `copy_and_verify` primitive (SHA-256 source/dest compare,
    /// non-destructive, source never deleted). FULLY executed
    /// Rust-side.
    #[serde(rename = "place_in_output_dir")]
    PlaceInOutputDir { dir: String },
    /// Verify each input file is intact by re-reading it + computing
    /// its SHA-256. FULLY executed Rust-side.
    #[serde(rename = "verify_output")]
    VerifyOutput,
}

impl OperationKind {
    /// The snake_case kind tag stored in the `operation_kind` column.
    /// This is the canonical identifier used in DB rows + IPC.
    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::Resize { .. } => "resize",
            Self::ConvertToFormat { .. } => "convert_to_format",
            Self::StripExif => "strip_exif",
            Self::Watermark { .. } => "watermark",
            Self::PlaceInOutputDir { .. } => "place_in_output_dir",
            Self::VerifyOutput => "verify_output",
        }
    }

    /// Serialize just the inner params content to a JSON string. The
    /// `operation_kind` column stores the kind tag separately; the
    /// `params` column stores this inner JSON.
    pub fn params_json(&self) -> Result<String> {
        let val = serde_json::to_value(self).map_err(map_json)?;
        // serde's tagged form is {"kind": "...", "params": <inner>}.
        // Extract the inner content.
        let params = val
            .get("params")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        serde_json::to_string(&params).map_err(map_json)
    }

    /// Parse a kind tag + params JSON back into a typed operation.
    /// Validates the kind is in the allowlist AND the params parse
    /// correctly for that kind. Used to reconstruct rows from the DB
    /// and as the validation entry point for the IPC command.
    pub fn parse(kind: &str, params_json: &str) -> Result<Self> {
        let params_val: serde_json::Value = if params_json.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_str(params_json).map_err(map_json)?
        };
        let tagged = serde_json::json!({ "kind": kind, "params": params_val });
        let op: Self = serde_json::from_value(tagged).map_err(|e| {
            AppError::builder(
                code::INVALID_INPUT,
                ErrorCategory::Validation,
                "That operation kind or its parameters are invalid.",
            )
            .technical(format!("kind={kind}, params={params_json}: {e}"))
            .build()
        })?;
        op.validate()?;
        Ok(op)
    }

    /// Validate the operation's parameters. Returns Err on bad input.
    /// Called from [`parse`]; also callable independently.
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Resize { max_width } => {
                if *max_width == 0 {
                    return Err(AppError::builder(
                        code::INVALID_INPUT,
                        ErrorCategory::Validation,
                        "Resize max width must be greater than zero.",
                    )
                    .build());
                }
                if *max_width > 100_000 {
                    return Err(AppError::builder(
                        code::INVALID_INPUT,
                        ErrorCategory::Validation,
                        "Resize max width is unreasonably large.",
                    )
                    .technical(format!("max_width={max_width}"))
                    .build());
                }
            }
            Self::ConvertToFormat { format } => {
                let f = format.trim().to_lowercase();
                if !ALLOWED_FORMATS.contains(&f.as_str()) {
                    return Err(AppError::builder(
                        code::INVALID_INPUT,
                        ErrorCategory::Validation,
                        "Convert format must be one of pdf, jpeg, or png.",
                    )
                    .technical(format!("format={format}"))
                    .build());
                }
            }
            Self::Watermark { text } => {
                if text.trim().is_empty() {
                    return Err(AppError::builder(
                        code::EMPTY_INPUT,
                        ErrorCategory::Validation,
                        "Watermark text cannot be empty.",
                    )
                    .build());
                }
                if text.chars().count() > 200 {
                    return Err(AppError::builder(
                        code::INVALID_INPUT,
                        ErrorCategory::Validation,
                        "Watermark text is too long (max 200 chars).",
                    )
                    .build());
                }
            }
            Self::PlaceInOutputDir { dir } => {
                if dir.trim().is_empty() {
                    return Err(AppError::builder(
                        code::EMPTY_INPUT,
                        ErrorCategory::Validation,
                        "Output directory cannot be empty.",
                    )
                    .build());
                }
                if dir.chars().count() > 4096 {
                    return Err(AppError::builder(
                        code::PATH_TOO_LONG,
                        ErrorCategory::Validation,
                        "Output directory path is too long.",
                    )
                    .build());
                }
            }
            Self::StripExif | Self::VerifyOutput => {}
        }
        Ok(())
    }

    /// True if this operation is fully executed Rust-side in V1.
    /// False for image/PDF operations that need the frontend engine.
    pub fn is_rust_executable(&self) -> bool {
        matches!(self, Self::PlaceInOutputDir { .. } | Self::VerifyOutput)
    }
}

/// A persisted recipe definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A step in a recipe. Carries the typed operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeStep {
    pub id: String,
    pub recipe_id: String,
    pub step_order: i64,
    pub operation: OperationKind,
    pub created_at: String,
}

/// A planned operation in a recipe preview (no execution).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedOperation {
    pub step_id: String,
    pub step_order: i64,
    pub kind: String,
    pub summary: String,
    /// True if this step is fully executed Rust-side in V1.
    pub rust_executable: bool,
}

/// A preview of a recipe: the recipe + its steps + the planned ops.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipePreview {
    pub recipe: Recipe,
    pub steps: Vec<RecipeStep>,
    pub operations: Vec<PlannedOperation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecipeRequest {
    pub name: String,
    pub description: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRecipeRequest {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub enabled: Option<bool>,
}

/// The result of a single step in a recipe run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    pub step_id: String,
    pub kind: String,
    /// success | partial | failure | skipped
    pub status: String,
    pub message: String,
    pub files_processed: u64,
}

/// The overall result of a recipe run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRunResult {
    /// success | partial | failure | skipped
    pub status: String,
    pub message: String,
    pub step_results: Vec<StepResult>,
}

/// A row of run history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeRunHistory {
    pub id: String,
    pub recipe_id: String,
    pub started_at: String,
    pub finished_at: String,
    /// success | partial | failure | skipped
    pub status: String,
    pub message: Option<String>,
}

// ── CRUD ──────────────────────────────────────────────────────────

pub fn create_recipe(db: &Database, req: CreateRecipeRequest) -> Result<Recipe> {
    if req.name.trim().is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Recipe name is required.",
        )
        .build());
    }
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        let enabled_int = i64::from(req.enabled.unwrap_or(true));
        conn.execute(
            "INSERT INTO recipe (id, name, description, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, req.name, req.description, enabled_int, now],
        )
        .map_err(map_sqlite)?;
        read_recipe(conn, &id)
    })
}

pub fn list_recipes(db: &Database) -> Result<Vec<Recipe>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, enabled, created_at, updated_at FROM recipe ORDER BY name",
            )
            .map_err(map_sqlite)?;
        let rows = stmt.query_map([], row_to_recipe).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

pub fn get_recipe(db: &Database, id: &str) -> Result<Recipe> {
    db.with_conn(|conn| read_recipe(conn, id))
}

pub fn update_recipe(db: &Database, req: UpdateRecipeRequest) -> Result<Recipe> {
    let existing = db.with_conn(|conn| read_recipe(conn, &req.id))?;
    let name = req.name.unwrap_or(existing.name);
    if name.trim().is_empty() {
        return Err(AppError::builder(
            code::EMPTY_INPUT,
            ErrorCategory::Validation,
            "Recipe name cannot be empty.",
        )
        .build());
    }
    // `description` is Option<Option<String>>:
    //   None = leave as-is
    //   Some(None) = clear
    //   Some(Some(s)) = set
    let description = match req.description {
        None => existing.description,
        Some(d) => d,
    };
    let enabled = req.enabled.unwrap_or(existing.enabled);
    db.with_conn(|conn| {
        let now = now_iso(conn)?;
        let enabled_int = i64::from(enabled);
        conn.execute(
            "UPDATE recipe SET name = ?1, description = ?2, enabled = ?3, updated_at = ?4 WHERE id = ?5",
            params![name, description, enabled_int, now, req.id],
        )
        .map_err(map_sqlite)?;
        read_recipe(conn, &req.id)
    })
}

pub fn delete_recipe(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM recipe WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── Steps ─────────────────────────────────────────────────────────

pub fn add_step(db: &Database, recipe_id: &str, operation: OperationKind) -> Result<RecipeStep> {
    // Validate the operation (defence in depth — the typed enum
    // already rejects bad kinds at deserialization, but parameters
    // can still be pathological).
    operation.validate()?;
    db.with_conn(|conn| {
        // Verify the recipe exists (FK alone doesn't always give a
        // friendly error message).
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recipe WHERE id = ?1",
                params![recipe_id],
                |r| r.get(0),
            )
            .map_err(map_sqlite)?;
        if exists == 0 {
            return Err(AppError::builder(
                code::FILE_NOT_FOUND,
                ErrorCategory::Filesystem,
                "That recipe wasn't found.",
            )
            .technical(format!("recipe_id={recipe_id}"))
            .build());
        }
        let id = Uuid::new_v4().to_string();
        let now = now_iso(conn)?;
        // step_order = MAX(step_order) + 1 (or 0 if no steps).
        let next_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(step_order), -1) + 1 FROM recipe_step WHERE recipe_id = ?1",
                params![recipe_id],
                |r| r.get(0),
            )
            .map_err(map_sqlite)?;
        let kind = operation.kind_str();
        let params_json = operation.params_json()?;
        conn.execute(
            "INSERT INTO recipe_step (id, recipe_id, step_order, operation_kind, params, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, recipe_id, next_order, kind, params_json, now],
        )
        .map_err(map_sqlite)?;
        read_step(conn, &id)
    })
}

pub fn list_steps(db: &Database, recipe_id: &str) -> Result<Vec<RecipeStep>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, recipe_id, step_order, operation_kind, params, created_at FROM recipe_step WHERE recipe_id = ?1 ORDER BY step_order ASC",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map(params![recipe_id], row_to_step)
            .map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

pub fn delete_step(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM recipe_step WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

/// Reorder steps to match the order of `step_ids`. All steps of the
/// recipe must be in the list (no partial reorders — that would
/// leave gaps). Validates that every id belongs to the recipe.
pub fn reorder_steps(db: &Database, recipe_id: &str, step_ids: &[String]) -> Result<()> {
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(map_sqlite)?;
        // Sanity: count of steps for this recipe must match the input.
        let actual: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM recipe_step WHERE recipe_id = ?1",
                params![recipe_id],
                |r| r.get(0),
            )
            .map_err(map_sqlite)?;
        if actual as usize != step_ids.len() {
            return Err(AppError::builder(
                code::INVALID_INPUT,
                ErrorCategory::Validation,
                "Reorder list must include every step in the recipe.",
            )
            .technical(format!("expected={actual}, got={}", step_ids.len()))
            .build());
        }
        for (i, sid) in step_ids.iter().enumerate() {
            let affected = tx
                .execute(
                    "UPDATE recipe_step SET step_order = ?1 WHERE id = ?2 AND recipe_id = ?3",
                    params![i as i64, sid, recipe_id],
                )
                .map_err(map_sqlite)?;
            if affected == 0 {
                return Err(AppError::builder(
                    code::FILE_NOT_FOUND,
                    ErrorCategory::Filesystem,
                    "A step in the reorder list doesn't belong to this recipe.",
                )
                .technical(format!("step_id={sid}, recipe_id={recipe_id}"))
                .build());
            }
        }
        tx.commit().map_err(map_sqlite)?;
        Ok(())
    })
}

// ── Preview + Execute + History ───────────────────────────────────

/// Build a preview of a recipe: the recipe itself, its steps in
/// order, and a list of planned operations (one per step) WITHOUT
/// executing any of them. Used by the UI to show what a recipe will
/// do before the user runs it.
pub fn preview_recipe(db: &Database, recipe_id: &str) -> Result<RecipePreview> {
    let recipe = db.with_conn(|conn| read_recipe(conn, recipe_id))?;
    let steps = list_steps(db, recipe_id)?;
    let operations = steps
        .iter()
        .map(|s| PlannedOperation {
            step_id: s.id.clone(),
            step_order: s.step_order,
            kind: s.operation.kind_str().to_string(),
            summary: summarize_operation(&s.operation),
            rust_executable: s.operation.is_rust_executable(),
        })
        .collect();
    Ok(RecipePreview {
        recipe,
        steps,
        operations,
    })
}

/// Execute a recipe against `input_paths`. Each step is run in order;
/// frontend-only steps (Resize, ConvertToFormat, StripExif, Watermark)
/// are recorded as `partial` with a "needs frontend engine" message
/// and execution continues to the next step. Rust-side steps
/// (`PlaceInOutputDir`, `VerifyOutput`) are fully executed.
///
/// `on_progress` is called with a short status message before each
/// step (so the UI can stream progress).
///
/// The run is recorded in `recipe_run_history` with a status of
/// success | partial | failure | skipped.
pub fn execute_recipe(
    db: &Database,
    recipe_id: &str,
    input_paths: &[String],
    on_progress: &mut dyn FnMut(&str),
) -> Result<RecipeRunResult> {
    let recipe = db.with_conn(|conn| read_recipe(conn, recipe_id))?;
    if !recipe.enabled {
        return Err(AppError::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "This recipe is disabled — enable it before running.",
        )
        .build());
    }
    let steps = list_steps(db, recipe_id)?;
    let started = chrono::Utc::now();

    // Snapshot the input paths so each step can read the previous
    // step's outputs. For V1, frontend-only steps don't produce
    // outputs in Rust, so the input set stays the same across steps.
    // (When frontend steps are wired up, this vec will be replaced
    // with the frontend's transformed outputs.)
    let mut current_paths: Vec<String> = input_paths.to_vec();

    let mut step_results: Vec<StepResult> = Vec::with_capacity(steps.len());
    let mut any_partial = false;
    let mut any_failure = false;
    let mut any_success = false;

    for (idx, step) in steps.iter().enumerate() {
        let progress_msg = format!(
            "Step {}/{}: {} ({})",
            idx + 1,
            steps.len(),
            step.operation.kind_str(),
            if step.operation.is_rust_executable() {
                "rust"
            } else {
                "needs frontend"
            }
        );
        on_progress(&progress_msg);

        let (mut result, produced) = execute_step(&step.operation, &current_paths);
        result.step_id = step.id.clone();
        // If the step produced outputs, those become the working set
        // for the next step. For V1, only `PlaceInOutputDir`
        // produces outputs (the destination copies), and a later
        // `VerifyOutput` step then verifies the COPIES, not the
        // originals. Frontend-only steps don't produce outputs in
        // Rust, so the working set stays as-is for those steps.
        if !produced.is_empty() {
            current_paths = produced;
        }

        match result.status.as_str() {
            "success" => any_success = true,
            "partial" => any_partial = true,
            "failure" => any_failure = true,
            _ => {}
        }
        step_results.push(result);
    }

    let status = if any_failure {
        "failure"
    } else if any_partial {
        "partial"
    } else if any_success {
        "success"
    } else {
        "skipped"
    };
    let message = format_run_message(status, &step_results);

    let finished = chrono::Utc::now();
    record_run_history(db, recipe_id, started, finished, status, &message)?;

    Ok(RecipeRunResult {
        status: status.to_string(),
        message,
        step_results,
    })
}

pub fn list_run_history(
    db: &Database,
    recipe_id: &str,
    limit: i64,
) -> Result<Vec<RecipeRunHistory>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, recipe_id, started_at, finished_at, status, message FROM recipe_run_history WHERE recipe_id = ?1 ORDER BY started_at DESC LIMIT ?2",
            )
            .map_err(map_sqlite)?;
        let rows = stmt.query_map(params![recipe_id, limit], row_to_history).map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

// ── Step execution ────────────────────────────────────────────────

/// Execute one step against `input_paths`. Returns the step result
/// AND an optional vec of produced output paths (which become the
/// working set for the next step). For V1, only `PlaceInOutputDir`
/// produces outputs (the destination copies); frontend-only steps
/// produce no outputs in Rust.
fn execute_step(op: &OperationKind, input_paths: &[String]) -> (StepResult, Vec<String>) {
    let kind = op.kind_str();
    match op {
        OperationKind::Resize { .. }
        | OperationKind::ConvertToFormat { .. }
        | OperationKind::StripExif
        | OperationKind::Watermark { .. } => (
            StepResult {
                step_id: String::new(),
                kind: kind.to_string(),
                status: "partial".to_string(),
                message: format!(
                    "{} needs frontend engine — recorded, not executed (V1)",
                    kind
                ),
                files_processed: input_paths.len() as u64,
            },
            Vec::new(),
        ),
        OperationKind::PlaceInOutputDir { dir } => {
            let dest_dir = Path::new(dir);
            let mut processed: u64 = 0;
            let mut failures: Vec<String> = Vec::new();
            let mut produced: Vec<String> = Vec::new();
            for input in input_paths {
                let src = Path::new(input);
                if !src.is_file() {
                    failures.push(format!("{} (not a regular file)", input));
                    continue;
                }
                let file_name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file");
                match copy_and_verify(
                    src,
                    dest_dir,
                    file_name,
                    ConflictPolicy::Rename,
                    &|| false,
                    &|_, _| {},
                ) {
                    Ok(result) => {
                        if result.verified {
                            processed += 1;
                            produced.push(result.destination);
                        } else {
                            failures.push(format!("{} (SHA-256 mismatch)", input));
                        }
                    }
                    Err(e) => {
                        failures.push(format!("{} ({e})", input));
                    }
                }
            }
            let status = if failures.is_empty() {
                "success"
            } else if processed > 0 {
                "partial"
            } else {
                "failure"
            };
            let message = if failures.is_empty() {
                format!("placed {processed} file(s) into {dir}")
            } else {
                format!(
                    "placed {processed} file(s); failed: {}",
                    failures.join("; ")
                )
            };
            (
                StepResult {
                    step_id: String::new(),
                    kind: kind.to_string(),
                    status: status.to_string(),
                    message,
                    files_processed: processed,
                },
                produced,
            )
        }
        OperationKind::VerifyOutput => {
            let mut processed: u64 = 0;
            let mut failures: Vec<String> = Vec::new();
            for input in input_paths {
                match compute_sha256(Path::new(input)) {
                    Ok(hash) => {
                        processed += 1;
                        tracing::debug!(path = %input, hash = %hash, "verify_output ok");
                    }
                    Err(e) => {
                        failures.push(format!("{} ({e})", input));
                    }
                }
            }
            let status = if failures.is_empty() {
                "success"
            } else if processed > 0 {
                "partial"
            } else {
                "failure"
            };
            let message = if failures.is_empty() {
                format!("verified {processed} file(s) (SHA-256)")
            } else {
                format!(
                    "verified {processed} file(s); failed: {}",
                    failures.join("; ")
                )
            };
            (
                StepResult {
                    step_id: String::new(),
                    kind: kind.to_string(),
                    status: status.to_string(),
                    message,
                    files_processed: processed,
                },
                // VerifyOutput doesn't produce outputs; the working
                // set stays as-is.
                Vec::new(),
            )
        }
    }
}

/// Compute the SHA-256 of a file. Used by `VerifyOutput`.
fn compute_sha256(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| {
        AppError::builder(
            code::IO_FAILURE,
            ErrorCategory::Filesystem,
            "Paperu couldn't open the file for verification.",
        )
        .technical(e.to_string())
        .build()
    })?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| {
            AppError::builder(
                code::IO_FAILURE,
                ErrorCategory::Filesystem,
                "Paperu couldn't read the file for verification.",
            )
            .technical(e.to_string())
            .build()
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let hash = hasher.finalize();
    Ok(hex(&hash))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

fn summarize_operation(op: &OperationKind) -> String {
    match op {
        OperationKind::Resize { max_width } => format!("Resize to max width {max_width}px"),
        OperationKind::ConvertToFormat { format } => format!("Convert to {format}"),
        OperationKind::StripExif => "Strip EXIF metadata".to_string(),
        OperationKind::Watermark { text } => format!("Watermark: \"{}\"", text),
        OperationKind::PlaceInOutputDir { dir } => format!("Copy+verify into {dir}"),
        OperationKind::VerifyOutput => "Verify output (SHA-256)".to_string(),
    }
}

fn format_run_message(status: &str, step_results: &[StepResult]) -> String {
    let success = step_results
        .iter()
        .filter(|r| r.status == "success")
        .count();
    let partial = step_results
        .iter()
        .filter(|r| r.status == "partial")
        .count();
    let failure = step_results
        .iter()
        .filter(|r| r.status == "failure")
        .count();
    format!(
        "{status}: {success} ok, {partial} partial, {failure} failed (of {} steps)",
        step_results.len()
    )
}

fn record_run_history(
    db: &Database,
    recipe_id: &str,
    started: chrono::DateTime<chrono::Utc>,
    finished: chrono::DateTime<chrono::Utc>,
    status: &str,
    message: &str,
) -> Result<()> {
    db.with_conn(|conn| {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO recipe_run_history (id, recipe_id, started_at, finished_at, status, message)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                recipe_id,
                started.to_rfc3339(),
                finished.to_rfc3339(),
                status,
                message,
            ],
        )
        .map_err(map_sqlite)?;
        Ok(())
    })
}

// ── DB helpers ────────────────────────────────────────────────────

fn read_recipe(conn: &rusqlite::Connection, id: &str) -> Result<Recipe> {
    conn.query_row(
        "SELECT id, name, description, enabled, created_at, updated_at FROM recipe WHERE id = ?1",
        params![id],
        row_to_recipe,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_recipe(row: &rusqlite::Row) -> rusqlite::Result<Recipe> {
    let enabled_int: i64 = row.get(3)?;
    Ok(Recipe {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        enabled: enabled_int != 0,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn read_step(conn: &rusqlite::Connection, id: &str) -> Result<RecipeStep> {
    conn.query_row(
        "SELECT id, recipe_id, step_order, operation_kind, params, created_at FROM recipe_step WHERE id = ?1",
        params![id],
        row_to_step,
    )
    .map_err(|e| map_sqlite_not_found(e, id))
}

fn row_to_step(row: &rusqlite::Row) -> rusqlite::Result<RecipeStep> {
    let id: String = row.get(0)?;
    let recipe_id: String = row.get(1)?;
    let step_order: i64 = row.get(2)?;
    let kind: String = row.get(3)?;
    let params_json: String = row.get(4)?;
    let created_at: String = row.get(5)?;
    // Reconstruct the typed operation from (kind, params).
    let operation = OperationKind::parse(&kind, &params_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(RecipeStep {
        id,
        recipe_id,
        step_order,
        operation,
        created_at,
    })
}

fn row_to_history(row: &rusqlite::Row) -> rusqlite::Result<RecipeRunHistory> {
    Ok(RecipeRunHistory {
        id: row.get(0)?,
        recipe_id: row.get(1)?,
        started_at: row.get(2)?,
        finished_at: row.get(3)?,
        status: row.get(4)?,
        message: row.get(5)?,
    })
}

fn now_iso(conn: &rusqlite::Connection) -> Result<String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
        r.get(0)
    })
    .map_err(map_sqlite)
}

fn map_sqlite(err: rusqlite::Error) -> AppError {
    AppError::builder(
        code::DATABASE_UNAVAILABLE,
        ErrorCategory::Database,
        "Paperu could not read or write recipes.",
    )
    .technical(err.to_string())
    .build()
}

fn map_sqlite_not_found(err: rusqlite::Error, id: &str) -> AppError {
    AppError::builder(
        code::FILE_NOT_FOUND,
        ErrorCategory::Filesystem,
        "That recipe wasn't found.",
    )
    .technical(format!("id={id}: {err}"))
    .build()
}

fn map_json(err: serde_json::Error) -> AppError {
    AppError::builder(
        code::INVALID_INPUT,
        ErrorCategory::Validation,
        "Paperu received a recipe operation it could not read.",
    )
    .technical(err.to_string())
    .build()
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    fn make_recipe(db: &Database, name: &str) -> Recipe {
        create_recipe(
            db,
            CreateRecipeRequest {
                name: name.to_string(),
                description: Some("test recipe".to_string()),
                enabled: Some(true),
            },
        )
        .unwrap()
    }

    #[test]
    fn create_list_delete_recipe() {
        let db = fresh_db();
        let r = make_recipe(&db, "My Recipe");
        assert_eq!(r.name, "My Recipe");
        assert!(r.enabled);
        assert_eq!(list_recipes(&db).unwrap().len(), 1);
        // Get + update.
        let fetched = get_recipe(&db, &r.id).unwrap();
        assert_eq!(fetched.id, r.id);
        let updated = update_recipe(
            &db,
            UpdateRecipeRequest {
                id: r.id.clone(),
                name: Some("Renamed".to_string()),
                description: Some(None),
                enabled: Some(false),
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert!(updated.description.is_none());
        assert!(!updated.enabled);
        // Delete.
        delete_recipe(&db, &r.id).unwrap();
        assert_eq!(list_recipes(&db).unwrap().len(), 0);
    }

    #[test]
    fn rejects_empty_recipe_name() {
        let db = fresh_db();
        let res = create_recipe(
            &db,
            CreateRecipeRequest {
                name: "   ".to_string(),
                description: None,
                enabled: None,
            },
        );
        assert!(res.is_err());
    }

    #[test]
    fn add_step_reorders_and_deletes() {
        let db = fresh_db();
        let r = make_recipe(&db, "Steps");
        // Add 3 steps out of logical order.
        let s1 = add_step(&db, &r.id, OperationKind::VerifyOutput).unwrap();
        assert_eq!(s1.step_order, 0);
        let s2 = add_step(
            &db,
            &r.id,
            OperationKind::PlaceInOutputDir {
                dir: "/tmp/out".to_string(),
            },
        )
        .unwrap();
        assert_eq!(s2.step_order, 1);
        let s3 = add_step(&db, &r.id, OperationKind::Resize { max_width: 1024 }).unwrap();
        assert_eq!(s3.step_order, 2);

        let steps = list_steps(&db, &r.id).unwrap();
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[0].id, s1.id);
        assert_eq!(steps[1].id, s2.id);
        assert_eq!(steps[2].id, s3.id);

        // Reorder: move s3 first.
        reorder_steps(&db, &r.id, &[s3.id.clone(), s2.id.clone(), s1.id.clone()]).unwrap();
        let reordered = list_steps(&db, &r.id).unwrap();
        assert_eq!(reordered[0].id, s3.id);
        assert_eq!(reordered[1].id, s2.id);
        assert_eq!(reordered[2].id, s1.id);

        // Delete the middle step.
        delete_step(&db, &s2.id).unwrap();
        let after = list_steps(&db, &r.id).unwrap();
        assert_eq!(after.len(), 2);
        assert!(after.iter().all(|s| s.id != s2.id));

        // Reorder with the wrong count is rejected.
        let res = reorder_steps(&db, &r.id, std::slice::from_ref(&s3.id));
        assert!(res.is_err(), "partial reorder rejected");
    }

    #[test]
    fn add_step_rejects_unknown_recipe() {
        let db = fresh_db();
        let res = add_step(&db, "nonexistent-recipe-id", OperationKind::VerifyOutput);
        assert!(res.is_err(), "unknown recipe id is rejected");
    }

    #[test]
    fn preview_lists_planned_operations() {
        let db = fresh_db();
        let r = make_recipe(&db, "Preview Test");
        add_step(&db, &r.id, OperationKind::Resize { max_width: 800 }).unwrap();
        add_step(
            &db,
            &r.id,
            OperationKind::PlaceInOutputDir {
                dir: "/tmp/dest".to_string(),
            },
        )
        .unwrap();
        add_step(&db, &r.id, OperationKind::VerifyOutput).unwrap();

        let preview = preview_recipe(&db, &r.id).unwrap();
        assert_eq!(preview.recipe.id, r.id);
        assert_eq!(preview.steps.len(), 3);
        assert_eq!(preview.operations.len(), 3);
        assert_eq!(preview.operations[0].kind, "resize");
        assert!(!preview.operations[0].rust_executable);
        assert_eq!(preview.operations[1].kind, "place_in_output_dir");
        assert!(preview.operations[1].rust_executable);
        assert_eq!(preview.operations[2].kind, "verify_output");
        assert!(preview.operations[2].rust_executable);
        // Summaries are non-empty + descriptive.
        assert!(preview.operations[0].summary.contains("Resize"));
        assert!(preview.operations[1].summary.contains("/tmp/dest"));
        assert!(preview.operations[2].summary.contains("SHA-256"));
    }

    #[test]
    fn execute_place_in_output_dir_and_verify_creates_verified_output() {
        let db = fresh_db();
        let r = make_recipe(&db, "Execute Test");
        // Build a real temp input file.
        let tmp = std::env::temp_dir().join(format!("paperu-recipe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("source.txt");
        let payload = b"hello recipe engine";
        std::fs::write(&src, payload).unwrap();
        let dest_dir = tmp.join("out");
        std::fs::create_dir_all(&dest_dir).unwrap();

        add_step(
            &db,
            &r.id,
            OperationKind::PlaceInOutputDir {
                dir: dest_dir.to_string_lossy().to_string(),
            },
        )
        .unwrap();
        add_step(&db, &r.id, OperationKind::VerifyOutput).unwrap();

        let input_paths = [src.to_string_lossy().to_string()];
        let mut progress_calls = 0;
        let result = execute_recipe(&db, &r.id, &input_paths, &mut |_| {
            progress_calls += 1;
        })
        .unwrap();

        assert_eq!(result.status, "success", "{}", result.message);
        assert_eq!(result.step_results.len(), 2);
        assert_eq!(result.step_results[0].status, "success");
        assert_eq!(result.step_results[1].status, "success");
        // The destination copy exists + matches.
        let dest_file = dest_dir.join("source.txt");
        assert_eq!(std::fs::read(&dest_file).unwrap(), payload);
        // The source is never deleted (non-destructive).
        assert_eq!(std::fs::read(&src).unwrap(), payload);
        // Progress was reported for each step.
        assert_eq!(progress_calls, 2);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn execute_recipe_with_unsupported_step_records_needs_frontend_and_continues() {
        let db = fresh_db();
        let r = make_recipe(&db, "Mixed");
        // Resize (frontend) then PlaceInOutputDir (Rust) then VerifyOutput (Rust).
        add_step(&db, &r.id, OperationKind::Resize { max_width: 1024 }).unwrap();
        add_step(
            &db,
            &r.id,
            OperationKind::PlaceInOutputDir {
                dir: std::env::temp_dir()
                    .join(format!("paperu-recipe-fe-{}", uuid::Uuid::new_v4()))
                    .to_string_lossy()
                    .to_string(),
            },
        )
        .unwrap();
        add_step(&db, &r.id, OperationKind::VerifyOutput).unwrap();

        let tmp =
            std::env::temp_dir().join(format!("paperu-recipe-fe-src-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("input.bin");
        std::fs::write(&src, b"recipe input bytes").unwrap();

        let input_paths = [src.to_string_lossy().to_string()];
        let result = execute_recipe(&db, &r.id, &input_paths, &mut |_| {}).unwrap();

        // Overall status is partial because Resize was partial.
        assert_eq!(result.status, "partial");
        assert_eq!(result.step_results.len(), 3);
        // Resize recorded needs-frontend.
        assert_eq!(result.step_results[0].status, "partial");
        assert!(
            result.step_results[0].message.contains("frontend"),
            "Resize step must mention frontend: {}",
            result.step_results[0].message
        );
        // The Rust steps still executed.
        assert_eq!(result.step_results[1].status, "success");
        assert_eq!(result.step_results[2].status, "success");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn run_history_is_recorded_after_execute() {
        let db = fresh_db();
        let r = make_recipe(&db, "History Test");
        add_step(&db, &r.id, OperationKind::VerifyOutput).unwrap();

        let tmp = std::env::temp_dir().join(format!("paperu-recipe-hist-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("h.txt");
        std::fs::write(&src, b"history").unwrap();

        // Before execute: no history rows.
        let before = list_run_history(&db, &r.id, 10).unwrap();
        assert!(before.is_empty());

        let _ = execute_recipe(
            &db,
            &r.id,
            &[src.to_string_lossy().to_string()],
            &mut |_| {},
        )
        .unwrap();

        // After execute: exactly one history row, with the expected status.
        let after = list_run_history(&db, &r.id, 10).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].recipe_id, r.id);
        assert_eq!(after[0].status, "success");
        assert!(after[0].message.is_some());
        assert_ne!(after[0].started_at, "");
        assert_ne!(after[0].finished_at, "");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn invalid_operation_kind_rejected_at_create_time() {
        // parse() rejects unknown kinds + bad params.
        let res = OperationKind::parse("bogus_kind", "{}");
        assert!(res.is_err(), "unknown kind is rejected");

        // parse() rejects well-formed kind but missing params.
        let res = OperationKind::parse("resize", "{}");
        assert!(res.is_err(), "missing maxWidth is rejected");

        // parse() rejects pathological max_width.
        let res = OperationKind::parse("resize", r#"{"maxWidth":0}"#);
        assert!(res.is_err(), "zero max_width is rejected");

        // parse() rejects unknown format.
        let res = OperationKind::parse("convert_to_format", r#"{"format":"gif"}"#);
        assert!(res.is_err(), "unknown format is rejected");

        // parse() rejects empty watermark text.
        let res = OperationKind::parse("watermark", r#"{"text":"  "}"#);
        assert!(res.is_err(), "empty watermark text is rejected");

        // parse() rejects empty dir.
        let res = OperationKind::parse("place_in_output_dir", r#"{"dir":""}"#);
        assert!(res.is_err(), "empty dir is rejected");

        // parse() accepts valid operations.
        let op = OperationKind::parse("resize", r#"{"maxWidth":1024}"#).unwrap();
        assert_eq!(op.kind_str(), "resize");
        assert_eq!(op.params_json().unwrap(), r#"{"maxWidth":1024}"#);

        let op = OperationKind::parse("strip_exif", "null").unwrap();
        assert_eq!(op.kind_str(), "strip_exif");

        let op = OperationKind::parse("verify_output", "null").unwrap();
        assert_eq!(op.kind_str(), "verify_output");
    }

    #[test]
    fn step_round_trips_through_db_with_typed_operation() {
        let db = fresh_db();
        let r = make_recipe(&db, "Round Trip");
        let added = add_step(
            &db,
            &r.id,
            OperationKind::Watermark {
                text: "Confidential".to_string(),
            },
        )
        .unwrap();
        assert_eq!(added.operation.kind_str(), "watermark");

        // Re-read from DB — the typed operation must reconstruct.
        let steps = list_steps(&db, &r.id).unwrap();
        assert_eq!(steps.len(), 1);
        match &steps[0].operation {
            OperationKind::Watermark { text } => assert_eq!(text, "Confidential"),
            other => panic!("expected Watermark, got {other:?}"),
        }
    }

    #[test]
    fn execute_missing_input_file_marks_step_failure() {
        let db = fresh_db();
        let r = make_recipe(&db, "Missing");
        let tmp =
            std::env::temp_dir().join(format!("paperu-recipe-missing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dest_dir = tmp.join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        add_step(
            &db,
            &r.id,
            OperationKind::PlaceInOutputDir {
                dir: dest_dir.to_string_lossy().to_string(),
            },
        )
        .unwrap();

        let bogus_path = tmp.join("does-not-exist.bin").to_string_lossy().to_string();
        let result = execute_recipe(&db, &r.id, &[bogus_path], &mut |_| {}).unwrap();
        // Missing input → step failure → overall failure.
        assert_eq!(result.status, "failure");
        assert_eq!(result.step_results[0].status, "failure");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn execute_recipe_with_no_steps_is_skipped() {
        let db = fresh_db();
        let r = make_recipe(&db, "Empty");
        let result = execute_recipe(&db, &r.id, &[], &mut |_| {}).unwrap();
        assert_eq!(result.status, "skipped");
        assert!(result.step_results.is_empty());
        // History row was still recorded.
        let h = list_run_history(&db, &r.id, 10).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].status, "skipped");
    }
}
