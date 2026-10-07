/** Paperu route definitions. */

import { createHashRouter } from "react-router";
import { App } from "@/app/App";
import { HomeRoute } from "./HomeRoute";

/**
 * Hash router: Tauri serves the frontend from the local bundle, so
 * a hash router avoids any protocol/path ambiguity. Future feature
 * routes are added here as siblings of the home route.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomeRoute /> },
    ],
  },
]);
