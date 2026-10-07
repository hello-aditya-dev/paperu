/** Paperu desktop entry point. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "@/routes";
import "@/styles/global.css";
import "@/styles/app.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Paperu root element #root not found.");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
