/**
 * StagedFileList — renders the files the user has dropped/picked, with
 * their real inspection status and metadata. Each file can be removed.
 */

import type { InspectFileResponse } from "@paperu/contracts";
import { Card } from "@paperu/ui";
import { kindLabel } from "@/lib/format";
import type { StagedFile } from "./UniversalDrop";

export interface StagedFileListProps {
  files: readonly StagedFile[];
  onRemove: (path: string) => void;
  onClear: () => void;
}

export function StagedFileList({
  files,
  onRemove,
  onClear,
}: StagedFileListProps): React.ReactNode {
  return (
    <Card className="paperu-staged">
      <div className="paperu-staged__head">
        <h2 className="paperu-staged__title">
          {files.length} file{files.length === 1 ? "" : "s"} ready
        </h2>
        <button
          type="button"
          className="paperu-staged__clear"
          onClick={onClear}
        >
          Clear all
        </button>
      </div>
      <ul className="paperu-staged__list">
        {files.map((f) => (
          <li key={f.path} className="paperu-staged__item">
            <StagedRow file={f} onRemove={() => onRemove(f.path)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StagedRow({
  file,
  onRemove,
}: {
  file: StagedFile;
  onRemove: () => void;
}): React.ReactNode {
  return (
    <div className="paperu-staged__row">
      <span className="paperu-staged__icon" aria-hidden="true">
        {file.result ? kindGlyph(file.result) : "⋯"}
      </span>
      <div className="paperu-staged__meta">
        <div className="paperu-staged__name" title={file.path}>
          {file.result?.fileName ?? basename(file.path)}
        </div>
        <div className="paperu-staged__sub">
          {file.status === "inspecting" && <span>Inspecting…</span>}
          {file.status === "done" && file.result && (
            <>
              <span className="paperu-staged__kind">
                {kindLabel(file.result.kind)}
              </span>
              <span className="paperu-staged__size">
                {file.result.size.humanReadable}
              </span>
              {file.result.extension && (
                <span className="paperu-staged__ext">.{file.result.extension}</span>
              )}
            </>
          )}
          {file.status === "error" && file.error && (
            <span className="paperu-staged__err">{file.error.message}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="paperu-staged__remove"
        onClick={onRemove}
        aria-label={`Remove ${file.result?.fileName ?? file.path}`}
      >
        ✕
      </button>
    </div>
  );
}

function kindGlyph(r: InspectFileResponse): string {
  switch (r.kind) {
    case "pdf":
      return "📄";
    case "image":
      return "🖼";
    default:
      return "📄";
  }
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}
