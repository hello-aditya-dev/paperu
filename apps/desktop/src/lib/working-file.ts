/**
 * WorkingFile store — the canonical application-level abstraction for
 * a staged working file that can flow from one operation to the next.
 *
 * This is what makes Paperu a composable workspace instead of nine
 * isolated tools. When an operation completes, its output is staged
 * here. The next view reads from here on mount, so the user can chain:
 *
 *   Fill → Sign → Make under 500 KB → Open
 *
 * Without re-selecting the file each time.
 *
 * Design:
 *   - Single staged working file (the most recent output).
 *   - The staged file is a real file on disk (produced by finalize_output),
 *     never a temp file that might disappear.
 *   - Each view checks for a staged file on mount; if present and the kind
 *     matches, it auto-loads it.
 *   - The store tracks the source operation so a future History view can
 *     reconstruct the workflow chain.
 */

import { create } from "zustand";
import type { InspectFileResponse } from "@paperu/contracts";

/** The operation that produced this working file. */
export type SourceOperation =
  | "pdf-fit"
  | "image-fit"
  | "pdf-merge"
  | "pdf-split"
  | "images-to-pdf"
  | "pdf-to-images"
  | "sign-pdf"
  | "fill-pdf"
  | "inspect"
  | "drop";

/** A staged working file — a real file on disk ready for the next op. */
export interface WorkingFile {
  /** Canonical absolute path. */
  readonly path: string;
  /** Display name (fileName). */
  readonly fileName: string;
  /** Coarse kind: "pdf" | "image" | "other". */
  readonly kind: string;
  /** MIME type if known. */
  readonly mimeType?: string;
  /** Size in bytes. */
  readonly size: number;
  /** Human-readable size. */
  readonly humanReadableSize: string;
  /** The operation that produced this file (for workflow history). */
  readonly sourceOperation: SourceOperation;
  /** When this file was staged (ms epoch). */
  readonly stagedAt: number;
  /** Optional: the path of the file this was produced from. */
  readonly derivedFrom?: string;
}

interface WorkingFileState {
  /** The current staged working file, or null. */
  workingFile: WorkingFile | null;
  /** Stage a working file from an inspect response + source operation. */
  stage: (file: InspectFileResponse, sourceOperation: SourceOperation, derivedFrom?: string) => void;
  /** Stage a working file from raw fields. */
  stageRaw: (fields: {
    path: string;
    fileName: string;
    kind: string;
    mimeType?: string;
    size: number;
    humanReadableSize: string;
    sourceOperation: SourceOperation;
    derivedFrom?: string;
  }) => void;
  /** Clear the staged working file. */
  clear: () => void;
  /** Consume the staged file (read + clear) — used when a view loads it. */
  consume: () => WorkingFile | null;
}

export const useWorkingFile = create<WorkingFileState>((set, get) => ({
  workingFile: null,

  stage: (file, sourceOperation, derivedFrom) =>
    set({
      workingFile: {
        path: file.path,
        fileName: file.fileName,
        kind: file.kind,
        mimeType: file.mimeType,
        size: file.size.bytes,
        humanReadableSize: file.size.humanReadable,
        sourceOperation,
        stagedAt: Date.now(),
        derivedFrom,
      },
    }),

  stageRaw: (fields) =>
    set({
      workingFile: {
        path: fields.path,
        fileName: fields.fileName,
        kind: fields.kind,
        mimeType: fields.mimeType,
        size: fields.size,
        humanReadableSize: fields.humanReadableSize,
        sourceOperation: fields.sourceOperation,
        stagedAt: Date.now(),
        derivedFrom: fields.derivedFrom,
      },
    }),

  clear: () => set({ workingFile: null }),

  consume: () => {
    const f = get().workingFile;
    // Don't clear — the file is still on disk and may be used again.
    // "Consume" here means "the current view has read it"; we leave it
    // staged so the user can navigate back. The store is cleared when
    // a new file is staged or explicitly cleared.
    return f;
  },
}));
