/**
 * Assignment Studio route — orchestrate photos/PDFs into one submission PDF
 * (Master Prompt 4 §8-11, deepened §20 Wave B).
 *
 * CANONICAL NATIVE-PATH ARCHITECTURE (no basename):
 *   native Tauri picker → absolute paths → inspectFile (real kind)
 *   → readFileBytes → in-memory File for engine → merge in USER ORDER
 *   → finalizeOutput(REAL ABSOLUTE PATH, …)
 *
 * Deepened beyond V1 (§20):
 *   - Cover page (optional): clean A4 cover with title / student name /
 *     enrolment / course / subject / date, generated with pdf-lib.
 *   - Page numbers (optional): deterministic, bottom-center, configurable
 *     start page, applied to every page after the cover.
 *   - Target size (optional): reuse fitPdfToSize on the merged result so
 *     the whole submission fits a portal size limit (e.g. under 2 MB).
 *
 * A4 normalization honesty (§20 "A4 normalization"): image-derived
 * pages are already A4 (imagesToPdf layout: "a4"). Original PDFs pass
 * through at their native page size — forcing arbitrary source PDFs
 * onto A4 would require embedding each source page onto an A4 sheet
 * (the Print Studio pattern). That's a deliberate next step; for now
 * the merge preserves source page sizes truthfully.
 *
 * Source safety (§11): picked files are read-only. Output goes through
 * the canonical finalize_output path (atomic, non-destructive).
 */

import { useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fitPdfToSize, mergePdfs, imagesToPdf } from "@/engines/pdf-engine";
import { pickAndInspectFiles, readFileBytes, type PickedFile } from "@/lib/file-picker";
import { finalizeOutput, openPath, revealPath } from "@/lib/ipc";
import { useRecentFiles } from "@/lib/recent-files";
import { Button, Card } from "@paperu/ui";

interface CoverFields {
  enabled: boolean;
  title: string;
  studentName: string;
  enrolment: string;
  course: string;
  subject: string;
  date: string;
}

interface PageNumberOptions {
  enabled: boolean;
  startPage: number;
  position: "bottom-center" | "bottom-right";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const A4_W = 595.28;
const A4_H = 841.89;

/** Build a clean A4 cover page PDF (bytes) from the provided fields. */
async function buildCoverPdf(fields: CoverFields): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_W, A4_H]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  // A subtle accent rule under the title.
  page.drawRectangle({ x: 56, y: A4_H - 130, width: A4_W - 112, height: 2, color: rgb(0.18, 0.31, 0.45) });

  page.drawText("Paperu Assignment", {
    x: 56, y: A4_H - 80, size: 12, font: helvetica, color: rgb(0.4, 0.4, 0.4),
  });

  if (fields.title) {
    const lines = wrapText(fields.title, 38);
    let y = A4_H - 120;
    for (const line of lines.slice(0, 3)) {
      page.drawText(line, { x: 56, y, size: 24, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
      y -= 30;
    }
  }

  // Metadata block.
  const rows: Array<[string, string]> = [
    ["Name", fields.studentName],
    ["Enrolment / Roll", fields.enrolment],
    ["Course", fields.course],
    ["Subject", fields.subject],
    ["Date", fields.date],
  ];
  let y = A4_H - 260;
  for (const [label, value] of rows) {
    if (!value) { y -= 26; continue; }
    page.drawText(label, { x: 56, y, size: 11, font: helvetica, color: rgb(0.45, 0.45, 0.45) });
    page.drawText(value, { x: 220, y, size: 12, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 26;
  }

  page.drawText("Generated locally by Paperu — 0 bytes uploaded.", {
    x: 56, y: 40, size: 9, font: helvetica, color: rgb(0.55, 0.55, 0.55),
  });

  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

/** Naive word-wrap for long titles. */
function wrapText(s: string, maxChars: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.length ? lines : [""];
}

/** Apply deterministic page numbers to every page of a PDF (bytes). */
async function applyPageNumbers(
  bytes: Uint8Array,
  opts: PageNumberOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + opts.startPage;
    const label = String(pageNum);
    const page = pages[i]!;
    const textWidth = font.widthOfTextAtSize(label, 10);
    const margin = 24;
    const x = opts.position === "bottom-center"
      ? (page.getWidth() - textWidth) / 2
      : page.getWidth() - margin - textWidth;
    page.drawText(label, {
      x, y: margin, size: 10, font, color: rgb(0.4, 0.4, 0.4),
    });
  }
  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}

export function AssignmentStudioRoute(): React.ReactNode {
  const [files, setFiles] = useState<readonly PickedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState<number | null>(null);
  const [cover, setCover] = useState<CoverFields>({
    enabled: false,
    title: "",
    studentName: "",
    enrolment: "",
    course: "",
    subject: "",
    date: "",
  });
  const [pageNumbers, setPageNumbers] = useState<PageNumberOptions>({
    enabled: false,
    startPage: 1,
    position: "bottom-center",
  });
  const [targetKb, setTargetKb] = useState<number | null>(null);
  const addRecent = useRecentFiles((s) => s.add);

  const onPick = async () => {
    setError(null);
    try {
      const picked = await pickAndInspectFiles({
        multiple: true,
        accept: "application/pdf,image/*",
      });
      if (picked.length === 0) return;
      setFiles((cur) => [...cur, ...picked]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeFile = (idx: number) => {
    setFiles((cur) => cur.filter((_, i) => i !== idx));
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    setFiles((cur) => {
      const next = [...cur];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return cur;
      const a = next[idx];
      const b = next[target];
      if (!a || !b) return cur;
      next[idx] = b;
      next[target] = a;
      return next;
    });
  };

  const onBuild = async () => {
    if (files.length === 0) {
      setError("Add at least one file first.");
      return;
    }
    setProcessing(true);
    setError(null);
    setResultPath(null);
    setResultSize(null);
    try {
      // Process files IN USER ORDER: convert each image to a 1-page A4
      // PDF, keep original PDFs as-is. Do NOT group by kind.
      const inputFiles: File[] = [];
      for (const picked of files) {
        const bytes = await readFileBytes(picked.path);
        if (picked.kind === "image") {
          const imgFile = new File(
            [new Blob([bytes.slice()], { type: picked.mimeType ?? "image/*" })],
            picked.fileName,
            { type: picked.mimeType ?? "image/*" },
          );
          const onePagePdfBytes = await imagesToPdf([imgFile], { layout: "a4" });
          inputFiles.push(new File(
            [new Blob([onePagePdfBytes.slice()], { type: "application/pdf" })],
            `${picked.fileName}.pdf`,
            { type: "application/pdf" },
          ));
        } else {
          inputFiles.push(new File(
            [new Blob([bytes.slice()], { type: "application/pdf" })],
            picked.fileName,
            { type: "application/pdf" },
          ));
        }
      }

      // Optional cover page goes first.
      const pdfsToMerge: File[] = [];
      if (cover.enabled && (cover.title || cover.studentName)) {
        const coverBytes = await buildCoverPdf(cover);
        pdfsToMerge.push(new File(
          [new Blob([coverBytes.slice()], { type: "application/pdf" })],
          "cover.pdf",
          { type: "application/pdf" },
        ));
      }
      pdfsToMerge.push(...inputFiles);

      // Merge all in USER ORDER (cover prepended).
      const mergedBytes: Uint8Array =
        pdfsToMerge.length === 1
          ? new Uint8Array(await pdfsToMerge[0]!.arrayBuffer())
          : await mergePdfs(pdfsToMerge);

      // Optional page numbers (applied after merge so numbering is
      // contiguous across the whole submission).
      let finalBytes = mergedBytes;
      if (pageNumbers.enabled) {
        finalBytes = await applyPageNumbers(mergedBytes, pageNumbers);
      }

      // Optional target-size fit (reuse fitPdfToSize).
      if (targetKb && targetKb > 0) {
        const fitFile = new File(
          [new Blob([finalBytes.slice()], { type: "application/pdf" })],
          "submission.pdf",
          { type: "application/pdf" },
        );
        const r = await fitPdfToSize(fitFile, { targetBytes: targetKb * 1024 });
        finalBytes = r.bytes;
      }

      // Finalize with the REAL absolute source path (no basename).
      const firstSourcePath = files[0]!.path;
      const result = await finalizeOutput(firstSourcePath, "-paperu-assignment", "pdf", finalBytes);
      setResultPath(result.outputPath);
      setResultSize(finalBytes.byteLength);
      addRecent({
        path: result.outputPath,
        fileName: result.output.fileName,
        kind: result.output.kind,
        humanReadableSize: result.output.size.humanReadable,
        operation: "Built assignment",
        timestamp: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <section className="paperu-section" aria-labelledby="asg-heading">
      <header className="paperu-section__header">
        <h1 id="asg-heading" className="paperu-text-display">Assignment Studio</h1>
        <p className="paperu-text-lead">
          Add photos, screenshots, or PDFs. Build one submission PDF — in your chosen order, with optional cover page, page numbers, and target size.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <Button variant="accent" onClick={onPick} disabled={processing}>+ Add photos or PDFs</Button>
          {files.length === 0 ? (
            <p className="paperu-text-caption" style={{ marginTop: "var(--paperu-space-3)" }}>No files yet. Pick photos or PDFs to start.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--paperu-space-3)", display: "grid", gap: "var(--paperu-space-2)" }}>
              {files.map((f, idx) => (
                <li key={`${f.path}-${idx}`} style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)", padding: "var(--paperu-space-2)", border: "1px solid var(--paperu-border-subtle)", borderRadius: "var(--paperu-radius-2)" }}>
                  <span aria-hidden="true">{f.kind === "image" ? "▦" : "▤"}</span>
                  <span className="paperu-truncate" style={{ flex: 1 }} title={f.path}>{f.fileName}</span>
                  <button type="button" onClick={() => moveFile(idx, -1)} disabled={idx === 0 || processing} aria-label="Move up">▴</button>
                  <button type="button" onClick={() => moveFile(idx, 1)} disabled={idx === files.length - 1 || processing} aria-label="Move down">▾</button>
                  <button type="button" onClick={() => removeFile(idx)} disabled={processing} aria-label="Remove">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
            <input type="checkbox" checked={cover.enabled} onChange={(e) => setCover({ ...cover, enabled: e.target.checked })} disabled={processing} />
            <span className="paperu-text-label">Add a cover page</span>
          </label>
          {cover.enabled && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
              <input className="paperu-target__input" placeholder="Assignment title" value={cover.title} onChange={(e) => setCover({ ...cover, title: e.target.value })} style={{ gridColumn: "1 / 3" }} />
              <input className="paperu-target__input" placeholder="Student name" value={cover.studentName} onChange={(e) => setCover({ ...cover, studentName: e.target.value })} />
              <input className="paperu-target__input" placeholder="Enrolment / Roll no." value={cover.enrolment} onChange={(e) => setCover({ ...cover, enrolment: e.target.value })} />
              <input className="paperu-target__input" placeholder="Course" value={cover.course} onChange={(e) => setCover({ ...cover, course: e.target.value })} />
              <input className="paperu-target__input" placeholder="Subject" value={cover.subject} onChange={(e) => setCover({ ...cover, subject: e.target.value })} />
              <input className="paperu-target__input" placeholder="Date" value={cover.date} onChange={(e) => setCover({ ...cover, date: e.target.value })} />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--paperu-space-2)" }}>
            <input type="checkbox" checked={pageNumbers.enabled} onChange={(e) => setPageNumbers({ ...pageNumbers, enabled: e.target.checked })} disabled={processing} />
            <span className="paperu-text-label">Add page numbers</span>
          </label>
          {pageNumbers.enabled && (
            <div style={{ display: "flex", gap: "var(--paperu-space-3)", marginTop: "var(--paperu-space-3)", flexWrap: "wrap", alignItems: "center" }}>
              <label className="paperu-text-caption">Start at</label>
              <input className="paperu-target__input" type="number" min={1} value={pageNumbers.startPage} onChange={(e) => setPageNumbers({ ...pageNumbers, startPage: Math.max(1, parseInt(e.target.value, 10) || 1) })} style={{ width: "80px" }} />
              <label className="paperu-text-caption">Position</label>
              <select className="paperu-target__input" value={pageNumbers.position} onChange={(e) => setPageNumbers({ ...pageNumbers, position: e.target.value as PageNumberOptions["position"] })}>
                <option value="bottom-center">Bottom center</option>
                <option value="bottom-right">Bottom right</option>
              </select>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          <label className="paperu-text-label">Target size (optional)</label>
          <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-2)", flexWrap: "wrap" }}>
            <button type="button" className={`paperu-target__preset${targetKb === null ? " is-active" : ""}`} onClick={() => setTargetKb(null)} style={{ padding: "var(--paperu-space-2) var(--paperu-space-3)" }}>No limit</button>
            {[1024, 2048, 5120].map((kb) => (
              <button key={kb} type="button" className={`paperu-target__preset${targetKb === kb ? " is-active" : ""}`} onClick={() => setTargetKb(kb)} style={{ padding: "var(--paperu-space-2) var(--paperu-space-3)" }}>Under {kb < 1024 ? `${kb} KB` : `${kb / 1024} MB`}</button>
            ))}
          </div>
        </div>
      </Card>

      <Button variant="accent" onClick={onBuild} disabled={processing || files.length === 0} style={{ width: "100%" }}>
        {processing ? "Building…" : "Build assignment"}
      </Button>

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}

      {resultPath && (
        <Card className="paperu-fitresult">
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div className="paperu-fitresult__stamps">
              <span className="paperu-stamp paperu-stamp--success">✓ Built ({resultSize != null ? formatBytes(resultSize) : ""})</span>
              <span className="paperu-stamp paperu-stamp--accent">🔒 Local only</span>
            </div>
            <p className="paperu-text-code paperu-break-all" style={{ marginTop: "var(--paperu-space-3)" }}>{resultPath}</p>
            <div className="paperu-fitresult__actions">
              <Button variant="accent" onClick={() => void openPath(resultPath)}>Open</Button>
              <Button variant="outline" onClick={() => void revealPath(resultPath)}>Open folder</Button>
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}
