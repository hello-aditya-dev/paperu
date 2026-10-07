import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles } from "@/lib/file-picker";

export function FilenameFixerRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<readonly { sourcePath: string; currentName: string; proposedName: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    const picked = await pickAndInspectFiles({ multiple: true });
    setFiles(picked.map((f) => f.path));
  };
  const onFix = async () => {
    if (files.length === 0) return;
    setProcessing(true); setError(null);
    try {
      const result = await invoke<readonly unknown[]>("preview_rename", {
        paths: files, config: { prefix: null, find: null, replace: null,
          numbering: null, numberingStart: null, numberingPadding: null,
          caseConversion: null, trimWhitespace: true, cleanupIllegal: true, extensionChange: null } });
      setPreview(result as never);
    } catch (e) { setError(String(e)); }
    finally { setProcessing(false); }
  };
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Filename Fixer</h1>
      <p className="paperu-workspace__subtitle">Clean up filenames for email and uploads.</p>
      <button onClick={onPick}>+ Add files</button>
      <span>{files.length} selected</span>
      <button onClick={onFix} disabled={processing || files.length === 0}>
        {processing ? "Fixing…" : "Fix filenames"}
      </button>
      {preview.length > 0 && (
        <ul>{preview.map((p, i) => (
          <li key={i}>{p.currentName} → <strong>{p.proposedName}</strong></li>
        ))}</ul>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
