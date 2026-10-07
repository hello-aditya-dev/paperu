/**
 * Small formatting helpers shared by the UI. The Rust layer is the
 * source of truth for byte sizes and timestamps in responses; these
 * helpers only format for display when the UI needs a localised
 * representation.
 */

/** Format an ISO-8601 UTC timestamp into a readable local string. */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A short label for a file kind, suitable for users. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "image":
      return "Image";
    case "archive":
      return "Archive";
    case "text":
      return "Text";
    case "spreadsheet":
      return "Spreadsheet";
    case "document":
      return "Document";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "executable":
      return "Application";
    case "signature":
      return "Signature";
    default:
      return "File";
  }
}
