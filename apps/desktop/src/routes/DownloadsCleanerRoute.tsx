import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function DownloadsCleanerRoute(): React.ReactNode {
  const [folder, setFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly { path: string; name: string; category: string; sizeBytes: number; humanReadableSize: string; modifiedAt: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onScan = async () => {
    if (!folder) { setError("Choose a folder first."); return; }
    setProcessing(true); setError(null);
    try {
      const result = await invoke<readonly unknown[]>("scan_downloads_folder", { folder });
      setFiles(result as never);
    } catch (e) { setError(String(e)); }
    finally { setProcessing(false); }
  };
  const categories = [...new Set(files.map((f) => f.category))];
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Downloads Cleaner</h1>
      <p className="paperu-workspace__subtitle">Scan, categorize, and tidy up. Never auto-deletes.</p>
      <input placeholder="Downloads folder path" value={folder ?? ""} onChange={(e) => setFolder(e.target.value)} />
      <button onClick={onScan} disabled={processing || !folder}>
        {processing ? "Scanning…" : "Scan folder"}
      </button>
      {categories.map((cat) => (
        <div key={cat}>
          <h3>{cat} ({files.filter((f) => f.category === cat).length})</h3>
          <ul>{files.filter((f) => f.category === cat).map((f) => (
            <li key={f.path}>{f.name} · {f.humanReadableSize}</li>
          ))}</ul>
        </div>
      ))}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
