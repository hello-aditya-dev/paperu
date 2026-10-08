/**
 * Timer Jobs route — full scheduling interface (Prompt 02 §11).
 *
 * The Rust backend (`src-tauri/src/timer_jobs/scheduler.rs`) runs a
 * background thread that ticks every 30s, finds enabled jobs whose
 * `next_run` is due, claims the occurrence atomically (exactly-once
 * via `timer_job_occurrence`), dispatches the allowlisted action
 * (`backup_recipe` / `recipe` / `organizer_rule`), and writes a
 * `timer_job_history` row. The frontend never schedules anything
 * itself — it writes the job definition and reads back the runtime
 * state.
 *
 * This route provides:
 *   - A scheduler dashboard (next run in the selected TZ, last run,
 *     success/failure badge, enabled/disabled, missed-run warning).
 *   - A Create/Edit job form with visual time input, weekday
 *     selector, timezone dropdown, action selector populated from
 *     the real DB (`listRecipes` / `listBackupRecipes`), and an
 *     input-file picker shown only when `actionType === "recipe"`.
 *   - Job controls: enable/disable, edit, delete, run now, view
 *     history.
 *   - A run-result card showing the latest dispatch's status,
 *     message, parsed output counts, and actionable errors.
 *
 * Honest limitations (documented inline + in the lead paragraph):
 *   - No background daemon — Paperu must be open to dispatch.
 *   - `inputPaths` editing requires delete + recreate (the Rust
 *     `UpdateTimerRequest` has no `input_paths` field).
 *   - `organizer_rule` action type is hidden from the UI because
 *     the spec restricts the action selector to `list_recipes` +
 *     `list_backup_recipes` (no `list_organizer_rules` in the
 *     allowed IPC list).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BackupRecipe,
  ClipboardEntry,
  CreateTimerRequest,
  Recipe,
  TimerJob,
  TimerJobHistory,
  UpdateTimerRequest,
} from "@paperu/contracts";
import {
  createTimerJob,
  deleteTimerJob,
  getTimerJobHistory,
  listBackupRecipes,
  listClipboardEntries,
  listRecipes,
  listTimerJobs,
  openPath,
  revealPath,
  toggleTimerJob,
  triggerTimerJobNow,
  updateTimerJob,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

// ── Constants ───────────────────────────────────────────────────────

type ScheduleKind = "one_time" | "daily" | "weekly";
type ActionType = "backup_recipe" | "recipe";
type FormMode = "create" | "edit";

const TIMEZONES: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "UTC", label: "UTC" },
  { id: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { id: "America/New_York", label: "America/New_York (EST/EDT)" },
  { id: "Europe/London", label: "Europe/London (GMT/BST)" },
  { id: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { id: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
];

const KINDS: ReadonlyArray<{ readonly id: ScheduleKind; readonly label: string }> = [
  { id: "one_time", label: "One-time" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];

const WEEKDAYS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly short: string;
}> = [
  { id: "Mon", label: "Monday", short: "Mon" },
  { id: "Tue", label: "Tuesday", short: "Tue" },
  { id: "Wed", label: "Wednesday", short: "Wed" },
  { id: "Thu", label: "Thursday", short: "Thu" },
  { id: "Fri", label: "Friday", short: "Fri" },
  { id: "Sat", label: "Saturday", short: "Sat" },
  { id: "Sun", label: "Sunday", short: "Sun" },
];

const ACTION_TYPES: ReadonlyArray<{ readonly id: ActionType; readonly label: string }> = [
  { id: "backup_recipe", label: "Backup Recipe" },
  { id: "recipe", label: "Typed Recipe" },
];

const INPUT_FILE_FILTERS: { name: string; extensions: string[] }[] = [
  { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "ico"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "All files", extensions: ["*"] },
];

// ── Helpers ─────────────────────────────────────────────────────────

/** Just the filename component of a path (cross-platform). */
function basename(p: string): string {
  if (!p) return p;
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? p : p.slice(i + 1);
}

/**
 * Format a UTC ISO string as a wall-clock string in the given IANA
 * timezone. Returns "—" if the input is null/empty. Uses the host
 * locale's date+time format with a short offset (e.g. "Wed, Dec 25,
 * 10:00 AM GMT+5:30"). Falls back to the raw ISO if Intl cannot
 * resolve the zone.
 */
function formatInTz(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "shortOffset",
    });
    return fmt.format(dt);
  } catch {
    return iso;
  }
}

/**
 * Convert a wall-clock datetime-local string ("YYYY-MM-DDTHH:MM")
 * interpreted in the given IANA timezone to an RFC 3339 UTC ISO
 * string ("YYYY-MM-DDTHH:MM:SS.000Z").
 *
 * Used to build the scheduleExpr for one_time jobs. The user picks a
 * wall-clock time in the selected tz; we compute the UTC instant that
 * corresponds to that wall-clock and serialise as RFC 3339. Returns
 * null if the input is malformed.
 */
function wallClockToUtcIso(wallClock: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(wallClock);
  if (!m) return null;
  const Y = Number(m[1]);
  const Mo = Number(m[2]) - 1;
  const D = Number(m[3]);
  const H = Number(m[4]);
  const Mi = Number(m[5]);
  if ([Y, Mo, D, H, Mi].some((n) => Number.isNaN(n))) return null;
  // Treat the wall-clock as if it were UTC, then format in the tz —
  // the difference between the formatted wall-clock and the input
  // wall-clock is the tz offset at that instant.
  const asIfUtc = Date.UTC(Y, Mo, D, H, Mi);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(asIfUtc));
  } catch {
    return null;
  }
  const get = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value ?? "0";
    return Number(v);
  };
  let actualH = get("hour");
  if (actualH === 24) actualH = 0;
  const actualY = get("year");
  const actualMo = get("month") - 1;
  const actualD = get("day");
  const actualMi = get("minute");
  const actualAsIfUtc = Date.UTC(actualY, actualMo, actualD, actualH, actualMi);
  const offsetMs = actualAsIfUtc - asIfUtc;
  const utcMs = asIfUtc - offsetMs;
  const out = new Date(utcMs);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/**
 * Compute the next occurrence of a daily schedule (HH:MM) in the
 * given tz, on or after `from`. Returns a UTC ISO string or null.
 */
function nextDaily(hhmm: string, tz: string, from: Date = new Date()): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const H = Number(m[1]);
  const Mi = Number(m[2]);
  if (H > 23 || Mi > 59) return null;
  // Walk today + the next 2 days; the first wall-clock that's
  // strictly after `from` wins.
  for (let delta = 0; delta <= 2; delta++) {
    const candidate = new Date(from.getTime() + delta * 86400000);
    const iso = wallClockToUtcIso(
      `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}T${String(H).padStart(2, "0")}:${String(Mi).padStart(2, "0")}`,
      tz,
    );
    if (iso && new Date(iso).getTime() > from.getTime()) return iso;
  }
  return null;
}

/**
 * Compute the next occurrence of a weekly schedule (Weekday HH:MM)
 * in the given tz, on or after `from`. Returns a UTC ISO string or null.
 */
function nextWeekly(weekday: string, hhmm: string, tz: string, from: Date = new Date()): string | null {
  const wd = WEEKDAYS.find((w) => w.id === weekday);
  if (!wd) return null;
  // Walk the next 14 days; the first whose weekday matches + whose
  // wall-clock is strictly after `from` wins.
  for (let delta = 0; delta <= 14; delta++) {
    const candidate = new Date(from.getTime() + delta * 86400000);
    // Format the candidate's weekday in the tz (so DST boundaries
    // don't trip us up).
    let candidateWd: string;
    try {
      candidateWd = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
      }).format(candidate);
    } catch {
      const idx = candidate.getDay() === 0 ? 6 : candidate.getDay() - 1;
      candidateWd = WEEKDAYS[idx]?.id ?? "Mon";
    }
    if (candidateWd !== wd.id) continue;
    const iso = wallClockToUtcIso(
      `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}T${hhmm}`,
      tz,
    );
    if (iso && new Date(iso).getTime() > from.getTime()) return iso;
  }
  return null;
}

/** Build a schedule expression from the form state. */
function buildScheduleExpr(
  kind: ScheduleKind,
  oneTimeLocal: string,
  dailyTime: string,
  weeklyWeekday: string,
  weeklyTime: string,
): string {
  switch (kind) {
    case "one_time":
      return oneTimeLocal;
    case "daily":
      return dailyTime;
    case "weekly":
      return `${weeklyWeekday} ${weeklyTime}`;
  }
}

/**
 * Compute a UTC ISO preview of the next run for the form's current
 * schedule + tz. Used to show the user "Next: Wed 09:30 IST" before
 * they save. Returns null if the form state is incomplete/invalid.
 */
function previewNextRun(
  kind: ScheduleKind,
  expr: string,
  tz: string,
): string | null {
  switch (kind) {
    case "one_time": {
      // expr is the raw datetime-local string; convert to UTC ISO.
      return wallClockToUtcIso(expr, tz);
    }
    case "daily": {
      // expr is "HH:MM".
      return nextDaily(expr, tz);
    }
    case "weekly": {
      const m = /^(\S+)\s+(\d{1,2}:\d{2})$/.exec(expr.trim());
      if (!m || !m[1] || !m[2]) return null;
      return nextWeekly(m[1], m[2], tz);
    }
  }
}

/** Colored status badge for a history row's `status` field. */
function statusBadge(status: string): { label: string; tone: string } {
  switch (status) {
    case "success":
      return { label: "✓ success", tone: "var(--paperu-success, #2e7d32)" };
    case "failure":
      return { label: "✗ failure", tone: "var(--paperu-danger, #c62828)" };
    case "skipped":
      return { label: "○ skipped", tone: "var(--paperu-text-muted, #777)" };
    default:
      return { label: status, tone: "var(--paperu-text-muted, #777)" };
  }
}

/**
 * Best-effort parse of an output count from a dispatch message.
 * The Rust dispatcher emits messages like "backed up 3 files",
 * "3 succeeded, 1 failed", "organized 5 files", "recipe success:
 * 3 steps executed". We extract the first integer we find (the
 * count of succeeded files / steps). Returns null when no count
 * can be parsed (e.g. a free-form error message).
 */
function parseOutputCount(message: string): number | null {
  const m = /\b(\d+)\b/.exec(message);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Suggest an actionable hint based on a failure message. Returns
 * null when no specific hint applies (the user just sees the raw
 * error message).
 */
function actionableHint(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("no longer exists")) {
    return "The referenced action was deleted. Edit this job and pick a different action, or delete the job.";
  }
  if (lower.includes("permission denied") || lower.includes("access denied")) {
    return "Paperu lacks filesystem permission for one of the paths. Check the destination folder's permissions.";
  }
  if (lower.includes("disk full") || lower.includes("no space")) {
    return "The destination volume is full. Free up space or change the action's destination.";
  }
  if (lower.includes("not found") || lower.includes("missing")) {
    return "One of the input files is gone. Re-pick the inputs (Edit → delete + recreate to change input paths).";
  }
  return null;
}

/** Format an ISO duration between startedAt + finishedAt as e.g. "1.2s". */
function formatDuration(startedAt: string, finishedAt: string): string {
  try {
    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  } catch {
    return "";
  }
}

/** Format a UTC ISO as a relative "Xh ago" / "Xm ago" string. */
function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const diffMs = Date.now() - t;
    if (diffMs < 0) return "in the future";
    if (diffMs < 60_000) return "just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}

// ── Form state ──────────────────────────────────────────────────────

interface FormState {
  readonly mode: FormMode;
  readonly editingId: string | null;
  readonly name: string;
  readonly kind: ScheduleKind;
  /** datetime-local string ("YYYY-MM-DDTHH:MM") for one_time. */
  readonly oneTimeLocal: string;
  /** "HH:MM" for daily. */
  readonly dailyTime: string;
  /** weekday id ("Mon".."Sun") for weekly. */
  readonly weeklyWeekday: string;
  /** "HH:MM" for weekly. */
  readonly weeklyTime: string;
  readonly timezone: string;
  readonly actionType: ActionType;
  readonly actionId: string;
  readonly inputPaths: readonly string[];
  /** True when the user is mid-way through picking files. */
  readonly enabled: boolean;
}

const EMPTY_FORM: FormState = {
  mode: "create",
  editingId: null,
  name: "",
  kind: "daily",
  oneTimeLocal: "",
  dailyTime: "09:00",
  weeklyWeekday: "Mon",
  weeklyTime: "09:00",
  timezone: "UTC",
  actionType: "backup_recipe",
  actionId: "",
  inputPaths: [],
  enabled: true,
};

// ── Component ───────────────────────────────────────────────────────

export function TimerJobsRoute(): React.ReactNode {
  const [jobs, setJobs] = useState<readonly TimerJob[]>([]);
  const [history, setHistory] = useState<Record<string, readonly TimerJobHistory[]>>({});
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [backupRecipes, setBackupRecipes] = useState<readonly BackupRecipe[]>([]);
  const [clipboardEntries, setClipboardEntries] = useState<readonly ClipboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  /** Latest "Run now" result, keyed by job id. */
  const [runResult, setRunResult] = useState<{
    readonly jobId: string;
    readonly status: string;
    readonly message: string;
    readonly finishedAt: string;
  } | null>(null);
  /** Id of the job currently being run via "Run now" (UI busy state). */
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, recs, brecs, clips] = await Promise.all([
        listTimerJobs(),
        listRecipes().catch(() => [] as readonly Recipe[]),
        listBackupRecipes().catch(() => [] as readonly BackupRecipe[]),
        listClipboardEntries().catch(() => [] as readonly ClipboardEntry[]),
      ]);
      setJobs(list);
      setRecipes(recs);
      setBackupRecipes(brecs);
      setClipboardEntries(clips);
      const histEntries = await Promise.all(
        list.map(async (j) => [j.id, (await getTimerJobHistory(j.id, 10))] as const),
      );
      const histMap: Record<string, readonly TimerJobHistory[]> = {};
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
    // Refresh every 30s to surface scheduler progress (the Rust
    // background thread fires independently of this UI; we just
    // re-read the latest state).
    const id = setInterval(() => {
      void load();
    }, 30000);
    return () => clearInterval(id);
  }, [load]);

  // ── Form helpers ──

  function patchForm(p: Partial<FormState>): void {
    setForm((cur) => ({ ...cur, ...p }));
  }

  function resetForm(): void {
    setForm(EMPTY_FORM);
  }

  function startEdit(job: TimerJob): void {
    // Parse the existing schedule expression into the form fields.
    const kind = ((): ScheduleKind => {
      if (job.scheduleKind === "one_time" || job.scheduleKind === "daily" || job.scheduleKind === "weekly") {
        return job.scheduleKind;
      }
      return "daily";
    })();
    let oneTimeLocal = "";
    let dailyTime = "09:00";
    let weeklyWeekday = "Mon";
    let weeklyTime = "09:00";
    if (kind === "one_time") {
      // Convert the stored UTC ISO back to a datetime-local string
      // in the job's tz (so the user sees the wall-clock they
      // originally entered, modulo DST drift).
      try {
        const dt = new Date(job.nextRun ?? job.scheduleExpr);
        if (!Number.isNaN(dt.getTime())) {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: job.timezone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).formatToParts(dt);
          const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
          oneTimeLocal = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
        }
      } catch {
        // Fall back to the raw expr.
        oneTimeLocal = job.scheduleExpr;
      }
    } else if (kind === "daily") {
      dailyTime = job.scheduleExpr;
    } else if (kind === "weekly") {
      const m = /^(\S+)\s+(\d{1,2}:\d{2})$/.exec(job.scheduleExpr.trim());
      if (m && m[1] && m[2]) {
        weeklyWeekday = m[1];
        weeklyTime = m[2];
      }
    }
    setForm({
      mode: "edit",
      editingId: job.id,
      name: job.name,
      kind,
      oneTimeLocal,
      dailyTime,
      weeklyWeekday,
      weeklyTime,
      timezone: job.timezone,
      actionType: job.actionType === "recipe" ? "recipe" : "backup_recipe",
      actionId: job.actionId,
      inputPaths: job.inputPaths ? [...job.inputPaths] : [],
      enabled: job.enabled,
    });
  }

  // ── Mutations ──

  async function onSave(): Promise<void> {
    if (!form.name.trim()) {
      setError("Timer name is required.");
      return;
    }
    if (!form.actionId.trim()) {
      setError("Pick a target action (backup recipe or typed recipe) before saving.");
      return;
    }
    const expr = buildScheduleExpr(
      form.kind,
      form.oneTimeLocal,
      form.dailyTime,
      form.weeklyWeekday,
      form.weeklyTime,
    );
    if (form.kind === "one_time" && !form.oneTimeLocal) {
      setError("Pick a date+time for the one-time schedule.");
      return;
    }
    if (form.kind === "daily" && !form.dailyTime) {
      setError("Pick a time for the daily schedule.");
      return;
    }
    if (form.kind === "weekly" && (!form.weeklyWeekday || !form.weeklyTime)) {
      setError("Pick a weekday + time for the weekly schedule.");
      return;
    }
    // Convert the one_time expression to a UTC ISO. Daily/weekly
    // expressions stay as wall-clock strings; the Rust side
    // resolves them against the timezone.
    const scheduleExpr =
      form.kind === "one_time" ? (wallClockToUtcIso(expr, form.timezone) ?? expr) : expr;
    try {
      if (form.mode === "create") {
        const req: CreateTimerRequest = {
          name: form.name.trim(),
          scheduleKind: form.kind,
          scheduleExpr,
          actionType: form.actionType,
          actionId: form.actionId,
          timezone: form.timezone,
          enabled: form.enabled,
          inputPaths: form.actionType === "recipe" && form.inputPaths.length > 0 ? form.inputPaths : null,
        };
        await createTimerJob(req);
      } else if (form.editingId) {
        const req: UpdateTimerRequest = {
          id: form.editingId,
          name: form.name.trim(),
          scheduleKind: form.kind,
          scheduleExpr,
          actionType: form.actionType,
          actionId: form.actionId,
          timezone: form.timezone,
          enabled: form.enabled,
        };
        await updateTimerJob(req);
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDelete(id: string): Promise<void> {
    try {
      await deleteTimerJob(id);
      if (form.editingId === id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onToggle(id: string, enabled: boolean): Promise<void> {
    try {
      await toggleTimerJob(id, enabled);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRunNow(job: TimerJob): Promise<void> {
    setRunningJobId(job.id);
    setError(null);
    try {
      const updated = await triggerTimerJobNow(job.id);
      // Read the latest history row for this job to surface the
      // dispatch result. The Rust side writes the row synchronously
      // before trigger_timer_job_now returns, so the first history
      // entry after the call IS this run's result.
      const hist = await getTimerJobHistory(job.id, 1);
      const latest = hist[0];
      if (latest) {
        setRunResult({
          jobId: job.id,
          status: latest.status,
          message: latest.message ?? "",
          finishedAt: latest.finishedAt,
        });
      } else {
        // No history row yet — the job may be disabled or the
        // schedule may be invalid. Surface whatever the Rust side
        // returned (lastError if any).
        setRunResult({
          jobId: job.id,
          status: updated.lastError ? "failure" : "skipped",
          message: updated.lastError ?? "No history row was written. Check the schedule + action.",
          finishedAt: updated.lastRun ?? new Date().toISOString(),
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningJobId(null);
    }
  }

  async function onPickInputFiles(): Promise<void> {
    try {
      const sel = await open({
        multiple: true,
        directory: false,
        title: "Pick input files for the recipe — Paperu",
        filters: INPUT_FILE_FILTERS,
      });
      const picked = Array.isArray(sel)
        ? sel
        : typeof sel === "string"
          ? [sel]
          : [];
      if (picked.length === 0) return;
      patchForm({
        inputPaths: mergeDedupe(form.inputPaths, picked),
      });
    } catch {
      /* dismissed */
    }
  }

  function onRemoveInput(i: number): void {
    patchForm({ inputPaths: form.inputPaths.filter((_, idx) => idx !== i) });
  }

  function onClearInputs(): void {
    patchForm({ inputPaths: [] });
  }

  function onAddInputFromClipboard(entry: ClipboardEntry): void {
    if (!entry.filePath) return;
    patchForm({
      inputPaths: mergeDedupe(form.inputPaths, [entry.filePath]),
    });
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

  // ── Derived state ──

  const actionOptions = useMemo<readonly { id: string; label: string }[]>(() => {
    if (form.actionType === "recipe") {
      return recipes.map((r) => ({ id: r.id, label: r.name }));
    }
    return backupRecipes.map((r) => ({ id: r.id, label: r.name }));
  }, [form.actionType, recipes, backupRecipes]);

  const clipboardFileEntries = useMemo(
    () => clipboardEntries.filter((e) => e.filePath).slice(0, 5),
    [clipboardEntries],
  );

  const scheduleExprPreview = buildScheduleExpr(
    form.kind,
    form.oneTimeLocal,
    form.dailyTime,
    form.weeklyWeekday,
    form.weeklyTime,
  );
  const nextRunPreview = useMemo(() => {
    if (form.kind === "one_time" && !form.oneTimeLocal) return null;
    return previewNextRun(form.kind, scheduleExprPreview, form.timezone);
  }, [form.kind, form.oneTimeLocal, scheduleExprPreview, form.timezone]);

  const isFormValid =
    form.name.trim().length > 0 &&
    form.actionId.length > 0 &&
    (form.kind !== "one_time" || form.oneTimeLocal.length > 0);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) => {
        // Overdue + enabled first, then by nextRun asc, then by name.
        const now = Date.now();
        const aOverdue = a.enabled && a.nextRun && new Date(a.nextRun).getTime() < now ? 0 : 1;
        const bOverdue = b.enabled && b.nextRun && new Date(b.nextRun).getTime() < now ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        const aNext = a.nextRun ? new Date(a.nextRun).getTime() : Number.POSITIVE_INFINITY;
        const bNext = b.nextRun ? new Date(b.nextRun).getTime() : Number.POSITIVE_INFINITY;
        if (aNext !== bNext) return aNext - bNext;
        return a.name.localeCompare(b.name);
      }),
    [jobs],
  );

  // ── Render ──

  return (
    <section className="paperu-section" aria-labelledby="timer-heading">
      <header className="paperu-section__header">
        <h1 id="timer-heading" className="paperu-text-display">
          Timer Jobs
        </h1>
        <p className="paperu-text-lead">
          Rust-owned scheduling — Paperu dispatches due jobs every 30s in a
          background thread, independent of whether this page is open. Backups
          are SHA-256 verified. Missed runs while Paperu was closed fire on the
          next launch. Honest limit: no background daemon — Paperu must be open
          to dispatch.
        </p>
      </header>

      {/* ── Job editor (create / edit) ── */}
      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "var(--paperu-space-3)",
              flexWrap: "wrap",
            }}
          >
            <span className="paperu-text-label">
              {form.mode === "create" ? "New timer job" : "Edit timer job"}
            </span>
            {form.mode === "edit" && (
              <button
                type="button"
                className="paperu-btn paperu-btn--ghost"
                onClick={resetForm}
                aria-label="Cancel edit"
              >
                ← Back to create
              </button>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gap: "var(--paperu-space-3)",
              marginTop: "var(--paperu-space-3)",
            }}
          >
            {/* Name */}
            <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
              <span className="paperu-text-caption">Name</span>
              <input
                className="paperu-target__input"
                placeholder="e.g. Nightly photo backup"
                value={form.name}
                onChange={(e) => patchForm({ name: e.target.value })}
                aria-label="Timer name"
              />
            </label>

            {/* Schedule kind + visual time input */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "var(--paperu-space-2)",
              }}
            >
              <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
                <span className="paperu-text-caption">Schedule kind</span>
                <select
                  className="paperu-target__input"
                  value={form.kind}
                  onChange={(e) => patchForm({ kind: e.target.value as ScheduleKind })}
                  aria-label="Schedule kind"
                >
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.kind === "one_time" && (
                <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
                  <span className="paperu-text-caption">
                    Date+time (in {form.timezone})
                  </span>
                  <input
                    className="paperu-target__input"
                    type="datetime-local"
                    value={form.oneTimeLocal}
                    onChange={(e) => patchForm({ oneTimeLocal: e.target.value })}
                    aria-label="One-time date and time"
                  />
                </label>
              )}
              {form.kind === "daily" && (
                <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
                  <span className="paperu-text-caption">Time (in {form.timezone})</span>
                  <input
                    className="paperu-target__input"
                    type="time"
                    value={form.dailyTime}
                    onChange={(e) => patchForm({ dailyTime: e.target.value })}
                    aria-label="Daily time"
                  />
                </label>
              )}
              {form.kind === "weekly" && (
                <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
                  <span className="paperu-text-caption">Time (in {form.timezone})</span>
                  <input
                    className="paperu-target__input"
                    type="time"
                    value={form.weeklyTime}
                    onChange={(e) => patchForm({ weeklyTime: e.target.value })}
                    aria-label="Weekly time"
                  />
                </label>
              )}
            </div>

            {/* Weekday selector (weekly only) */}
            {form.kind === "weekly" && (
              <fieldset
                style={{
                  border: "1px solid var(--paperu-border, #ccc)",
                  borderRadius: "var(--paperu-radius-md, 6px)",
                  padding: "var(--paperu-space-2)",
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "var(--paperu-space-1)",
                }}
              >
                <legend className="paperu-text-caption">Weekday</legend>
                {WEEKDAYS.map((w) => {
                  const active = form.weeklyWeekday === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      className="paperu-btn paperu-btn--ghost"
                      aria-pressed={active}
                      onClick={() => patchForm({ weeklyWeekday: w.id })}
                      style={{
                        padding: "var(--paperu-space-2)",
                        fontSize: "var(--paperu-text-xs)",
                        background: active
                          ? "color-mix(in srgb, var(--paperu-accent, #2a72cc) 12%, transparent)"
                          : "transparent",
                        borderColor: active
                          ? "var(--paperu-accent, #2a72cc)"
                          : "var(--paperu-border, #ccc)",
                        color: active
                          ? "var(--paperu-accent, #2a72cc)"
                          : "var(--paperu-text, #333)",
                      }}
                    >
                      {w.short}
                    </button>
                  );
                })}
              </fieldset>
            )}

            {/* Timezone selector */}
            <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
              <span className="paperu-text-caption">Timezone</span>
              <select
                className="paperu-target__input"
                value={form.timezone}
                onChange={(e) => patchForm({ timezone: e.target.value })}
                aria-label="Timezone"
              >
                {TIMEZONES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Action type + action selector */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 2fr",
                gap: "var(--paperu-space-2)",
              }}
            >
              <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
                <span className="paperu-text-caption">Action type</span>
                <select
                  className="paperu-target__input"
                  value={form.actionType}
                  onChange={(e) =>
                    patchForm({
                      actionType: e.target.value as ActionType,
                      actionId: "",
                      inputPaths: [],
                    })
                  }
                  aria-label="Action type"
                >
                  {ACTION_TYPES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: "var(--paperu-space-1)" }}>
                <span className="paperu-text-caption">
                  Target {form.actionType === "recipe" ? "recipe" : "backup recipe"}
                </span>
                <select
                  className="paperu-target__input"
                  value={form.actionId}
                  onChange={(e) => patchForm({ actionId: e.target.value })}
                  aria-label={`Target ${form.actionType === "recipe" ? "recipe" : "backup recipe"}`}
                >
                  <option value="">
                    {actionOptions.length === 0
                      ? form.actionType === "recipe"
                        ? "No recipes — create one in Recipe Engine first"
                        : "No backup recipes — create one in Backup Recipes first"
                      : "Pick…"}
                  </option>
                  {actionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Input file picker (recipe only) */}
            {form.actionType === "recipe" && (
              <div
                style={{
                  border: "1px dashed var(--paperu-border-subtle, #ccc)",
                  borderRadius: "var(--paperu-radius-md, 6px)",
                  padding: "var(--paperu-space-3)",
                  display: "grid",
                  gap: "var(--paperu-space-2)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "var(--paperu-space-2)",
                    flexWrap: "wrap",
                  }}
                >
                  <span className="paperu-text-caption">
                    Input files ({form.inputPaths.length})
                  </span>
                  {form.mode === "edit" && (
                    <span
                      className="paperu-text-caption"
                      style={{ color: "var(--paperu-warning, #b07000)" }}
                    >
                      Input paths are immutable on edit — delete + recreate to
                      change them.
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "var(--paperu-space-2)",
                    flexWrap: "wrap",
                  }}
                >
                  {form.mode === "create" && (
                    <Button variant="outline" onClick={onPickInputFiles}>
                      + Pick input files
                    </Button>
                  )}
                  {form.mode === "create" && form.inputPaths.length > 0 && (
                    <Button variant="ghost" onClick={onClearInputs}>
                      Clear
                    </Button>
                  )}
                </div>
                {form.inputPaths.length > 0 && (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "grid",
                      gap: "var(--paperu-space-1)",
                      maxHeight: "10rem",
                      overflowY: "auto",
                    }}
                  >
                    {form.inputPaths.map((p, i) => (
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
                        {form.mode === "create" && (
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => onRemoveInput(i)}
                            aria-label={`Remove ${basename(p)}`}
                            style={{ padding: "0 4px" }}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/* Quick-pick recent clipboard file paths (create only). */}
                {form.mode === "create" && clipboardFileEntries.length > 0 && (
                  <details>
                    <summary className="paperu-text-caption">
                      Recent clipboard files ({clipboardFileEntries.length})
                    </summary>
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        marginTop: "var(--paperu-space-2)",
                        display: "grid",
                        gap: "var(--paperu-space-1)",
                      }}
                    >
                      {clipboardFileEntries.map((e) => (
                        <li
                          key={e.id}
                          className="paperu-text-code paperu-break-all"
                          style={{
                            fontSize: "var(--paperu-text-xs)",
                            display: "flex",
                            gap: "var(--paperu-space-2)",
                            alignItems: "center",
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {e.filePath}
                          </span>
                          <button
                            type="button"
                            className="paperu-btn paperu-btn--ghost"
                            onClick={() => onAddInputFromClipboard(e)}
                            aria-label={`Add ${basename(e.filePath ?? "")} to input files`}
                            style={{ padding: "0 6px" }}
                          >
                            +
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* Next-run preview */}
            <div
              style={{
                padding: "var(--paperu-space-2) var(--paperu-space-3)",
                borderRadius: "var(--paperu-radius-md, 6px)",
                background:
                  nextRunPreview
                    ? "color-mix(in srgb, var(--paperu-accent, #2a72cc) 8%, transparent)"
                    : "var(--paperu-surface-muted, rgba(0,0,0,0.03))",
                color: "var(--paperu-text-muted, #555)",
              }}
              aria-live="polite"
            >
              <span className="paperu-text-caption">
                Next run preview:{" "}
                {nextRunPreview ? (
                  <strong className="paperu-text-numeric">
                    {formatInTz(nextRunPreview, form.timezone)}
                  </strong>
                ) : (
                  <span>pick a valid schedule to see the next run</span>
                )}
              </span>
            </div>

            {/* Enabled toggle (create only — edit toggles live in the dashboard). */}
            {form.mode === "create" && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--paperu-space-2)",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => patchForm({ enabled: e.target.checked })}
                  aria-label="Enabled on create"
                />
                <span className="paperu-text-caption">
                  Enable on create (scheduler will start ticking immediately)
                </span>
              </label>
            )}

            {/* Save / Cancel */}
            <div
              style={{
                display: "flex",
                gap: "var(--paperu-space-2)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="accent"
                onClick={onSave}
                disabled={!isFormValid}
              >
                {form.mode === "create" ? "Create timer" : "Save changes"}
              </Button>
              {form.mode === "edit" && (
                <Button variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ── Dashboard ── */}
      {sortedJobs.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: "var(--paperu-space-3)",
                flexWrap: "wrap",
              }}
            >
              <span className="paperu-text-label">
                Scheduled jobs ({sortedJobs.length})
              </span>
              <button
                type="button"
                className="paperu-btn paperu-btn--ghost"
                onClick={() => void load()}
                aria-label="Refresh jobs"
                style={{ fontSize: "var(--paperu-text-xs)" }}
              >
                ↻ Refresh
              </button>
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                marginTop: "var(--paperu-space-3)",
                display: "grid",
                gap: "var(--paperu-space-3)",
              }}
            >
              {sortedJobs.map((job) => {
                const hist = history[job.id] ?? [];
                const latest = hist[0];
                const now = Date.now();
                const nextMs = job.nextRun ? new Date(job.nextRun).getTime() : null;
                const overdue =
                  job.enabled && nextMs !== null && nextMs < now;
                const lastMs = job.lastRun ? new Date(job.lastRun).getTime() : null;
                const lastAgo = lastMs !== null ? formatAgo(job.lastRun) : "";
                const badge = latest ? statusBadge(latest.status) : null;
                return (
                  <li
                    key={job.id}
                    style={{
                      border: "1px solid var(--paperu-border-subtle, #e0e0e0)",
                      borderRadius: "var(--paperu-radius-md, 6px)",
                      padding: "var(--paperu-space-3)",
                      background: overdue
                        ? "color-mix(in srgb, var(--paperu-warning, #b07000) 4%, transparent)"
                        : "transparent",
                    }}
                  >
                    {/* Header: name + status */}
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
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--paperu-space-2)",
                            flexWrap: "wrap",
                          }}
                        >
                          <strong className="paperu-text-numeric">{job.name}</strong>
                          {badge && (
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
                          )}
                          <span
                            className="paperu-stamp"
                            style={{
                              color: job.enabled
                                ? "var(--paperu-success, #2e7d32)"
                                : "var(--paperu-text-muted, #777)",
                              borderColor: job.enabled
                                ? "color-mix(in srgb, var(--paperu-success, #2e7d32) 50%, transparent)"
                                : "var(--paperu-border, #ccc)",
                              background: job.enabled
                                ? "color-mix(in srgb, var(--paperu-success, #2e7d32) 8%, transparent)"
                                : "transparent",
                            }}
                          >
                            {job.enabled ? "enabled" : "disabled"}
                          </span>
                        </div>
                        <div
                          className="paperu-text-caption"
                          style={{ marginTop: "var(--paperu-space-1)" }}
                        >
                          {KINDS.find((k) => k.id === job.scheduleKind)?.label ??
                            job.scheduleKind}{" "}
                          · {job.scheduleExpr} · {job.timezone} ·{" "}
                          {ACTION_TYPES.find((a) => a.id === job.actionType)?.label ??
                            job.actionType}
                        </div>
                      </div>
                      {/* Controls */}
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--paperu-space-2)",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <Button
                          variant="outline"
                          onClick={() => void onRunNow(job)}
                          disabled={runningJobId === job.id || !job.enabled}
                          aria-label={`Run ${job.name} now`}
                        >
                          {runningJobId === job.id ? "Running…" : "Run now"}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => startEdit(job)}
                          aria-label={`Edit ${job.name}`}
                        >
                          Edit
                        </Button>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--paperu-space-1)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={job.enabled}
                            onChange={(e) => void onToggle(job.id, e.target.checked)}
                            aria-label={`Toggle enabled for ${job.name}`}
                          />
                          <span className="paperu-text-caption">
                            {job.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="paperu-btn paperu-btn--ghost"
                          onClick={() => void onDelete(job.id)}
                          aria-label={`Delete ${job.name}`}
                          style={{ padding: "0 6px" }}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Schedule + last-run info */}
                    <dl
                      style={{
                        margin: "var(--paperu-space-3) 0 0",
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: "var(--paperu-space-2)",
                        fontSize: "var(--paperu-text-xs)",
                      }}
                    >
                      <div>
                        <dt
                          className="paperu-text-caption"
                          style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
                        >
                          Next run
                        </dt>
                        <dd
                          className="paperu-text-numeric"
                          style={{ margin: 0, color: "var(--paperu-text, #333)" }}
                        >
                          {formatInTz(job.nextRun, job.timezone)}
                        </dd>
                      </div>
                      <div>
                        <dt
                          className="paperu-text-caption"
                          style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
                        >
                          Last run
                        </dt>
                        <dd
                          className="paperu-text-numeric"
                          style={{ margin: 0, color: "var(--paperu-text, #333)" }}
                        >
                          {formatInTz(job.lastRun, job.timezone)}
                          {lastAgo ? ` (${lastAgo})` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt
                          className="paperu-text-caption"
                          style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
                        >
                          Action
                        </dt>
                        <dd
                          className="paperu-text-code paperu-break-all"
                          style={{ margin: 0 }}
                        >
                          {describeActionId(
                            job.actionId,
                            job.actionType === "recipe" ? recipes : backupRecipes,
                          )}
                          {" · "}
                          <span style={{ color: "var(--paperu-text-muted, #777)" }}>
                            {job.actionId}
                          </span>
                        </dd>
                      </div>
                    </dl>

                    {/* Missed-run warning */}
                    {overdue && (
                      <div
                        className="paperu-text-caption paperu-break-all"
                        role="status"
                        style={{
                          marginTop: "var(--paperu-space-2)",
                          padding: "var(--paperu-space-2) var(--paperu-space-3)",
                          borderRadius: "var(--paperu-radius-md, 6px)",
                          background:
                            "color-mix(in srgb, var(--paperu-warning, #b07000) 10%, transparent)",
                          color: "var(--paperu-warning, #b07000)",
                        }}
                      >
                        ⚠ Missed run — the scheduler should fire on the next
                        tick (≤ 30s). If it doesn't, check that Paperu is open
                        and the action's target still exists.
                      </div>
                    )}

                    {/* Last error */}
                    {job.lastError && (
                      <div
                        className="paperu-text-caption paperu-break-all"
                        style={{
                          marginTop: "var(--paperu-space-2)",
                          color: "var(--paperu-danger, #c62828)",
                        }}
                      >
                        Last error: {job.lastError}
                        {actionableHint(job.lastError) && (
                          <span
                            style={{ display: "block", marginTop: "var(--paperu-space-1)" }}
                          >
                            → {actionableHint(job.lastError)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Input paths (recipe only) */}
                    {job.actionType === "recipe" &&
                      job.inputPaths &&
                      job.inputPaths.length > 0 && (
                        <details style={{ marginTop: "var(--paperu-space-2)" }}>
                          <summary className="paperu-text-caption">
                            Input files ({job.inputPaths.length})
                          </summary>
                          <ul
                            style={{
                              listStyle: "none",
                              padding: 0,
                              marginTop: "var(--paperu-space-2)",
                              display: "grid",
                              gap: "var(--paperu-space-1)",
                            }}
                          >
                            {job.inputPaths.map((p, i) => (
                              <li
                                key={`${p}-${i}`}
                                className="paperu-text-code paperu-break-all"
                                style={{
                                  fontSize: "var(--paperu-text-xs)",
                                  display: "flex",
                                  gap: "var(--paperu-space-1)",
                                  alignItems: "center",
                                  flexWrap: "wrap",
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
                        </details>
                      )}

                    {/* Run result (latest dispatch) */}
                    {runResult && runResult.jobId === job.id && (
                      <div
                        style={{
                          marginTop: "var(--paperu-space-3)",
                          border: "1px solid var(--paperu-border-subtle, #e0e0e0)",
                          borderRadius: "var(--paperu-radius-md, 6px)",
                          padding: "var(--paperu-space-3)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: "var(--paperu-space-2)",
                            alignItems: "baseline",
                            flexWrap: "wrap",
                          }}
                        >
                          <span className="paperu-text-label">
                            Last "Run now" result:
                          </span>
                          {(() => {
                            const r = statusBadge(runResult.status);
                            return (
                              <span
                                className="paperu-stamp"
                                style={{
                                  color: r.tone,
                                  borderColor: `color-mix(in srgb, ${r.tone} 50%, transparent)`,
                                  background: `color-mix(in srgb, ${r.tone} 8%, transparent)`,
                                }}
                              >
                                {r.label}
                              </span>
                            );
                          })()}
                          {(() => {
                            const count = parseOutputCount(runResult.message);
                            return count !== null ? (
                              <span className="paperu-text-caption">
                                · {count} file(s) / step(s) processed
                              </span>
                            ) : null;
                          })()}
                          <span className="paperu-text-caption">
                            · finished {formatInTz(runResult.finishedAt, job.timezone)}
                          </span>
                        </div>
                        <p
                          className="paperu-text-caption paperu-break-all"
                          style={{ marginTop: "var(--paperu-space-2)" }}
                        >
                          {runResult.message || "(no message)"}
                        </p>
                        {runResult.status === "failure" && (
                          <p
                            className="paperu-text-caption"
                            style={{
                              marginTop: "var(--paperu-space-1)",
                              color: "var(--paperu-danger, #c62828)",
                            }}
                          >
                            {actionableHint(runResult.message) ??
                              "The action did not complete. Open the relevant feature route (Backup Recipes / Recipe Engine) for more detail."}
                          </p>
                        )}
                      </div>
                    )}

                    {/* History */}
                    {hist.length > 0 && (
                      <details style={{ marginTop: "var(--paperu-space-3)" }}>
                        <summary className="paperu-text-label">
                          History ({hist.length})
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
                          {hist.map((h) => {
                            const b = statusBadge(h.status);
                            const dur = formatDuration(h.startedAt, h.finishedAt);
                            return (
                              <li
                                key={h.id}
                                className="paperu-text-caption paperu-text-numeric"
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "auto 1fr",
                                  gap: "var(--paperu-space-2)",
                                  alignItems: "baseline",
                                }}
                              >
                                <span
                                  className="paperu-stamp"
                                  style={{
                                    color: b.tone,
                                    borderColor: `color-mix(in srgb, ${b.tone} 50%, transparent)`,
                                    background: `color-mix(in srgb, ${b.tone} 8%, transparent)`,
                                  }}
                                >
                                  {b.label}
                                </span>
                                <span className="paperu-break-all">
                                  {formatInTz(h.finishedAt, job.timezone)}
                                  {dur ? ` · ${dur}` : ""}
                                  {h.message ? ` · ${h.message}` : ""}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {/* ── Loading / empty states ── */}
      {loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>Loading…</p>
          </div>
        </Card>
      )}
      {sortedJobs.length === 0 && !loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>
              No timer jobs yet. Create one above — pick a schedule, a target
              action, and (for typed recipes) input files.
            </p>
          </div>
        </Card>
      )}

      {/* ── Error display ── */}
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

// ── Local helpers (continued) ──────────────────────────────────────

/**
 * Resolve an action id to a human-readable label using the loaded
 * recipes / backup recipes. Falls back to the id when the target
 * was deleted (the user sees the raw id, which is honest).
 */
function describeActionId(
  actionId: string,
  pool: readonly { id: string; name: string }[],
): string {
  const match = pool.find((r) => r.id === actionId);
  return match ? match.name : "(deleted)";
}

/** Merge two string arrays, deduplicating by exact string. */
function mergeDedupe(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const p of additions) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}
