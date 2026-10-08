export interface StudyPack {
  readonly id: string;
  readonly name: string;
  readonly subject: string | null;
  readonly semester: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StudyPackItem {
  readonly id: string;
  readonly packId: string;
  readonly filePath: string | null;
  readonly fileName: string | null;
  readonly fileKind: string | null;
  readonly noteId: string | null;
  readonly label: string;
  readonly section: string | null;
  readonly pinned: boolean;
  readonly sortOrder: number;
  readonly createdAt: string;
}
export interface CreatePackRequest {
  readonly name: string;
  readonly subject?: string | null;
  readonly semester?: string | null;
  readonly description?: string | null;
}
export interface AddItemRequest {
  readonly packId: string;
  readonly filePath?: string | null;
  readonly fileName?: string | null;
  readonly fileKind?: string | null;
  readonly noteId?: string | null;
  readonly label: string;
  readonly section?: string | null;
}
export const StudyPacksCommand = {
  Create: "create_study_pack",
  List: "list_study_packs",
  Delete: "delete_study_pack",
  AddItem: "add_study_pack_item",
  ListItems: "list_study_pack_items",
  RemoveItem: "remove_study_pack_item",
} as const;
