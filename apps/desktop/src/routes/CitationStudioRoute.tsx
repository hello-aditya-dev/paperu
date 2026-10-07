/**
 * Citation Studio — deterministic citation formatting (Feature 1).
 * Form → live preview (APA/MLA/Chicago/Harvard/BibTeX) → copy → save → list.
 */
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Author, CitationEntry, SavedCitation } from "@paperu/contracts";
import { CitationCommand } from "@paperu/contracts";

export function CitationStudioRoute(): React.ReactNode {
  const [sourceType, setSourceType] = useState("book");
  const [authors, setAuthors] = useState<Author[]>([{ last: "", first: "" }]);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [publisher, setPublisher] = useState("");
  const [volume, setVolume] = useState("");
  const [issue, setIssue] = useState("");
  const [pages, setPages] = useState("");
  const [url, setUrl] = useState("");
  const [doi, setDoi] = useState("");
  const [isbn, setIsbn] = useState("");
  const [style, setStyle] = useState("apa");
  const [preview, setPreview] = useState("");
  const [saved, setSaved] = useState<readonly SavedCitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buildEntry = (): CitationEntry => ({
    id: null, sourceType, authors, editors: null, year: year || null,
    title, publisher: publisher || null, volume: volume || null,
    issue: issue || null, pages: pages || null, url: url || null,
    doi: doi || null, isbn: isbn || null, notes: null,
  });

  const updatePreview = useCallback(async () => {
    if (!title) { setPreview(""); return; }
    try {
      const res = await invoke<string>(CitationCommand.Format, {
        entry: { id: null, sourceType, authors, editors: null, year: year || null,
          title, publisher: publisher || null, volume: volume || null,
          issue: issue || null, pages: pages || null, url: url || null,
          doi: doi || null, isbn: isbn || null, notes: null }, style });
      setPreview(res);
    } catch { setPreview(""); }
  }, [sourceType, authors, title, year, publisher, volume, issue, pages, url, doi, isbn, style]);

  useEffect(() => { void updatePreview(); }, [updatePreview]);

  const load = async () => {
    setLoading(true);
    try { const r = await invoke<readonly SavedCitation[]>(CitationCommand.List); setSaved(r); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const onSave = async () => {
    if (!title) { setError("Title is required."); return; }
    try { await invoke(CitationCommand.Save, { entry: buildEntry() }); void load(); }
    catch (e) { setError(String(e)); }
  };
  const onDelete = async (id: string) => {
    try { await invoke(CitationCommand.Delete, { id }); void load(); }
    catch (e) { setError(String(e)); }
  };
  const onCopy = () => { void navigator.clipboard.writeText(preview); };

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">Citation Studio</h1>
        <p className="paperu-workspace__subtitle">Deterministic citations — APA, MLA, Chicago, Harvard, BibTeX. No AI.</p>
      </header>

      <fieldset className="paperu-print__options">
        <legend>Source type</legend>
        {["book", "journal", "website", "thesis"].map((t) => (
          <label key={t}><input type="radio" name="stype" checked={sourceType === t} onChange={() => setSourceType(t)} /> {t}</label>
        ))}
      </fieldset>

      {authors.map((a, i) => (
        <div key={i}>
          <input placeholder="Last name" value={a.last} onChange={(e) => setAuthors((prev) => prev.map((x, j) => j === i ? { ...x, last: e.target.value } : x))} />
          <input placeholder="First name" value={a.first} onChange={(e) => setAuthors((prev) => prev.map((x, j) => j === i ? { ...x, first: e.target.value } : x))} />
          {authors.length > 1 && <button onClick={() => setAuthors((prev) => prev.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <button onClick={() => setAuthors((prev) => [...prev, { last: "", first: "" }])}>+ Add author</button>

      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} />
      <input placeholder="Publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
      {sourceType === "journal" && (<>
        <input placeholder="Volume" value={volume} onChange={(e) => setVolume(e.target.value)} />
        <input placeholder="Issue" value={issue} onChange={(e) => setIssue(e.target.value)} />
        <input placeholder="Pages" value={pages} onChange={(e) => setPages(e.target.value)} />
      </>)}
      <input placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input placeholder="DOI" value={doi} onChange={(e) => setDoi(e.target.value)} />
      <input placeholder="ISBN" value={isbn} onChange={(e) => setIsbn(e.target.value)} />

      <select value={style} onChange={(e) => setStyle(e.target.value)}>
        <option value="apa">APA</option><option value="mla">MLA</option>
        <option value="chicago">Chicago</option><option value="harvard">Harvard</option>
        <option value="bibtex">BibTeX</option>
      </select>

      {preview && (
        <div className="paperu-assignment__result">
          <pre>{preview}</pre>
          <button onClick={onCopy}>Copy citation</button>
          <button onClick={onSave}>Save to library</button>
        </div>
      )}

      <h2>Saved citations</h2>
      {loading ? <p>Loading…</p> : saved.length === 0 ? <p>No saved citations yet.</p> : (
        <ul className="paperu-history__list">
          {saved.map((c) => (
            <li key={c.id}>{c.title} ({c.sourceType}) <button onClick={() => onDelete(c.id)}>Delete</button></li>
          ))}
        </ul>
      )}
      {error && <div role="status">{error}</div>}
    </section>
  );
}
