/**
 * Screenshot Bridge route — pick a screenshot, crop/rotate, hand off to
 * Assignment Studio or Shelf (90% §40, Wave 4).
 *
 * Reuses image-engine primitives (cropImage, rotateImage). The handoff
 * stages the processed file via the WorkingFile store + navigates.
 * No screenshot editor — just crop/rotate/bridge.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse } from "@paperu/contracts";
import { inspectFile, finalizeOutput } from "@/lib/ipc";
import { readFileBytes } from "@/lib/file-picker";
import { useWorkingFile } from "@/lib/working-file";
import { cropImage, rotateImage } from "@/engines/image-engine";
import { Button, Card } from "@paperu/ui";

interface CropState {
  x: string;
  y: string;
  width: string;
  height: string;
}

export function ScreenshotBridgeRoute(): React.ReactNode {
  const navigate = useNavigate();
  const stage = useWorkingFile((s) => s.stage);
  const [file, setFile] = useState<InspectFileResponse | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [crop, setCrop] = useState<CropState>({ x: "0", y: "0", width: "", height: "" });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickScreenshot(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a screenshot — Paperu",
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      const meta = await inspectFile(selected);
      if (meta.kind !== "image") { setError("That file isn't an image."); return; }
      setFile(meta);
      setError(null);
      // Pre-fill crop with full image dims if available.
      // (We don't have pixel dims here without reading the file; leave blank = no crop.)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function processAndHandoff(target: "assignment" | "shelf"): Promise<void> {
    if (!file) { setError("Choose a screenshot first."); return; }
    setProcessing(true);
    setError(null);
    try {
      const bytes = await readFileBytes(file.path);
      let memFile = new File([new Blob([bytes.slice()])], file.fileName, { type: file.mimeType ?? "image/*" });

      // Rotate if needed.
      if (rotation !== 0) {
        const res = await rotateImage(memFile, rotation);
        memFile = new File([new Blob([res.bytes.slice()])], file.fileName, { type: "image/png" });
      }

      // Crop if dimensions are provided.
      const cw = parseInt(crop.width, 10);
      const ch = parseInt(crop.height, 10);
      if (cw > 0 && ch > 0) {
        const x = parseInt(crop.x, 10) || 0;
        const y = parseInt(crop.y, 10) || 0;
        const res = await cropImage(memFile, { x, y, width: cw, height: ch });
        memFile = new File([new Blob([res.bytes.slice()])], file.fileName, { type: "image/png" });
      }

      // Finalize the processed image next to the source.
      const finalized = await finalizeOutput(file.path, "-screenshot", "png", new Uint8Array(await new Blob([memFile]).arrayBuffer()));
      // Stage for the target workflow.
      stage(finalized.output, "drop", file.path);

      if (target === "assignment") {
        navigate("/assignment");
      } else {
        navigate("/");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="ss-heading">
      <header className="paperu-section__header">
        <h1 id="ss-heading" className="paperu-text-display">Screenshot Bridge</h1>
        <p className="paperu-text-lead">Pick a screenshot, optionally crop + rotate, then send it to Assignment Studio or the Shelf. No screenshot editor — just a bridge.</p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={pickScreenshot} disabled={processing}>Choose a screenshot</Button>
          {file && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={file.path}>{file.path}</div>
              <div className="paperu-text-caption">{file.size.humanReadable}</div>
            </div>
          )}
        </div>
      </Card>

      {file && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <span className="paperu-text-label">Rotate</span>
            <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
              {([0, 90, 180, 270] as const).map((r) => (
                <button key={r} type="button" className={`paperu-target__preset${rotation === r ? " is-active" : ""}`} onClick={() => setRotation(r)} aria-pressed={rotation === r} style={{ padding: "var(--paperu-space-3)" }}>{r === 0 ? "None" : `${r}°`}</button>
              ))}
            </div>
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <span className="paperu-text-label">Crop (optional — leave blank for no crop)</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                <input className="paperu-target__input" placeholder="X (0)" value={crop.x} onChange={(e) => setCrop({ ...crop, x: e.target.value.replace(/[^0-9]/g, "") })} />
                <input className="paperu-target__input" placeholder="Y (0)" value={crop.y} onChange={(e) => setCrop({ ...crop, y: e.target.value.replace(/[^0-9]/g, "") })} />
                <input className="paperu-target__input" placeholder="Width (px)" value={crop.width} onChange={(e) => setCrop({ ...crop, width: e.target.value.replace(/[^0-9]/g, "") })} />
                <input className="paperu-target__input" placeholder="Height (px)" value={crop.height} onChange={(e) => setCrop({ ...crop, height: e.target.value.replace(/[^0-9]/g, "") })} />
              </div>
            </div>
          </div>
        </Card>
      )}

      {file && (
        <div style={{ display: "flex", gap: "var(--paperu-space-3)", flexWrap: "wrap" }}>
          <Button variant="accent" onClick={() => void processAndHandoff("assignment")} disabled={processing}>
            {processing ? "Processing…" : "Send to Assignment Studio"}
          </Button>
          <Button variant="outline" onClick={() => void processAndHandoff("shelf")} disabled={processing}>
            Send to Shelf
          </Button>
        </div>
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
