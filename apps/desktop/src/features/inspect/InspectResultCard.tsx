/**
 * InspectResultCard — renders real file metadata returned by Rust.
 */

import type { InspectFileResponse } from "@paperu/contracts";
import { Card } from "@paperu/ui";
import { formatTimestamp, kindLabel } from "@/lib/format";

export interface InspectResultCardProps {
  result: InspectFileResponse;
}

export function InspectResultCard({
  result,
}: InspectResultCardProps): React.ReactNode {
  return (
    <Card className="paperu-result" aria-live="polite">
      <div className="paperu-result__head">
        <span className="paperu-result__kind">{kindLabel(result.kind)}</span>
        <h2 className="paperu-result__name" title={result.path}>
          {result.fileName}
        </h2>
      </div>

      <dl className="paperu-result__grid">
        <Field term="Size">
          <strong>{result.size.humanReadable}</strong>
          <span className="paperu-result__bytes">
            {" "}
            ({result.size.bytes.toLocaleString()} bytes)
          </span>
        </Field>
        <Field term="Type">
          {result.extension ? `.${result.extension}` : "—"}
          {result.mimeType ? (
            <span className="paperu-result__mime"> {result.mimeType}</span>
          ) : null}
        </Field>
        <Field term="Path">
          <code className="paperu-result__path">{result.path}</code>
        </Field>
        <Field term="Modified">{formatTimestamp(result.modifiedAt)}</Field>
        <Field term="Created">{formatTimestamp(result.createdAt)}</Field>
        <Field term="Accessed">{formatTimestamp(result.accessedAt)}</Field>
        <Field term="Read-only">{result.readOnly ? "Yes" : "No"}</Field>
        <Field term="Synced folder">
          {result.inSyncedFolder ? "Yes (OneDrive)" : "No"}
        </Field>
      </dl>

      <p className="paperu-result__note">
        Source file untouched. Paperu only read metadata.
      </p>
    </Card>
  );
}

function Field({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="paperu-result__field">
      <dt className="paperu-result__term">{term}</dt>
      <dd className="paperu-result__value">{children}</dd>
    </div>
  );
}
