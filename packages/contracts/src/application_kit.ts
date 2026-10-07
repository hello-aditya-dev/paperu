/**
 * @paperu/contracts — application_kit.ts
 *
 * The user's reusable personal documents: photo, signature, initials,
 * resume, ID files, marksheets, certificates. Rust mirror at
 * `contracts/application_kit.rs`. JSON shapes match.
 *
 * Stores ONLY file references + metadata. NEVER document bytes (§19, §76).
 */

import type { FilePath, IsoTimestamp } from "./common.js";

/** The kind of application kit item. */
export type ApplicationKitItemKind =
  | "photo"
  | "signature"
  | "initials"
  | "resume"
  | "id"
  | "marksheet"
  | "certificate"
  | "other";

/** A single application kit item. */
export interface ApplicationKitItem {
  readonly id: string;
  readonly kind: ApplicationKitItemKind;
  readonly label: string;
  readonly filePath: FilePath;
  readonly fileName: string;
  readonly fileKind: "pdf" | "image" | "other";
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly notes: string | null;
  readonly sortOrder: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** Request to add a new kit item. */
export interface AddApplicationKitItemRequest {
  readonly kind: ApplicationKitItemKind;
  readonly label: string;
  readonly filePath: FilePath;
  readonly fileName: string;
  readonly fileKind: "pdf" | "image" | "other";
  readonly mimeType?: string | null;
  readonly sizeBytes?: number | null;
  readonly notes?: string | null;
}

/** Request to update a kit item. All fields optional — only provided
 *  fields are updated. */
export interface UpdateApplicationKitItemRequest {
  readonly id: string;
  readonly label?: string;
  readonly notes?: string | null;
  readonly sortOrder?: number;
}

/** Command names for the application_kit IPC boundary. */
export const ApplicationKitCommand = {
  Add: "add_application_kit_item",
  List: "list_application_kit_items",
  Update: "update_application_kit_item",
  Remove: "remove_application_kit_item",
} as const;
