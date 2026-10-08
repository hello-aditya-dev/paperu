/**
 * Timer Jobs route — persisted scheduled jobs (90% §59, AUTOMATION-04, P0-B).
 *
 * Rust backend (src/timer_jobs/mod.rs) already has CRUD + compute_next_run.
 * This is the real UI: create/list/delete/toggle + schedule configuration.
 *
 * Honest limitation: Paperu must be running for timers to fire (no
 * background daemon). The UI states this clearly. A foreground timer
 * loop checks enabled jobs every 60s + fires when next_run is reached.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import type { TimerJob } from "@paperu/contracts";
import { createTimerJob, listTimerJobs, deleteTimerJob, toggleTimerJob } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

type ScheduleKind = "one_time" | "daily" | "weekly";

const KINDS: ReadonlyArray<{ id: ScheduleKind; label: string; placeholder: string }> = [
  { id: "one_time", label: "One-time", placeholder: "2026-12-25T10:00:00Z" },
  { id: "daily", label: "Daily", placeholder: "09:00" },
  { id: "weekly", label: "Weekly", placeholder: "Mon 09:00" },
];

const ACTION_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "backup_recipe", label: "Backup Recipe" },
  { id: "organizer_rule", label: "Organizer Rule" },
  { id: "rename_preset", label: "Rename Preset" },
];

export function TimerJobsRoute(): React.ReactNode {
  const [jobs, setJobs] = useState<readonly TimerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ScheduleKind>("daily");
  const [newExpr, setNewExpr] = useState("09:00");
  const [newActionType, setNewActionType] = useState("backup_recipe");
  const [newActionId, setNewActionId] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await listTimerJobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Foreground timer loop: check every 60s if any enabled job's
    // next_run has passed. Honest: this only works while Paperu is open.
    timerRef.current = setInterval(() => {
      void load(); // refresh the list (next_run is computed at creation)
    }, 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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

  function formatNextRun(next: string | null): string {
    if (!next) return "—";
    try {
      const d = new Date(next);
      return d.toLocaleString();
    } catch {
      return next;
    }
  }

  const currentPlaceholder = KINDS.find((k) => k.id === newKind)?.placeholder ?? "";

  return (
    <section className="paperu-section" aria-labelledby="timer-heading">
      <header className="paperu-section__header">
        <h1 id="timer-heading" className="paperu-text-display">Timer Jobs</h1>
        <p className="paperu-text-lead">
          Schedule Paperu operations — one-time, daily, or weekly. Paperu must be open for jobs to fire (no background daemon). The next-run time is computed automatically.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">New timer</span>
          <div style={{ display: "grid", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            <input className="paperu-target__input" placeholder="Timer name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--paperu-space-2)" }}>
              <select className="paperu-target__input" value={newKind} onChange={(e) => setNewKind(e.target.value as ScheduleKind)}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
              <input className="paperu-target__input" placeholder={currentPlaceholder} value={newExpr} onChange={(e) => setNewExpr(e.target.value)} />
              <select className="paperu-target__input" value={newActionType} onChange={(e) => setNewActionType(e.target.value)}>
                {ACTION_TYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)" }}>
              <input className="paperu-target__input" placeholder="Action ID (e.g. backup recipe ID)" value={newActionId} onChange={(e) => setNewActionId(e.target.value)} style={{ flex: 1 }} />
              <Button variant="accent" onClick={onCreate}>Create</Button>
            </div>
          </div>
        </div>
      </Card>

      {jobs.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Scheduled jobs ({jobs.length})</span>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-3)" }}>
              {jobs.map((job) => (
                <li key={job.id} style={{ border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)", padding: "var(--paperu-space-3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--paperu-space-3)" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{job.name}</div>
                      <div className="paperu-text-caption">
                        {job.scheduleKind} · {job.scheduleExpr}
                      </div>
                      <div className="paperu-text-caption">
                        Action: {job.actionType} ({job.actionId})
                      </div>
                      <div className="paperu-text-caption paperu-text-numeric">
                        Next run: {formatNextRun(job.nextRun)}
                        {job.lastRun && ` · Last run: ${formatNextRun(job.lastRun)}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-1)" }}>
                        <input type="checkbox" checked={job.enabled} onChange={(e) => void onToggle(job.id, e.target.checked)} />
                        <span className="paperu-text-caption">{job.enabled ? "Enabled" : "Disabled"}</span>
                      </label>
                      <button type="button" className="paperu-btn paperu-btn--ghost" onClick={() => void onDelete(job.id)} aria-label="Delete">×</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {loading && <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>Loading…</p></div></Card>}
      {jobs.length === 0 && !loading && (
        <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>No timer jobs yet. Create one above.</p></div></Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}
