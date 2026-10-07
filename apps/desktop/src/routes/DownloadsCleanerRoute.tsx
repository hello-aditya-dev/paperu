/** Downloads Cleaner — real folder scan + categorized list. Never auto-deletes. */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "@paperu/contracts";
import { CleanerCommand } from "@paperu/contracts";

export function DownloadsCleanerRoute(): React.ReactNode {
  const [folder, setFolder] = useState("");
  const [files, setFiles] = useState<readonly FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = [...new Set(files.map((f) => f.category))].sort();

  const onScan = async () => {
    if (!folder) { setError("Enter a folder path."); return; }
    setProcessing(true); setError(null); setFiles([]);
    try {
      const res = await invoke<readonly FileEntry[]>(CleanerCommand.Scan, { folder });
      setFiles(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Downloads Cleaner</h1>
        <p className="paperu-workspace__subtitle">Scan, categorize, and tidy up. Never auto-deletes.</p>
      </header>
      <input placeholder="Folder path" value={folder} onChange={(e) => setFolder(e.target.value)} />
      <button onClick={onScan} disabled={processing || !folder}>{processing ? "Scanning…" : "Scan folder"}</button>
      {files.length > 0 && <p>{files.length} files · {categories.length} categories</p>}
      {categories.map((cat) => {
        const catFiles = files.filter((f) => f.category === cat);
        return (
          <div key={cat}>
            <h3>{cat} — {catFiles.length} files</h3>
            <ul>{catFiles.map((f) => <li key={f.path}>{f.name} · {f.humanReadableSize}</li>)}</ul>
          </div>
        );
      })}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
