/**
 * SignPdfView — place an electronic signature on a PDF page.
 *
 * Draw/import signature → pick page → click on the page preview to place
 * → adjust width → Sign & save. The output is finalized to disk via the
 * canonical atomic-finalization path.
 *
 * This is an ELECTRONIC SIGNATURE (visible image placement), NOT a PKI
 * certificate digital signature. The doctrine §16 requires this distinction.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFile, readFileBytes, finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { Card, Button } from "@paperu/ui";
import { SignaturePad } from "@/components/SignaturePad";
import { signPdf, renderPdfPage, type PdfFitProgress, type PageRenderResult } from "@/engines/pdf-engine";

type State =
  | { kind: "idle" }
  | { kind: "inspecting"; path: string }
  | { kind: "ready"; file: InspectFileResponse }
  | { kind: "running"; progress: PdfFitProgress }
  | { kind: "done"; outputPath: string }
  | { kind: "error"; error: AppError };

interface Pick {
  x: number;
  y: number;
  pageWidthPt: number;
  pageHeightPt: number;
}

interface DragDropEvent {
  paths: string[];
}

export function SignPdfView(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [stagedFile, setStagedFile] = useState<InspectFileResponse | null>(null);
  const [sigPng, setSigPng] = useState<Uint8Array | null>(null);
  const [sigDims, setSigDims] = useState<{ w: number; h: number } | null>(null);
  const [page, setPage] = useState(1);
  const [pick, setPick] = useState<Pick | null>(null);
  const [widthPt, setWidthPt] = useState(140);
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
      // Read bytes and render the first page.
      const bytes = await readFileBytes(path);
      setFileBytes(bytes);
      setPage(1);
      setPick(null);
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
      // Page render failed; preview unavailable but signing still works.
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
        title: "Choose a PDF to sign — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        await handlePath(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  // Decode signature dimensions when the PNG changes.
  useEffect(() => {
    if (!sigPng) { setSigDims(null); return; }
    let cancelled = false;
    createImageBitmap(new Blob([sigPng.slice()], { type: "image/png" }))
      .then((bmp) => {
        if (cancelled) return;
        setSigDims({ w: bmp.width, h: bmp.height });
        bmp.close?.();
      })
      .catch(() => setSigDims(null));
    return () => { cancelled = true; };
  }, [sigPng]);

  // Manage the signature preview object URL — revoke on change/unmount
  // to prevent memory leaks (doctrine §43).
  const [sigPreviewUrl, setSigPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!sigPng) { setSigPreviewUrl(null); return; }
    const url = URL.createObjectURL(new Blob([sigPng.slice()], { type: "image/png" }));
    setSigPreviewUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [sigPng]);

  const heightPt = sigDims ? (widthPt * sigDims.h) / sigDims.w : widthPt * 0.4;

  function onPageClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (!pageRender) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    // Convert to PDF points (origin bottom-left).
    const xPt = xPx / pageRender.scale;
    const yPt = pageRender.heightPt - yPx / pageRender.scale;
    setPick({
      x: xPt,
      y: yPt,
      pageWidthPt: pageRender.widthPt,
      pageHeightPt: pageRender.heightPt,
    });
  }

  async function changePage(newPage: number): Promise<void> {
    setPage(newPage);
    setPick(null);
    if (fileBytes) await renderPage(fileBytes, newPage);
  }

  async function run(): Promise<void> {
    if (!stagedFile || !sigPng || !pick) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", progress: { fraction: 0, stage: "Signing…" } });
    try {
      const bytes = await readFileBytes(stagedFile.path);
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const file = new File([ab], stagedFile.fileName, { type: "application/pdf" });
      const out = await signPdf(file, sigPng, {
        page,
        x: pick.x,
        y: pick.y,
        width: widthPt,
        height: heightPt,
      }, {
        signal: controller.signal,
        onProgress: (p) => setState({ kind: "running", progress: p }),
      });
      const finalized = await finalizeOutput(stagedFile.path, "-signed", "pdf", out);
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
    setSigPng(null);
    setPick(null);
    setFileBytes(null);
    setPageRender(null);
  }

  return (
    <section className="paperu-section" aria-labelledby="sign-heading">
      <header className="paperu-section__header">
        <h1 id="sign-heading" className="paperu-text-display">Sign PDF</h1>
        <p className="paperu-text-lead">
          Draw or import your signature, place it on the page, save. A visible
          electronic signature — not a cryptographic certificate signature.
          Signatures stay on this machine.
        </p>
      </header>

      {(state.kind === "idle" || state.kind === "error") && (
        <>
          <div className="paperu-dropzone" role="region" aria-label="Drop a PDF here or choose one">
            <div className="paperu-dropzone__inner">
              <div className="paperu-dropzone__glyph" aria-hidden="true">⌁</div>
              <p className="paperu-dropzone__title">Drop a PDF here</p>
              <p className="paperu-dropzone__hint">{state.kind === "error" ? state.error.message : "Place your signature on any page."}</p>
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

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <SignaturePad onChange={setSigPng} />
            </div>
          </Card>

          <Card>
            <div style={{ padding: "var(--paperu-space-5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-3)", marginBottom: "var(--paperu-space-4)" }}>
                <span className="paperu-text-label">Page</span>
                <input
                  type="number"
                  min={1}
                  value={page}
                  onChange={(e) => changePage(Math.max(1, parseInt(e.target.value || "1", 10)))}
                  className="paperu-target__input"
                  style={{ width: "80px" }}
                  aria-label="Page number"
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="paperu-text-label">Signature width</span>
                    <span className="paperu-text-numeric">{Math.round(widthPt)}pt</span>
                  </div>
                  <input type="range" min={60} max={320} step={5} value={widthPt} onChange={(e) => setWidthPt(parseInt(e.target.value, 10))} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} aria-label="Signature width" />
                </div>
              </div>

              <p className="paperu-text-caption" style={{ marginBottom: "var(--paperu-space-2)" }}>
                {sigPng ? "Click on the page preview to place your signature." : "Draw or import a signature first."}
              </p>

              {pageRender && (
                <div style={{ overflowX: "auto" }}>
                  <div
                    style={{ position: "relative", display: "inline-block", cursor: "crosshair", border: "1px solid var(--paperu-border)", borderRadius: "var(--paperu-radius-md)", overflow: "hidden" }}
                    onClick={onPageClick}
                    role="presentation"
                  >
                    {/* The rendered page canvas is appended as an img via data URL */}
                    <img
                      src={pageRender.canvas.toDataURL()}
                      alt={`Page ${page} preview`}
                      style={{ display: "block", maxWidth: "100%", pointerEvents: "none" }}
                    />
                    {pick && sigPng && (
                      <div
                        style={{
                          position: "absolute",
                          left: `${(pick.x / pick.pageWidthPt) * 100}%`,
                          top: `${((pick.pageHeightPt - pick.y - heightPt) / pick.pageHeightPt) * 100}%`,
                          width: `${(widthPt / pick.pageWidthPt) * 100}%`,
                          height: `${(heightPt / pick.pageHeightPt) * 100}%`,
                          border: "2px solid var(--paperu-accent)",
                          pointerEvents: "none",
                        }}
                      >
                        <img
                          src={sigPreviewUrl ?? undefined}
                          alt="Signature placement"
                          style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9 }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {rendering && <p className="paperu-text-caption">Rendering page…</p>}
              {!pageRender && !rendering && <p className="paperu-text-caption">Page preview unavailable.</p>}

              {pick && (
                <p className="paperu-text-caption paperu-text-numeric" style={{ marginTop: "var(--paperu-space-2)" }}>
                  Placed at ({Math.round(pick.x)}, {Math.round(pick.y)})
                </p>
              )}

              <Button
                variant="accent"
                onClick={run}
                disabled={!sigPng || !pick || state.kind === "running"}
                style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}
              >
                {state.kind === "running" ? "Signing…" : "Sign & save"}
              </Button>
              {state.kind === "running" && (
                <Button variant="outline" onClick={() => abortRef.current?.abort()} style={{ width: "100%", marginTop: "var(--paperu-space-2)" }}>
                  Cancel
                </Button>
              )}
            </div>
          </Card>
        </>
      )}

      {state.kind === "done" && (
        <Card className="paperu-fitresult" aria-live="polite">
          <div className="paperu-fitresult__stamps">
            <span className="paperu-stamp paperu-stamp--success">✓ Signed</span>
            <span className="paperu-stamp paperu-stamp--accent">🔒 Processed locally</span>
          </div>
          <p className="paperu-section__privacy" style={{ marginTop: "var(--paperu-space-4)" }}>
            <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes uploaded · Output saved next to the source
          </p>
          <p className="paperu-section__privacy paperu-break-all" style={{ marginTop: "var(--paperu-space-2)" }}>
            <code className="paperu-text-code">{state.outputPath}</code>
          </p>
          <div className="paperu-fitresult__actions">
            <Button variant="accent" onClick={() => void openPath(state.outputPath)}>Open file</Button>
            <Button variant="outline" onClick={() => void revealPath(state.outputPath)}>Open folder</Button>
            <Button variant="ghost" onClick={reset}>Sign another</Button>
          </div>
        </Card>
      )}

      {state.kind === "error" && (
        <Card className="paperu-error" role="alert">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{state.error.message}</h2>
          </div>
          <Button variant="ghost" onClick={reset} style={{ marginTop: "var(--paperu-space-3)" }}>Try again</Button>
        </Card>
      )}
    </section>
  );
}
