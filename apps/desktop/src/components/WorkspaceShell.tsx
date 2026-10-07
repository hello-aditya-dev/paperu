/**
 * Paperu workspace shell — an editorial list of the modules in a
 * given workspace (Master Prompt 3 §38-40).
 *
 * Replaces the "seven giant cards" approach with a calm editorial
 * structure: heading, one-line description per tool, consistent
 * spacing. Derives its contents from the module registry
 * (getModulesInWorkspace) — no second hardcoded list.
 *
 * Used by PdfWorkspaceRoute and ImagesWorkspaceRoute.
 */

import { useNavigate } from "react-router";
import {
  getModulesInWorkspace,
  type ModuleEntry,
} from "@/lib/module-registry";

export interface WorkspaceShellProps {
  /** The workspace to render. */
  readonly workspace: ModuleEntry["workspace"];
  /** Human-friendly heading, e.g. "PDF". */
  readonly heading: string;
  /** One-line subtitle, e.g. "Everything you can do with a PDF." */
  readonly subtitle: string;
}

export function WorkspaceShell({
  workspace,
  heading,
  subtitle,
}: WorkspaceShellProps): React.ReactNode {
  const modules = getModulesInWorkspace(workspace);
  const navigate = useNavigate();

  return (
    <section className="paperu-workspace">
      <header className="paperu-workspace__header">
        <h1 className="paperu-workspace__heading">{heading}</h1>
        <p className="paperu-workspace__subtitle">{subtitle}</p>
      </header>

      {modules.length === 0 ? (
        <p className="paperu-workspace__empty">
          No tools available in this workspace yet.
        </p>
      ) : (
        <ul className="paperu-workspace__list" role="list">
          {modules.map((m) => (
            <li key={m.id} className="paperu-workspace__item">
              <button
                type="button"
                className="paperu-workspace__tool"
                onClick={() => {
                  if (!m.route.startsWith("#")) navigate(m.route);
                }}
              >
                <span className="paperu-workspace__tool-glyph" aria-hidden="true">
                  {m.glyph ?? "·"}
                </span>
                <span className="paperu-workspace__tool-body">
                  <span className="paperu-workspace__tool-label">
                    {m.label}
                  </span>
                  <span className="paperu-workspace__tool-desc">
                    {m.description}
                  </span>
                  {m.advancedName && (
                    <span className="paperu-workspace__tool-advanced">
                      {m.advancedName}
                    </span>
                  )}
                </span>
                {m.shortcut && (
                  <kbd
                    className="paperu-kbd paperu-workspace__tool-shortcut"
                    aria-hidden="true"
                  >
                    {m.shortcut}
                  </kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
