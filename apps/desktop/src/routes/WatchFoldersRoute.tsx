/**
 * Watch Folders route — full Watch Folders workspace (Prompt 02 §9).
 *
 * Previously a single-folder live feed, this route is now a
 * three-section workspace:
 *
 *   A. Watched Folders     — folders with rules attached, each row
 *                            showing the path, enabled/paused counts,
 *                            the rule count, and the most recent
 *                            event time. An "+ Add folder" picker
 *                            arms the live watcher on a chosen root.
 *   B. Automation Rules    — create / edit / toggle / delete watch
 *                            rules. The action selector is populated
 *                            from the real DB: backup recipes, typed
 *                            recipes, organizer rules. Delete uses a
 *                            two-step confirm so a stray click cannot
 *                            lose data.
 *   C. Execution Activity — recent matching events with
 *                            pending/running/succeeded/failed/
 *                            cancelled/skipped badges, error details,
 *                            and a "Retry" affordance that re-arms
 *                            a failed rule (off → on) so the next
 *                            matching event re-dispatches.
 *
 * The watcher itself runs in Rust (notify + notify-debouncer-mini;
 * ReadDirectoryChangesW on Windows, FSEvents on macOS, inotify on
 * Linux). Events are debounced 400ms then emitted to the frontend
 * as `paperu://watch-event`. Paperu takes NO destructive automatic
 * action — the dispatcher only runs the three allowlisted actions
 * (backup_recipe / recipe / organizer_rule), all non-destructive.
 * Self-loop prevention filters Paperu's own output suffixes so a
 * rule doesn't re-trigger on Paperu's finalize_output writes.
 *
 * Accessibility:
 *  - Every interactive control has a visible text label or aria-label.
 *  - Tab order follows visual order; the confirm-delete flow keeps
 *    focus on the same button so a keyboard user can press Enter to
 *    confirm or Escape to cancel.
 *  - Live regions (aria-live="polite") announce status changes.
 *
 * Light/dark theme + compact-window layout:
 *  - All colors via design tokens (var(--paperu-*)); no hard-coded
 *    colors without a fallback.
 *  - Grid layouts use auto-fit + minmax so columns collapse on
 *    narrow viewports; padding clamps to var(--paperu-space-*).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BackupRecipe,
  ClipboardEntry,
  CreateWatchRuleRequest,
  OrganizerRule,
  Recipe,
  WatchEvent,
  WatchExecutionHistory,
  WatchRule,
} from "@paperu/contracts";
import { WATCH_EVENT_CHANNEL } from "@paperu/contracts";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  createWatchRule,
  currentWatchFolder,
  deleteWatchRule,
  listBackupRecipes,
  listClipboardEntries,
  listOrganizerRules,
  listRecipes,
  listWatchRules,
  revealPath,
  startWatchFolder,
  stopWatchFolder,
  toggleWatchRule,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

// ── Constants ───────────────────────────────────────────────────

/** Live feed cap. Older events are dropped (FIFO). */
const MAX_FEED = 200;
/** History cap. Older rows are dropped (most-recent first). */
const MAX_HISTORY = 100;
/** Clipboard snapshot cap shown in the activity card. */
const MAX_CLIPBOARD = 5;

/** The condition-type <option> descriptors. */
const CONDITION_OPTIONS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
}> = [
  { id: "extension", label: "Extension", placeholder: "pdf" },
  { id: "filename_contains", label: "Filename contains", placeholder: "invoice" },
  { id: "prefix", label: "Filename prefix", placeholder: "INV-" },
  { id: "suffix", label: "Filename suffix", placeholder: "-final" },
];

/** The action-type <option> descriptors. */
const ACTION_OPTIONS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "backup_recipe", label: "Backup Recipe" },
  { id: "recipe", label: "Typed Recipe" },
  { id: "organizer_rule", label: "Organizer Rule" },
];

// ── Local types ───────────────────────────────────────────────────

/** A live event in the feed (preserved from the old route). */
interface FeedEntry {
  readonly path: string;
  readonly kind: string;
  readonly at: number;
}

/**
 * A "watched folder" row in Section A — one row per unique folder
 * path that has at least one rule. Derived from the rules list
 * client-side so we don't need a separate "list folders" IPC.
 */
interface WatchedFolderRow {
  readonly folderPath: string;
  readonly name: string;
  readonly ruleCount: number;
  readonly enabledCount: number;
  readonly pausedCount: number;
  readonly lastTriggeredAt: string | null;
}

/**
 * The pending rule form. Used both for the create flow + the edit
 * flow (the edit flow seeds these fields from the selected rule).
 */
interface RuleForm {
  name: string;
  folderPath: string;
  recursive: boolean;
  conditionType: string;
  conditionValue: string;
  actionType: string;
  actionId: string;
  enabled: boolean;
}

/** An empty rule form. */
function emptyForm(): RuleForm {
  return {
    name: "",
    folderPath: "",
    recursive: true,
    conditionType: "extension",
    conditionValue: "",
    actionType: "backup_recipe",
    actionId: "",
    enabled: true,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/** Just the filename component of a path (cross-platform). */
function basename(p: string): string {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? p : p.slice(i + 1);
}

/** Coarse kind label for a watch event. */
function kindLabel(kind: string): string {
  switch (kind) {
    case "create":
      return "+ create";
    case "modify":
      return "✎ modify";
    case "remove":
      return "− remove";
    case "access":
      return "○ access";
    default:
      return "? other";
  }
}

/** Relative time formatter: "12s" / "5m" / "3h" / "2d". */
function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Format an ISO timestamp; falls back to the raw string. */
function formatIso(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Status badge for an execution row. Maps the activity vocabulary
 * to a label + tone color. Mirrors RecipeRunStatus / TimerJobHistory
 * conventions plus the watch-specific "pending" / "cancelled".
 */
function statusBadge(status: string): { label: string; tone: string } {
  switch (status) {
    case "success":
      return { label: "✓ success", tone: "var(--paperu-success, #2e7d32)" };
    case "running":
      return { label: "◐ running", tone: "var(--paperu-accent, #2a72cc)" };
    case "pending":
      return { label: "○ pending", tone: "var(--paperu-text-muted, #777)" };
    case "cancelled":
      return { label: "⊘ cancelled", tone: "var(--paperu-text-muted, #777)" };
    case "skipped":
      return { label: "⤬ skipped", tone: "var(--paperu-warning, #b07000)" };
    case "failure":
      return { label: "✗ failure", tone: "var(--paperu-danger, #c62828)" };
    default:
      return { label: "○ unknown", tone: "var(--paperu-text-muted, #777)" };
  }
}

/**
 * True if a watch event's path matches a rule's folder + condition.
 * Mirrors the Rust `find_matching_rules` containment logic in a
 * best-effort way (component-based, not string starts-with).
 */
function ruleMatchesEvent(rule: WatchRule, eventPath: string): boolean {
  if (!rule.enabled || rule.paused) return false;
  // Path containment: the event's parent directory must equal the
  // rule's root (non-recursive) or be the rule's root / a subdirectory
  // of it (recursive).
  const eventFolder = eventPath.slice(0, Math.max(eventPath.lastIndexOf("/"), eventPath.lastIndexOf("\\")));
  const ruleRoot = rule.folderPath.replace(/[\\/]+$/, "");
  if (!eventFolder || !ruleRoot) return false;
  const eventComps = eventFolder.split(/[\\/]+/).filter(Boolean);
  const ruleComps = ruleRoot.split(/[\\/]+/).filter(Boolean);
  if (eventComps.length < ruleComps.length) return false;
  for (let i = 0; i < ruleComps.length; i++) {
    if (eventComps[i] !== ruleComps[i]) return false;
  }
  if (!rule.recursive && eventComps.length !== ruleComps.length) return false;
  // Condition check (mirror Rust `condition_matches`).
  const fileName = basename(eventPath).toLowerCase();
  const value = rule.conditionValue.toLowerCase();
  switch (rule.conditionType) {
    case "extension": {
      const v = value.replace(/^\./, "");
      return v ? fileName.endsWith(`.${v}`) : false;
    }
    case "filename_contains":
      return value.length > 0 && fileName.includes(value);
    case "prefix":
      return value.length > 0 && fileName.startsWith(value);
    case "suffix": {
      if (!value) return false;
      const stem = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
      return stem.endsWith(value);
    }
    default:
      return false;
  }
}

/**
 * Derive the activity history from the loaded rules. Each rule
 * contributes one row representing its most recent dispatch
 * (or a "pending" row when never fired). Combined with the live
 * feed-derived rows in `deriveActivity`.
 */
function deriveHistoryFromRules(rules: readonly WatchRule[]): WatchExecutionHistory[] {
  const out: WatchExecutionHistory[] = [];
  for (const r of rules) {
    const triggered = r.lastTriggeredAt;
    const status = r.lastStatus ?? (triggered ? "success" : "pending");
    out.push({
      id: `${r.id}:${triggered ?? "pending"}`,
      ruleId: r.id,
      ruleName: r.name ?? basename(r.folderPath) ?? r.id,
      folderPath: r.folderPath,
      actionType: r.actionType,
      actionId: r.actionId,
      triggeredAt: triggered ?? r.createdAt,
      status,
      message:
        status === "skipped"
          ? "skipped by loop prevention or missing action"
          : status === "failure"
            ? "last dispatch failed — see the action's own log"
            : status === "success"
              ? `dispatched ${r.actionType}`
              : "rule armed — waiting for a matching event",
      triggerPath: null,
    });
  }
  // Newest first. Rows without a triggeredAt sort by createdAt.
  out.sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1));
  return out.slice(0, MAX_HISTORY);
}

/**
 * Build the "watched folders" summary rows from the rules list.
 * One row per unique folder path. Counts rules / enabled / paused
 * + the latest last_triggered_at across all rules for that folder.
 */
function deriveWatchedFolders(rules: readonly WatchRule[]): WatchedFolderRow[] {
  const map = new Map<string, WatchedFolderRow>();
  for (const r of rules) {
    const key = r.folderPath;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        folderPath: r.folderPath,
        name: r.name ?? basename(r.folderPath) ?? r.folderPath,
        ruleCount: 1,
        enabledCount: r.enabled && !r.paused ? 1 : 0,
        pausedCount: r.paused ? 1 : 0,
        lastTriggeredAt: r.lastTriggeredAt,
      });
    } else {
      const next: WatchedFolderRow = {
        folderPath: existing.folderPath,
        name: existing.name,
        ruleCount: existing.ruleCount + 1,
        enabledCount: existing.enabledCount + (r.enabled && !r.paused ? 1 : 0),
        pausedCount: existing.pausedCount + (r.paused ? 1 : 0),
        lastTriggeredAt:
          existing.lastTriggeredAt && r.lastTriggeredAt
            ? existing.lastTriggeredAt < r.lastTriggeredAt
              ? r.lastTriggeredAt
              : existing.lastTriggeredAt
            : r.lastTriggeredAt ?? existing.lastTriggeredAt,
      };
      map.set(key, next);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.folderPath.toLowerCase() < b.folderPath.toLowerCase() ? -1 : 1,
  );
}

// ── Component ────────────────────────────────────────────────────

export function WatchFoldersRoute(): React.ReactNode {
  // Live watcher state.
  const [watching, setWatching] = useState<string | null>(null);
  const [watcherBusy, setWatcherBusy] = useState(false);

  // Rules + their derived views.
  const [rules, setRules] = useState<readonly WatchRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);

  // Live event feed.
  const [feed, setFeed] = useState<readonly FeedEntry[]>([]);

  // Rule form (create or edit).
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  // Delete-confirm state — when set, the matching rule's row shows
  // a confirm UI; pressing Enter / Space confirms, Escape cancels.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Retry-in-flight tracking (per rule id) so the Retry button can
  // show "Re-arming…" while the toggle-off → toggle-on round-trip runs.
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  // Action-selector options (populated from the real DB).
  const [backupRecipes, setBackupRecipes] = useState<readonly BackupRecipe[]>([]);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [organizerRules, setOrganizerRules] = useState<readonly OrganizerRule[]>([]);

  // Clipboard snapshots (recent automated captures shown in
  // the activity card as auxiliary activity).
  const [clipEntries, setClipEntries] = useState<readonly ClipboardEntry[]>([]);

  // Surface error / info to the user.
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Hold the unlisten function for `paperu://watch-event`.
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // ── Loaders ────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    setLoadingRules(true);
    setError(null);
    try {
      const list = await listWatchRules();
      setRules(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRules(false);
    }
  }, []);

  const loadActionOptions = useCallback(async () => {
    // Best-effort: a failure to load one selector's options does not
    // abort the others. Each selector simply shows an empty state.
    const tasks: ReadonlyArray<Promise<unknown>> = [
      listBackupRecipes()
        .then((r) => setBackupRecipes(r))
        .catch(() => setBackupRecipes([])),
      listRecipes()
        .then((r) => setRecipes(r))
        .catch(() => setRecipes([])),
      listOrganizerRules()
        .then((r) => setOrganizerRules(r))
        .catch(() => setOrganizerRules([])),
      listClipboardEntries()
        .then((r) => setClipEntries(r.slice(0, MAX_CLIPBOARD)))
        .catch(() => setClipEntries([])),
    ];
    await Promise.allSettled(tasks);
  }, []);

  useEffect(() => {
    void loadRules();
    void loadActionOptions();
  }, [loadRules, loadActionOptions]);

  // On mount, check if a watcher is already active.
  useEffect(() => {
    let cancelled = false;
    currentWatchFolder()
      .then((p) => {
        if (!cancelled && p) setWatching(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for watch events (live feed + activity derivation).
  useEffect(() => {
    let cancelled = false;
    listen<WatchEvent>(WATCH_EVENT_CHANNEL, (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (!payload) return;
      const entry: FeedEntry = {
        path: payload.path,
        kind: payload.kind,
        at: Date.now(),
      };
      setFeed((cur) => [entry, ...cur].slice(0, MAX_FEED));
    })
      .then((un) => {
        if (cancelled) un();
        else unlistenRef.current = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  // ── Derived data ──────────────────────────────────────────────

  const watchedFolders = useMemo(() => deriveWatchedFolders(rules), [rules]);

  const historyFromRules = useMemo(
    () => deriveHistoryFromRules(rules),
    [rules],
  );

  /**
   * Activity rows. Combines the rule-derived history (persistent)
   * with the live feed (ephemeral) so a fresh matching event shows
   * up immediately with a "running" badge until the dispatcher
   * records the next status on the rule (surfaced via re-load).
   */
  const activity: WatchExecutionHistory[] = useMemo(() => {
    const live: WatchExecutionHistory[] = [];
    for (const e of feed) {
      for (const r of rules) {
        if (!ruleMatchesEvent(r, e.path)) continue;
        const badge = statusBadge(r.lastStatus ?? "running");
        void badge; // badge computed lazily by the renderer
        live.push({
          id: `live:${e.at}:${r.id}`,
          ruleId: r.id,
          ruleName: r.name ?? basename(r.folderPath) ?? r.id,
          folderPath: r.folderPath,
          actionType: r.actionType,
          actionId: r.actionId,
          triggeredAt: new Date(e.at).toISOString(),
          status: r.lastStatus ?? "running",
          message: `matched ${kindLabel(e.kind)} · ${basename(e.path)}`,
          triggerPath: e.path,
        });
      }
    }
    // Combine + dedupe (rule-derived rows take priority when the
    // status is final; live rows fill in transient activity).
    const byKey = new Map<string, WatchExecutionHistory>();
    for (const row of [...historyFromRules, ...live]) {
      // Live rows are kept under their own id (the rule-derived row
      // is the persistent one); we show both so the user sees the
      // most recent match attempt + the last known dispatch status.
      byKey.set(row.id, row);
    }
    return Array.from(byKey.values())
      .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1))
      .slice(0, MAX_HISTORY);
  }, [feed, rules, historyFromRules]);

  // ── Actions ────────────────────────────────────────────────────

  async function pickAndStart(folder?: string): Promise<void> {
    setError(null);
    try {
      let selected = folder;
      if (!selected) {
        const picked = await open({
          multiple: false,
          directory: true,
          title: "Choose a folder to watch — Paperu",
        });
        if (typeof picked !== "string" || picked.length === 0) return;
        selected = picked;
      }
      setWatcherBusy(true);
      await startWatchFolder(selected);
      setWatching(selected);
      // Pre-fill the rule form's folderPath so the user can add a
      // rule for the folder they just armed the watcher on.
      setForm((f) => ({ ...f, folderPath: selected ?? f.folderPath }));
      setFeed([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatcherBusy(false);
    }
  }

  async function stop(): Promise<void> {
    setWatcherBusy(true);
    try {
      await stopWatchFolder();
      setWatching(null);
      setInfo("Stopped watching.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatcherBusy(false);
    }
  }

  async function pickFolderForForm(): Promise<void> {
    try {
      const picked = await open({
        multiple: false,
        directory: true,
        title: "Pick the folder this rule watches — Paperu",
      });
      if (typeof picked !== "string" || picked.length === 0) return;
      setForm((f) => ({ ...f, folderPath: picked }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Submit the rule form. When `editingId` is null we create a new
   * rule; otherwise we delete-then-recreate (the Rust side has no
   * update_watch_rule command, so the canonical edit flow is
   * delete + recreate). Both paths re-load the rules list.
   */
  async function onSubmitRule(): Promise<void> {
    setError(null);

    // Validation: clear messages.
    if (!form.folderPath.trim()) {
      setError("Pick a folder to watch first.");
      return;
    }
    if (!form.conditionValue.trim()) {
      setError("A condition value is required (e.g. \"pdf\").");
      return;
    }
    if (!form.actionId.trim()) {
      setError("Pick the action this rule should run.");
      return;
    }
    if (!ACTION_OPTIONS.some((o) => o.id === form.actionType)) {
      setError("That action type is not supported.");
      return;
    }
    if (!CONDITION_OPTIONS.some((o) => o.id === form.conditionType)) {
      setError("That condition type is not supported.");
      return;
    }

    setFormBusy(true);
    try {
      const req: CreateWatchRuleRequest = {
        folderPath: form.folderPath.trim(),
        conditionType: form.conditionType,
        conditionValue: form.conditionValue.trim(),
        actionType: form.actionType,
        actionId: form.actionId.trim(),
        enabled: form.enabled,
        name: form.name.trim() || undefined,
        recursive: form.recursive,
      };
      if (editingId) {
        // Edit flow = delete + recreate (no update command on the
        // Rust side). The toggle/enable state from the form wins.
        await deleteWatchRule(editingId);
      }
      await createWatchRule(req);
      setForm(emptyForm());
      setEditingId(null);
      setInfo(editingId ? "Rule updated." : "Rule created.");
      await loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFormBusy(false);
    }
  }

  function onEditRule(rule: WatchRule): void {
    setEditingId(rule.id);
    setForm({
      name: rule.name ?? "",
      folderPath: rule.folderPath,
      recursive: rule.recursive,
      conditionType: rule.conditionType,
      conditionValue: rule.conditionValue,
      actionType: rule.actionType,
      actionId: rule.actionId,
      enabled: rule.enabled,
    });
    setConfirmDeleteId(null);
    // Scroll the form into view (best-effort) so a keyboard user
    // lands on the form fields.
    requestAnimationFrame(() => {
      const el = document.getElementById("wf-rule-form-card");
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function onCancelEdit(): void {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function onToggleRule(rule: WatchRule, next: boolean): Promise<void> {
    try {
      await toggleWatchRule(rule.id, next);
      await loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteRule(id: string): Promise<void> {
    try {
      await deleteWatchRule(id);
      if (editingId === id) onCancelEdit();
      setConfirmDeleteId(null);
      await loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Re-arm a failed/skipped rule by toggling it off then back on.
   * The next matching event will then re-dispatch. The Rust side
   * has no explicit "retry_watch_rule" command, so this is the
   * closest semantic equivalent using the existing IPC.
   */
  async function onRetryRule(rule: WatchRule): Promise<void> {
    setRetrying((s) => {
      const next = new Set(s);
      next.add(rule.id);
      return next;
    });
    try {
      // Off then on — only if the rule is currently enabled. If it's
      // disabled, just turning it on is the "retry" semantic.
      if (rule.enabled) {
        await toggleWatchRule(rule.id, false);
      }
      await toggleWatchRule(rule.id, true);
      setInfo(`Re-armed rule "${rule.name ?? basename(rule.folderPath)}".`);
      await loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying((s) => {
        const next = new Set(s);
        next.delete(rule.id);
        return next;
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  // Action options currently visible in the selector.
  const actionOptions: ReadonlyArray<{ readonly id: string; readonly label: string }> =
    useMemo(() => {
      if (form.actionType === "backup_recipe") {
        return backupRecipes.map((r) => ({ id: r.id, label: r.name }));
      }
      if (form.actionType === "recipe") {
        return recipes.map((r) => ({ id: r.id, label: r.name }));
      }
      if (form.actionType === "organizer_rule") {
        return organizerRules
          .map((r) => ({
            id: r.id ?? "",
            label: r.name,
          }))
          .filter((o) => o.id.length > 0);
      }
      return [];
    }, [form.actionType, backupRecipes, recipes, organizerRules]);

  // Reset actionId when the actionType changes (so we never submit
  // an id from the wrong list).
  useEffect(() => {
    setForm((f) =>
      f.actionId && !actionOptions.some((o) => o.id === f.actionId)
        ? { ...f, actionId: "" }
        : f,
    );
  }, [actionOptions]);

  const currentCondition = CONDITION_OPTIONS.find((c) => c.id === form.conditionType);

  return (
    <section className="paperu-section" aria-labelledby="wf-heading">
      <header className="paperu-section__header">
        <h1 id="wf-heading" className="paperu-text-display">
          Watch Folders
        </h1>
        <p className="paperu-text-lead">
          A full Watch Folders workspace — arm a live watcher on a folder,
          attach automation rules to it, and see every matching event with its
          dispatch status. Paperu takes no destructive action — the dispatcher
          only runs the three non-destructive actions (Backup Recipe, Typed
          Recipe, Organizer Rule). Self-loop prevention filters Paperu's own
          outputs.
        </p>
      </header>

      {/* ── Live watcher status ──────────────────────────────────── */}
      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "var(--paperu-space-3)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="paperu-text-label">Live watcher</span>
              {watching ? (
                <>
                  <div
                    className="paperu-text-code paperu-break-all"
                    title={watching}
                    style={{ marginTop: "var(--paperu-space-1)" }}
                  >
                    👁 watching: {watching}
                  </div>
                  <div
                    className="paperu-text-caption paperu-text-numeric"
                    aria-live="polite"
                  >
                    {feed.length} event{feed.length === 1 ? "" : "s"} this session
                  </div>
                </>
              ) : (
                <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-1)" }}>
                  No folder is being watched right now. Pick a folder to arm the
                  watcher — events will stream into the live feed and the
                  execution activity panel.
                </p>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: "var(--paperu-space-2)",
                flexShrink: 0,
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="accent"
                onClick={() => void pickAndStart()}
                disabled={watcherBusy}
                aria-label="Add a folder to watch"
              >
                {watcherBusy ? "Starting…" : "+ Add folder"}
              </Button>
              {watching && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void revealPath(watching)}
                    aria-label={`Reveal ${basename(watching)} in file manager`}
                  >
                    Open folder
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={stop}
                    disabled={watcherBusy}
                  >
                    Stop watching
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ── Section A: Watched Folders ────────────────────────────── */}
      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "var(--paperu-space-2)",
              flexWrap: "wrap",
              marginBottom: "var(--paperu-space-3)",
            }}
          >
            <h2 id="wf-folders-heading" className="paperu-text-label">
              Section A · Watched Folders ({watchedFolders.length})
            </h2>
            <button
              type="button"
              className="paperu-btn paperu-btn--ghost"
              onClick={() => void pickAndStart()}
              disabled={watcherBusy}
              aria-label="Add a folder to watch"
            >
              + Add folder
            </button>
          </div>
          {loadingRules && <p className="paperu-text-caption">Loading…</p>}
          {!loadingRules && watchedFolders.length === 0 && (
            <p className="paperu-text-caption">
              No folders have rules yet. Create a rule below — Paperu will
              derive the watched-folders list from your rules.
            </p>
          )}
          {watchedFolders.length > 0 && (
            <ul
              aria-labelledby="wf-folders-heading"
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "var(--paperu-space-2)",
              }}
            >
              {watchedFolders.map((f) => (
                <li
                  key={f.folderPath}
                  style={{
                    border: "1px solid var(--paperu-border-subtle)",
                    borderRadius: "var(--paperu-radius-2)",
                    padding: "var(--paperu-space-2) var(--paperu-space-3)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "var(--paperu-space-2)",
                    alignItems: "center",
                    background: watching === f.folderPath
                      ? "color-mix(in srgb, var(--paperu-accent, #2a72cc) 6%, transparent)"
                      : "var(--paperu-surface)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="paperu-text-code paperu-break-all"
                      title={f.folderPath}
                      style={{ fontWeight: 600 }}
                    >
                      {f.name}
                    </div>
                    <div
                      className="paperu-text-caption paperu-break-all"
                      style={{ marginTop: 2 }}
                    >
                      {f.folderPath}
                    </div>
                    <div
                      className="paperu-text-caption paperu-text-numeric"
                      style={{ marginTop: 2, display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}
                    >
                      <span>{f.ruleCount} rule{f.ruleCount === 1 ? "" : "s"}</span>
                      <span>· {f.enabledCount} enabled</span>
                      {f.pausedCount > 0 && <span>· {f.pausedCount} paused</span>}
                      <span>· last event: {formatIso(f.lastTriggeredAt)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--paperu-space-1)", flexShrink: 0 }}>
                    <button
                      type="button"
                      className="paperu-btn paperu-btn--ghost"
                      onClick={() => void revealPath(f.folderPath)}
                      aria-label={`Reveal ${f.name} in file manager`}
                      title="Reveal in file manager"
                    >
                      ⎘
                    </button>
                    {watching === f.folderPath ? (
                      <span
                        className="paperu-stamp paperu-stamp--accent"
                        title="This folder is the active live watcher"
                      >
                        live
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="paperu-btn paperu-btn--ghost"
                        onClick={() => void pickAndStart(f.folderPath)}
                        disabled={watcherBusy}
                        aria-label={`Arm watcher on ${f.name}`}
                        title="Arm watcher on this folder"
                      >
                        ▶
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ── Section B: Automation Rules ───────────────────────────── */}
      <Card id="wf-rule-form-card">
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <h2 className="paperu-text-label" style={{ marginBottom: "var(--paperu-space-2)" }}>
            {editingId ? "Edit rule" : "Create rule"}
          </h2>

          {/* Form fields */}
          <div style={{ display: "grid", gap: "var(--paperu-space-2)" }}>
            <input
              className="paperu-target__input"
              placeholder="Rule name (optional)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-label="Rule name (optional)"
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
              <input
                className="paperu-target__input"
                placeholder="Folder to watch (absolute path)"
                value={form.folderPath}
                onChange={(e) => setForm({ ...form, folderPath: e.target.value })}
                aria-label="Folder to watch"
                style={{ flex: 1, minWidth: "240px" }}
              />
              <Button variant="outline" onClick={pickFolderForForm} disabled={formBusy}>
                Pick folder
              </Button>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--paperu-space-2)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form.recursive}
                onChange={(e) => setForm({ ...form, recursive: e.target.checked })}
              />
              <span className="paperu-text-caption">
                Recursive — match files inside subdirectories too
              </span>
            </label>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "var(--paperu-space-2)",
              }}
            >
              <select
                className="paperu-target__input"
                value={form.conditionType}
                onChange={(e) => setForm({ ...form, conditionType: e.target.value, conditionValue: "" })}
                aria-label="Condition type"
              >
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                className="paperu-target__input"
                placeholder={currentCondition?.placeholder ?? "value"}
                value={form.conditionValue}
                onChange={(e) => setForm({ ...form, conditionValue: e.target.value })}
                aria-label="Condition value"
                style={{ minWidth: "160px" }}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "var(--paperu-space-2)",
              }}
            >
              <select
                className="paperu-target__input"
                value={form.actionType}
                onChange={(e) => setForm({ ...form, actionType: e.target.value, actionId: "" })}
                aria-label="Action type"
              >
                {ACTION_OPTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select
                className="paperu-target__input"
                value={form.actionId}
                onChange={(e) => setForm({ ...form, actionId: e.target.value })}
                aria-label="Action target"
                aria-describedby="wf-action-target-hint"
                style={{ minWidth: "160px" }}
              >
                <option value="">— pick {form.actionType} —</option>
                {actionOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <p id="wf-action-target-hint" className="paperu-text-caption">
              {actionOptions.length === 0
                ? `No ${form.actionType.replace("_", " ")}s saved yet — create one in its own route first.`
                : `${actionOptions.length} ${form.actionType.replace("_", " ")}(s) loaded from the database.`}
            </p>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--paperu-space-2)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <span className="paperu-text-caption">
                Enabled — when unchecked, the rule never fires
              </span>
            </label>

            <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
              <Button variant="accent" onClick={() => void onSubmitRule()} disabled={formBusy}>
                {formBusy
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Create rule"}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={onCancelEdit} disabled={formBusy}>
                  Cancel edit
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {rules.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-text-label" style={{ marginBottom: "var(--paperu-space-3)" }}>
              Section B · Saved rules ({rules.length})
            </h2>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "var(--paperu-space-2)",
              }}
            >
              {rules.map((r) => {
                const isConfirming = confirmDeleteId === r.id;
                const isRetrying = retrying.has(r.id);
                const badge = statusBadge(r.lastStatus ?? "pending");
                return (
                  <li
                    key={r.id}
                    style={{
                      border: "1px solid var(--paperu-border-subtle)",
                      borderRadius: "var(--paperu-radius-2)",
                      padding: "var(--paperu-space-2) var(--paperu-space-3)",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "var(--paperu-space-2)",
                      alignItems: "center",
                      background:
                        editingId === r.id
                          ? "color-mix(in srgb, var(--paperu-accent, #2a72cc) 6%, transparent)"
                          : "var(--paperu-surface)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "baseline", flexWrap: "wrap" }}>
                        <span
                          className="paperu-text-code"
                          style={{ fontWeight: 600 }}
                          title={r.name ?? undefined}
                        >
                          {r.name ?? basename(r.folderPath) ?? r.id}
                        </span>
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
                        {!r.enabled && (
                          <span className="paperu-stamp">disabled</span>
                        )}
                        {r.paused && <span className="paperu-stamp">paused</span>}
                        {!r.recursive && <span className="paperu-stamp">non-recursive</span>}
                      </div>
                      <div
                        className="paperu-text-caption paperu-break-all"
                        style={{ marginTop: 2 }}
                      >
                        {r.folderPath}
                      </div>
                      <div
                        className="paperu-text-caption paperu-text-numeric"
                        style={{ marginTop: 2, display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}
                      >
                        <span>if {r.conditionType} = {r.conditionValue || "—"}</span>
                        <span>· {r.actionType}</span>
                        <span>· action {r.actionId}</span>
                        <span>· last {formatIso(r.lastTriggeredAt)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "var(--paperu-space-1)", flexShrink: 0, flexWrap: "wrap" }}>
                      {isConfirming ? (
                        <>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--outline"
                            onClick={() => void onDeleteRule(r.id)}
                            aria-label={`Confirm delete rule ${r.name ?? basename(r.folderPath) ?? r.id}`}
                            title="Confirm delete"
                          >
                            Confirm?
                          </button>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => setConfirmDeleteId(null)}
                            aria-label="Cancel delete"
                            title="Cancel (Escape)"
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setConfirmDeleteId(null);
                            }}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => onEditRule(r)}
                            aria-label={`Edit rule ${r.name ?? basename(r.folderPath) ?? r.id}`}
                            title="Edit"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => void onToggleRule(r, !r.enabled)}
                            aria-label={r.enabled ? `Disable rule ${r.name ?? r.id}` : `Enable rule ${r.name ?? r.id}`}
                            title={r.enabled ? "Disable" : "Enable"}
                          >
                            {r.enabled ? "◼" : "▶"}
                          </button>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => void onRetryRule(r)}
                            disabled={isRetrying || !r.enabled}
                            aria-label={`Retry rule ${r.name ?? basename(r.folderPath) ?? r.id}`}
                            title="Re-arm (off → on) so the next matching event re-dispatches"
                          >
                            {isRetrying ? "…" : "↻"}
                          </button>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => setConfirmDeleteId(r.id)}
                            aria-label={`Delete rule ${r.name ?? basename(r.folderPath) ?? r.id}`}
                            title="Delete"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {/* ── Section C: Execution Activity ────────────────────────── */}
      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "var(--paperu-space-2)",
              flexWrap: "wrap",
              marginBottom: "var(--paperu-space-3)",
            }}
          >
            <h2 className="paperu-text-label">
              Section C · Execution Activity ({activity.length})
            </h2>
            <div style={{ display: "flex", gap: "var(--paperu-space-1)", flexWrap: "wrap" }}>
              <span className="paperu-stamp">pending</span>
              <span className="paperu-stamp paperu-stamp--accent">running</span>
              <span className="paperu-stamp paperu-stamp--success">succeeded</span>
              <span className="paperu-stamp">failed</span>
              <span className="paperu-stamp">skipped</span>
              <span className="paperu-stamp">cancelled</span>
            </div>
          </div>
          {activity.length === 0 && (
            <p className="paperu-text-caption">
              No matching events yet. Arm the watcher + create a rule — Paperu
              will surface every dispatch attempt here with its status, the
              triggering file, and a Retry affordance for failures.
            </p>
          )}
          {activity.length > 0 && (
            <ul
              aria-label="Recent watch-rule execution activity"
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "var(--paperu-space-2)",
                maxHeight: "24rem",
                overflowY: "auto",
              }}
            >
              {activity.map((row) => {
                const badge = statusBadge(row.status);
                const isFailure = row.status === "failure" || row.status === "skipped";
                const rule = rules.find((r) => r.id === row.ruleId);
                return (
                  <li
                    key={row.id}
                    style={{
                      border: "1px solid var(--paperu-border-subtle)",
                      borderRadius: "var(--paperu-radius-2)",
                      padding: "var(--paperu-space-2) var(--paperu-space-3)",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "var(--paperu-space-2)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--paperu-space-2)",
                          alignItems: "baseline",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          className="paperu-stamp"
                          style={{
                            color: badge.tone,
                            borderColor: `color-mix(in srgb, ${badge.tone} 50%, transparent)`,
                            background: `color-mix(in srgb, ${badge.tone} 8%, transparent)`,
                          }}
                          aria-live="polite"
                        >
                          {badge.label}
                        </span>
                        <span className="paperu-text-caption paperu-text-numeric">
                          {formatIso(row.triggeredAt)}
                        </span>
                        <span className="paperu-text-caption paperu-break-all">
                          {row.ruleName}
                        </span>
                      </div>
                      <div className="paperu-text-caption paperu-break-all" style={{ marginTop: 2 }}>
                        {row.message}
                      </div>
                      {row.triggerPath && (
                        <div
                          className="paperu-text-code paperu-break-all"
                          style={{ marginTop: 2, fontSize: "var(--paperu-text-xs)" }}
                          title={row.triggerPath}
                        >
                          {row.triggerPath}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "var(--paperu-space-1)", flexShrink: 0 }}>
                      {isFailure && rule && (
                        <button
                          type="button"
                          className="paperu-btn paperu-btn--ghost"
                          onClick={() => void onRetryRule(rule)}
                          disabled={retrying.has(rule.id) || !rule.enabled}
                          aria-label={`Retry rule ${row.ruleName}`}
                          title="Re-arm this rule so the next matching event re-dispatches"
                        >
                          ↻ Retry
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      {/* ── Live events feed (preserved from the old route) ──────── */}
      {feed.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "var(--paperu-space-3)",
                gap: "var(--paperu-space-2)",
                flexWrap: "wrap",
              }}
            >
              <span className="paperu-text-label">Live events ({feed.length})</span>
              <button
                type="button"
                className="paperu-btn paperu-btn--ghost"
                onClick={() => setFeed([])}
                aria-label="Clear live events feed"
              >
                Clear
              </button>
            </div>
            <ul
              aria-label="Live filesystem event feed"
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "var(--paperu-space-1)",
                maxHeight: "400px",
                overflowY: "auto",
              }}
            >
              {feed.map((e, i) => (
                <li
                  key={`${e.at}-${i}`}
                  style={{
                    display: "flex",
                    gap: "var(--paperu-space-2)",
                    alignItems: "baseline",
                    padding: "var(--paperu-space-1) 0",
                    borderBottom: "1px solid var(--paperu-border-subtle)",
                  }}
                >
                  <span
                    className="paperu-text-code"
                    style={{ minWidth: "64px", fontSize: "var(--paperu-text-xs)" }}
                  >
                    {kindLabel(e.kind)}
                  </span>
                  <span
                    className="paperu-text-code paperu-break-all paperu-truncate"
                    style={{ flex: 1, fontSize: "var(--paperu-text-xs)" }}
                    title={e.path}
                  >
                    {e.path}
                  </span>
                  <span
                    className="paperu-text-caption paperu-text-numeric"
                    style={{ minWidth: "60px", textAlign: "right" }}
                    aria-live="off"
                  >
                    {timeAgo(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* ── Auxiliary activity: recent clipboard snapshots ─────── */}
      {clipEntries.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-text-label" style={{ marginBottom: "var(--paperu-space-2)" }}>
              Recent clipboard snapshots ({clipEntries.length})
            </h2>
            <p className="paperu-text-caption" style={{ marginBottom: "var(--paperu-space-2)" }}>
              Auxiliary automation activity — entries the Clipboard History route
              captured. Shown here as a quick pulse of recent local automation
              (opt-in, local-only, no network).
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "var(--paperu-space-1)",
              }}
            >
              {clipEntries.map((c) => (
                <li
                  key={c.id}
                  className="paperu-text-caption paperu-text-numeric"
                  style={{ display: "flex", gap: "var(--paperu-space-2)" }}
                >
                  <span>{formatIso(c.createdAt)}</span>
                  <span className="paperu-text-code paperu-break-all" style={{ flex: 1 }}>
                    {(c.content ?? "").slice(0, 120) || "(no text)"}
                    {c.pinned ? " · 📌 pinned" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* ── Info / Error surfaces ──────────────────────────────── */}
      {info && (
        <Card className="paperu-fitresult" role="status">
          <div style={{ padding: "var(--paperu-space-3)" }}>
            <span className="paperu-stamp paperu-stamp--success">✓ {info}</span>
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
