/**
 * Typed Recipe Engine route (P5e, AUTOMATION-02).
 *
 * A Recipe is an ordered list of typed, validated operations. NO raw
 * shell commands — every step is a typed variant with validated
 * parameters. This route is the UI for:
 *   - Creating / editing / deleting recipes.
 *   - Adding / reordering / deleting steps.
 *   - Previewing what a recipe will do (without executing it).
 *   - Running a recipe against a set of input files.
 *   - Viewing the persistent run history.
 *
 * Honest V1 scope: only `PlaceInOutputDir` and `VerifyOutput` are
 * fully executed Rust-side. The image/PDF operations (`Resize`,
 * `ConvertToFormat`, `StripExif`, `Watermark`) are recorded + shown
 * in the preview but the run reports "needs frontend engine" for
 * those steps. We never pretend to do image processing we can't do.
 */

import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CreateTypedRecipeRequest,
  Recipe,
  RecipeOperationKind,
  RecipeOperationKindTag,
  RecipePreview,
  RecipeRunHistory,
  RecipeRunResult,
  RecipeStep,
  UpdateRecipeRequest,
} from "@paperu/contracts";
import {
  addRecipeStep,
  createRecipe,
  deleteRecipe,
  deleteRecipeStep,
  executeRecipe,
  listRecipeRunHistory,
  listRecipes,
  listRecipeSteps,
  previewRecipe,
  reorderRecipeSteps,
  updateRecipe,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

/** Option descriptors for the operation-kind <select>. */
const OPERATION_OPTIONS: ReadonlyArray<{
  readonly tag: RecipeOperationKindTag;
  readonly label: string;
  readonly needsParams: "maxWidth" | "format" | "text" | "dir" | null;
}> = [
  { tag: "resize", label: "Resize", needsParams: "maxWidth" },
  { tag: "convert_to_format", label: "Convert to format", needsParams: "format" },
  { tag: "strip_exif", label: "Strip EXIF", needsParams: null },
  { tag: "watermark", label: "Watermark", needsParams: "text" },
  { tag: "place_in_output_dir", label: "Place in output dir", needsParams: "dir" },
  { tag: "verify_output", label: "Verify output (SHA-256)", needsParams: null },
];

const FORMAT_OPTIONS = ["pdf", "jpeg", "png"] as const;

/** Build a `RecipeOperationKind` value for a kind tag + the form state. */
function buildOperation(
  tag: RecipeOperationKindTag,
  params: { maxWidth: string; format: string; text: string; dir: string },
): RecipeOperationKind | null {
  switch (tag) {
    case "resize": {
      const n = Number(params.maxWidth);
      if (!Number.isInteger(n) || n <= 0) return null;
      return { kind: "resize", params: { maxWidth: n } };
    }
    case "convert_to_format": {
      const fmt = params.format.trim().toLowerCase();
      if (!FORMAT_OPTIONS.includes(fmt as (typeof FORMAT_OPTIONS)[number])) return null;
      return {
        kind: "convert_to_format",
        params: { format: fmt as (typeof FORMAT_OPTIONS)[number] },
      };
    }
    case "strip_exif":
      return { kind: "strip_exif", params: null };
    case "watermark": {
      const text = params.text.trim();
      if (!text) return null;
      return { kind: "watermark", params: { text } };
    }
    case "place_in_output_dir": {
      const dir = params.dir.trim();
      if (!dir) return null;
      return { kind: "place_in_output_dir", params: { dir } };
    }
    case "verify_output":
      return { kind: "verify_output", params: null };
  }
}

/** Pretty-print an operation for the step list. */
function describeOperation(op: RecipeOperationKind): string {
  switch (op.kind) {
    case "resize":
      return `Resize to max width ${op.params.maxWidth}px`;
    case "convert_to_format":
      return `Convert to ${op.params.format}`;
    case "strip_exif":
      return "Strip EXIF metadata";
    case "watermark":
      return `Watermark: "${op.params.text}"`;
    case "place_in_output_dir":
      return `Copy+verify into ${op.params.dir}`;
    case "verify_output":
      return "Verify output (SHA-256)";
  }
}

/** True if a step kind is fully executed Rust-side in V1. */
function isRustExecutable(op: RecipeOperationKind): boolean {
  return op.kind === "place_in_output_dir" || op.kind === "verify_output";
}

function statusBadge(status: string): { label: string; tone: string } {
  switch (status) {
    case "success":
      return { label: "✓ success", tone: "var(--paperu-color-success, #2e7d32)" };
    case "partial":
      return { label: "◐ partial", tone: "var(--paperu-color-warning, #b07000)" };
    case "failure":
      return { label: "✗ failure", tone: "var(--paperu-color-danger, #c62828)" };
    default:
      return { label: "○ skipped", tone: "var(--paperu-color-muted, #777)" };
  }
}

export function RecipesRoute(): React.ReactNode {
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [steps, setSteps] = useState<Record<string, readonly RecipeStep[]>>({});
  const [history, setHistory] = useState<Record<string, readonly RecipeRunHistory[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [runResult, setRunResult] = useState<RecipeRunResult | null>(null);
  const [running, setRunning] = useState(false);

  // New recipe form state.
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Add-step form state (per selected recipe).
  const [stepKind, setStepKind] = useState<RecipeOperationKindTag>("resize");
  const [stepMaxWidth, setStepMaxWidth] = useState("1024");
  const [stepFormat, setStepFormat] = useState("pdf");
  const [stepText, setStepText] = useState("");
  const [stepDir, setStepDir] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listRecipes();
      setRecipes(list);
      const stepEntries = await Promise.all(
        list.map(async (r) => [r.id, (await listRecipeSteps(r.id))] as const),
      );
      const histEntries = await Promise.all(
        list.map(async (r) => [r.id, (await listRecipeRunHistory(r.id, 10))] as const),
      );
      const stepMap: Record<string, readonly RecipeStep[]> = {};
      for (const [id, s] of stepEntries) stepMap[id] = s;
      setSteps(stepMap);
      const histMap: Record<string, readonly RecipeRunHistory[]> = {};
      for (const [id, h] of histEntries) histMap[id] = h;
      setHistory(histMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the preview whenever the selected recipe changes.
  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await previewRecipe(selectedId);
        if (!cancelled) setPreview(p);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function onCreate(): Promise<void> {
    if (!newName.trim()) {
      setError("Recipe name is required.");
      return;
    }
    try {
      const req: CreateTypedRecipeRequest = {
        name: newName.trim(),
        description: newDesc.trim() || null,
        enabled: true,
      };
      const r = await createRecipe(req);
      setNewName("");
      setNewDesc("");
      await load();
      setSelectedId(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDelete(id: string): Promise<void> {
    try {
      await deleteRecipe(id);
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onToggleEnabled(r: Recipe, enabled: boolean): Promise<void> {
    try {
      const req: UpdateRecipeRequest = { id: r.id, enabled };
      await updateRecipe(req);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRename(r: Recipe, name: string): Promise<void> {
    if (!name.trim()) return;
    try {
      const req: UpdateRecipeRequest = { id: r.id, name };
      await updateRecipe(req);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onAddStep(recipeId: string): Promise<void> {
    const op = buildOperation(stepKind, {
      maxWidth: stepMaxWidth,
      format: stepFormat,
      text: stepText,
      dir: stepDir,
    });
    if (!op) {
      setError("The current operation parameters are invalid for that kind.");
      return;
    }
    try {
      await addRecipeStep(recipeId, op);
      setStepText("");
      setStepDir("");
      await load();
      // Refresh the preview too.
      if (selectedId === recipeId) {
        try {
          setPreview(await previewRecipe(recipeId));
        } catch {
          /* preview is best-effort */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteStep(recipeId: string, stepId: string): Promise<void> {
    try {
      await deleteRecipeStep(stepId);
      await load();
      if (selectedId === recipeId) {
        try {
          setPreview(await previewRecipe(recipeId));
        } catch {
          /* preview is best-effort */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onMoveStep(
    recipeId: string,
    stepList: readonly RecipeStep[],
    from: number,
    to: number,
  ): Promise<void> {
    if (to < 0 || to >= stepList.length) return;
    const reordered = [...stepList];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);
    try {
      await reorderRecipeSteps(recipeId, reordered.map((s) => s.id));
      await load();
      if (selectedId === recipeId) {
        try {
          setPreview(await previewRecipe(recipeId));
        } catch {
          /* preview is best-effort */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onPickStepDir(): Promise<void> {
    try {
      const sel = await open({
        multiple: false,
        directory: true,
        title: "Choose output directory — Paperu",
      });
      if (typeof sel === "string" && sel.length > 0) setStepDir(sel);
    } catch {
      /* dismissed */
    }
  }

  async function onExecute(recipeId: string): Promise<void> {
    setRunning(true);
    setError(null);
    setRunResult(null);
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        title: "Choose input files — Paperu",
      });
      const inputPaths = Array.isArray(picked)
        ? picked
        : typeof picked === "string"
          ? [picked]
          : [];
      if (inputPaths.length === 0) {
        setError("Pick at least one input file to run the recipe.");
        return;
      }
      const result = await executeRecipe(recipeId, inputPaths);
      setRunResult(result);
      await load();
      // Refresh the preview in case steps changed (they shouldn't, but
      // this keeps the UI honest).
      if (selectedId === recipeId) {
        try {
          setPreview(await previewRecipe(recipeId));
        } catch {
          /* preview is best-effort */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const selectedRecipe = recipes.find((r) => r.id === selectedId) ?? null;
  const selectedSteps = selectedId ? (steps[selectedId] ?? []) : [];
  const selectedHistory = selectedId ? (history[selectedId] ?? []) : [];
  const currentOption = OPERATION_OPTIONS.find((o) => o.tag === stepKind);

  return (
    <section className="paperu-section" aria-labelledby="recipes-heading">
      <header className="paperu-section__header">
        <h1 id="recipes-heading" className="paperu-text-display">
          Recipe Engine
        </h1>
        <p className="paperu-text-lead">
          Ordered lists of typed, validated operations. NO raw shell
          commands — every step is a typed variant. V1 honestly executes
          only <code>PlaceInOutputDir</code> + <code>VerifyOutput</code>
          Rust-side (SHA-256 verified). The image/PDF operations are
          recorded + previewed but report "needs frontend engine" until
          the webview side wires them up.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">New recipe</span>
          <div
            style={{
              display: "grid",
              gap: "var(--paperu-space-2)",
              marginTop: "var(--paperu-space-2)",
            }}
          >
            <input
              className="paperu-target__input"
              placeholder="Recipe name (e.g. Paper photos → print)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ width: "100%" }}
              aria-label="Recipe name"
            />
            <textarea
              className="paperu-target__input"
              placeholder="Short description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              style={{ width: "100%" }}
              aria-label="Recipe description"
            />
            <Button variant="accent" onClick={onCreate}>
              Save recipe
            </Button>
          </div>
        </div>
      </Card>

      {recipes.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">
              Saved recipes ({recipes.length})
            </span>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                marginTop: "var(--paperu-space-3)",
                display: "grid",
                gap: "var(--paperu-space-2)",
              }}
            >
              {recipes.map((r) => {
                const isSel = r.id === selectedId;
                return (
                  <li
                    key={r.id}
                    style={{
                      border: "1px solid var(--paperu-border-subtle)",
                      borderRadius: "var(--paperu-radius-2)",
                      padding: "var(--paperu-space-3)",
                      background: isSel
                        ? "var(--paperu-color-surface-raised, rgba(0,0,0,0.03))"
                        : "transparent",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "var(--paperu-space-3)",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <button
                          type="button"
                          className="paperu-btn paperu-btn--ghost"
                          style={{ fontWeight: 600, padding: 0, textAlign: "left" }}
                          onClick={() => setSelectedId(isSel ? null : r.id)}
                          aria-expanded={isSel}
                        >
                          {r.name}
                        </button>
                        {r.description && (
                          <div className="paperu-text-caption paperu-break-all">
                            {r.description}
                          </div>
                        )}
                        <div className="paperu-text-caption">
                          {(steps[r.id]?.length ?? 0)} step(s) ·{" "}
                          {r.enabled ? "enabled" : "disabled"}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--paperu-space-2)",
                          alignItems: "center",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--paperu-space-1)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) => void onToggleEnabled(r, e.target.checked)}
                            aria-label={`Toggle enabled for ${r.name}`}
                          />
                          <span className="paperu-text-caption">
                            {r.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="paperu-btn paperu-btn--ghost"
                          onClick={() => void onDelete(r.id)}
                          aria-label={`Delete ${r.name}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {selectedRecipe && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--paperu-space-3)" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="paperu-text-label">Selected recipe</span>
                <input
                  className="paperu-target__input"
                  value={selectedRecipe.name}
                  onChange={(e) => void onRename(selectedRecipe, e.target.value)}
                  style={{ fontWeight: 600, marginTop: "var(--paperu-space-1)", width: "100%" }}
                  aria-label="Recipe name (editable)"
                />
              </div>
            </div>

            {/* Steps list */}
            <div style={{ marginTop: "var(--paperu-space-4)" }}>
              <span className="paperu-text-label">Steps ({selectedSteps.length})</span>
              {selectedSteps.length === 0 ? (
                <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
                  No steps yet. Add one below.
                </p>
              ) : (
                <ol
                  style={{
                    listStyle: "none",
                    padding: 0,
                    marginTop: "var(--paperu-space-2)",
                    display: "grid",
                    gap: "var(--paperu-space-1)",
                  }}
                >
                  {selectedSteps.map((s, i) => {
                    const rustExec = isRustExecutable(s.operation);
                    return (
                      <li
                        key={s.id}
                        style={{
                          border: "1px solid var(--paperu-border-subtle)",
                          borderRadius: "var(--paperu-radius-2)",
                          padding: "var(--paperu-space-2)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "var(--paperu-space-2)",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="paperu-text-caption paperu-text-numeric">
                            #{i + 1} · {s.operation.kind}
                            {!rustExec && (
                              <span
                                style={{
                                  marginLeft: "var(--paperu-space-2)",
                                  color: "var(--paperu-color-warning, #b07000)",
                                }}
                              >
                                needs frontend
                              </span>
                            )}
                          </div>
                          <div className="paperu-text-code paperu-break-all">
                            {describeOperation(s.operation)}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "var(--paperu-space-1)" }}>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => void onMoveStep(selectedRecipe.id, selectedSteps, i, i - 1)}
                            disabled={i === 0}
                            aria-label="Move step up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => void onMoveStep(selectedRecipe.id, selectedSteps, i, i + 1)}
                            disabled={i === selectedSteps.length - 1}
                            aria-label="Move step down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => void onDeleteStep(selectedRecipe.id, s.id)}
                            aria-label="Delete step"
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            {/* Add-step form */}
            <div
              style={{
                marginTop: "var(--paperu-space-4)",
                border: "1px dashed var(--paperu-border-subtle)",
                borderRadius: "var(--paperu-radius-2)",
                padding: "var(--paperu-space-3)",
                display: "grid",
                gap: "var(--paperu-space-2)",
              }}
            >
              <span className="paperu-text-label">Add step</span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "var(--paperu-space-2)",
                }}
              >
                <select
                  className="paperu-target__input"
                  value={stepKind}
                  onChange={(e) => setStepKind(e.target.value as RecipeOperationKindTag)}
                  aria-label="Operation kind"
                >
                  {OPERATION_OPTIONS.map((o) => (
                    <option key={o.tag} value={o.tag}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {currentOption?.needsParams === "maxWidth" && (
                  <input
                    className="paperu-target__input"
                    type="number"
                    min={1}
                    placeholder="max width (px)"
                    value={stepMaxWidth}
                    onChange={(e) => setStepMaxWidth(e.target.value)}
                    aria-label="Max width"
                  />
                )}
                {currentOption?.needsParams === "format" && (
                  <select
                    className="paperu-target__input"
                    value={stepFormat}
                    onChange={(e) => setStepFormat(e.target.value)}
                    aria-label="Target format"
                  >
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                )}
                {currentOption?.needsParams === "text" && (
                  <input
                    className="paperu-target__input"
                    placeholder="watermark text"
                    value={stepText}
                    onChange={(e) => setStepText(e.target.value)}
                    aria-label="Watermark text"
                  />
                )}
                {currentOption?.needsParams === "dir" && (
                  <div style={{ display: "flex", gap: "var(--paperu-space-1)" }}>
                    <input
                      className="paperu-target__input"
                      placeholder="output directory"
                      value={stepDir}
                      onChange={(e) => setStepDir(e.target.value)}
                      style={{ flex: 1 }}
                      aria-label="Output directory"
                    />
                    <Button variant="outline" onClick={onPickStepDir}>
                      Pick
                    </Button>
                  </div>
                )}
                {currentOption?.needsParams === null && (
                  <span className="paperu-text-caption" style={{ alignSelf: "center" }}>
                    This operation takes no parameters.
                  </span>
                )}
              </div>
              <Button variant="accent" onClick={() => void onAddStep(selectedRecipe.id)}>
                Add step
              </Button>
            </div>

            {/* Preview */}
            {preview && preview.operations.length > 0 && (
              <details style={{ marginTop: "var(--paperu-space-4)" }} open>
                <summary className="paperu-text-label">Preview ({preview.operations.length} ops)</summary>
                <ol
                  style={{
                    listStyle: "none",
                    padding: 0,
                    marginTop: "var(--paperu-space-2)",
                    display: "grid",
                    gap: "var(--paperu-space-1)",
                  }}
                >
                  {preview.operations.map((op) => (
                    <li
                      key={op.stepId}
                      className="paperu-text-caption"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "var(--paperu-space-2)",
                      }}
                    >
                      <span>#{op.stepOrder + 1} · {op.summary}</span>
                      <span
                        style={{
                          color: op.rustExecutable
                            ? "var(--paperu-color-success, #2e7d32)"
                            : "var(--paperu-color-warning, #b07000)",
                        }}
                      >
                        {op.rustExecutable ? "rust" : "frontend"}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {/* Execute */}
            <div
              style={{
                marginTop: "var(--paperu-space-4)",
                display: "flex",
                gap: "var(--paperu-space-2)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="accent"
                onClick={() => void onExecute(selectedRecipe.id)}
                disabled={running || !selectedRecipe.enabled}
              >
                {running ? "Running…" : "Run recipe…"}
              </Button>
              {!selectedRecipe.enabled && (
                <span className="paperu-text-caption" style={{ color: "var(--paperu-color-warning, #b07000)" }}>
                  Recipe is disabled — enable it to run.
                </span>
              )}
            </div>

            {/* Run result */}
            {runResult && (
              <div
                style={{
                  marginTop: "var(--paperu-space-3)",
                  border: "1px solid var(--paperu-border-subtle)",
                  borderRadius: "var(--paperu-radius-2)",
                  padding: "var(--paperu-space-3)",
                }}
              >
                <div className="paperu-text-label">
                  Last run: {statusBadge(runResult.status).label}
                </div>
                <p className="paperu-text-caption paperu-break-all" style={{ marginTop: "var(--paperu-space-1)" }}>
                  {runResult.message}
                </p>
                <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-1)" }}>
                  {runResult.stepResults.map((s, i) => {
                    const badge = statusBadge(s.status);
                    return (
                      <li key={s.stepId || i} className="paperu-text-caption" style={{ display: "flex", gap: "var(--paperu-space-2)" }}>
                        <span style={{ color: badge.tone, minWidth: "5rem" }}>{badge.label}</span>
                        <span className="paperu-break-all">{s.message}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Run history */}
            {selectedHistory.length > 0 && (
              <details style={{ marginTop: "var(--paperu-space-3)" }}>
                <summary className="paperu-text-label">
                  Run history ({selectedHistory.length})
                </summary>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    marginTop: "var(--paperu-space-2)",
                    display: "grid",
                    gap: "var(--paperu-space-1)",
                    maxHeight: "12rem",
                    overflowY: "auto",
                  }}
                >
                  {selectedHistory.map((h) => {
                    const badge = statusBadge(h.status);
                    return (
                      <li
                        key={h.id}
                        className="paperu-text-caption paperu-text-numeric"
                        style={{ display: "flex", gap: "var(--paperu-space-2)" }}
                      >
                        <span style={{ color: badge.tone, minWidth: "5rem" }}>{badge.label}</span>
                        <span>{new Date(h.finishedAt).toLocaleString()}</span>
                        {h.message && <span className="paperu-break-all">· {h.message}</span>}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>
        </Card>
      )}

      {loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>Loading…</p>
          </div>
        </Card>
      )}
      {recipes.length === 0 && !loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>No recipes yet. Create one above.</p>
          </div>
        </Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">
              !
            </span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}
