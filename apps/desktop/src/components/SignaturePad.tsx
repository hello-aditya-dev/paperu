/**
 * SignaturePad — draw or import a signature, output PNG bytes with
 * transparency. Signatures are sensitive data; never uploaded, never
 * logged. The PNG bytes live only in memory until placed into the PDF.
 */

import { useRef, useState } from "react";
import { Button } from "@paperu/ui";

export interface SignaturePadProps {
  onChange: (pngBytes: Uint8Array | null) => void;
}

export function SignaturePad({ onChange }: SignaturePadProps): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // High-DPI canvas setup on mount.
  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#20201c";
    }
  };

  // Set up canvas once it's mounted.
  useRef(() => {
    setupCanvas();
  });

  const pos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  };

  const end = () => {
    drawing.current = false;
    last.current = null;
    emitPng();
  };

  const emitPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      blob.arrayBuffer().then((ab) => {
        onChange(new Uint8Array(ab));
      });
    }, "image/png");
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasInk(false);
    onChange(null);
  };

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      ctx.clearRect(0, 0, cw, ch);
      const r = Math.min(cw / img.width, ch / img.height) * 0.9;
      const w = img.width * r;
      const h = img.height * r;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      setHasInk(true);
      emitPng();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
    e.target.value = "";
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--paperu-space-2)" }}>
        <span className="paperu-text-label">Draw or import your signature</span>
        <div style={{ display: "flex", gap: "var(--paperu-space-1)" }}>
          <Button variant="ghost" onClick={clear} disabled={!hasInk} style={{ minHeight: "32px", fontSize: "var(--paperu-text-xs)" }}>
            Clear
          </Button>
          <label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
 className="paperu-sr-only"
              onChange={onImport}
            />
            <span className="paperu-btn paperu-btn--outline" style={{ minHeight: "32px", fontSize: "var(--paperu-text-xs)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
              Import
            </span>
          </label>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="paperu-card"
        style={{
          width: "100%",
          height: "144px",
          touchAction: "none",
          cursor: "crosshair",
          display: "block",
        }}
        role="img"
        aria-label="Signature drawing area"
      />
      <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-2)" }}>
        Sign with mouse, trackpad, or touch. Stored only in memory; never uploaded.
      </p>
    </div>
  );
}
