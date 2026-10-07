/**
 * Typed Tauri IPC client.
 *
 * The only sanctioned way for the React layer to call native code.
 * Wraps Tauri's `invoke` with the contracts from `@paperu/contracts`
 * and converts rejections into structured `AppError` values. The UI
 * never receives raw strings.
 *
 * When running outside Tauri (unit tests, plain browser), calls fall
 * back to a registered mock so components can be tested without a
 * native backend. Production never mocks.
 */

import type {
  AddApplicationKitItemRequest,
  AddRecentWorkRequest,
  AppError,
  AppInfo,
  ApplicationKitItem,
  CreateNoteFolderRequest,
  CreateNoteRequest,
  CreateResult,
  DryRunResult,
  ExecuteResult,
  ExtractResult,
  FileEntry,
  DuplicateGroup,
  InspectFileResponse,
  ListResult,
  Note,
  NoteFolder,
  OrganizerRule,
  PdfMetadata,
  PdfNativeResponse,
  ReadingHistoryEntry,
  RecentWorkEntry,
  RescueDiagnosis,
  Settings,
  SettingsPatch,
  UpdateApplicationKitItemRequest,
  UpdateNoteRequest,
  UpdateReadingHistoryRequest,
} from "@paperu/contracts";
import {
  ApplicationKitCommand,
  ArchiveCommand,
  CleanerCommand,
  CommandName,
  DuplicateCommand,
  NotesCommand,
  OrganizerCommand,
  PdfNativeCommand,
  ReadingHistoryCommand,
  RecentWorkCommand,
  RescueCommand,
  WatchCommand,
  isAppError,
  appError as buildAppError,
  ErrorCategory,
  ErrorCode,
  ErrorSeverity,
  Recoverability,
} from "@paperu/contracts";

// ── Tauri invoke shim ────────────────────────────────────────────
// We import `invoke` lazily so that this module loads in a plain
// browser/jsdom environment (tests) without Tauri's runtime present.

type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

async function getInvoke(): Promise<InvokeFn | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const api = await import("@tauri-apps/api/core");
    return api.invoke as InvokeFn;
  }
  return null;
}

// ── Mock registry (tests/dev only) ────────────────────────────────

type MockHandler = (args: Record<string, unknown> | undefined) => unknown;

const mocks = new Map<string, MockHandler>();

/** Register a mock handler for a command. Test-only. */
export function __mockCommand(cmd: string, fn: MockHandler): void {
  mocks.set(cmd, fn);
}

/** Clear all mocks. Test-only. */
export function __clearMocks(): void {
  mocks.clear();
}

function isMocked(cmd: string): boolean {
  return mocks.has(cmd);
}

// ── Error normalisation ───────────────────────────────────────────

const unknownError: AppError = buildAppError({
  code: ErrorCode.Unknown,
  category: ErrorCategory.Internal,
  severity: ErrorSeverity.Error,
  recoverability: Recoverability.Fatal,
  message: "Something went wrong on this PC.",
});

function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) {
    return buildAppError({
      code: ErrorCode.Unknown,
      category: ErrorCategory.Internal,
      message: "Something went wrong on this PC.",
      technical: err.message,
    });
  }
  return unknownError;
}

// ── Typed commands ────────────────────────────────────────────────

/** Inspect a local file and return real metadata. */
export async function inspectFile(
  path: string,
): Promise<InspectFileResponse> {
  const args: Record<string, unknown> = {
    request: { path },
  };
  return call<InspectFileResponse>(CommandName.InspectFile, args);
}

// ── finalize_output (Builder-added command, typed locally) ─────────
// The contracts package is Integrator-controlled. The finalize_output
// command is a Builder addition; its types live here in the desktop app
// until the Integrator promotes them to @paperu/contracts.

/** Response from the finalize_output command. */
export interface FinalizeOutputResponse {
  readonly outputPath: string;
  readonly output: InspectFileResponse;
}

/**
 * Finalize engine-produced bytes into a file on disk via the canonical
 * non-destructive atomic-finalization path. The output is written next
 * to the source file with `-{suffix}.{ext}` appended, conflict-renamed.
 * The source is never modified.
 *
 * Architecture guard (master prompt §9): a bare basename like
 * `document.pdf` is NOT a valid native source path. The Rust
 * `finalize_output` command validates absolute paths, but we reject
 * basenames here too — earlier, with a clearer error — so the broken
 * pattern can never silently reach the engine. A valid native path
 * (Windows `C:\\Users\\…` or Unix `/home/…`) always contains at least
 * one path separator; a basename contains neither `/` nor `\\`.
 */
export async function finalizeOutput(
  sourcePath: string,
  suffix: string,
  extension: string,
  bytes: Uint8Array,
): Promise<FinalizeOutputResponse> {
  if (!isAbsoluteNativePath(sourcePath)) {
    throw buildAppError({
      code: ErrorCode.InvalidInput,
      category: ErrorCategory.Validation,
      severity: ErrorSeverity.Error,
      recoverability: Recoverability.ActionRequired,
      message: "Paperu can't finalize a file without its real location.",
      detail: "The source path looks like a filename only — Paperu needs the full path on this PC.",
      technical: `finalizeOutput rejected non-absolute sourcePath: ${JSON.stringify(sourcePath)}`,
    });
  }
  const bytesBase64 = bytesToBase64(bytes);
  const args: Record<string, unknown> = {
    request: {
      sourcePath,
      suffix,
      extension,
      bytesBase64,
    },
  };
  return call<FinalizeOutputResponse>("finalize_output", args);
}

/**
 * A native absolute path always contains at least one path separator
 * (`/` on Unix, `\\` on Windows, plus drive letters). A bare basename
 * like `document.pdf` contains neither — it is the broken pattern the
 * master prompt §6-8 flagged. This guard is platform-agnostic: it
 * rejects basenames while accepting both Unix and Windows absolute
 * paths. It does NOT validate the path exists (that's the Rust side's
 * job); it only catches the basename regression.
 */
function isAbsoluteNativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  return p.includes("/") || p.includes("\\");
}

/** Encode a Uint8Array as a base64 string (for IPC transfer). */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    const c0 = b0 >> 2;
    const c1 = ((b0 & 0x03) << 4) | (b1 >> 4);
    const c2 = ((b1 & 0x0f) << 2) | (b2 >> 6);
    const c3 = b2 & 0x3f;
    s += B64[c0]!;
    s += B64[c1]!;
    s += i + 1 < len ? B64[c2]! : "=";
    s += i + 2 < len ? B64[c3]! : "=";
  }
  return s;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// ── read_file_bytes (Builder-added command) ───────────────────────

/** Response from the read_file_bytes command. */
export interface ReadFileBytesResponse {
  readonly bytesBase64: string;
  readonly size: number;
}

/**
 * Read a local file's bytes read-only. Used by the webview engines that
 * need the actual file content to process. The original file is never
 * modified.
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const args: Record<string, unknown> = { request: { path } };
  const res = await call<ReadFileBytesResponse>("read_file_bytes", args);
  return base64ToBytes(res.bytesBase64);
}

/** Decode a base64 string into a Uint8Array. */
export function base64ToBytes(s: string): Uint8Array {
  const cleaned = s.replace(/[\s]/g, "");
  const len = cleaned.length;
  const out = new Uint8Array((len * 3) / 4);
  let outIdx = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = cleaned[i]!;
    if (c === "=") break;
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx++] = (buf >> bits) & 0xff;
    }
  }
  return out.slice(0, outIdx);
}

// ── reveal_path / open_path (Builder-added commands) ──────────────

/**
 * Reveal a file in the platform file manager (Explorer on Windows,
 * Finder on macOS, xdg-open on Linux). The file must exist.
 */
export async function revealPath(path: string): Promise<void> {
  await call<void>("reveal_path", { request: { path } });
}

/**
 * Open a file with the platform default application.
 */
export async function openPath(path: string): Promise<void> {
  await call<void>("open_path", { request: { path } });
}

// ── pdf_page_count (Builder-added command) ────────────────────────

/** Response from the pdf_page_count command. */
export interface PdfPageCountResponse {
  readonly pageCount: number | null;
}

/**
 * Get the page count of a local PDF. Returns null if the count could
 * not be determined. Used by the Split view to validate page ranges.
 */
export async function pdfPageCount(path: string): Promise<number | null> {
  const args: Record<string, unknown> = { request: { path } };
  const res = await call<PdfPageCountResponse>("pdf_page_count", args);
  return res.pageCount;
}

/**
 * Inspect multiple local files. Returns one result per path, preserving
 * order. Each file is inspected independently; a failure on one file does
 * not prevent the others from being inspected. The `onResult` callback is
 * invoked as each inspection completes so the UI can stream updates.
 *
 * No file content is read; only metadata. The original files are never
 * modified.
 */
export async function inspectFiles(
  paths: readonly string[],
  onResult?: (path: string, result: InspectFileResponse | AppError) => void,
): Promise<InspectFileResponse[]> {
  const results: InspectFileResponse[] = [];
  // Inspect sequentially to avoid flooding the IPC channel and to give
  // the UI a steady stream of real progress. Bounded parallelism could be
  // added later if batch performance demands it.
  for (const path of paths) {
    try {
      const r = await inspectFile(path);
      results.push(r);
      onResult?.(path, r);
    } catch (err) {
      onResult?.(path, err as AppError);
    }
  }
  return results;
}

/** Read the current settings. */
export async function readSettings(): Promise<Settings> {
  return call<Settings>(CommandName.ReadSettings);
}

/** Apply a settings patch. */
export async function writeSettings(patch: SettingsPatch): Promise<Settings> {
  return call<Settings>(CommandName.WriteSettings, { patch });
}

/** Read app identity/version. */
export async function readAppInfo(): Promise<AppInfo> {
  return call<AppInfo>(CommandName.ReadAppInfo);
}

// ── Recent work (persistent history) ──────────────────────────────

/** Add a new recent-work entry. Returns the inserted entry. */
export async function addRecentWork(
  request: AddRecentWorkRequest,
): Promise<RecentWorkEntry> {
  return call<RecentWorkEntry>(RecentWorkCommand.Add, { request });
}

/** List recent-work entries, most-recent-first. */
export async function listRecentWork(
  limit: number = 50,
): Promise<RecentWorkEntry[]> {
  return call<RecentWorkEntry[]>(RecentWorkCommand.List, { limit });
}

/** Remove a single recent-work entry by id. */
export async function removeRecentWork(id: string): Promise<void> {
  await call<null>(RecentWorkCommand.Remove, { id });
}

/** Clear all recent-work entries. */
export async function clearRecentWork(): Promise<void> {
  await call<null>(RecentWorkCommand.Clear);
}

// ── Application kit ──────────────────────────────────────────────

/** Add a new application kit item. Returns the inserted item. */
export async function addApplicationKitItem(
  request: AddApplicationKitItemRequest,
): Promise<ApplicationKitItem> {
  return call<ApplicationKitItem>(ApplicationKitCommand.Add, { request });
}

/** List all application kit items, grouped by kind. */
export async function listApplicationKitItems(): Promise<ApplicationKitItem[]> {
  return call<ApplicationKitItem[]>(ApplicationKitCommand.List);
}

/** Update an existing kit item. Only provided fields are updated. */
export async function updateApplicationKitItem(
  request: UpdateApplicationKitItemRequest,
): Promise<ApplicationKitItem> {
  return call<ApplicationKitItem>(ApplicationKitCommand.Update, { request });
}

/** Remove a single kit item by id. */
export async function removeApplicationKitItem(id: string): Promise<void> {
  await call<null>(ApplicationKitCommand.Remove, { id });
}

/**
 * Atomically replace a kit item's file reference (90% §7). Single
 * transactional UPDATE — preserves the id; failure leaves the original
 * item unchanged (no remove-then-add gap).
 */
export async function replaceApplicationKitItem(
  id: string,
  request: AddApplicationKitItemRequest,
): Promise<ApplicationKitItem> {
  return call<ApplicationKitItem>(ApplicationKitCommand.Replace, { id, request });
}

// ── Folder Organizer (rules-based file automation) ────────────────

/** Persist a folder-organizer rule (insert or replace by id). Returns the id. */
export async function saveOrganizerRule(rule: OrganizerRule): Promise<string> {
  return call<string>(OrganizerCommand.Save, { rule });
}

/** List all saved folder-organizer rules, ordered by sortOrder. */
export async function listOrganizerRules(): Promise<OrganizerRule[]> {
  return call<OrganizerRule[]>(OrganizerCommand.List);
}

/** Delete a saved folder-organizer rule by id. */
export async function deleteOrganizerRule(id: string): Promise<void> {
  await call<null>(OrganizerCommand.Delete, { id });
}

/** Preview what a rule would do. Does NOT touch the filesystem. */
export async function dryRunOrganizer(rule: OrganizerRule): Promise<DryRunResult> {
  return call<DryRunResult>(OrganizerCommand.DryRun, { rule });
}

/**
 * Run an organizer rule for real. Performs the configured action
 * (move/copy) on every matched file. Source-safety: a failed move
 * leaves the source untouched; the batch never aborts on one file.
 * Cross-volume moves fall back to copy+delete.
 */
export async function executeOrganizerRule(rule: OrganizerRule): Promise<ExecuteResult> {
  return call<ExecuteResult>(OrganizerCommand.Execute, { rule });
}

// ── Downloads Cleaner ─────────────────────────────────────────────

/** Scan a folder and return categorized file entries. Never deletes. */
export async function scanDownloadsFolder(folder: string): Promise<FileEntry[]> {
  return call<FileEntry[]>(CleanerCommand.Scan, { folder });
}

// ── Duplicate Finder ───────────────────────────────────────────────

/** Find exact duplicate files (by content hash) in a folder. Returns
 *  groups of identical files. Never deletes — the caller chooses. */
export async function findExactDuplicates(folder: string): Promise<DuplicateGroup[]> {
  return call<DuplicateGroup[]>(DuplicateCommand.Find, { folder });
}

// ── File Rescue ────────────────────────────────────────────────────

/** Diagnose a possibly-damaged file via Rust magic-byte inspection.
 *  Conservative — never modifies the original. */
export async function diagnoseFile(path: string): Promise<RescueDiagnosis> {
  return call<RescueDiagnosis>(RescueCommand.Diagnose, { path });
}

// ── Archive Studio (safe ZIP create/extract/list) ─────────────────

/** List the entries of a ZIP archive. Unsafe entry names are rejected,
 *  not silently skipped. The archive is never extracted here. */
export async function listArchive(path: string): Promise<ListResult> {
  return call<ListResult>(ArchiveCommand.List, { path });
}

/** Extract a ZIP archive into a destination directory. ZIP-Slip + symlink
 *  escape + decompression-bomb guards run on every entry. Never overwrites
 *  existing files (collisions are reported in `skipped`). */
export async function extractArchive(path: string, dest: string): Promise<ExtractResult> {
  return call<ExtractResult>(ArchiveCommand.Extract, { path, dest });
}

/** Create a ZIP archive from a list of files (deflate compression).
 *  One unreadable source file is skipped (reported), not fatal. */
export async function createArchive(archivePath: string, files: readonly string[]): Promise<CreateResult> {
  return call<CreateResult>(ArchiveCommand.Create, { archivePath, files });
}

// ── PDF page operations (Rust-native, lopdf) ──────────────────────

/**
 * Rotate pages of a PDF. `angle` is 90/180/270; `pages` is 1-based,
 * empty = all pages. Returns the modified bytes (base64) + the page
 * count. The frontend finalizes via finalizeOutput(absoluteSourcePath, …).
 * Source-safety: the original is never modified.
 */
export async function rotatePdfPages(
  path: string,
  angle: number,
  pages: readonly number[],
): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.Rotate, { path, angle, pages });
}

/** Delete the specified 1-based pages from a PDF. Returns the modified bytes. */
export async function deletePdfPages(
  path: string,
  pages: readonly number[],
): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.Delete, { path, pages });
}

/** Keep ONLY the specified 1-based pages (delete the complement). Returns the modified bytes. */
export async function extractPdfPages(
  path: string,
  pages: readonly number[],
): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.Extract, { path, pages });
}

/** Get the page count of a local PDF. */
export async function pdfNativePageCount(path: string): Promise<number> {
  return call<number>(PdfNativeCommand.PageCount, { path });
}

/** Inspect the PDF Info dictionary metadata (Title/Author/Creator/etc). */
export async function inspectPdfMetadata(path: string): Promise<PdfMetadata> {
  return call<PdfMetadata>(PdfNativeCommand.InspectMetadata, { path });
}

/** Remove the PDF Info dictionary fields (privacy: strip metadata). */
export async function removePdfMetadata(path: string): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.RemoveMetadata, { path });
}

/** Set the MediaBox of every (or selected) page to a custom size. */
export async function setPdfPageSize(
  path: string,
  width: number,
  height: number,
  pages: readonly number[],
): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.SetPageSize, { path, width, height, pages });
}

/** Reorder pages to the given 1-based permutation. */
export async function reorderPdfPages(
  path: string,
  order: readonly number[],
): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.Reorder, { path, order });
}

/** Reverse the page order (last page first). */
export async function reversePdfPages(path: string): Promise<PdfNativeResponse> {
  return call<PdfNativeResponse>(PdfNativeCommand.Reverse, { path });
}

// ── Watch Folders (notify + debouncer) ────────────────────────────

/** Start watching a folder (recursive, debounced 400ms). Emits
 *  `paperu://watch-event` for each change. Replaces any existing watcher.
 *  Paperu takes NO destructive automatic action — the frontend decides. */
export async function startWatchFolder(path: string): Promise<void> {
  await call<null>(WatchCommand.Start, { path });
}

/** Stop the active watcher (if any). Safe to call when none is active. */
export async function stopWatchFolder(): Promise<void> {
  await call<null>(WatchCommand.Stop);
}

/** Returns the currently-watched path (null if none). */
export async function currentWatchFolder(): Promise<string | null> {
  return call<string | null>(WatchCommand.Current);
}

// NOTE: `base64ToBytes` already exists above (near readFileBytes) —
// the PdfPageOpsRoute imports it from there. No duplicate here.

// ── Notes ────────────────────────────────────────────────────────

/** Create a new note. Returns the inserted note. */
export async function createNote(request: CreateNoteRequest): Promise<Note> {
  return call<Note>(NotesCommand.Create, { request });
}

/** List notes (most-recent-first). includeDeleted=false by default. */
export async function listNotes(includeDeleted = false): Promise<Note[]> {
  return call<Note[]>(NotesCommand.List, { includeDeleted });
}

/** Get a single note by id. */
export async function getNote(id: string): Promise<Note> {
  return call<Note>(NotesCommand.Get, { id });
}

/** Autosave a note. Only provided fields update. */
export async function updateNote(request: UpdateNoteRequest): Promise<Note> {
  return call<Note>(NotesCommand.Update, { request });
}

/** Soft-delete a note (moves to "recently deleted"). */
export async function softDeleteNote(id: string): Promise<void> {
  await call<null>(NotesCommand.SoftDelete, { id });
}

/** Restore a soft-deleted note. */
export async function restoreNote(id: string): Promise<void> {
  await call<null>(NotesCommand.Restore, { id });
}

/** Permanently delete notes whose deletedAt < olderThanIso. Returns count. */
export async function purgeDeletedNotes(olderThanIso: string): Promise<number> {
  return call<number>(NotesCommand.PurgeDeleted, { olderThanIso });
}

/** Create a note folder. */
export async function createNoteFolder(
  request: CreateNoteFolderRequest,
): Promise<NoteFolder> {
  return call<NoteFolder>(NotesCommand.CreateFolder, { request });
}

/** List all note folders. */
export async function listNoteFolders(): Promise<NoteFolder[]> {
  return call<NoteFolder[]>(NotesCommand.ListFolders);
}

/** Local search across note title, body, tags. No AI. */
export async function searchNotes(query: string): Promise<Note[]> {
  return call<Note[]>(NotesCommand.Search, { query });
}

// ── Reading history ──────────────────────────────────────────────

/** Upsert reading-history for a path (called on open/scroll). */
export async function upsertReadingHistory(
  request: UpdateReadingHistoryRequest,
): Promise<ReadingHistoryEntry> {
  return call<ReadingHistoryEntry>(ReadingHistoryCommand.Upsert, { request });
}

/** Get reading-history for a file path (null if absent). */
export async function getReadingHistory(
  path: string,
): Promise<ReadingHistoryEntry | null> {
  return call<ReadingHistoryEntry | null>(ReadingHistoryCommand.Get, { path });
}

/** List all reading-history entries, most-recently-opened-first. */
export async function listReadingHistory(): Promise<ReadingHistoryEntry[]> {
  return call<ReadingHistoryEntry[]>(ReadingHistoryCommand.List);
}

/** Remove a single reading-history entry by id. */
export async function removeReadingHistory(id: string): Promise<void> {
  await call<null>(ReadingHistoryCommand.Remove, { id });
}

/** Clear all reading-history entries. */
export async function clearReadingHistory(): Promise<void> {
  await call<null>(ReadingHistoryCommand.Clear);
}

// ── Core call ────────────────────────────────────────────────────

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isMocked(cmd)) {
    // Mocks are synchronous-ish; preserve async semantics.
    const handler = mocks.get(cmd)!;
    return Promise.resolve(handler(args) as T);
  }
  const invoke = await getInvoke();
  if (!invoke) {
    throw buildAppError({
      code: ErrorCode.NotImplemented,
      category: ErrorCategory.Unsupported,
      severity: ErrorSeverity.Warning,
      recoverability: Recoverability.ActionRequired,
      message: "Paperu is running outside its desktop shell.",
      detail: "This build needs the Paperu desktop app to access your files.",
      technical: "no __TAURI_INTERNALS__ on window; invoke unavailable",
    });
  }
  try {
    return (await invoke(cmd, args)) as T;
  } catch (err) {
    throw toAppError(err);
  }
}
