import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function DuplicateFinderRoute(): React.ReactNode {
  const [folder, setFolder] = useState<string | null>(null);
  const [groups, setGroups] = useState<readonly { groupId: string; fileSize: number; humanReadableSize: string; paths: string[]; potentialSpaceSaved: number }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onScan = async () => {
    if (!folder) { setError("Choose a folder first."); return; }
    setProcessing(true); setError(null);
    try {
      const result = await invoke<readonly unknown[]>("find_exact_duplicates", { folder });
      setGroups(result as never);
    } catch (e) { setError(String(e)); }
    finally { setProcessing(false); }
  };
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Duplicate Finder</h1>
      <p className="paperu-workspace__subtitle">Find exact duplicate files. Never auto-deletes.</p>
      <input placeholder="Folder path" value={folder ?? ""} onChange={(e) => setFolder(e.target.value)} />
      <button onClick={onScan} disabled={processing || !folder}>
        {processing ? "Scanning…" : "Scan for duplicates"}
      </button>
      {groups.length === 0 && !processing && folder && (
        <p>No duplicates found.</p>
      )}
      {groups.map((g) => (
        <div key={g.groupId}>
          <h3>{g.humanReadableSize} · {g.paths.length} copies · save {g.humanReadableSize}</h3>
          <ul>{g.paths.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ))}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
