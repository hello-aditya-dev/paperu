import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function FolderOrganizerRoute(): React.ReactNode {
  const [rules, setRules] = useState<readonly { id: string; name: string; sourceFolder: string; destFolder: string; conditionType: string; conditionValue: string; action: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const result = await invoke<readonly unknown[]>("list_organizer_rules");
      setRules(result as never);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  if (loading && rules.length === 0) {
    void load();
    return <section><p>Loading…</p></section>;
  }
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Folder Organizer</h1>
      <p className="paperu-workspace__subtitle">Rules-based file automation with dry-run preview.</p>
      <button onClick={load}>Refresh</button>
      {rules.length === 0 ? (
        <p>No rules yet. Create one to start organizing.</p>
      ) : (
        <ul>{rules.map((r) => (
          <li key={r.id}>{r.name}: {r.conditionType}={r.conditionValue} → {r.action} to {r.destFolder}</li>
        ))}</ul>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
