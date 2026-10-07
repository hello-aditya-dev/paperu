/**
 * Universal Drop — Paperu's primary file-entry interaction model.
 *
 * Users drag one or more files onto the window (or pick them via the
 * native dialog). Paperu inspects each file locally through the canonical
 * `inspect_file` IPC contract, classifies it, and presents sensible
 * available actions.
 *
 * Privacy:
 *   - No file content is read by this feature; only metadata via inspect.
 *   - Files are never uploaded.
 *   - Originals are never modified.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inspectFiles } from "@/lib/ipc";
import { Button } from "@paperu/ui";
import { StagedFileList } from "./StagedFileList";
import { ActionSuggestions } from "./ActionSuggestions";

/** A staged file with its inspection outcome. */
export interface StagedFile {
  /** Canonical absolute path (the identity). */
  readonly path: string;
  readonly status: "inspecting" | "done" | "error";
  readonly result?: InspectFileResponse;
  readonly error?: AppError;
}

interface DragDropEvent {
  paths: string[];
}

export function UniversalDrop(): React.ReactNode {
  const [files, setFiles] = useState<readonly StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Listen for native Tauri drag-drop events (multi-file).
  useEffect(() => {
    let cancelled = false;
    listen<DragDropEvent>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths ?? [];
      if (paths.length > 0 && !cancelled) {
        void handlePaths(paths);
      }
    })
      .then((un) => {
        if (cancelled) un();
        else unlistenRef.current = un;
      })
      .catch(() => {
        // Outside Tauri (tests) — drag-drop won't fire.
      });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaths = useCallback(async (paths: readonly string[]) => {
    if (paths.length === 0) return;
    setBusy(true);
    // Add placeholders so the UI shows immediate feedback.
    const placeholders: StagedFile[] = paths.map((p) => ({
      path: p,
      status: "inspecting",
    }));
    setFiles((prev) => {
      // Deduplicate by path; keep existing results, add new placeholders.
      const existing = new Map(prev.map((f) => [f.path, f]));
      for (const p of placeholders) {
        if (!existing.has(p.path)) existing.set(p.path, p);
      }
      return Array.from(existing.values());
    });

    await inspectFiles(paths, (path, result) => {
      setFiles((prev) =>
        prev.map((f) => {
          if (f.path !== path) return f;
          if ("code" in result) {
            return { ...f, status: "error", error: result };
          }
          return { ...f, status: "done", result };
        }),
      );
    });
    setBusy(false);
  }, []);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Choose files — Paperu",
      });
      if (selected === null) return;
      const paths: string[] = Array.isArray(selected)
        ? selected.filter((s): s is string => typeof s === "string")
        : typeof selected === "string"
          ? [selected]
          : [];
      if (paths.length > 0) {
        await handlePaths(paths);
      }
    } catch {
      // Dialog dismissed or unavailable.
    }
  }

  function handleRemove(path: string): void {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }

  function handleClear(): void {
    setFiles([]);
  }

  const done = files.filter(
    (f): f is StagedFile & { status: "done"; result: InspectFileResponse } =>
      f.status === "done" && f.result != null,
  );

  return (
    <section className="paperu-drop" aria-labelledby="drop-heading">
      <header className="paperu-drop__header">
        <p className="paperu-text-eyebrow">Stop uploading your files to random websites.</p>
        <h1 id="drop-heading" className="paperu-text-display">What do you need to do?</h1>
        <p className="paperu-text-lead">
          Drop anything onto this window. Paperu inspects it on this PC, then
          suggests the right tool. Nothing is uploaded — ever.
        </p>
      </header>

      <div
        className={`paperu-dropzone${dragging ? " is-dragging" : ""}`}
        role="region"
        aria-label="Drop files here or choose files to inspect"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          // Tauri native drag-drop is handled via the event listener above.
          // This HTML drop is a fallback for the web path property when
          // available (e.g. in tests). Collect all dropped file paths.
          const fileList = e.dataTransfer?.files;
          if (fileList && fileList.length > 0) {
            const paths: string[] = [];
            for (let i = 0; i < fileList.length; i++) {
              // Use indexed access; works for both real FileList and
              // array-like objects in tests.
              const f = (fileList as unknown as ArrayLike<{ path?: string }>)[i];
              const path = f?.path;
              if (path) paths.push(path);
            }
            if (paths.length > 0) void handlePaths(paths);
          }
        }}
      >
        <div className="paperu-dropzone__inner">
          <div className="paperu-dropzone__glyph" aria-hidden="true">
            ⌁
          </div>
          <p className="paperu-dropzone__title">Drop files here</p>
          <p className="paperu-dropzone__hint">
            {busy ? "Inspecting…" : "PDFs, images — processed on this PC. 0 bytes uploaded."}
          </p>
          <Button variant="accent" onClick={handlePick} disabled={busy}>
            {busy ? "Reading…" : "Choose files"}
          </Button>
        </div>
        <span className="paperu-sr-only">
          Drag one or more files onto this window, or activate the Choose files
          button to open the file picker.
        </span>
      </div>

      {files.length > 0 && (
        <>
          <StagedFileList files={files} onRemove={handleRemove} onClear={handleClear} />
          {done.length > 0 && <ActionSuggestions files={done} />}
        </>
      )}

      <p className="paperu-drop__privacy">
        <span aria-hidden="true">🔒</span> Local-first: processed on this PC. 0
        bytes uploaded.
      </p>
    </section>
  );
}
