/** Quick Look — fast preview for images + text. No full editor. */
import { useState } from "react";
import { pickAndInspectFiles, readFileBytes } from "@/lib/file-picker";

export function QuickLookRoute(): React.ReactNode {
  const [file, setFile] = useState<{ path: string; name: string; kind: string } | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onPick = async () => {
    setError(null);
    const picked = await pickAndInspectFiles({ multiple: false });
    if (picked.length === 0) return;
    const f = picked[0]!;
    setFile({ path: f.path, name: f.fileName, kind: f.kind });
    setImageSrc(null); setTextContent(null); setLoading(true);
    try {
      if (f.kind === "image") {
        const bytes = await readFileBytes(f.path);
        const blob = new Blob([bytes.slice()], { type: f.mimeType ?? "image/*" });
        setImageSrc(URL.createObjectURL(blob));
      } else {
        // Try text for small files (< 1 MB)
        const bytes = await readFileBytes(f.path);
        if (bytes.length < 1_048_576) {
          setTextContent(new TextDecoder().decode(bytes));
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Quick Look</h1>
        <p className="paperu-workspace__subtitle">Fast preview without opening an editor.</p>
      </header>
      <button onClick={onPick} disabled={loading}>{loading ? "Loading…" : "Choose file"}</button>
      {file && (
        <div>
          <h3>{file.name}</h3>
          {imageSrc && <img src={imageSrc} alt={file.name} style={{ maxWidth: "100%", maxHeight: "70vh" }} />}
          {textContent !== null && <pre style={{ maxHeight: "60vh", overflow: "auto" }}>{textContent}</pre>}
          {file.kind === "pdf" && <p>PDF preview available in the Study Reader.</p>}
          {file.kind === "other" && !textContent && !loading && <p>No preview available for this file type.</p>}
        </div>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
