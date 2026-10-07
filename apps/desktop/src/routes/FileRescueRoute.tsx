import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles } from "@/lib/file-picker";

export function FileRescueRoute(): React.ReactNode {
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [diagnosis, setDiagnosis] = useState<{ fileKind: string; status: string; message: string; recoverable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    const picked = await pickAndInspectFiles({ multiple: false });
    if (picked.length === 0) return;
    const f = picked[0]!;
    setFile({ path: f.path, name: f.fileName });
    setDiagnosis(null); setError(null);
    try {
      const result = await invoke<{ fileKind: string; status: string; message: string; recoverable: boolean }>("diagnose_file", { path: f.path });
      setDiagnosis(result);
    } catch (e) { setError(String(e)); }
  };
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">File Rescue</h1>
      <p className="paperu-workspace__subtitle">Diagnose and recover damaged files. Originals never modified.</p>
      <button onClick={onPick}>Choose file</button>
      {file && <p>File: {file.name}</p>}
      {diagnosis && (
        <div>
          <p>Kind: {diagnosis.fileKind}</p>
          <p>Status: {diagnosis.status}</p>
          <p>{diagnosis.message}</p>
          {diagnosis.recoverable && <p>Recovery may be possible — try re-saving.</p>}
        </div>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
