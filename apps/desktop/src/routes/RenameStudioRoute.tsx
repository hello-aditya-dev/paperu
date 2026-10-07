/**
 * Rename Studio — real bulk rename with preview-before-apply (Feature 10).
 * Uses canonical file picker → absolute paths → Rust preview_rename →
 * preview table → user confirms → execute_rename → result report.
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles } from "@/lib/file-picker";
import type { RenameConfig, RenamePreview, RenameResult } from "@paperu/contracts";
import { RenameCommand } from "@paperu/contracts";

export function RenameStudioRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly { path: string; fileName: string }[]>([]);
  const [previews, setPreviews] = useState<readonly RenamePreview[]>([]);
  const [result, setResult] = useState<RenameResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config fields
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [numbering, setNumbering] = useState(false);
  const [caseConv, setCaseConv] = useState("none");
  const [trimWs, setTrimWs] = useState(true);
  const [cleanIllegal, setCleanIllegal] = useState(true);

  const onPick = async () => {
    setError(null);
    const picked = await pickAndInspectFiles({ multiple: true });
    if (picked.length > 0) {
      setFiles(picked.map((f) => ({ path: f.path, fileName: f.fileName })));
      setPreviews([]);
      setResult(null);
    }
  };

  const buildConfig = (): RenameConfig => ({
    prefix: prefix || null,
    suffix: suffix || null,
    numbering: numbering || null,
    numberingStart: numbering ? 1 : null,
    numberingPadding: numbering ? 2 : null,
    find: find || null,
    replace: replace || null,
    caseConversion: caseConv !== "none" ? caseConv : null,
    trimWhitespace: trimWs || null,
    cleanupIllegal: cleanIllegal || null,
    extensionChange: null,
  });

  const onPreview = async () => {
    if (files.length === 0) { setError("Add files first."); return; }
    setProcessing(true); setError(null); setResult(null);
    try {
      const res = await invoke<readonly RenamePreview[]>(RenameCommand.Preview, {
        paths: files.map((f) => f.path),
        config: buildConfig(),
      });
      setPreviews(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  };

  const onApply = async () => {
    if (previews.length === 0) { setError("Preview first."); return; }
    setProcessing(true); setError(null);
    try {
      const res = await invoke<RenameResult>(RenameCommand.Execute, {
        paths: files.map((f) => f.path),
        config: buildConfig(),
      });
      setResult(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Rename Studio</h1>
        <p className="paperu-workspace__subtitle">Preview bulk renames before executing. Never overwrites without consent.</p>
      </header>

      <div className="paperu-assignment__files">
        <button type="button" onClick={onPick} className="paperu-assignment__picker">+ Add files</button>
        {files.length > 0 && <span>{files.length} files selected</span>}
      </div>

      <fieldset className="paperu-print__options">
        <legend>Rename options</legend>
        <label>Prefix <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="pre_" /></label>
        <label>Suffix <input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="_v2" /></label>
        <label>Find <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="old" /></label>
        <label>Replace <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="new" /></label>
        <label><input type="checkbox" checked={numbering} onChange={(e) => setNumbering(e.target.checked)} /> Numbering</label>
        <label>Case <select value={caseConv} onChange={(e) => setCaseConv(e.target.value)}>
          <option value="none">None</option><option value="upper">UPPER</option>
          <option value="lower">lower</option><option value="title">Title Case</option>
        </select></label>
        <label><input type="checkbox" checked={trimWs} onChange={(e) => setTrimWs(e.target.checked)} /> Trim whitespace</label>
        <label><input type="checkbox" checked={cleanIllegal} onChange={(e) => setCleanIllegal(e.target.checked)} /> Clean illegal chars</label>
      </fieldset>

      <div className="paperu-assignment__build">
        <button type="button" onClick={onPreview} disabled={processing || files.length === 0}>
          {processing ? "Working…" : "Preview"}
        </button>
        {previews.length > 0 && (
          <button type="button" onClick={onApply} disabled={processing}>Apply {previews.length} renames</button>
        )}
      </div>

      {previews.length > 0 && (
        <table className="paperu-history__list">
          <thead><tr><th>Current</th><th>Proposed</th><th>Status</th></tr></thead>
          <tbody>
            {previews.map((p) => (
              <tr key={p.sourcePath}>
                <td>{p.currentName}</td>
                <td><strong>{p.proposedName}</strong></td>
                <td>{p.hasCollision ? "⚠ collision" : p.warning ?? "ok"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result && (
        <div className="paperu-assignment__result" role="status">
          <p>Renamed {result.succeeded.length}, skipped {result.skipped.length}, errors {result.errors.length}</p>
          {result.errors.length > 0 && <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
      {error && <div className="paperu-assignment__error" role="status">{error}</div>}
    </section>
  );
}
