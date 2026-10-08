/**
 * Timer Jobs route — Rust-owned scheduling + real dispatch (P0-02).
 *
 * The Rust backend (src/timer_jobs/scheduler.rs) runs a background
 * thread that ticks every 30s, finds enabled jobs whose next_run is
 * due, claims the occurrence atomically (exactly-once), dispatches
 * the allowlisted action (backup_recipe, organizer_rule), and records
 * a history row. This route is purely a control + observability UI.
 *
 * Honest limitation: the scheduler runs only while Paperu is open
 * (no background daemon). Missed runs while Paperu was closed are
 * dispatched on the next launch (one immediate tick on startup).
 */

import { useCallback, useEffect, useState } from "react";
import type { TimerJob, TimerJobHistory, UpdateTimerRequest } from "@paperu/contracts";
import {
  createTimerJob,
  deleteTimerJob,
  getTimerJobHistory,
  listTimerJobs,
  toggleTimerJob,
  triggerTimerJobNow,
  updateTimerJob,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

type ScheduleKind = "one_time" | "daily" | "weekly";

const KINDS: ReadonlyArray<{ id: ScheduleKind; label: string; placeholder: string }> = [
  { id: "one_time", label: "One-time", placeholder: "2026-12-25T10:00:00Z" },
  { id: "daily", label: "Daily", placeholder: "09:00" },
  { id: "weekly", label: "Weekly", placeholder: "Mon 09:00" },
];

const ACTION_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "backup_recipe", label: "Backup Recipe" },
  { id: "recipe", label: "Typed Recipe" },
  { id: "organizer_rule", label: "Organizer Rule (skipped — pending)" },
];

export function TimerJobsRoute(): React.ReactNode {
  const [jobs, setJobs] = useState<readonly TimerJob[]>([]);
  const [history, setHistory] = useState<Record<string, readonly TimerJobHistory[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ScheduleKind>("daily");
  const [newExpr, setNewExpr] = useState("09:00");
  const [newActionType, setNewActionType] = useState("backup_recipe");
  const [newActionId, setNewActionId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTimerJobs();
      setJobs(list);
      // Load history for each job (cheap — capped at 50 rows).
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

  async function onCreate(): Promise<void> {
    if (!newName.trim() || !newExpr.trim() || !newActionId.trim()) {
      setError("Name, schedule expression, and action ID are required.");
      return;
    }
    try {
      await createTimerJob({
        name: newName.trim(),
        scheduleKind: newKind,
        scheduleExpr: newExpr.trim(),
        actionType: newActionType,
        actionId: newActionId.trim(),
        enabled: true,
      });
      setNewName("");
      setNewActionId("");
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

  async function onDelete(id: string): Promise<void> {
    try {
      await deleteTimerJob(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRunNow(id: string): Promise<void> {
    try {
      await triggerTimerJobNow(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRename(id: string, name: string): Promise<void> {
    const req: UpdateTimerRequest = { id, name };
    try {
      await updateTimerJob(req);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function formatNextRun(next: string | null): string {
    if (!next) return "— (no upcoming run)";
    try {
      return new Date(next).toLocaleString();
    } catch {
      return next;
    }
  }

  function statusBadge(status: string): string {
    if (status === "success") return "✓ success";
    if (status === "failure") return "✗ failure";
    return "○ skipped";
  }

  const currentPlaceholder = KINDS.find((k) => k.id === newKind)?.placeholder ?? "";

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

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">New timer</span>
          <div
            style={{
              display: "grid",
              gap: "var(--paperu-space-2)",
              marginTop: "var(--paperu-space-2)",
            }}
          >
            <input
              className="paperu-target__input"
              placeholder="Timer name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ width: "100%" }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "var(--paperu-space-2)",
              }}
            >
              <select
                className="paperu-target__input"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as ScheduleKind)}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                className="paperu-target__input"
                placeholder={currentPlaceholder}
                value={newExpr}
                onChange={(e) => setNewExpr(e.target.value)}
              />
              <select
                className="paperu-target__input"
                value={newActionType}
                onChange={(e) => setNewActionType(e.target.value)}
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)" }}>
              <input
                className="paperu-target__input"
                placeholder="Action ID (e.g. backup recipe ID)"
                value={newActionId}
                onChange={(e) => setNewActionId(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button variant="accent" onClick={onCreate}>
                Create
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {jobs.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">
              Scheduled jobs ({jobs.length})
            </span>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                marginTop: "var(--paperu-space-3)",
                display: "grid",
                gap: "var(--paperu-space-3)",
              }}
            >
              {jobs.map((job) => {
                const hist = history[job.id] ?? [];
                return (
                  <li
                    key={job.id}
                    style={{
                      border: "1px solid var(--paperu-border-subtle)",
                      borderRadius: "var(--paperu-radius-2)",
                      padding: "var(--paperu-space-3)",
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
                        <input
                          className="paperu-target__input"
                          value={job.name}
                          onChange={(e) => void onRename(job.id, e.target.value)}
                          style={{ fontWeight: 600, marginBottom: "var(--paperu-space-1)" }}
                          aria-label="Timer name"
                        />
                        <div className="paperu-text-caption">
                          {job.scheduleKind} · {job.scheduleExpr} · {job.timezone}
                        </div>
                        <div className="paperu-text-caption">
                          Action: {job.actionType} ({job.actionId})
                        </div>
                        <div className="paperu-text-caption paperu-text-numeric">
                          Next run: {formatNextRun(job.nextRun)}
                          {job.lastRun && ` · Last run: ${formatNextRun(job.lastRun)}`}
                        </div>
                        {job.lastError && (
                          <div
                            className="paperu-text-caption"
                            style={{ color: "var(--paperu-color-danger)" }}
                          >
                            Last error: {job.lastError}
                          </div>
                        )}
                        {hist.length > 0 && (
                          <details style={{ marginTop: "var(--paperu-space-2)" }}>
                            <summary className="paperu-text-caption">
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
                              {hist.map((h) => (
                                <li
                                  key={h.id}
                                  className="paperu-text-caption paperu-text-numeric"
                                >
                                  {statusBadge(h.status)} · {new Date(h.finishedAt).toLocaleString()}{" "}
                                  {h.message ? `· ${h.message}` : ""}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--paperu-space-2)",
                          alignItems: "center",
                        }}
                      >
                        <Button
                          variant="ghost"
                          onClick={() => void onRunNow(job.id)}
                          disabled={!job.enabled}
                        >
                          Run now
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
                          />
                          <span className="paperu-text-caption">
                            {job.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="paperu-btn paperu-btn--ghost"
                          onClick={() => void onDelete(job.id)}
                          aria-label="Delete"
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

      {loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>Loading…</p>
          </div>
        </Card>
      )}
      {jobs.length === 0 && !loading && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <p>No timer jobs yet. Create one above.</p>
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
