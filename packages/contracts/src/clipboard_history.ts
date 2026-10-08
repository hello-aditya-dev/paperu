export interface ClipboardEntry {
  readonly id: string;
  readonly kind: string;
  readonly content: string | null;
  readonly filePath: string | null;
  readonly pinned: boolean;
  readonly createdAt: string;
}
export interface AddEntryRequest {
  readonly content: string;
}
export const ClipboardHistoryCommand = {
  Add: "add_clipboard_entry",
  List: "list_clipboard_entries",
  SetPinned: "set_clipboard_entry_pinned",
  Delete: "delete_clipboard_entry",
  Clear: "clear_clipboard_history",
  Count: "clipboard_entry_count",
} as const;
