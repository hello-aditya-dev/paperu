/**
 * Quick Look — fast preview for images, text, and PDFs.
 * No full editor. Deepened Wave C §28.
 *
 * Previously: images + small text only; PDFs were punted to the Study
 * Reader. Now: PDF preview via lazy-loaded pdfjs (render first page),
 * plus images + text. Native picker, typed reveal/open.
 */

import { useEffect, useRef, useState } from "react";
import { pickAndInspectFiles, readFileBytes, type PickedFile } from "@/lib/file-picker";
import { openPath, revealPath } from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

export function QuickLookRoute(): React.ReactNode {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Revoke object URLs to avoid leaks when the file changes.
  useEffect(() => {
    return () => {
      if (imageSrc) URL.revokeObjectURL(imageSrc);
    };
  }, [imageSrc]);

  async function pick(): Promise<void> {
    setError(null);
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    try {
      const picked = await pickAndInspectFiles({ multiple: false });
      if (picked.length === 0) return;
      const f = picked[0]!;
      setFile(f);
      setImageSrc(null);
      setTextContent(null);
      setLoading(true);
      try {
        const bytes = await readFileBytes(f.path);
        if (f.kind === "image") {
          const blob = new Blob([bytes.slice()], { type: f.mimeType ?? "image/*" });
          setImageSrc(URL.createObjectURL(blob));
        } else if (f.kind === "pdf") {
          // Lazy-load pdfjs only when a PDF is previewed — keeps the
          // Quick Look chunk small for non-PDF users.
          const pdfjs = await import("pdfjs-dist");
          const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              // Cap the preview at ~800px wide for a fast first render.
              const scale = Math.min(1.5, 800 / viewport.width);
              const scaled = page.getViewport({ scale });
              canvas.width = scaled.width;
              canvas.height = scaled.height;
              await page.render({ canvasContext: ctx, viewport: scaled }).promise;
            }
          }
        } else {
          // Text for small files (< 1 MB).
          if (bytes.length < 1_048_576) {
            setTextContent(new TextDecoder().decode(bytes));
          } else {
            setTextContent("(file too large to preview as text)");
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="ql-heading">
      <header className="paperu-section__header">
        <h1 id="ql-heading" className="paperu-text-display">Quick Look</h1>
        <p className="paperu-text-lead">
          Fast preview for images, text, and PDFs — without opening a full editor.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pick} disabled={loading}>
            {loading ? "Loading…" : "Choose a file"}
          </Button>
          {file && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={file.path}>{file.path}</div>
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                <Button variant="outline" onClick={() => void openPath(file.path)}>Open</Button>
                <Button variant="outline" onClick={() => void revealPath(file.path)}>Reveal</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {file && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <h2 className="paperu-text-label">{file.fileName}</h2>
            {imageSrc && (
              <img src={imageSrc} alt={file.fileName} style={{ maxWidth: "100%", maxHeight: "70vh", marginTop: "var(--paperu-space-3)" }} />
            )}
            {file.kind === "pdf" && (
              <div style={{ marginTop: "var(--paperu-space-3)", textAlign: "center" }}>
                <canvas ref={canvasRef} style={{ maxWidth: "100%", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }} />
              </div>
            )}
            {textContent !== null && (
              <pre style={{ maxHeight: "60vh", overflow: "auto", marginTop: "var(--paperu-space-3)", padding: "var(--paperu-space-3)", background: "var(--paperu-surface-muted, #f5f5f5)", borderRadius: "var(--paperu-radius-2)", fontSize: "var(--paperu-text-xs)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{textContent}</pre>
            )}
            {file.kind === "other" && textContent === null && !loading && !imageSrc && (
              <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>No preview available for this file type.</p>
            )}
          </div>
        </Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}
