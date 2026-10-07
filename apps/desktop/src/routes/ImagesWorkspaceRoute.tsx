/** Images workspace — everything you can do with an image. */

import { WorkspaceShell } from "@/components/WorkspaceShell";

export function ImagesWorkspaceRoute(): React.ReactNode {
  return (
    <WorkspaceShell
      workspace="images"
      heading="Images"
      subtitle="Everything you can do with an image."
    />
  );
}
