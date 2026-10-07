/**
 * Filename Fixer — clean filenames for email/uploads (Feature 14).
 * Reuses Rename Studio primitives. Presets for portal-safe, Windows-safe,
 * spaces→hyphens, spaces→underscores, normalize whitespace, strip illegal.
 * Always previews before applying.
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles } from "@/lib/file-picker";
import type { RenamePreview, RenameResult } from "@paperu/contracts";
import { RenameCommand } from "@paperu/contracts";

type Preset = "portal-safe" | "windows-safe" | "hyphens" | "underscores" | "trim" | "strip-illegal";

const PRESETS: Record<Preset, string> = {
  "portal-safe": "Portal/upload safe",
  "windows-safe": "Windows safe",
  "hyphens": "Spaces → hyphens",
  "underscores": "Spaces → underscores",
  "trim": "Normalize whitespace",
  "strip-illegal": "Strip illegal chars",
};

export function FilenameFixerRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly { path: string; fileName: string }[]>([]);
  const [preset, setPreset] = useState<Preset>("portal-safe");
  const [previews, setPreviews] = useState<readonly RenamePreview[]>([]);
  const [result, setResult] = useState<RenameResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    setError(null);
    const picked = await pickAndInspectFiles({ multiple: true });
    if (picked.length > 0) {
      setFiles(picked.map((f) => ({ path: f.path, fileName: f.fileName })));
      setPreviews([]); setResult(null);
    }
  };

  const buildConfig = () => {
    const base = { prefix: null, suffix: null, numbering: null, numberingStart: null, numberingPadding: null, find: null, replace: null, caseConversion: null, extensionChange: null };
    switch (preset) {
      case "portal-safe": return { ...base, find: " ", replace: "-", trimWhitespace: true, cleanupIllegal: true };
      case "windows-safe": return { ...base, trimWhitespace: true, cleanupIllegal: true };
      case "hyphens": return { ...base, find: " ", replace: "-" };
      case "underscores": return { ...base, find: " ", replace: "_" };
      case "trim": return { ...base, trimWhitespace: true };
      case "strip-illegal": return { ...base, cleanupIllegal: true };
    }
  };

  const onPreview = async () => {
    if (files.length === 0) { setError("Add files first."); return; }
    setProcessing(true); setError(null); setResult(null);
    try {
      const res = await invoke<readonly RenamePreview[]>(RenameCommand.Preview, { paths: files.map((f) => f.path), config: buildConfig() });
      setPreviews(res);
    } catch (e) { setError(String(e)); }
    finally { setProcessing(false); }
  };

  const onApply = async () => {
    setProcessing(true); setError(null);
    try {
      const res = await invoke<RenameResult>(RenameCommand.Execute, { paths: files.map((f) => f.path), config: buildConfig() });
      setResult(res);
    } catch (e) { setError(String(e)); }
    finally { setProcessing(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Filename Fixer</h1>
        <p className="paperu-workspace__subtitle">Clean up filenames for email and uploads. Reuses Rename Studio.</p>
      </header>
      <button onClick={onPick}>+ Add files</button>
      {files.length > 0 && <span>{files.length} selected</span>}
      <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
        {(Object.keys(PRESETS) as Preset[]).map((p) => <option key={p} value={p}>{PRESETS[p]}</option>)}
      </select>
      <button onClick={onPreview} disabled={processing || files.length === 0}>{processing ? "Working…" : "Preview"}</button>
      {previews.length > 0 && (
        <>
          <table className="paperu-history__list">
            <thead><tr><th>Current</th><th>Fixed</th></tr></thead>
            <tbody>{previews.map((p) => (<tr key={p.sourcePath}><td>{p.currentName}</td><td><strong>{p.proposedName}</strong></td></tr>))}</tbody>
          </table>
          <button onClick={onApply} disabled={processing}>Apply {previews.length} fixes</button>
        </>
      )}
      {result && <div role="status"><p>Fixed {result.succeeded.length} files.</p></div>}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
