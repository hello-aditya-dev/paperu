/** Paperu route definitions. */

import { createHashRouter } from "react-router";
import { App } from "@/app/App";
import { HomeRoute } from "./HomeRoute";
import { InspectRoute } from "./InspectRoute";
import { PdfFitRoute } from "./PdfFitRoute";
import { ImageFitRoute } from "./ImageFitRoute";
import { PdfMergeRoute } from "./PdfMergeRoute";
import { PdfSplitRoute } from "./PdfSplitRoute";
import { ImagesToPdfRoute } from "./ImagesToPdfRoute";
import { PdfToImagesRoute } from "./PdfToImagesRoute";
import { SignPdfRoute } from "./SignPdfRoute";
import { FillPdfRoute } from "./FillPdfRoute";

/**
 * Hash router: Tauri serves the frontend from the local bundle, so
 * a hash router avoids any protocol/path ambiguity. Feature routes are
 * added here as siblings of the home route as they are ported.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "inspect", element: <InspectRoute /> },
      { path: "pdf/fit", element: <PdfFitRoute /> },
      { path: "image/fit", element: <ImageFitRoute /> },
      { path: "pdf/merge", element: <PdfMergeRoute /> },
      { path: "pdf/split", element: <PdfSplitRoute /> },
      { path: "pdf/from-images", element: <ImagesToPdfRoute /> },
      { path: "pdf/to-images", element: <PdfToImagesRoute /> },
      { path: "pdf/sign", element: <SignPdfRoute /> },
      { path: "pdf/fill", element: <FillPdfRoute /> },
    ],
  },
]);
