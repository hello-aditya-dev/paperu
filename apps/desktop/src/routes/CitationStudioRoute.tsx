import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function CitationStudioRoute(): React.ReactNode {
  const [citations, setCitations] = useState<readonly { id: string; title: string; sourceType: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const r = await invoke<readonly unknown[]>("list_citations"); setCitations(r as never); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Citation Studio</h1>
      <p className="paperu-workspace__subtitle">Deterministic citations — APA, MLA, Chicago, Harvard, BibTeX. No AI.</p>
      {loading ? <p>Loading…</p> : citations.length === 0 ? <p>No citations yet.</p> :
        <ul>{citations.map((c) => <li key={c.id}>{c.title} ({c.sourceType})</li>)}</ul>}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
