/**
 * Image Toolbox (Offline Converter) — real local image operations
 * (Feature 13, master prompt §22 Wave C).
 *
 * Exposes ALL the image-engine primitives in one place:
 *   Convert  — PNG ⇄ JPEG ⇄ WebP
 *   Resize   — width / height / aspect-preserved
 *   Crop     — x / y / width / height
 *   Rotate   — 90 / 180 / 270
 *   Inspect  — real dimensions + EXIF + GPS (truthful, §11)
 *   Strip    — remove EXIF/GPS, report only what was actually there
 *
 * CANONICAL NATIVE-PATH ARCHITECTURE (no basename):
 *   native picker → absolute path → readFileBytes → in-memory File
 *   → engine primitive → finalizeOutput(REAL ABSOLUTE PATH, …)
 *
 * All processing is local. No uploads. No AI (§30).
 */

import { useCallback, useEffect, useState } from "react";
import type { InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import {
  convertImage,
  cropImage,
  inspectImageMetadata,
  resizeImage,
  rotateImage,
  stripExif,
  adjustImage,
  flipImage,
  watermarkImage,
  type ImageMetadata,
} from "@/engines/image-engine";
import {
  finalizeOutput,
  inspectFile,
  openPath,
  revealPath,
} from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

type Mode = "convert" | "resize" | "crop" | "rotate" | "inspect" | "strip" | "adjust" | "flip" | "watermark";

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: "convert", label: "Convert" },
  { id: "resize", label: "Resize" },
  { id: "crop", label: "Crop" },
  { id: "rotate", label: "Rotate" },
  { id: "flip", label: "Flip" },
  { id: "adjust", label: "Adjust" },
  { id: "watermark", label: "Watermark" },
  { id: "inspect", label: "Inspect" },
  { id: "strip", label: "Strip metadata" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface Output {
  outputPath: string;
  width?: number;
  height?: number;
  format?: string;
  removed?: readonly string[];
  meta?: ImageMetadata;
}

export function OfflineConverterRoute(): React.ReactNode {
  const [file, setFile] = useState<InspectFileResponse | null>(null);
  const [mode, setMode] = useState<Mode>("convert");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [meta, setMeta] = useState<ImageMetadata | null>(null);

  // Convert
  const [targetFormat, setTargetFormat] = useState<"jpeg" | "png" | "webp">("jpeg");
  // Resize
  const [resizeW, setResizeW] = useState("");
  const [resizeH, setResizeH] = useState("");
  // Crop
  const [cropX, setCropX] = useState("0");
  const [cropY, setCropY] = useState("0");
  const [cropW, setCropW] = useState("");
  const [cropH, setCropH] = useState("");
  // Rotate
  const [rotate, setRotate] = useState<90 | 180 | 270>(90);
  // Flip
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  // Adjust (brightness/contrast/saturation/grayscale/B&W)
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [blackAndWhite, setBlackAndWhite] = useState(false);
  // Watermark
  const [wmText, setWmText] = useState("Paperu");
  const [wmOpacity, setWmOpacity] = useState(0.3);
  const [wmSize, setWmSize] = useState(48);
  const [wmPos, setWmPos] = useState<"center" | "bottom-right" | "bottom-left" | "top-right" | "top-left">("center");

  const addRecent = useRecentFiles((s) => s.add);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose an image — Paperu",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const inspected = await inspectFile(selected);
      if (inspected.kind !== "image") {
        setError("That file isn't an image Paperu can process.");
        return;
      }
      setFile(inspected);
      setOutput(null);
      setMeta(null);
      // Pre-fill crop defaults from real dimensions once known.
      setCropW(String(inspected.size.bytes ? "" : ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Inspect mode: show real metadata as soon as a file is picked.
  useEffect(() => {
    if (mode !== "inspect" || !file) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await readFileBytes(file.path);
        const memFile = new File([new Blob([bytes.slice()])], file.fileName, { type: file.mimeType ?? "image/*" });
        const m = await inspectImageMetadata(memFile);
        if (!cancelled) setMeta(m);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [mode, file]);

  async function getMemFile(): Promise<File> {
    if (!file) throw new Error("Choose an image first.");
    const bytes = await readFileBytes(file.path);
    return new File([new Blob([bytes.slice()])], file.fileName, { type: file.mimeType ?? "image/*" });
  }

  async function finalize(bytes: Uint8Array, ext: string, partial: Omit<Output, "outputPath">): Promise<void> {
    if (!file) return;
    const out = await finalizeOutput(file.path, `-tool`, ext, bytes);
    const outputPath = out.outputPath;
    setOutput({ ...partial, outputPath });
    addRecent({
      path: outputPath,
      fileName: out.output.fileName,
      kind: out.output.kind,
      humanReadableSize: out.output.size.humanReadable,
      operation: `Image ${mode}`,
      timestamp: Date.now(),
    });
  }

  async function onConvert(): Promise<void> {
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await convertImage(memFile, targetFormat, 0.92);
      await finalize(res.bytes, res.format === "jpeg" ? "jpg" : res.format, { format: res.format.toUpperCase() });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onResize(): Promise<void> {
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await resizeImage(memFile, {
        width: resizeW ? parseInt(resizeW, 10) : undefined,
        height: resizeH ? parseInt(resizeH, 10) : undefined,
        preserveAspectRatio: true,
      });
      await finalize(res.bytes, "png", { width: res.width, height: res.height, format: "PNG" });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onCrop(): Promise<void> {
    setProcessing(true); setError(null); setOutput(null);
    try {
      const x = parseInt(cropX, 10) || 0;
      const y = parseInt(cropY, 10) || 0;
      const w = parseInt(cropW, 10);
      const h = parseInt(cropH, 10);
      if (!w || !h || w <= 0 || h <= 0) { setError("Enter a valid crop width and height."); return; }
      const memFile = await getMemFile();
      const res = await cropImage(memFile, { x, y, width: w, height: h });
      await finalize(res.bytes, "png", { width: res.width, height: res.height, format: "PNG" });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onRotate(): Promise<void> {
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await rotateImage(memFile, rotate);
      await finalize(res.bytes, "png", { width: res.width, height: res.height, format: "PNG" });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onStrip(): Promise<void> {
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await stripExif(memFile);
      await finalize(res.bytes, "jpg", { format: "JPEG", removed: res.removed });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onFlip(): Promise<void> {
    if (!flipH && !flipV) { setError("Choose horizontal or vertical flip."); return; }
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await flipImage(memFile, { horizontal: flipH, vertical: flipV });
      await finalize(res.bytes, "png", { format: "PNG" });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onAdjust(): Promise<void> {
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await adjustImage(memFile, {
        brightness, contrast, saturation, grayscale, blackAndWhite,
      });
      await finalize(res.bytes, "jpg", { format: "JPEG" });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  async function onWatermark(): Promise<void> {
    if (!wmText.trim()) { setError("Enter watermark text."); return; }
    setProcessing(true); setError(null); setOutput(null);
    try {
      const memFile = await getMemFile();
      const res = await watermarkImage(memFile, {
        text: wmText, opacity: wmOpacity, fontSize: wmSize, position: wmPos,
      });
      await finalize(res.bytes, "jpg", { format: "JPEG" });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setProcessing(false); }
  }

  return (
    <section className="paperu-section" aria-labelledby="imgtool-heading">
      <header className="paperu-section__header">
        <h1 id="imgtool-heading" className="paperu-text-display">Image Toolbox</h1>
        <p className="paperu-text-lead">
          Convert, resize, crop, rotate, inspect, and strip metadata — all locally on this PC. 0 bytes uploaded. No AI.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={handlePick} disabled={processing}>Choose an image</Button>
          {file && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={file.path}>{file.path}</div>
              <div className="paperu-text-caption" style={{ marginTop: "2px" }}>
                {file.kind.toUpperCase()} · {file.size.humanReadable}
              </div>
            </div>
          )}
        </div>
      </Card>

      {file && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)" }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`paperu-target__preset${mode === m.id ? " is-active" : ""}`}
                  onClick={() => { setMode(m.id); setOutput(null); setError(null); }}
                  aria-pressed={mode === m.id}
                  style={{ padding: "var(--paperu-space-2) var(--paperu-space-3)" }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {file && mode === "convert" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Convert to</span>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
              {(["jpeg", "png", "webp"] as const).map((f) => (
                <button key={f} type="button" className={`paperu-target__preset${targetFormat === f ? " is-active" : ""}`} onClick={() => setTargetFormat(f)} aria-pressed={targetFormat === f} style={{ padding: "var(--paperu-space-3)" }}>{f.toUpperCase()}</button>
              ))}
            </div>
            <Button variant="accent" onClick={onConvert} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Converting…" : "Convert"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "resize" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Resize (aspect preserved)</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
              <input className="paperu-target__input" placeholder="Width (px)" value={resizeW} onChange={(e) => setResizeW(e.target.value.replace(/[^0-9]/g, ""))} />
              <input className="paperu-target__input" placeholder="Height (blank = auto)" value={resizeH} onChange={(e) => setResizeH(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
            <Button variant="accent" onClick={onResize} disabled={processing || (!resizeW && !resizeH)} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Resizing…" : "Resize"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "crop" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Crop (from top-left)</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
              <input className="paperu-target__input" placeholder="X" value={cropX} onChange={(e) => setCropX(e.target.value.replace(/[^0-9]/g, ""))} />
              <input className="paperu-target__input" placeholder="Y" value={cropY} onChange={(e) => setCropY(e.target.value.replace(/[^0-9]/g, ""))} />
              <input className="paperu-target__input" placeholder="Width (px)" value={cropW} onChange={(e) => setCropW(e.target.value.replace(/[^0-9]/g, ""))} />
              <input className="paperu-target__input" placeholder="Height (px)" value={cropH} onChange={(e) => setCropH(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
            <Button variant="accent" onClick={onCrop} disabled={processing || (!cropW || !cropH)} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Cropping…" : "Crop"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "rotate" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Rotate</span>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
              {([90, 180, 270] as const).map((d) => (
                <button key={d} type="button" className={`paperu-target__preset${rotate === d ? " is-active" : ""}`} onClick={() => setRotate(d)} aria-pressed={rotate === d} style={{ padding: "var(--paperu-space-3)" }}>{d}°</button>
              ))}
            </div>
            <Button variant="accent" onClick={onRotate} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Rotating…" : "Rotate"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "flip" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Flip</span>
            <div style={{ display: "flex", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-2)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                <input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} /> Horizontal
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                <input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} /> Vertical
              </label>
            </div>
            <Button variant="accent" onClick={onFlip} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Flipping…" : "Flip"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "adjust" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Adjust (brightness / contrast / saturation)</span>
            <div style={{ display: "grid", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-2)" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Brightness</span><span className="paperu-text-numeric">{brightness > 0 ? `+${brightness}` : brightness}</span></div>
                <input type="range" min={-100} max={100} value={brightness} onChange={(e) => setBrightness(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Contrast</span><span className="paperu-text-numeric">{contrast > 0 ? `+${contrast}` : contrast}</span></div>
                <input type="range" min={-100} max={100} value={contrast} onChange={(e) => setContrast(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Saturation</span><span className="paperu-text-numeric">{saturation > 0 ? `+${saturation}` : saturation}</span></div>
                <input type="range" min={-100} max={100} value={saturation} onChange={(e) => setSaturation(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
              <div style={{ display: "flex", gap: "var(--paperu-space-3)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                  <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} /> Grayscale
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
                  <input type="checkbox" checked={blackAndWhite} onChange={(e) => setBlackAndWhite(e.target.checked)} /> Black &amp; white
                </label>
              </div>
            </div>
            <Button variant="accent" onClick={onAdjust} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Adjusting…" : "Apply adjustments"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "watermark" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Text watermark</span>
            <input className="paperu-target__input" placeholder="Watermark text" value={wmText} onChange={(e) => setWmText(e.target.value)} style={{ width: "100%", marginTop: "var(--paperu-space-2)" }} />
            <div style={{ display: "grid", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Opacity</span><span className="paperu-text-numeric">{Math.round(wmOpacity * 100)}%</span></div>
                <input type="range" min={0.05} max={1} step={0.05} value={wmOpacity} onChange={(e) => setWmOpacity(parseFloat(e.target.value))} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Font size</span><span className="paperu-text-numeric">{wmSize}px</span></div>
                <input type="range" min={16} max={120} value={wmSize} onChange={(e) => setWmSize(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
              <select className="paperu-target__input" value={wmPos} onChange={(e) => setWmPos(e.target.value as typeof wmPos)} style={{ width: "100%" }}>
                <option value="center">Center</option>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
              </select>
            </div>
            <Button variant="accent" onClick={onWatermark} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Watermarking…" : "Apply watermark"}</Button>
          </div>
        </Card>
      )}

      {file && mode === "inspect" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Real metadata</span>
            {!meta ? (
              <p className="paperu-text-caption">Reading…</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-2)" }}>
                <li>Dimensions: <strong>{meta.width} × {meta.height}px</strong></li>
                <li>Format: <strong>{meta.format || "unknown"}</strong></li>
                <li>EXIF camera metadata: <strong>{meta.hasExif ? "present" : "absent"}</strong></li>
                <li>GPS location data: <strong>{meta.hasGps ? "present" : "not detected"}</strong></li>
                {!meta.hasGps && (
                  <li className="paperu-text-caption" style={{ opacity: 0.8 }}>
                    GPS detection is real — Paperu parses the JPEG EXIF GPS IFD pointer (tag 0x8825), not just EXIF presence.
                  </li>
                )}
              </ul>
            )}
          </div>
        </Card>
      )}

      {file && mode === "strip" && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Strip metadata</span>
            <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
              Re-encodes the image to a clean JPEG with no EXIF, GPS, or camera info. The report lists only metadata that was actually present.
            </p>
            <Button variant="accent" onClick={onStrip} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>{processing ? "Stripping…" : "Strip metadata"}</Button>
          </div>
        </Card>
      )}

      {output && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Done</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-1)" }}>
              {output.format && <li>Format: {output.format}</li>}
              {output.width && output.height && <li>Output: {output.width} × {output.height}px</li>}
              {output.removed && output.removed.length > 0 && (
                <li>Removed: {output.removed.join(", ")}</li>
              )}
              {output.removed && output.removed.length === 0 && (
                <li className="paperu-text-caption">No metadata was present to remove — the report is truthful.</li>
              )}
            </ul>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{output.outputPath}</p>
            <div className="paperu-fitresult__actions">
              <Button variant="accent" onClick={() => void openPath(output.outputPath)}>Open</Button>
              <Button variant="outline" onClick={() => void revealPath(output.outputPath)}>Open folder</Button>
            </div>
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

// formatBytes kept for potential future use; suppress unused warning.
void formatBytes;
