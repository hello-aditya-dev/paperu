/**
 * Folder Organizer route — rules-based file automation with dry-run
 * preview AND real execute (master prompt §24, Wave A.8 + A.9).
 *
 * Previously this route called raw `invoke()` from @tauri-apps/api/core
 * — bypassing the typed IPC layer. It also only had Save / Delete /
 * DryRun. The "execute path" (§24) was missing: a rule could be
 * previewed but never actually run.
 *
 * This rewrite:
 *  - uses the typed IPC wrappers from @/lib/ipc (no raw invoke);
 *  - adds native folder pickers for source + destination (absolute
 *    paths, no manual typing of `C:\\…`);
 *  - adds a real Execute button that performs the move/copy on disk,
 *    with a clear confirmation step and a per-file result breakdown;
 *  - preserves source-safety: a failed move leaves the source file
 *    untouched; the batch never aborts on one per-file failure.
 *
 * No destructive auto-delete (§0). The only actions are move and copy.
 */

import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { DryRunResult, ExecuteResult, OrganizerRule } from "@paperu/contracts";
import {
  deleteOrganizerRule,
  dryRunOrganizer,
  executeOrganizerRule,
  listOrganizerRules,
  saveOrganizerRule,
} from "@/lib/ipc";
import { revealPath } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

type ConditionType = "extension" | "filename_contains" | "prefix" | "suffix";
type ActionType = "move" | "copy";

interface NewRuleState {
  name: string;
  sourceFolder: string;
  destFolder: string;
  conditionType: ConditionType;
  conditionValue: string;
  action: ActionType;
}

const CONDITIONS: ReadonlyArray<{ id: ConditionType; label: string }> = [
  { id: "extension", label: "Extension is" },
  { id: "filename_contains", label: "Filename contains" },
  { id: "prefix", label: "Filename starts with" },
  { id: "suffix", label: "Filename ends with" },
];

const ACTIONS: ReadonlyArray<{ id: ActionType; label: string }> = [
  { id: "move", label: "Move" },
  { id: "copy", label: "Copy" },
];

function formatCount(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function FolderOrganizerRoute(): React.ReactNode {
  const [rules, setRules] = useState<readonly OrganizerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<NewRuleState>({
    name: "",
    sourceFolder: "",
    destFolder: "",
    conditionType: "extension",
    conditionValue: "",
    action: "move",
  });
  // Per-rule in-flight result display (dry-run OR execute).
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [pendingExecute, setPendingExecute] = useState<OrganizerRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRules(await listOrganizerRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickFolder(field: "sourceFolder" | "destFolder"): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: field === "sourceFolder" ? "Choose source folder — Paperu" : "Choose destination folder — Paperu",
      });
      if (typeof selected === "string" && selected.length > 0) {
        setNewRule((r) => ({ ...r, [field]: selected }));
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function onSave(): Promise<void> {
    if (!newRule.name || !newRule.sourceFolder || !newRule.destFolder) {
      setError("Name, source folder, and destination folder are required.");
      return;
    }
    try {
      await saveOrganizerRule({
        id: null,
        name: newRule.name,
        sourceFolder: newRule.sourceFolder,
        destFolder: newRule.destFolder,
        conditionType: newRule.conditionType,
        conditionValue: newRule.conditionValue,
        action: newRule.action,
        enabled: true,
        sortOrder: null,
      });
      setNewRule({
        name: "",
        sourceFolder: "",
        destFolder: "",
        conditionType: "extension",
        conditionValue: "",
        action: "move",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(id: string): Promise<void> {
    try {
      await deleteOrganizerRule(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDryRun(rule: OrganizerRule): Promise<void> {
    setDryRunResult(null);
    setExecuteResult(null);
    try {
      setDryRunResult(await dryRunOrganizer(rule));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onExecute(rule: OrganizerRule): Promise<void> {
    setExecuting(true);
    setError(null);
    setDryRunResult(null);
    setExecuteResult(null);
    try {
      setExecuteResult(await executeOrganizerRule(rule));
      // Refresh the rule list (execute may have moved files out of source).
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
      setPendingExecute(null);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="org-heading">
      <header className="paperu-section__header">
        <h1 id="org-heading" className="paperu-text-display">Folder Organizer</h1>
        <p className="paperu-text-lead">
          Rules-based file automation. Dry-run first, then execute for real. Move or copy — never auto-delete.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <span className="paperu-text-label">New rule</span>
          <div style={{ display: "grid", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
            <input
              className="paperu-target__input"
              placeholder="Rule name (e.g. Move PDFs to Documents)"
              value={newRule.name}
              onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "center" }}>
              <input
                className="paperu-target__input"
                placeholder="Source folder (click Pick)"
                value={newRule.sourceFolder}
                onChange={(e) => setNewRule({ ...newRule, sourceFolder: e.target.value })}
                style={{ flex: 1 }}
              />
              <Button variant="outline" onClick={() => void pickFolder("sourceFolder")}>Pick</Button>
            </div>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "center" }}>
              <input
                className="paperu-target__input"
                placeholder="Destination folder (click Pick)"
                value={newRule.destFolder}
                onChange={(e) => setNewRule({ ...newRule, destFolder: e.target.value })}
                style={{ flex: 1 }}
              />
              <Button variant="outline" onClick={() => void pickFolder("destFolder")}>Pick</Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)" }}>
              <select
                className="paperu-target__input"
                value={newRule.conditionType}
                onChange={(e) => setNewRule({ ...newRule, conditionType: e.target.value as ConditionType })}
              >
                {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <input
                className="paperu-target__input"
                placeholder="Condition value (e.g. pdf)"
                value={newRule.conditionValue}
                onChange={(e) => setNewRule({ ...newRule, conditionValue: e.target.value })}
              />
            </div>
            <select
              className="paperu-target__input"
              value={newRule.action}
              onChange={(e) => setNewRule({ ...newRule, action: e.target.value as ActionType })}
              style={{ width: "100%" }}
            >
              {ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <Button variant="accent" onClick={onSave} disabled={loading}>Save rule</Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>Loading…</p></div></Card>
      ) : rules.length === 0 ? (
        <Card><div style={{ padding: "var(--paperu-space-5)" }}><p>No rules yet. Create one above.</p></div></Card>
      ) : (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <ul className="paperu-history__list" style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-3)" }}>
              {rules.map((r) => {
                const id = r.id;
                return (
                  <li key={id ?? r.name} style={{ border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)", padding: "var(--paperu-space-3)" }}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="paperu-text-caption paperu-break-all" style={{ marginTop: "var(--paperu-space-1)" }}>
                      {r.conditionType} = "{r.conditionValue}" → {r.action} to {r.destFolder}
                    </div>
                    <div className="paperu-text-caption paperu-break-all" style={{ opacity: 0.8 }}>
                      from {r.sourceFolder}
                    </div>
                    <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap" }}>
                      <Button variant="outline" onClick={() => void onDryRun(r)} disabled={executing}>Dry run</Button>
                      <Button
                        variant="accent"
                        onClick={() => setPendingExecute(r)}
                        disabled={executing}
                      >
                        Execute
                      </Button>
                      {id && <Button variant="ghost" onClick={() => void onDelete(id)} disabled={executing}>Delete</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {pendingExecute && (
        <Card className="paperu-error" role="alertdialog">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-error__title">Run "{pendingExecute.name}" for real?</h2>
            <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
              This will {pendingExecute.action} matched files from
              <br /><code className="paperu-text-code paperu-break-all">{pendingExecute.sourceFolder}</code>
              <br />to
              <br /><code className="paperu-text-code paperu-break-all">{pendingExecute.destFolder}</code>
            </p>
            <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
              {pendingExecute.action === "move"
                ? "Move removes the source file after copying. A failed move leaves the source untouched."
                : "Copy leaves the source file in place."}
            </p>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-4)" }}>
              <Button variant="accent" onClick={() => void onExecute(pendingExecute)} disabled={executing}>
                {executing ? "Running…" : `Yes, ${pendingExecute.action}`}
              </Button>
              <Button variant="ghost" onClick={() => setPendingExecute(null)} disabled={executing}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {dryRunResult && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-text-label" style={{ marginBottom: "var(--paperu-space-2)" }}>Dry run preview</h2>
            <p className="paperu-text-numeric">
              {formatCount(dryRunResult.matchedFiles.length, "file")} would be moved · {formatCount(dryRunResult.skipped.length, "file")} skipped
            </p>
            {dryRunResult.matchedFiles.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", maxHeight: "260px", overflowY: "auto" }}>
                {dryRunResult.matchedFiles.map((f) => (
                  <li key={f.path} className="paperu-text-code paperu-break-all" style={{ marginBottom: "var(--paperu-space-1)", fontSize: "var(--paperu-text-xs)" }}>
                    {f.name} → {f.destPath}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {executeResult && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ {formatCount(executeResult.succeeded.length, "file")} done</span>
              {executeResult.failed.length > 0 && (
                <span className="paperu-stamp paperu-stamp--warn">{formatCount(executeResult.failed.length, "file")} failed</span>
              )}
            </div>
            {executeResult.succeeded.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", maxHeight: "180px", overflowY: "auto" }}>
                {executeResult.succeeded.map((f) => (
                  <li key={f.path} className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)", marginBottom: "2px" }}>✓ {f.name} → {f.destPath}</li>
                ))}
              </ul>
            )}
            {executeResult.failed.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", maxHeight: "180px", overflowY: "auto" }}>
                {executeResult.failed.map((f) => (
                  <li key={f.path} className="paperu-text-code paperu-break-all" style={{ fontSize: "var(--paperu-text-xs)", marginBottom: "2px", color: "var(--paperu-text-warning)" }}>✗ {f.name}: {f.error}</li>
                ))}
              </ul>
            )}
            {executeResult.succeeded[0] && (
              <Button
                variant="outline"
                onClick={() => {
                  const first = executeResult.succeeded[0];
                  if (first) void revealPath(first.destPath);
                }}
                style={{ marginTop: "var(--paperu-space-3)" }}
              >
                Open destination folder
              </Button>
            )}
          </div>
        </Card>
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
