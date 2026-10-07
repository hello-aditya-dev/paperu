/**
 * Offline Converter — real local format conversion (Feature 13).
 * Uses the existing image-engine functions: convertImage, resizeImage,
 * stripExif. All processing is local. No uploads. No AI.
 *
 * Supported conversion edges (honest, not "convert anything"):
 *   PNG → JPEG, PNG → WebP
 *   JPEG → PNG, JPEG → WebP
 *   WebP → PNG, WebP → JPEG
 *   + Resize (width/height/percentage)
 *   + Clean metadata (EXIF/GPS stripping)
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickAndInspectFiles, readFileBytes } from "@/lib/file-picker";
import { convertImage, resizeImage, stripExif, inspectImageMetadata } from "@/engines/image-engine";

type ConvertAction = "convert" | "resize" | "clean-metadata";

export function OfflineConverterRoute(): React.ReactNode {
  const [file, setFile] = useState<{ path: string; name: string; kind: string } | null>(null);
  const [action, setAction] = useState<ConvertAction>("convert");
  const [targetFormat, setTargetFormat] = useState<"jpeg" | "png" | "webp">("jpeg");
  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [result, setResult] = useState<{ outputPath: string; removed?: string[]; width?: number; height?: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async () => {
    setError(null);
    const picked = await pickAndInspectFiles({ multiple: false, accept: "image/*" });
    if (picked.length === 0) return;
    setFile({ path: picked[0]!.path, name: picked[0]!.fileName, kind: picked[0]!.kind });
    setResult(null);
  };

  const onProcess = async () => {
    if (!file) { setError("Choose a file first."); return; }
    setProcessing(true); setError(null); setResult(null);
    try {
      const bytes = await readFileBytes(file.path);
      const imgFile = new File([new Blob([bytes.slice()])], file.name, { type: "image/*" });
      let outputBytes: Uint8Array;
      let ext = "png";
      let removed: string[] | undefined;
      let width: number | undefined;
      let height: number | undefined;
      if (action === "convert") {
        const res = await convertImage(imgFile, targetFormat, 0.92);
        outputBytes = res.bytes;
        ext = res.format;
      } else if (action === "resize" && (targetWidth || targetHeight)) {
        const res = await resizeImage(imgFile, {
          width: targetWidth ? parseInt(targetWidth, 10) : undefined,
          height: targetHeight ? parseInt(targetHeight, 10) : undefined,
          preserveAspectRatio: true,
        });
        outputBytes = res.bytes;
        ext = res.format;
        width = res.width; height = res.height;
      } else if (action === "clean-metadata") {
        const res = await stripExif(imgFile);
        outputBytes = res.bytes;
        ext = res.format;
        removed = res.removed;
      } else {
        throw new Error("Invalid action or missing parameters.");
      }
      // Finalize via canonical finalize_output.
      const b64 = bytesToBase64(outputBytes);
      const out = await invoke<string>("finalize_output", {
        request: { sourcePath: file.path, suffix: `-converted`, extension: ext, bytesBase64: b64 },
      });
      setResult({ outputPath: out, removed, width, height });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Offline Converter</h1>
        <p className="paperu-workspace__subtitle">Convert, resize, and clean images locally. No uploads. No AI.</p>
      </header>
      <button onClick={onPick} disabled={processing}>Choose image</button>
      {file && <p>File: <code>{file.name}</code></p>}
      {file && (
        <fieldset className="paperu-print__options">
          <legend>Action</legend>
          <label><input type="radio" name="action" checked={action === "convert"} onChange={() => setAction("convert")} /> Convert format</label>
          <label><input type="radio" name="action" checked={action === "resize"} onChange={() => setAction("resize")} /> Resize</label>
          <label><input type="radio" name="action" checked={action === "clean-metadata"} onChange={() => setAction("clean-metadata")} /> Clean metadata (EXIF/GPS)</label>
        </fieldset>
      )}
      {action === "convert" && (
        <select value={targetFormat} onChange={(e) => setTargetFormat(e.target.value as "jpeg" | "png" | "webp")}>
          <option value="jpeg">JPEG</option><option value="png">PNG</option><option value="webp">WebP</option>
        </select>
      )}
      {action === "resize" && (
        <>
          <input placeholder="Width (px)" value={targetWidth} onChange={(e) => setTargetWidth(e.target.value)} />
          <input placeholder="Height (px, blank for aspect)" value={targetHeight} onChange={(e) => setTargetHeight(e.target.value)} />
        </>
      )}
      <button onClick={onProcess} disabled={processing || !file}>
        {processing ? "Processing…" : "Convert"}
      </button>
      {result && (
        <div className="paperu-assignment__result" role="status">
          <p>Done.</p>
          {result.removed && result.removed.length > 0 && <p>Removed: {result.removed.join(", ")}</p>}
          {result.width && result.height && <p>Output: {result.width} × {result.height}px</p>}
          <code>{result.outputPath}</code>
        </div>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}
