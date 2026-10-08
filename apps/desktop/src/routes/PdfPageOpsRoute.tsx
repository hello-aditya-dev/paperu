/**
 * PDF Page Ops route — rotate / delete / extract / reorder / reverse /
 * page-size / metadata (90% §22-24, Wave 2). Rust-native via lopdf (MIT).
 *
 * The engine takes the source path, reads bytes via Rust, operates on the
 * page tree in-memory, returns modified bytes (base64). The frontend
 * finalizes via finalizeOutput(absoluteSourcePath, …). Source-safety §22:
 * the original is never modified.
 */

import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { InspectFileResponse, PdfMetadata } from "@paperu/contracts";
import { PAGE_SIZES } from "@paperu/contracts";
import {
  base64ToBytes,
  deletePdfPages,
  extractPdfPages,
  finalizeOutput,
  inspectFile,
  inspectPdfMetadata,
  openPath,
  pdfNativePageCount,
  removePdfMetadata,
  reorderPdfPages,
  revealPath,
  reversePdfPages,
  rotatePdfPages,
  cropPdfPages,
  setPdfPageSize,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";
import { readFileBytes } from "@/lib/file-picker";

type Mode =
  | "rotate"
  | "delete"
  | "extract"
  | "reorder"
  | "reverse"
  | "page-size"
  | "crop"
  | "metadata"
  | "insert";

type InsertSubMode = "pdf" | "image" | "blank";

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: "rotate", label: "Rotate" },
  { id: "delete", label: "Delete" },
  { id: "extract", label: "Extract" },
  { id: "reorder", label: "Reorder" },
  { id: "reverse", label: "Reverse" },
  { id: "page-size", label: "Page size" },
  { id: "crop", label: "Crop" },
  { id: "insert", label: "Insert" },
  { id: "metadata", label: "Metadata" },
];

const INSERT_SUBMODES: ReadonlyArray<{ id: InsertSubMode; label: string }> = [
  { id: "pdf", label: "From PDF" },
  { id: "image", label: "Image as page" },
  { id: "blank", label: "Blank pages" },
];

function parsePages(text: string, max: number): number[] | string {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const out: number[] = [];
  for (const part of trimmed.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const range = p.split("-");
    if (range.length === 1) {
      const n = parseInt(range[0]!, 10);
      if (Number.isNaN(n) || n < 1 || n > max) return `Page ${p} is out of range (1–${max}).`;
      out.push(n);
    } else if (range.length === 2) {
      const a = parseInt(range[0]!, 10);
      const b = parseInt(range[1]!, 10);
      if (Number.isNaN(a) || Number.isNaN(b) || a < 1 || b < a || b > max) return `Range ${p} is invalid (1–${max}).`;
      for (let i = a; i <= b; i++) out.push(i);
    } else {
      return `Couldn't parse "${p}".`;
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function PdfPageOpsRoute(): React.ReactNode {
  const [file, setFile] = useState<InspectFileResponse | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [mode, setMode] = useState<Mode>("rotate");
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [pagesText, setPagesText] = useState("");
  const [reorderText, setReorderText] = useState("");
  const [pageSize, setPageSize] = useState<keyof typeof PAGE_SIZES>("a4");
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  // Crop
  const [cropX, setCropX] = useState("50");
  const [cropY, setCropY] = useState("50");
  const [cropW, setCropW] = useState("400");
  const [cropH, setCropH] = useState("600");
  const [metadata, setMetadata] = useState<PdfMetadata | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  // Insert mode state.
  const [insertSubMode, setInsertSubMode] = useState<InsertSubMode>("pdf");
  const [insertAfter, setInsertAfter] = useState("0"); // 0 = at start; N = after page N
  const [insertCount, setInsertCount] = useState("1");
  const [insertPdfPath, setInsertPdfPath] = useState<string | null>(null);
  const [insertImagePath, setInsertImagePath] = useState<string | null>(null);
  const [insertPagesText, setInsertPagesText] = useState(""); // for PDF sub-mode: which source pages

  const loadFile = useCallback(async (path: string) => {
    const inspected = await inspectFile(path);
    if (inspected.kind !== "pdf") {
      setError("That file isn't a PDF.");
      return;
    }
    setFile(inspected);
    setOutputPath(null);
    setError(null);
    const count = await pdfNativePageCount(path);
    setPageCount(count);
  }, []);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a PDF — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        await loadFile(selected);
      }
    } catch {
      // Dialog dismissed.
    }
  }

  async function run(): Promise<void> {
    if (!file) { setError("Choose a PDF first."); return; }
    setError(null);
    setOutputPath(null);
    setProcessing(true);
    try {
      let res;
      if (mode === "rotate") {
        const parsed = parsePages(pagesText, pageCount);
        if (typeof parsed === "string") { setError(parsed); return; }
        res = await rotatePdfPages(file.path, angle, parsed);
      } else if (mode === "delete") {
        const parsed = parsePages(pagesText, pageCount);
        if (typeof parsed === "string") { setError(parsed); return; }
        if (parsed.length === 0) { setError("Enter page numbers to delete."); return; }
        if (parsed.length >= pageCount) { setError("Refusing to delete every page."); return; }
        res = await deletePdfPages(file.path, parsed);
      } else if (mode === "extract") {
        const parsed = parsePages(pagesText, pageCount);
        if (typeof parsed === "string") { setError(parsed); return; }
        if (parsed.length === 0) { setError("Enter page numbers to keep."); return; }
        res = await extractPdfPages(file.path, parsed);
      } else if (mode === "reorder") {
        const parsed = parsePages(reorderText, pageCount);
        if (typeof parsed === "string") { setError(parsed); return; }
        if (parsed.length !== pageCount) { setError(`Reorder list must include all ${pageCount} pages.`); return; }
        res = await reorderPdfPages(file.path, parsed);
      } else if (mode === "reverse") {
        res = await reversePdfPages(file.path);
      } else if (mode === "crop") {
        const x = parseFloat(cropX) || 0;
        const y = parseFloat(cropY) || 0;
        const w = parseFloat(cropW) || 0;
        const h = parseFloat(cropH) || 0;
        if (w <= 0 || h <= 0) { setError("Enter valid crop width + height."); return; }
        res = await cropPdfPages(file.path, x, y, w, h, []);
      } else if (mode === "page-size") {
        const w = customW ? parseFloat(customW) : PAGE_SIZES[pageSize].width;
        const h = customH ? parseFloat(customH) : PAGE_SIZES[pageSize].height;
        if (!w || !h || w <= 0 || h <= 0) { setError("Enter valid width + height."); return; }
        res = await setPdfPageSize(file.path, w, h, []);
      } else if (mode === "insert") {
        // Insert is handled separately (pdf-lib based) — see runInsert.
        await runInsert();
        return;
      } else {
        // metadata — remove
        res = await removePdfMetadata(file.path);
      }
      const bytes = base64ToBytes(res.bytesBase64);
      const finalized = await finalizeOutput(file.path, `-${mode}`, "pdf", bytes);
      setOutputPath(finalized.outputPath);
      setPageCount(res.pageCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function inspectMeta(): Promise<void> {
    if (!file) return;
    setError(null);
    try {
      setMetadata(await inspectPdfMetadata(file.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pickInsertPdf(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose the source PDF — Paperu",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        setInsertPdfPath(selected);
      }
    } catch {
      // dismissed
    }
  }

  async function pickInsertImage(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose an image — Paperu",
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (typeof selected === "string" && selected.length > 0) {
        setInsertImagePath(selected);
      }
    } catch {
      // dismissed
    }
  }

  /// Insert pages via pdf-lib (lazy). Output is finalized via
  /// finalizeOutput (the canonical non-destructive path — the original
  /// file is never modified).
  ///
  /// Approach: build a FRESH output doc, copy the target's pages
  /// (before + inserted + after) into it in order. This avoids the
  /// pdf-lib PageList API quirks around in-place reordering.
  async function runInsert(): Promise<void> {
    if (!file) return;
    setError(null);
    setOutputPath(null);
    setProcessing(true);
    try {
      const pos = parseInt(insertAfter, 10);
      if (Number.isNaN(pos) || pos < 0 || pos > pageCount) {
        setError(`Insert position must be 0–${pageCount} (0 = at start).`);
        return;
      }
      const { PDFDocument } = await import("pdf-lib");
      const targetBytes = await readFileBytes(file.path);
      const sourceDoc = await PDFDocument.load(targetBytes);
      const outDoc = await PDFDocument.create();
      let insertedCount = 0;
      // Copy the first `pos` pages from the source into out.
      const beforeIndices = Array.from({ length: pos }, (_, i) => i);
      if (beforeIndices.length > 0) {
        const beforePages = await outDoc.copyPages(sourceDoc, beforeIndices);
        for (const p of beforePages) outDoc.addPage(p);
      }
      // Now the inserted pages.
      if (insertSubMode === "pdf") {
        if (!insertPdfPath) {
          setError("Pick a source PDF to insert pages from.");
          return;
        }
        const insertBytes = await readFileBytes(insertPdfPath);
        const insertDoc = await PDFDocument.load(insertBytes);
        const insertPageCount = insertDoc.getPageCount();
        const parsed = parsePages(insertPagesText, insertPageCount);
        if (typeof parsed === "string") {
          setError(parsed);
          return;
        }
        const indices = parsed.length === 0
          ? Array.from({ length: insertPageCount }, (_, i) => i)
          : parsed.map((p) => p - 1);
        const inserted = await outDoc.copyPages(insertDoc, indices);
        for (const p of inserted) outDoc.addPage(p);
        insertedCount = inserted.length;
      } else if (insertSubMode === "image") {
        if (!insertImagePath) {
          setError("Pick an image to insert as a page.");
          return;
        }
        const count = parseInt(insertCount, 10) || 1;
        const imgBytes = await readFileBytes(insertImagePath);
        const isPng = insertImagePath.toLowerCase().endsWith(".png");
        const img = isPng
          ? await outDoc.embedPng(imgBytes)
          : await outDoc.embedJpg(imgBytes);
        const A4_W = 595.28;
        const A4_H = 841.89;
        const scale = Math.min(A4_W / img.width, A4_H / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        for (let i = 0; i < count; i++) {
          const page = outDoc.addPage([A4_W, A4_H]);
          page.drawImage(img, {
            x: (A4_W - drawW) / 2,
            y: (A4_H - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        }
        insertedCount = count;
      } else {
        // blank
        const count = parseInt(insertCount, 10) || 1;
        const A4_W = 595.28;
        const A4_H = 841.89;
        for (let i = 0; i < count; i++) {
          outDoc.addPage([A4_W, A4_H]);
        }
        insertedCount = count;
      }
      // Copy the remaining `pageCount - pos` pages from the source.
      const afterIndices = Array.from({ length: pageCount - pos }, (_, i) => i + pos);
      if (afterIndices.length > 0) {
        const afterPages = await outDoc.copyPages(sourceDoc, afterIndices);
        for (const p of afterPages) outDoc.addPage(p);
      }
      const outBytes = new Uint8Array(await outDoc.save({ useObjectStreams: true }));
      const finalized = await finalizeOutput(file.path, "-insert", "pdf", outBytes);
      setOutputPath(finalized.outputPath);
      setPageCount(pageCount + insertedCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="ppo-heading">
      <header className="paperu-section__header">
        <h1 id="ppo-heading" className="paperu-text-display">PDF page operations</h1>
        <p className="paperu-text-lead">
          Rotate, delete, extract, reorder, reverse, resize pages, and strip metadata — Rust-native (lopdf), non-destructive, saved next to the original.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={handlePick} disabled={processing}>Choose a PDF</Button>
          {file && (
            <div style={{ marginTop: "var(--paperu-space-3)" }}>
              <div className="paperu-text-code paperu-break-all" title={file.path}>{file.path}</div>
              <div className="paperu-text-caption paperu-text-numeric">{pageCount} pages · {file.size.humanReadable}</div>
            </div>
          )}
        </div>
      </Card>

      {file && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--paperu-space-2)" }}>
              {MODES.map((m) => (
                <button key={m.id} type="button" className={`paperu-target__preset${mode === m.id ? " is-active" : ""}`} onClick={() => { setMode(m.id); setOutputPath(null); setError(null); }} aria-pressed={mode === m.id} style={{ padding: "var(--paperu-space-2) var(--paperu-space-3)" }}>{m.label}</button>
              ))}
            </div>
            {mode === "rotate" && (
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
                {([90, 180, 270] as const).map((a) => (
                  <button key={a} type="button" className={`paperu-target__preset${angle === a ? " is-active" : ""}`} onClick={() => setAngle(a)} aria-pressed={angle === a} style={{ padding: "var(--paperu-space-3)" }}>{a}°</button>
                ))}
              </div>
            )}
            {(mode === "rotate" || mode === "delete" || mode === "extract") && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <label className="paperu-text-label" htmlFor="ppo-pages">Pages {mode === "rotate" ? "(blank = all)" : ""}</label>
                <input id="ppo-pages" className="paperu-target__input" placeholder={`e.g. 1, 3, 5-8 (1–${pageCount})`} value={pagesText} onChange={(e) => { setPagesText(e.target.value); setError(null); }} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
              </div>
            )}
            {mode === "reorder" && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <label className="paperu-text-label" htmlFor="ppo-reorder">New page order (all {pageCount} pages, comma-separated)</label>
                <input id="ppo-reorder" className="paperu-target__input" placeholder={`e.g. 3, 1, 2, ${pageCount > 3 ? "..." : ""}`} value={reorderText} onChange={(e) => { setReorderText(e.target.value); setError(null); }} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
              </div>
            )}
            {mode === "page-size" && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
                  {(["a4", "letter", "legal"] as const).map((s) => (
                    <button key={s} type="button" className={`paperu-target__preset${pageSize === s ? " is-active" : ""}`} onClick={() => { setPageSize(s); setCustomW(""); setCustomH(""); }} aria-pressed={pageSize === s} style={{ padding: "var(--paperu-space-3)" }}>{PAGE_SIZES[s].label}</button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
                  <input className="paperu-target__input" placeholder={`Custom width (blank = ${PAGE_SIZES[pageSize].width})`} value={customW} onChange={(e) => setCustomW(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <input className="paperu-target__input" placeholder={`Custom height (blank = ${PAGE_SIZES[pageSize].height})`} value={customH} onChange={(e) => setCustomH(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
              </div>
            )}
            {mode === "crop" && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <span className="paperu-text-label">Crop pages (CropBox — visible region)</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)" }}>
                  <input className="paperu-target__input" placeholder="X (pt)" value={cropX} onChange={(e) => setCropX(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <input className="paperu-target__input" placeholder="Y (pt)" value={cropY} onChange={(e) => setCropY(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <input className="paperu-target__input" placeholder="Width (pt)" value={cropW} onChange={(e) => setCropW(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <input className="paperu-target__input" placeholder="Height (pt)" value={cropH} onChange={(e) => setCropH(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
              </div>
            )}
            {mode === "metadata" && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <Button variant="outline" onClick={inspectMeta} disabled={processing}>Inspect metadata</Button>
                {metadata && (
                  <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-1)" }}>
                    {(["title","author","subject","keywords","creator","producer","creationDate","modDate"] as const).map((f) => (
                      <li key={f} className="paperu-text-code" style={{ fontSize: "var(--paperu-text-xs)" }}>
                        <strong>{f}:</strong> {metadata[f] ?? "(none)"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {mode === "insert" && (
              <div style={{ marginTop: "var(--paperu-space-3)" }}>
                <div style={{ display: "flex", gap: "var(--paperu-space-2)", flexWrap: "wrap" }}>
                  {INSERT_SUBMODES.map((s) => (
                    <button key={s.id} type="button" className={`paperu-target__preset${insertSubMode === s.id ? " is-active" : ""}`} onClick={() => setInsertSubMode(s.id)} aria-pressed={insertSubMode === s.id} style={{ padding: "var(--paperu-space-2) var(--paperu-space-3)" }}>{s.label}</button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
                  <div>
                    <label className="paperu-text-label" htmlFor="ppo-ins-after">Insert after page</label>
                    <input id="ppo-ins-after" className="paperu-target__input" placeholder={`0–${pageCount} (0 = at start)`} value={insertAfter} onChange={(e) => setInsertAfter(e.target.value.replace(/[^0-9]/g, ""))} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
                  </div>
                  {(insertSubMode === "image" || insertSubMode === "blank") && (
                    <div>
                      <label className="paperu-text-label" htmlFor="ppo-ins-count">Count</label>
                      <input id="ppo-ins-count" className="paperu-target__input" placeholder="1" value={insertCount} onChange={(e) => setInsertCount(e.target.value.replace(/[^0-9]/g, ""))} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
                    </div>
                  )}
                </div>
                {insertSubMode === "pdf" && (
                  <div style={{ marginTop: "var(--paperu-space-3)" }}>
                    <Button variant="outline" onClick={pickInsertPdf} disabled={processing}>Pick source PDF</Button>
                    {insertPdfPath && (
                      <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-1)" }}>{insertPdfPath}</div>
                    )}
                    <div style={{ marginTop: "var(--paperu-space-2)" }}>
                      <label className="paperu-text-label" htmlFor="ppo-ins-pages">Source pages (blank = all)</label>
                      <input id="ppo-ins-pages" className="paperu-target__input" placeholder="e.g. 1, 3, 5-8" value={insertPagesText} onChange={(e) => setInsertPagesText(e.target.value)} style={{ width: "100%", marginTop: "var(--paperu-space-1)" }} />
                    </div>
                  </div>
                )}
                {insertSubMode === "image" && (
                  <div style={{ marginTop: "var(--paperu-space-3)" }}>
                    <Button variant="outline" onClick={pickInsertImage} disabled={processing}>Pick image (PNG/JPEG)</Button>
                    {insertImagePath && (
                      <div className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-1)" }}>{insertImagePath}</div>
                    )}
                  </div>
                )}
                <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>
                  Inserted pages are placed at the specified position. The original is never modified — output is saved as a new file via finalizeOutput.
                </p>
              </div>
            )}
            <Button variant="accent" onClick={run} disabled={processing} style={{ width: "100%", marginTop: "var(--paperu-space-4)" }}>
              {processing ? "Working…" : mode === "reverse" ? "Reverse pages" : mode === "page-size" ? "Set page size" : mode === "metadata" ? "Remove metadata" : mode === "insert" ? `Insert ${insertSubMode === "pdf" ? "PDF pages" : insertSubMode === "image" ? "image pages" : "blank pages"}` : `${mode} pages`}
            </Button>
          </div>
        </Card>
      )}

      {outputPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ {mode} done · {pageCount} pages</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{outputPath}</p>
            <div className="paperu-fitresult__actions">
              <Button variant="accent" onClick={() => void openPath(outputPath)}>Open</Button>
              <Button variant="outline" onClick={() => void revealPath(outputPath)}>Open folder</Button>
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
