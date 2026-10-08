/**
 * Typed Recipe Engine route (P5e, AUTOMATION-02; P01-2 native rewrite).
 *
 * A Recipe is an ordered list of typed, validated operations. NO raw
 * shell commands — every step is a typed variant with validated
 * parameters. This route is the UI for:
 *   - Creating / editing / deleting recipes.
 *   - Adding / reordering / deleting steps.
 *   - Previewing what a recipe will do (without executing it).
 *   - Picking input files + running a recipe.
 *   - Watching live progress events from the Rust executor.
 *   - Cancelling an in-flight run.
 *   - Repeating a run with the same inputs.
 *   - Opening / revealing step outputs in the platform file manager.
 *   - Viewing the persistent run history.
 *
 * As of P01-1 / P01-2 ALL SIX operations execute natively Rust-side
 * (image ops via the `image` crate, PDF ops via `lopdf`, watermark
 * via `ab_glyph` + DejaVu Sans Bold). The "needs frontend" caveats
 * are gone. Recipes run unattended — the React window does not have
 * to stay open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CreateTypedRecipeRequest,
  Recipe,
  RecipeOperationKind,
  RecipeOperationKindTag,
  RecipePreview,
  RecipeProgressEvent,
  RecipeRunHistory,
  RecipeRunResult,
  RecipeStep,
  UpdateRecipeRequest,
} from "@paperu/contracts";
import {
  addRecipeStep,
  cancelRecipeRun,
  createRecipe,
  deleteRecipe,
  deleteRecipeStep,
  executeRecipe,
  listRecipeRunHistory,
  listRecipes,
  listRecipeSteps,
  listenRecipeProgress,
  openPath,
  previewRecipe,
  reorderRecipeSteps,
  revealPath,
  updateRecipe,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

/** File-extension filters shared by the input picker. */
const INPUT_FILE_FILTERS: { name: string; extensions: string[] }[] = [
  { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "ico"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "All files", extensions: ["*"] },
];

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
      return `Resize to max width ${op.params.maxWidth}px (Lanczos3, never upscales)`;
    case "convert_to_format":
      return `Convert to ${op.params.format}`;
    case "strip_exif":
      return "Strip EXIF metadata (decode + re-encode)";
    case "watermark":
      return `Watermark: "${op.params.text}"`;
    case "place_in_output_dir":
      return `Copy+verify into ${op.params.dir}`;
    case "verify_output":
      return "Verify output (SHA-256)";
  }
}

function statusBadge(status: string): { label: string; tone: string } {
  switch (status) {
    case "success":
      return { label: "✓ success", tone: "var(--paperu-success, #2e7d32)" };
    case "partial":
      return { label: "◐ partial", tone: "var(--paperu-warning, #b07000)" };
    case "failure":
      return { label: "✗ failure", tone: "var(--paperu-danger, #c62828)" };
    default:
      return { label: "○ skipped", tone: "var(--paperu-text-muted, #777)" };
  }
}

/** Just the filename component of a path (cross-platform). */
function basename(p: string): string {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? p : p.slice(i + 1);
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
  /** Recipe currently executing on the Rust side (drives the live progress UI). */
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);
  /** Latest progress message ("Step 2/3: resize (native)"). */
  const [progress, setProgress] = useState<string | null>(null);
  /** True while a cancel request is in flight. */
  const [cancelling, setCancelling] = useState(false);
  /** Cancel request surfaced an error (e.g. command not registered). */
  const [cancelError, setCancelError] = useState<string | null>(null);

  // New recipe form state.
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Add-step form state (per selected recipe).
  const [stepKind, setStepKind] = useState<RecipeOperationKindTag>("resize");
  const [stepMaxWidth, setStepMaxWidth] = useState("1024");
  const [stepFormat, setStepFormat] = useState("pdf");
  const [stepText, setStepText] = useState("");
  const [stepDir, setStepDir] = useState("");

  // Input files for the next run + last-used inputs (for Repeat).
  const [inputPaths, setInputPaths] = useState<string[]>([]);
  const [lastInputPaths, setLastInputPaths] = useState<string[]>([]);

  // Hold the unlisten function for the progress event subscription.
  // Lives for the lifetime of the component — events are filtered
  // by `runningRecipeId` in the handler.
  const unlistenRef = useRef<(() => void) | null>(null);

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

  // Mount the progress-event listener for the lifetime of the
  // component. The handler filters by `runningRecipeId` so events
  // for other recipes (if any) are silently dropped. Outside the
  // Tauri shell the wrapper resolves to a no-op unlisten.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const un = await listenRecipeProgress((event: RecipeProgressEvent) => {
          if (cancelled) return;
          if (runningRecipeId !== null && event.recipeId !== runningRecipeId) return;
          if (event.message) setProgress(event.message);
        });
        if (cancelled) {
          un();
        } else {
          unlistenRef.current = un;
        }
      } catch {
        // Listener registration is best-effort; the run still works
        // without live progress (executeRecipe returns the final result).
      }
    })();
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [runningRecipeId]);

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

  async function onPickInputFiles(): Promise<void> {
    try {
      const sel = await open({
        multiple: true,
        directory: false,
        title: "Choose input files — Paperu",
        filters: INPUT_FILE_FILTERS,
      });
      const picked = Array.isArray(sel)
        ? sel
        : typeof sel === "string"
          ? [sel]
          : [];
      if (picked.length > 0) {
        setInputPaths((cur) => {
          const seen = new Set(cur);
          const merged = [...cur];
          for (const p of picked) {
            if (!seen.has(p)) {
              seen.add(p);
              merged.push(p);
            }
          }
          return merged;
        });
      }
    } catch {
      /* dismissed */
    }
  }

  function onRemoveInput(i: number): void {
    setInputPaths((cur) => cur.filter((_, idx) => idx !== i));
  }

  function onClearInputs(): void {
    setInputPaths([]);
  }

  async function onExecute(recipeId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      setError("Pick at least one input file to run the recipe.");
      return;
    }
    setRunning(true);
    setRunningRecipeId(recipeId);
    setProgress("Starting…");
    setRunResult(null);
    setError(null);
    try {
      const result = await executeRecipe(recipeId, paths);
      setRunResult(result);
      setLastInputPaths(paths);
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
      setRunningRecipeId(null);
      setProgress(null);
      setCancelling(false);
      setCancelError(null);
    }
  }

  async function onCancel(recipeId: string): Promise<void> {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelRecipeRun(recipeId);
    } catch (e) {
      // The Rust side may not yet implement the command; surface the
      // error next to the cancel button so the user knows it didn't
      // take effect. The run itself continues (and will still return
      // a result via executeRecipe).
      setCancelError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  }

  async function onRepeat(recipeId: string): Promise<void> {
    if (lastInputPaths.length === 0) return;
    await onExecute(recipeId, lastInputPaths);
  }

  async function onOpenOutput(path: string): Promise<void> {
    try {
      await openPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRevealOutput(path: string): Promise<void> {
    try {
      await revealPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const selectedRecipe = recipes.find((r) => r.id === selectedId) ?? null;
  const selectedSteps = selectedId ? (steps[selectedId] ?? []) : [];
  const selectedHistory = selectedId ? (history[selectedId] ?? []) : [];
  const currentOption = OPERATION_OPTIONS.find((o) => o.tag === stepKind);
  const isThisRunning = running && runningRecipeId === selectedId;

  return (
    <section className="paperu-section" aria-labelledby="recipes-heading">
      <header className="paperu-section__header">
        <h1 id="recipes-heading" className="paperu-text-display">
          Recipe Engine
        </h1>
        <p className="paperu-text-lead">
          Ordered lists of typed, validated operations. NO raw shell
          commands — every step is a typed variant. All six operations
          execute natively Rust-side: <code>Resize</code> (Lanczos3),
          <code>ConvertToFormat</code> (JPEG/PNG/<wbr />PDF),
          <code>StripExif</code>, <code>Watermark</code> (DejaVu Sans),
          <code>PlaceInOutputDir</code> (SHA-256 copy+verify, source
          never deleted), <code>VerifyOutput</code> (SHA-256). Recipes
          run unattended — the window does not need to stay open.
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
                  {selectedSteps.map((s, i) => (
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
                  ))}
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
                          color: "var(--paperu-success, #2e7d32)",
                        }}
                      >
                        native
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {/* Input files picker */}
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
              <span className="paperu-text-label">
                Input files ({inputPaths.length})
              </span>
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
                <Button variant="outline" onClick={onPickInputFiles}>
                  + Pick input files
                </Button>
                {inputPaths.length > 0 && (
                  <Button variant="ghost" onClick={onClearInputs}>
                    Clear
                  </Button>
                )}
              </div>
              {inputPaths.length > 0 && (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: "var(--paperu-space-1)",
                    maxHeight: "12rem",
                    overflowY: "auto",
                  }}
                >
                  {inputPaths.map((p, i) => (
                    <li
                      key={`${p}-${i}`}
                      className="paperu-text-code paperu-break-all"
                      style={{
                        fontSize: "var(--paperu-text-xs)",
                        display: "flex",
                        gap: "var(--paperu-space-2)",
                        alignItems: "flex-start",
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>{p}</span>
                      <button
                        type="button"
                        className="paperu-btn paperu-btn--ghost"
                        onClick={() => onRemoveInput(i)}
                        aria-label={`Remove ${basename(p)}`}
                        style={{ padding: "0 4px" }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {lastInputPaths.length > 0 && (
                <p className="paperu-text-caption">
                  Last run used {lastInputPaths.length} input file(s).
                </p>
              )}
            </div>

            {/* Run / Cancel / Repeat controls */}
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
                onClick={() => void onExecute(selectedRecipe.id, inputPaths)}
                disabled={isThisRunning || !selectedRecipe.enabled || inputPaths.length === 0}
              >
                {isThisRunning ? "Running…" : "Run recipe"}
              </Button>
              {isThisRunning && (
                <Button
                  variant="outline"
                  onClick={() => void onCancel(selectedRecipe.id)}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling…" : "Cancel run"}
                </Button>
              )}
              {!isThisRunning && lastInputPaths.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => void onRepeat(selectedRecipe.id)}
                  disabled={!selectedRecipe.enabled}
                >
                  Repeat last run
                </Button>
              )}
              {!selectedRecipe.enabled && (
                <span className="paperu-text-caption" style={{ color: "var(--paperu-warning, #b07000)" }}>
                  Recipe is disabled — enable it to run.
                </span>
              )}
              {inputPaths.length === 0 && selectedRecipe.enabled && (
                <span className="paperu-text-caption">
                  Pick input files above to enable Run.
                </span>
              )}
            </div>

            {/* Live progress */}
            {isThisRunning && progress && (
              <div
                className="paperu-text-caption paperu-text-numeric"
                role="status"
                aria-live="polite"
                style={{
                  marginTop: "var(--paperu-space-3)",
                  padding: "var(--paperu-space-2) var(--paperu-space-3)",
                  borderRadius: "var(--paperu-radius-2)",
                  background: "color-mix(in srgb, var(--paperu-accent, #2a72cc) 8%, transparent)",
                  color: "var(--paperu-text-muted, #555)",
                }}
              >
                {progress}
              </div>
            )}
            {isThisRunning && cancelError && (
              <div
                className="paperu-text-caption paperu-break-all"
                style={{
                  marginTop: "var(--paperu-space-2)",
                  color: "var(--paperu-danger, #c62828)",
                }}
              >
                Cancel failed: {cancelError}. The run continues.
              </div>
            )}

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
                <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-2)", display: "grid", gap: "var(--paperu-space-2)" }}>
                  {runResult.stepResults.map((s, i) => {
                    const badge = statusBadge(s.status);
                    const outputs = s.outputPaths ?? [];
                    return (
                      <li
                        key={s.stepId || i}
                        style={{
                          border: "1px solid var(--paperu-border-subtle)",
                          borderRadius: "var(--paperu-radius-2)",
                          padding: "var(--paperu-space-2)",
                          display: "grid",
                          gap: "var(--paperu-space-1)",
                        }}
                      >
                        <div
                          className="paperu-text-caption"
                          style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "baseline" }}
                        >
                          <span
                            className="paperu-stamp"
                            style={{
                              color: badge.tone,
                              borderColor: `color-mix(in srgb, ${badge.tone} 50%, transparent)`,
                              background: `color-mix(in srgb, ${badge.tone} 8%, transparent)`,
                            }}
                          >
                            {badge.label}
                          </span>
                          <span className="paperu-text-numeric">#{i + 1} · {s.kind}</span>
                          <span style={{ color: "var(--paperu-text-muted, #777)" }}>
                            {s.filesProcessed} file(s)
                          </span>
                        </div>
                        <div className="paperu-text-caption paperu-break-all">
                          {s.message}
                        </div>
                        {outputs.length > 0 && (
                          <ul
                            style={{
                              listStyle: "none",
                              padding: 0,
                              margin: 0,
                              display: "grid",
                              gap: "var(--paperu-space-1)",
                            }}
                          >
                            {outputs.map((p, j) => (
                              <li
                                key={`${p}-${j}`}
                                className="paperu-text-code paperu-break-all"
                                style={{
                                  display: "flex",
                                  gap: "var(--paperu-space-1)",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                  fontSize: "var(--paperu-text-xs)",
                                }}
                              >
                                <span style={{ flex: 1, minWidth: 0 }}>{p}</span>
                                <button
                                  type="button"
                                  className="paperu-btn paperu-btn--ghost"
                                  onClick={() => void onOpenOutput(p)}
                                  aria-label={`Open ${basename(p)}`}
                                  style={{ padding: "0 6px" }}
                                >
                                  Open
                                </button>
                                <button
                                  type="button"
                                  className="paperu-btn paperu-btn--ghost"
                                  onClick={() => void onRevealOutput(p)}
                                  aria-label={`Reveal ${basename(p)}`}
                                  style={{ padding: "0 6px" }}
                                >
                                  Reveal
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
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
                        <span
                          className="paperu-stamp"
                          style={{
                            color: badge.tone,
                            borderColor: `color-mix(in srgb, ${badge.tone} 50%, transparent)`,
                            background: `color-mix(in srgb, ${badge.tone} 8%, transparent)`,
                          }}
                        >
                          {badge.label}
                        </span>
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
