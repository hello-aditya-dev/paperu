/** Duplicate Finder — real exact-duplicate scan with grouped results. */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DuplicateGroup } from "@paperu/contracts";
import { DuplicateCommand } from "@paperu/contracts";

export function DuplicateFinderRoute(): React.ReactNode {
  const [folder, setFolder] = useState("");
  const [groups, setGroups] = useState<readonly DuplicateGroup[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalSaved = groups.reduce((sum: number, g: DuplicateGroup) => sum + g.potentialSpaceSaved, 0);

  const onScan = async () => {
    if (!folder) { setError("Enter a folder path."); return; }
    setProcessing(true); setError(null); setGroups([]);
    try {
      const res = await invoke<readonly DuplicateGroup[]>(DuplicateCommand.Find, { folder });
      setGroups(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Duplicate Finder</h1>
        <p className="paperu-workspace__subtitle">Find exact duplicate files. Never auto-deletes — you choose what to remove.</p>
      </header>
      <input placeholder="Folder path (e.g. C:\Users\...\Downloads)" value={folder} onChange={(e) => setFolder(e.target.value)} />
      <button onClick={onScan} disabled={processing || !folder}>{processing ? "Scanning…" : "Scan for duplicates"}</button>
      {groups.length > 0 && <p>{groups.length} duplicate groups · {totalSaved} bytes reclaimable</p>}
      {groups.length === 0 && !processing && folder && <p>No duplicates found.</p>}
      {groups.map((g) => (
        <div key={g.groupId} className="paperu-history__item">
          <span>{g.humanReadableSize} · {g.paths.length} copies · save {g.humanReadableSize}</span>
          <ul>{g.paths.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ))}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
