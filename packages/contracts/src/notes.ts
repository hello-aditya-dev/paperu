/**
 * @paperu/contracts — notes.ts
 *
 * Local-first notes with autosave + soft-delete (Master Prompt 4 §27-32).
 * Body is markdown-ish text. NEVER uploaded. Search is local (no AI).
 *
 * Rust mirror at `contracts/notes.rs`. JSON shapes match.
 */

import type { IsoTimestamp } from "./common.js";

/** A single note. */
export interface Note {
  readonly id: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly tags: readonly string[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Set when soft-deleted; null otherwise. */
  readonly deletedAt: IsoTimestamp | null;
}

/** A folder for organizing notes. */
export interface NoteFolder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly createdAt: IsoTimestamp;
}

/** Request to create a new note. */
export interface CreateNoteRequest {
  readonly folderId?: string | null;
  readonly title?: string;
  readonly body?: string;
  readonly tags?: readonly string[];
}

/** Autosave request — only provided fields update. */
export interface UpdateNoteRequest {
  readonly id: string;
  readonly title?: string;
  readonly body?: string;
  readonly folderId?: string | null;
  readonly pinned?: boolean;
  readonly tags?: readonly string[];
}

/** Request to create a folder. */
export interface CreateNoteFolderRequest {
  readonly name: string;
  readonly parentId?: string | null;
}

/** Command names for the notes IPC boundary. */
export const NotesCommand = {
  Create: "create_note",
  List: "list_notes",
  Get: "get_note",
  Update: "update_note",
  SoftDelete: "soft_delete_note",
  Restore: "restore_note",
  PurgeDeleted: "purge_deleted_notes",
  CreateFolder: "create_note_folder",
  ListFolders: "list_note_folders",
  Search: "search_notes",
} as const;
