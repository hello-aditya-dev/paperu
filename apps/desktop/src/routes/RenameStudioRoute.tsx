import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles } from "@/lib/file-picker";

export function RenameStudioRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<readonly { sourcePath: string; currentName: string; proposedName: string; hasCollision: boolean; warning: string | null }[]>([]);
  const [prefix, setPrefix] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    const picked = await pickAndInspectFiles({ multiple: true });
    setFiles(picked.map((f) => f.path));
  };
  const onPreview = async () => {
    if (files.length === 0) return;
    setProcessing(true); setError(null);
    try {
      const result = await invoke<readonly unknown[]>("preview_rename", {
        paths: files, config: { prefix: prefix || null, find: find || null, replace: replace || null,
          numbering: null, numberingStart: null, numberingPadding: null,
          caseConversion: null, trimWhitespace: null, cleanupIllegal: null, extensionChange: null } });
      setPreview(result as never);
    } catch (e) { setError(String(e)); }
    finally { setProcessing(false); }
  };
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Rename Studio</h1>
      <p className="paperu-workspace__subtitle">Preview bulk renames before executing.</p>
      <button onClick={onPick}>+ Add files</button>
      <span>{files.length} selected</span>
      <input placeholder="Prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      <input placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
      <input placeholder="Replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
      <button onClick={onPreview} disabled={processing || files.length === 0}>
        {processing ? "Previewing…" : "Preview"}
      </button>
      {preview.length > 0 && (
        <ul>{preview.map((p, i) => (
          <li key={i}>{p.currentName} → <strong>{p.proposedName}</strong>
            {p.warning && <em> ⚠ {p.warning}</em>}</li>
        ))}</ul>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
