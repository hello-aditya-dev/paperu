/**
 * ErrorCard — renders a structured AppError with a clear, actionable
 * message for the user and technical detail for engineers.
 */

import type { AppError } from "@paperu/contracts";
import { Card } from "@paperu/ui";

export interface ErrorCardProps {
  error: AppError;
}

export function ErrorCard({ error }: ErrorCardProps): React.ReactNode {
  return (
    <Card
      className="paperu-error"
      role="alert"
      aria-live="assertive"
      data-category={error.category}
      data-severity={error.severity}
    >
      <div className="paperu-error__head">
        <span className="paperu-error__badge" aria-hidden="true">
          !
        </span>
        <h2 className="paperu-error__title">{error.message}</h2>
      </div>

      {error.detail ? (
        <p className="paperu-error__detail">{error.detail}</p>
      ) : null}

      <dl className="paperu-error__meta">
        <div>
          <dt>Code</dt>
          <dd>
            <code>{error.code}</code>
          </dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{error.category}</dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>{error.recoverability}</dd>
        </div>
        {error.technical ? (
          <div className="paperu-error__technical">
            <dt>Technical</dt>
            <dd>
              <code>{error.technical}</code>
            </dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
