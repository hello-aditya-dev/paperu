/**
 * NextActions — contextual next-operation buttons shown on result cards.
 *
 * When an operation completes, the output is staged in the WorkingFile
 * store. This component reads the staged file and offers actions that
 * make sense for its kind:
 *
 *   PDF output  → Make it fit, Sign, Fill, Split, PDF → Images
 *   Image output → Make it fit, Images → PDF
 *
 * Clicking a next action navigates to the target view. The target view
 * reads the staged file on mount and auto-loads it — no re-selection.
 */

import { useNavigate } from "react-router";
import { useWorkingFile } from "@/lib/working-file";
import { Button } from "@paperu/ui";

export function NextActions({ exclude }: { exclude?: string }): React.ReactNode {
  const navigate = useNavigate();
  const workingFile = useWorkingFile((s) => s.workingFile);

  if (!workingFile) return null;

  const actions: { label: string; to: string; id: string }[] = [];

  if (workingFile.kind === "pdf") {
    if (exclude !== "pdf-fit")
      actions.push({ label: "Make this fit", to: "/pdf/fit", id: "na-fit" });
    if (exclude !== "sign-pdf")
      actions.push({ label: "Sign this", to: "/pdf/sign", id: "na-sign" });
    if (exclude !== "fill-pdf")
      actions.push({ label: "Fill this", to: "/pdf/fill", id: "na-fill" });
    if (exclude !== "pdf-split")
      actions.push({ label: "Split this", to: "/pdf/split", id: "na-split" });
    if (exclude !== "pdf-to-images")
      actions.push({ label: "PDF → Images", to: "/pdf/to-images", id: "na-to-img" });
  } else if (workingFile.kind === "image") {
    if (exclude !== "image-fit")
      actions.push({ label: "Make this fit", to: "/image/fit", id: "na-img-fit" });
    if (exclude !== "images-to-pdf")
      actions.push({ label: "Add to PDF", to: "/pdf/from-images", id: "na-i2p" });
  }

  if (actions.length === 0) return null;

  return (
    <div className="paperu-nextactions">
      <span className="paperu-text-label" style={{ marginBottom: "var(--paperu-space-2)", display: "block" }}>
        Next action
      </span>
      <div className="paperu-nextactions__grid">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant="outline"
            onClick={() => navigate(a.to)}
            style={{ minHeight: "36px", fontSize: "var(--paperu-text-xs)" }}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
