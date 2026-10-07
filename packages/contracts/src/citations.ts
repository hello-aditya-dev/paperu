import type { IsoTimestamp } from "./common.js";
export interface Author { readonly last: string; readonly first: string; }
export interface CitationEntry {
  readonly id?: string | null;
  readonly sourceType: string;
  readonly authors: readonly Author[];
  readonly editors?: readonly Author[] | null;
  readonly year?: string | null;
  readonly title: string;
  readonly publisher?: string | null;
  readonly volume?: string | null;
  readonly issue?: string | null;
  readonly pages?: string | null;
  readonly url?: string | null;
  readonly doi?: string | null;
  readonly isbn?: string | null;
  readonly notes?: string | null;
}
export interface SavedCitation {
  readonly id: string;
  readonly sourceType: string;
  readonly authorsJson: string;
  readonly editorsJson: string | null;
  readonly year: string | null;
  readonly title: string;
  readonly publisher: string | null;
  readonly volume: string | null;
  readonly issue: string | null;
  readonly pages: string | null;
  readonly url: string | null;
  readonly doi: string | null;
  readonly isbn: string | null;
  readonly notes: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
export const CitationCommand = {
  Save: "save_citation", List: "list_citations", Delete: "delete_citation", Format: "format_citation",
} as const;
