/** Paperu route definitions. */

import { createHashRouter } from "react-router";
import { App } from "@/app/App";
import { HomeRoute } from "./HomeRoute";
import { InspectRoute } from "./InspectRoute";

/**
 * Hash router: Tauri serves the frontend from the local bundle, so
 * a hash router avoids any protocol/path ambiguity. Feature routes are
 * added here as siblings of the home route as they are ported.
 *
 * Routes currently active:
 *   /         — Home (Universal Drop)
 *   /inspect  — Local File Inspect (the original foundation proof)
 *
 * Future routes (pending engine port + Integrator dependency approval):
 *   /pdf/fit          — PDF Make It Fit (target size)
 *   /image/fit        — Image Make It Fit (target size)
 *   /pdf/merge        — PDF Merge
 *   /pdf/split        — PDF Split / Extract
 *   /pdf/from-images  — Images → PDF
 *   /pdf/to-images    — PDF → Images
 *   /pdf/sign         — Sign PDF
 *   /pdf/fill         — Fill / Annotate
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "inspect", element: <InspectRoute /> },
    ],
  },
]);
