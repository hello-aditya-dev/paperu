/**
 * @paperu/contracts — forms_vault.ts (90% §38).
 * Local-only reusable personal field values. Never injects into websites.
 */
export interface FormField {
  readonly id: string;
  readonly fieldKey: string;
  readonly fieldValue: string;
  readonly label: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertFieldRequest {
  readonly fieldKey: string;
  readonly fieldValue: string;
  readonly label?: string | null;
}

export const FormsVaultCommand = {
  Upsert: "upsert_forms_field",
  List: "list_forms_fields",
  Remove: "remove_forms_field",
  Clear: "clear_forms_fields",
} as const;

/** Standard field keys Paperu recognizes. */
export const STANDARD_FIELD_KEYS = [
  "name", "address", "email", "phone", "dob",
  "roll_no", "course", "subject", "institution", "guardian_name",
  "guardian_phone", "alternate_phone", "id_number",
] as const;
