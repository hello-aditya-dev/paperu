/**
 * FillPdfView — overlay text, dates, and checkboxes onto a PDF page.
 *
 * Works on any PDF, including non-fillable ones (overlays are drawn on
 * top of the page, not into AcroForm fields). Click on the page preview
 * to place a field. Multiple fields can be placed, reviewed, and removed
 * before saving.
 *
 * Eventually Paperu should enable: government form → fill → photo →
 * signature → compress under portal limit (doctrine §17).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput } from "@/lib/ipc";
import { Card, Button } from "@paperu/ui";
import {
  fillPdf,
  renderPdfPage,
  type OverlayItem,
  type OverlayKind,
  type PdfFitProgress,
  type PageRenderResult,
} from "@/engines/pdf-engine";

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse }
  | { kind: "running"; progress: PdfFitProgress }
  | { kind: "done"; outputPath: string }
  | { kind: "error"; error: AppError };

interface DragDropEvent {
  paths: string[];
}

let overlayIdCounter = 0;
function nextOverlayId(): string {
  overlayIdCounter += 1;
  return `o${overlayIdCounter}`;
}

export function FillPdfView(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [stagedFile, setStagedFile] = useState<InspectFileResponse | null>(null);
  const [tool, setTool] = useState<OverlayKind>("text");
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(12);
  const [boxSize, setBoxSize] = useState(14);
  const [page, setPage] = useState(1);
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [pageRender, setPageRender] = useState<PageRenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen<DragDropEvent>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths ?? [];
      if (paths.length > 0 && !cancelled) void handlePath(paths[0]!);
    })
      .then((un) => {
        if (cancelled) un();
        else unlistenRef.current = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePath = useCallback(async (path: string) => {
    setState({ kind: "inspecting", path });
    try {
      const result = await inspectFile(path);
      if (result.kind !== "pdf") {
        setState({
          kind: "error",
          error: {
            code: "unsupported.format",
            category: "unsupported",
            severity: "warning",
            recoverability: "action_required",
            message: "That file is not a PDF.",
          },
        });
        return;
      }
      setState({ kind: "ready", file: result });
      setStagedFile(result);
      const bytes = await readFileBytes(path);
      setFileBytes(bytes);
      setPage(1);
      setOverlays([]);
      await renderPage(bytes, 1);
    } catch (err) {
      setState({ kind: "error", error: err as AppError });
    }
  }, []);

  async function renderPage(bytes: Uint8Array, pageNum: number): Promise<void> {
    setRendering(true);
    try {
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const file = new File([ab], "preview.pdf", { type: "application/pdf" });
      const result = await renderPdfPage(file, pageNum, 620);
      setPageRender(result);
    } catch {
      setPageRender(null);
    } finally {
      setRendering(false);
    }
  }

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a PDF to fill — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        await handlePath(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  function onPageClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (!pageRender) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const xPt = xPx / pageRender.scale;
    const yPt = pageRender.heightPt - yPx / pageRender.scale;
    const item: OverlayItem = {
      id: nextOverlayId(),
      kind: tool,
      page,
      x: xPt,
      y: yPt,
      text: tool === "date" ? (text || new Date().toLocaleDateString("en-IN")) : text,
      fontSize,
      size: boxSize,
    };
    setOverlays((prev) => [...prev, item]);
    if (tool === "text") setText("");
  }

  async function changePage(newPage: number): Promise<void> {
    setPage(newPage);
    if (fileBytes) await renderPage(fileBytes, newPage);
  }

  function removeOverlay(id: string): void {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }
  function clearOverlays(): void {
    setOverlays([]);
  }

  async function run(): Promise<void> {
    if (!stagedFile || overlays.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", progress: { fraction: 0, stage: "Filling…" } });
    try {
      const bytes = await readFileBytes(stagedFile.path);
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const file = new File([ab], stagedFile.fileName, { type: "application/pdf" });
      const out = await fillPdf(file, overlays, {
        signal: controller.signal,
        onProgress: (p) => setState({ kind: "running", progress: p }),
      });
      const finalized = await finalizeOutput(stagedFile.path, "-filled", "pdf", out);
      setState({ kind: "done", outputPath: finalized.outputPath });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (stagedFile) setState({ kind: "ready", file: stagedFile });
      } else {
        setState({ kind: "error", error: err as AppError });
      }
    } finally {
      abortRef.current = null;
    }
  }

  function reset(): void {
    setState({ kind: "idle" });
    setStagedFile(null);
    setOverlays([]);
    setText("");
    setFileBytes(null);
    setPageRender(null);
  }

  const pageOverlays = overlays.filter((o) => o.page === page);

  return (
    <section className="paperu-section" aria-labelledby="fill-heading">
      <header className="paperu-section__header">
        <h1 id="fill-heading" className="paperu-text-display">Fill PDF</h1>
        <p className="paperu-text-lead">
          Place text, dates, and checkmarks on top of any PDF — even
          non-fillable ones. Click on the page preview to place each field.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div className="paperu-dropzone" role="region" aria-label="Drop a PDF here or choose one">
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
              <p className="paperu-dropzone__title">Drop a PDF here</p>
              <p className="paperu-dropzone__hint">{state.kind === "error" ? state.error.message : "Fill forms, add text, dates, checkmarks."}</p>
              <Button variant="accent" onClick={handlePick}>Choose a PDF</Button>
            </div>
          </div>
          {state.kind === "error" && (
            <Card className="paperu-error" role="alert">
              <div className="paperu-error__head">
                <span className="paperu-error__badge" aria-hidden="true">!</span>
                <h2 className="paperu-error__title">{state.error.message}</h2>
              </div>
              <Button variant="ghost" onClick={reset} style={{ marginTop: "var(--paperu-space-3)" }}>Try again</Button>
            </Card>
          )}
        </>
      )}

      {state.kind === "inspecting" && (
        <Card className="paperu-progress" aria-live="polite">
          <p className="paperu-progress__stage">Reading {state.path}…</p>
        </Card>
      )}

      {(state.kind === "ready" || state.kind === "running") && stagedFile && (
        <>
          <Card className="paperu-staged">
            <div className="paperu-staged__row">
              <span className="paperu-staged__icon" aria-hidden="true">📄</span>
              <div className="paperu-staged__meta">
                <div className="paperu-staged__name paperu-truncate" title={stagedFile.path}>{stagedFile.fileName}</div>
                <div className="paperu-staged__sub">
                  <span className="paperu-staged__kind">PDF</span>
                  <span className="paperu-staged__size paperu-text-numeric">{stagedFile.size.humanReadable}</span>
                </div>
              </div>
              <button type="button" className="paperu-staged__remove" onClick={reset} aria-label="Remove file" disabled={state.kind === "running"}>✕</button>
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-4)" }}>
            <Card>
              <div style={{ padding: "var(--paperu-space-5)" }}>
                <span className="paperu-text-label">Field type</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                  {(["text", "date", "check"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`paperu-target__preset${tool === t ? " is-active" : ""}`}
                      onClick={() => setTool(t)}
                      aria-pressed={tool === t}
                      style={{ flexDirection: "column", padding: "var(--paperu-space-2)", fontSize: "var(--paperu-text-xs)" }}
                    >
                      {t === "text" ? "Text" : t === "date" ? "Date" : "Check"}
                    </button>
                  ))}
                </div>

                {tool !== "check" ? (
                  <>
                    <div style={{ marginTop: "var(--paperu-space-3)" }}>
                      <label className="paperu-text-label" htmlFor="fill-text">
                        {tool === "date" ? "Date (blank = today)" : "Text to place"}
                      </label>
                      <input
                        id="fill-text"
                        className="paperu-target__input"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={tool === "date" ? new Date().toLocaleDateString("en-IN") : "Type something…"}
                        style={{ width: "100%", marginTop: "var(--paperu-space-1)" }}
                      />
                    </div>
                    <div style={{ marginTop: "var(--paperu-space-3)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="paperu-text-label">Font size</span>
                        <span className="paperu-text-numeric">{fontSize}pt</span>
                      </div>
                      <input type="range" min={7} max={28} step={1} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value, 10))} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: "var(--paperu-space-3)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span className="paperu-text-label">Check size</span>
                      <span className="paperu-text-numeric">{boxSize}pt</span>
                    </div>
                    <input type="range" min={8} max={28} step={1} value={boxSize} onChange={(e) => setBoxSize(parseInt(e.target.value, 10))} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
                  </div>
                )}

                <div style={{ marginTop: "var(--paperu-space-3)" }}>
                  <label className="paperu-text-label">Page</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-1)" }}>
                    <input
                      type="number"
                      min={1}
                      value={page}
                      onChange={(e) => changePage(Math.max(1, parseInt(e.target.value || "1", 10)))}
                      className="paperu-target__input"
                      style={{ width: "80px" }}
                      aria-label="Page number"
                    />
                  </div>
                </div>

                <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>
                  Click on the preview to place a {tool === "check" ? "checkmark" : tool === "date" ? "date" : "text field"}.
                </p>
              </div>
            </Card>

            <Card>
              <div style={{ padding: "var(--paperu-space-5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--paperu-space-2)" }}>
                  <span className="paperu-text-label">{overlays.length} field{overlays.length === 1 ? "" : "s"}</span>
                  {overlays.length > 0 && (
                    <button type="button" className="paperu-staged__clear" onClick={clearOverlays} disabled={state.kind === "running"}>Clear</button>
                  )}
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: "160px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--paperu-space-1)" }}>
                  {overlays.length === 0 && <li className="paperu-text-caption" style={{ padding: "var(--paperu-space-3)", textAlign: "center" }}>No fields yet. Click the preview to add one.</li>}
                  {overlays.map((o) => (
                    <li key={o.id} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", padding: "var(--paperu-space-1) var(--paperu-space-2)", border: "1px solid var(--paperu-border)", borderRadius: "var(--paperu-radius-sm)", fontSize: "var(--paperu-text-xs)" }}>
                      <span className="paperu-text-metadata-key" style={{ textTransform: "uppercase" }}>{o.kind}</span>
                      <span className="paperu-truncate" style={{ flex: 1, minWidth: 0 }}>p{o.page}: {o.kind === "check" ? "✕" : (o.text || "(blank)")}</span>
                      <button type="button" onClick={() => removeOverlay(o.id)} className="paperu-staged__remove" style={{ width: "20px", height: "20px", fontSize: "var(--paperu-text-xs)" }} aria-label="Remove field">✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>

          {pageRender && (
            <Card>
              <div style={{ padding: "var(--paperu-space-5)" }}>
                <span className="paperu-text-label">Page {page} preview · click to place</span>
                <div style={{ overflowX: "auto", marginTop: "var(--paperu-space-2)" }}>
                  <div
                    style={{ position: "relative", display: "inline-block", cursor: "crosshair", border: "1px solid var(--paperu-border)", borderRadius: "var(--paperu-radius-md)", overflow: "hidden" }}
                    onClick={onPageClick}
                    role="presentation"
                  >
                    <img
                      src={pageRender.canvas.toDataURL()}
                      alt={`Page ${page} preview`}
                      style={{ display: "block", maxWidth: "100%", pointerEvents: "none" }}
                    />
                    {pageOverlays.map((o) => {
                      const h = o.kind === "check" ? (o.size || 14) : (o.fontSize || 12);
                      const scale = pageRender.scale;
                      return (
                        <div
                          key={o.id}
                          style={{
                            position: "absolute",
                            left: `${(o.x / pageRender.widthPt) * 100}%`,
                            top: `${((pageRender.heightPt - o.y - h) / pageRender.heightPt) * 100}%`,
                            pointerEvents: "none",
                            color: "var(--paperu-text)",
                          }}
                        >
                          {o.kind === "check" ? (
                            <div style={{ width: `${(o.size || 14) * scale}px`, height: `${(o.size || 14) * scale}px`, border: "2px solid var(--paperu-accent)", display: "grid", placeItems: "center", color: "var(--paperu-accent)", fontSize: `${(o.size || 14) * scale * 0.7}px` }}>✕</div>
                          ) : (
                            <span style={{ fontSize: `${(o.fontSize || 12) * scale}px`, fontFamily: "var(--paperu-font-sans)", lineHeight: 1, whiteSpace: "pre" }}>
                              {o.kind === "date" ? (o.text || new Date().toLocaleDateString("en-IN")) : o.text}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )}
          {rendering && <Card className="paperu-progress"><p className="paperu-progress__stage">Rendering page…</p></Card>}

          {(state.kind === "ready" || state.kind === "running") && (
            <Button
              variant="accent"
              onClick={run}
              disabled={overlays.length === 0 || state.kind === "running"}
              style={{ width: "100%" }}
            >
              {state.kind === "running" ? "Filling…" : `Fill & save (${overlays.length})`}
            </Button>
          )}
          {state.kind === "running" && (
            <Card className="paperu-progress" aria-live="polite">
              <div className="paperu-progress__head">
                <span className="paperu-progress__stage">{state.progress.stage}</span>
                <span className="paperu-progress__pct">{state.progress.fraction == null ? "…" : `${Math.round(state.progress.fraction * 100)}%`}</span>
              </div>
              <div className="paperu-progress__bar" role="progressbar">
                <div
                  className={state.progress.fraction == null ? "paperu-progress__fill paperu-progress__fill--indeterminate" : "paperu-progress__fill"}
                  style={state.progress.fraction != null ? { width: `${state.progress.fraction * 100}%` } : undefined}
                />
              </div>
              <Button variant="outline" onClick={() => abortRef.current?.abort()} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>Cancel</Button>
            </Card>
          )}
        </>
      )}

      {state.kind === "done" && (
        <Card className="paperu-fitresult" aria-live="polite">
          <div className="paperu-fitresult__stamps">
            <span className="paperu-stamp paperu-stamp--success">✓ Done</span>
            <span className="paperu-stamp paperu-stamp--accent">🔒 Processed locally</span>
          </div>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · Output saved next to the source
          </p>
          <p className="paperu-section__privacy paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>
            <code className="paperu-text-code">{state.outputPath}</code>
          </p>
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={reset}>Fill another</Button>
          </div>
        </Card>
      )}
    </section>
  );
}
