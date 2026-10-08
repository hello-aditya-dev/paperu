/**
 * @paperu/contracts — signature_vault.ts
 *
 * Signature Vault — local-only signature file references (90% §37).
 * Rust mirror at src/signature_vault/mod.rs. Stores ONLY file references +
 * metadata, never signature image bytes.
 */

export type SignatureVariant = "full" | "initials" | "guardian" | "work";

export interface SignatureItem {
  readonly id: string;
  readonly label: string;
  readonly variant: SignatureVariant;
  readonly filePath: string;
  readonly fileName: string;
  readonly fileKind: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly notes: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddSignatureRequest {
  readonly label: string;
  readonly variant: SignatureVariant;
  readonly filePath: string;
  readonly fileName: string;
  readonly fileKind: string;
  readonly mimeType?: string | null;
  readonly sizeBytes?: number | null;
  readonly notes?: string | null;
}

export interface UpdateSignatureRequest {
  readonly id: string;
  readonly label?: string;
  readonly notes?: string | null;
  readonly sortOrder?: number;
}

export const SignatureVaultCommand = {
  Add: "add_signature_item",
  List: "list_signature_items",
  Update: "update_signature_item",
  Replace: "replace_signature_item",
  Remove: "remove_signature_item",
} as const;
