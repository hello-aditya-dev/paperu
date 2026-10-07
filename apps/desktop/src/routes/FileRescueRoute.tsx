/** File Rescue — real file diagnosis via Rust magic-byte inspection. */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles } from "@/lib/file-picker";
import type { RescueDiagnosis } from "@paperu/contracts";
import { RescueCommand } from "@paperu/contracts";

export function FileRescueRoute(): React.ReactNode {
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [diagnosis, setDiagnosis] = useState<RescueDiagnosis | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    setError(null);
    const picked = await pickAndInspectFiles({ multiple: false });
    if (picked.length === 0) return;
    setFile({ path: picked[0]!.path, name: picked[0]!.fileName });
    setDiagnosis(null);
    setProcessing(true);
    try {
      const res = await invoke<RescueDiagnosis>(RescueCommand.Diagnose, { path: picked[0]!.path });
      setDiagnosis(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">File Rescue</h1>
        <p className="paperu-workspace__subtitle">Diagnose damaged files. Originals never modified. Conservative recovery only.</p>
      </header>
      <button onClick={onPick} disabled={processing}>{processing ? "Diagnosing…" : "Choose file to diagnose"}</button>
      {file && <p>File: <code>{file.name}</code></p>}
      {diagnosis && (
        <div className="paperu-assignment__result">
          <p><strong>Kind:</strong> {diagnosis.fileKind}</p>
          <p><strong>Status:</strong> {diagnosis.status}</p>
          <p>{diagnosis.message}</p>
          {diagnosis.recoverable && <p>⚠ Recovery may be possible — Paperu can attempt to re-save a fresh copy.</p>}
        </div>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
