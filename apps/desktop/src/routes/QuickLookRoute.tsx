import { useState } from "react";
import { pickAndInspectFiles, readFileBytes } from "@/lib/file-picker";

export function QuickLookRoute(): React.ReactNode {
  const [file, setFile] = useState<{ path: string; fileName: string; kind: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    const picked = await pickAndInspectFiles({ multiple: false });
    if (picked.length === 0) return;
    const f = picked[0]!;
    setFile({ path: f.path, fileName: f.fileName, kind: f.kind });
    setPreview(null); setError(null);
    if (f.kind === "image") {
      try {
        const bytes = await readFileBytes(f.path);
        const blob = new Blob([bytes.slice()]);
        setPreview(URL.createObjectURL(blob));
      } catch (e) { setError(String(e)); }
    }
  };
  return (
    <section className="paperu-workspace">
      <h1 className="paperu-workspace__heading">Quick Look</h1>
      <p className="paperu-workspace__subtitle">Fast preview without opening an editor.</p>
      <button onClick={onPick}>Choose file</button>
      {file && (
        <div>
          <h3>{file.fileName}</h3>
          {preview && <img src={preview} alt={file.fileName} style={{ maxWidth: "100%" }} />}
          {file.kind === "pdf" && <p>PDF preview needs the Study Reader engine.</p>}
          {file.kind === "other" && <p>No preview available for this type.</p>}
        </div>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
