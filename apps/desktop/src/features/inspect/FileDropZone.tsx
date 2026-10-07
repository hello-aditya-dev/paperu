/**
 * FileDropZone — accessible drag/drop + file-picker entry point.
 *
 * Uses Tauri's file-drop events (the window receives them natively)
 * and the dialog plugin's `open()` to pick a file. Only the *path*
 * is passed to Rust; no file content crosses the boundary.
 */

import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@paperu/ui";

export interface FileDropZoneProps {
  /** Called with an absolute path chosen by the user. */
  onFileSelected: (path: string) => void;
  busy?: boolean;
}

interface DragDropEvent {
  paths: string[];
}

export function FileDropZone({
  onFileSelected,
  busy,
}: FileDropZoneProps): React.ReactNode {
  const [dragging, setDragging] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Tauri emits `tauri://drag-drop` with the dropped file paths.
    listen<DragDropEvent>("tauri://drag-drop", (event) => {
      const paths = event.payload?.paths ?? [];
      if (paths.length > 0 && !cancelled) {
        onFileSelected(paths[0]!);
      }
    })
      .then((un) => {
        if (cancelled) un();
        else unlistenRef.current = un;
      })
      .catch(() => {
        // Outside Tauri (tests) — drag-drop simply won't fire.
      });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [onFileSelected]);

  async function handlePick(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a file to inspect — Paperu",
      });
      if (typeof selected === "string" && selected.length > 0) {
        onFileSelected(selected);
      }
    } catch {
      // Dialog dismissed or unavailable; no action needed.
    }
  }

  return (
    <div
      className={`paperu-dropzone${dragging ? " is-dragging" : ""}`}
      role="region"
      aria-label="Drop a file here or choose one to inspect"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        // In Tauri, native drag-drop is handled via the event above;
        // the HTML drop fallback covers the web path property when
        // available. We use the path if exposed.
        const path = (file as unknown as { path?: string }).path;
        if (path) onFileSelected(path);
      }}
    >
      <div className="paperu-dropzone__inner">
        <div className="paperu-dropzone__glyph" aria-hidden="true">
          ⌁
        </div>
        <p className="paperu-dropzone__title">Drop a file to inspect it</p>
        <p className="paperu-dropzone__hint">
          Processed on this PC. 0 bytes uploaded.
        </p>
        <Button variant="accent" onClick={handlePick} disabled={busy}>
          {busy ? "Inspecting…" : "Choose a file"}
        </Button>
      </div>
      <span className="paperu-sr-only">
        Drag a file onto this area, or activate the Choose a file button to
        open the file picker.
      </span>
    </div>
  );
}
