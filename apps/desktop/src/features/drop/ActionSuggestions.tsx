/**
 * ActionSuggestions — inspects the staged files and suggests available
 * actions based on what was dropped. Only actions that genuinely exist
 * are shown; unfinished features are not listed.
 *
 * Routing is currently within-app (hash router). The action cards link
 * to the relevant feature route when it exists, or show a "coming soon"
 * state when the feature is planned but not yet ported.
 */

import type { InspectFileResponse, FileKind } from "@paperu/contracts";
import { Card } from "@paperu/ui";
import type { StagedFile } from "./UniversalDrop";

export interface ActionSuggestionsProps {
  files: readonly StagedFile[];
}

interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly href?: string;
  readonly available: boolean;
}

export function ActionSuggestions({
  files,
}: ActionSuggestionsProps): React.ReactNode {
  const results = files
    .map((f) => f.result)
    .filter((r): r is InspectFileResponse => r != null);
  const kinds = new Set<FileKind>(results.map((r) => r.kind));
  const pdfCount = results.filter((r) => r.kind === "pdf").length;
  const imageCount = results.filter((r) => r.kind === "image").length;

  const suggestions: Suggestion[] = [];

  if (pdfCount >= 1) {
    suggestions.push({
      id: "pdf-fit",
      label: "Make PDF fit a size",
      desc: "Shrink under 50 KB – 2 MB",
      href: "#/pdf/fit",
      available: true,
    });
  }
  if (imageCount >= 1) {
    suggestions.push({
      id: "image-fit",
      label: "Make image fit a size",
      desc: "Shrink under any target",
      href: "#/image/fit",
      available: true,
    });
  }
  if (pdfCount >= 2) {
    suggestions.push({
      id: "pdf-merge",
      label: `Merge ${pdfCount} PDFs`,
      desc: "Combine in order",
      href: "#/pdf/merge",
      available: true,
    });
  }
  if (pdfCount === 1) {
    suggestions.push({
      id: "pdf-split",
      label: "Split / extract pages",
      desc: "Ranges or every page",
      href: "#/pdf/split",
      available: true,
    });
  }
  if (imageCount >= 2) {
    suggestions.push({
      id: "images-to-pdf",
      label: "Images → PDF",
      desc: "One file from many",
      href: "#/pdf/from-images",
      available: false,
    });
  }
  // Unsupported files get a notice.
  const unsupported = results.filter(
    (r) => r.kind !== "pdf" && r.kind !== "image",
  ).length;

  if (suggestions.length === 0 && unsupported === 0) return null;

  return (
    <Card className="paperu-actions">
      <h2 className="paperu-actions__title">Suggested actions</h2>
      <div className="paperu-actions__grid">
        {suggestions.map((s) => (
          <a
            key={s.id}
            className={`paperu-action${s.available ? "" : " is-pending"}`}
            href={s.href ?? "#"}
            aria-disabled={!s.available}
            onClick={(e) => {
              if (!s.available) e.preventDefault();
            }}
          >
            <span className="paperu-action__label">{s.label}</span>
            <span className="paperu-action__desc">{s.desc}</span>
            {!s.available && (
              <span className="paperu-action__badge">Coming soon</span>
            )}
          </a>
        ))}
      </div>
      {unsupported > 0 && (
        <p className="paperu-actions__note">
          {unsupported} file{unsupported === 1 ? "" : "s"} not recognized as PDF
          or image. Paperu will skip those.
        </p>
      )}
      {kinds.size > 0 && (
        <p className="paperu-actions__privacy">
          <span aria-hidden="true">🔒</span> Processed on this PC · 0 bytes
          uploaded
        </p>
      )}
    </Card>
  );
}
