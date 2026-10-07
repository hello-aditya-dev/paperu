/** Folder Organizer — persisted rules + dry-run preview. No destructive auto-delete. */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OrganizerRule, DryRunResult } from "@paperu/contracts";
import { OrganizerCommand } from "@paperu/contracts";

export function FolderOrganizerRoute(): React.ReactNode {
  const [rules, setRules] = useState<readonly OrganizerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({ name: "", sourceFolder: "", destFolder: "", conditionType: "extension", conditionValue: "", action: "move" });

  const load = async () => {
    setLoading(true); setError(null);
    try { const r = await invoke<readonly OrganizerRule[]>(OrganizerCommand.List); setRules(r); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const onSave = async () => {
    if (!newRule.name || !newRule.sourceFolder || !newRule.destFolder) { setError("Name, source, and destination are required."); return; }
    try { await invoke(OrganizerCommand.Save, { rule: { ...newRule, id: null, enabled: true, sortOrder: null } }); setNewRule({ name: "", sourceFolder: "", destFolder: "", conditionType: "extension", conditionValue: "", action: "move" }); void load(); }
    catch (e) { setError(String(e)); }
  };
  const onDelete = async (id: string) => { try { await invoke(OrganizerCommand.Delete, { id }); void load(); } catch (e) { setError(String(e)); } };
  const onDryRun = async (rule: OrganizerRule) => {
    try { const r = await invoke<DryRunResult>(OrganizerCommand.DryRun, { rule }); setDryRun(r); }
    catch (e) { setError(String(e)); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Folder Organizer</h1>
        <p className="paperu-workspace__subtitle">Rules-based file automation with dry-run preview. No destructive deletion.</p>
      </header>
      <fieldset className="paperu-print__options">
        <legend>New rule</legend>
        <input placeholder="Rule name" value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} />
        <input placeholder="Source folder" value={newRule.sourceFolder} onChange={(e) => setNewRule({ ...newRule, sourceFolder: e.target.value })} />
        <input placeholder="Destination folder" value={newRule.destFolder} onChange={(e) => setNewRule({ ...newRule, destFolder: e.target.value })} />
        <select value={newRule.conditionType} onChange={(e) => setNewRule({ ...newRule, conditionType: e.target.value })}>
          <option value="extension">Extension</option><option value="filename_contains">Filename contains</option>
          <option value="prefix">Prefix</option><option value="suffix">Suffix</option>
        </select>
        <input placeholder="Condition value" value={newRule.conditionValue} onChange={(e) => setNewRule({ ...newRule, conditionValue: e.target.value })} />
        <select value={newRule.action} onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}>
          <option value="move">Move</option><option value="copy">Copy</option>
        </select>
        <button onClick={onSave}>Save rule</button>
      </fieldset>
      {loading ? <p>Loading…</p> : rules.length === 0 ? <p>No rules yet. Create one above.</p> : (
        <ul className="paperu-history__list">
          {rules.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong>: {r.conditionType}="{r.conditionValue}" → {r.action} to {r.destFolder}
              <button onClick={() => onDryRun(r)}>Dry run</button>
              <button onClick={() => r.id && onDelete(r.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {dryRun && (
        <div className="paperu-assignment__result">
          <p>{dryRun.matchedFiles.length} files would be moved, {dryRun.skipped.length} skipped</p>
          {dryRun.matchedFiles.length > 0 && <ul>{dryRun.matchedFiles.map((f) => <li key={f.path}>{f.name} → {f.destPath}</li>)}</ul>}
        </div>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
