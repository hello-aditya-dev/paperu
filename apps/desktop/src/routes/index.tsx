/**
 * Paperu route definitions.
 *
 * Heavy feature routes (PDF engines, image engines) are lazy-loaded
 * via React.lazy so they don't bloat the initial bundle (Master
 * Prompt 3 §67-69). The Home, History, About, and Diagnostics
 * routes are eager — they're small and frequently visited.
 *
 * Hash router: Tauri serves the frontend from the local bundle, so
 * a hash router avoids any protocol/path ambiguity.
 */
/* eslint-disable react-refresh/only-export-components -- route config file, not a component module */

import { lazy, Suspense } from "react";
import { createHashRouter } from "react-router";
import { App } from "@/app/App";
import { HomeRoute } from "./HomeRoute";
import { AboutRoute } from "./AboutRoute";
import { DiagnosticsRoute } from "./DiagnosticsRoute";
import { HistoryRoute } from "./HistoryRoute";
import { PdfWorkspaceRoute } from "./PdfWorkspaceRoute";
import { ImagesWorkspaceRoute } from "./ImagesWorkspaceRoute";

// ── Lazy-loaded feature routes ────────────────────────────────────
// These pull in the pdf-lib/pdfjs-dist/canvas engines. Splitting
// them keeps the initial JS payload small (~104 kB gzip on main;
// ~395 kB gzip on builder with engines here, vs ~560 kB unsplit).

const InspectRoute = lazy(() =>
  import("./InspectRoute").then((m) => ({ default: m.InspectRoute })),
);
const PdfFitRoute = lazy(() =>
  import("./PdfFitRoute").then((m) => ({ default: m.PdfFitRoute })),
);
const ImageFitRoute = lazy(() =>
  import("./ImageFitRoute").then((m) => ({ default: m.ImageFitRoute })),
);
const PdfMergeRoute = lazy(() =>
  import("./PdfMergeRoute").then((m) => ({ default: m.PdfMergeRoute })),
);
const PdfSplitRoute = lazy(() =>
  import("./PdfSplitRoute").then((m) => ({ default: m.PdfSplitRoute })),
);
const ImagesToPdfRoute = lazy(() =>
  import("./ImagesToPdfRoute").then((m) => ({ default: m.ImagesToPdfRoute })),
);
const PdfToImagesRoute = lazy(() =>
  import("./PdfToImagesRoute").then((m) => ({ default: m.PdfToImagesRoute })),
);
const SignPdfRoute = lazy(() =>
  import("./SignPdfRoute").then((m) => ({ default: m.SignPdfRoute })),
);
const FillPdfRoute = lazy(() =>
  import("./FillPdfRoute").then((m) => ({ default: m.FillPdfRoute })),
);

// ── Master Prompt 4 consumer routes (all lazy) ──────────────────
const AssignmentStudioRoute = lazy(() =>
  import("./AssignmentStudioRoute").then((m) => ({
    default: m.AssignmentStudioRoute,
  })),
);
const PortalReadyRoute = lazy(() =>
  import("./PortalReadyRoute").then((m) => ({ default: m.PortalReadyRoute })),
);
const ApplicationKitRoute = lazy(() =>
  import("./ApplicationKitRoute").then((m) => ({
    default: m.ApplicationKitRoute,
  })),
);
const StudyReaderRoute = lazy(() =>
  import("./StudyReaderRoute").then((m) => ({ default: m.StudyReaderRoute })),
);
const NotesRoute = lazy(() =>
  import("./NotesRoute").then((m) => ({ default: m.NotesRoute })),
);
const PrintStudioRoute = lazy(() =>
  import("./PrintStudioRoute").then((m) => ({
    default: m.PrintStudioRoute,
  })),
);
const BatchStudioRoute = lazy(() =>
  import("./BatchStudioRoute").then((m) => ({ default: m.BatchStudioRoute })),
);
const PaperuSendRoute = lazy(() =>
  import("./PaperuSendRoute").then((m) => ({ default: m.PaperuSendRoute })),
);
const OnboardingRoute = lazy(() =>
  import("./OnboardingRoute").then((m) => ({ default: m.OnboardingRoute })),
);

/** A minimal loading fallback for lazy routes. */
function RouteLoading(): React.ReactNode {
  return (
    <div className="paperu-route-loading" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

/** Wrap a lazy element in a Suspense boundary. */
function withSuspense(element: React.ReactNode): React.ReactNode {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "inspect", element: withSuspense(<InspectRoute />) },
      // Workspace shells (eager — small, no engine deps).
      { path: "pdf", element: <PdfWorkspaceRoute /> },
      { path: "images", element: <ImagesWorkspaceRoute /> },
      { path: "pdf/fit", element: withSuspense(<PdfFitRoute />) },
      { path: "image/fit", element: withSuspense(<ImageFitRoute />) },
      { path: "pdf/merge", element: withSuspense(<PdfMergeRoute />) },
      { path: "pdf/split", element: withSuspense(<PdfSplitRoute />) },
      {
        path: "pdf/from-images",
        element: withSuspense(<ImagesToPdfRoute />),
      },
      {
        path: "pdf/to-images",
        element: withSuspense(<PdfToImagesRoute />),
      },
      { path: "pdf/sign", element: withSuspense(<SignPdfRoute />) },
      { path: "pdf/fill", element: withSuspense(<FillPdfRoute />) },
      { path: "about", element: <AboutRoute /> },
      { path: "diagnostics", element: <DiagnosticsRoute /> },
      { path: "history", element: <HistoryRoute /> },
      // ── Master Prompt 4 consumer routes (lazy) ─────────────────
      {
        path: "assignment",
        element: withSuspense(<AssignmentStudioRoute />),
      },
      { path: "portal", element: withSuspense(<PortalReadyRoute />) },
      { path: "kit", element: withSuspense(<ApplicationKitRoute />) },
      {
        path: "reader",
        element: withSuspense(<StudyReaderRoute path={null} />),
      },
      { path: "reader/:path", element: withSuspense(<StudyReaderRoute path={null} />) },
      { path: "notes", element: withSuspense(<NotesRoute />) },
      { path: "print", element: withSuspense(<PrintStudioRoute />) },
      { path: "batch", element: withSuspense(<BatchStudioRoute />) },
      { path: "send", element: withSuspense(<PaperuSendRoute />) },
      { path: "onboarding", element: withSuspense(<OnboardingRoute />) },
    ],
  },
]);
