/** PDF workspace — everything you can do with a PDF. */

import { WorkspaceShell } from "@/components/WorkspaceShell";

export function PdfWorkspaceRoute(): React.ReactNode {
  return (
    <WorkspaceShell
      workspace="pdf"
      heading="PDF"
      subtitle="Everything you can do with a PDF."
    />
  );
}
