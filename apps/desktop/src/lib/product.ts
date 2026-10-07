/**
 * Centralized product identity for Paperu.
 *
 * The single source of truth for product metadata on the frontend.
 * Future agents must derive UI strings from these constants rather
 * than scattering hardcoded brand strings.
 *
 * The application does NOT require the website URL to be operational
 * to build or function.
 */

export const PRODUCT_NAME = "Paperu" as const;
export const PRODUCT_SLUG = "paperu" as const;
export const APP_IDENTIFIER = "app.paperu.desktop" as const;
export const WEBSITE_URL = "https://paperu.app" as const;
export const PRIVACY_SUMMARY = "Processed on this PC. 0 bytes uploaded." as const;

/** Canonical future website routes (centralised, not scattered). */
export const WEB_ROUTES = {
  HOME: "https://paperu.app",
  DOWNLOAD: "https://paperu.app/download",
  PRICING: "https://paperu.app/pricing",
  PRIVACY: "https://paperu.app/privacy",
  HELP: "https://paperu.app/help",
} as const;
