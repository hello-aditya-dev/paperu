//! Centralized product identity for Paperu.
//!
//! This is the single source of truth for product metadata. Future
//! agents must derive UI strings, identifiers and configuration from
//! these constants rather than scattering hardcoded brand strings
//! throughout the codebase.
//!
//! The application does NOT require the website URL to be operational
//! to build or function. The domain is referenced only where an
//! eventual website URL belongs.

/// The user-facing product name.
pub const PRODUCT_NAME: &str = "Paperu";

/// The machine slug used in package names, paths and identifiers.
pub const PRODUCT_SLUG: &str = "paperu";

/// The stable Tauri / Windows application identifier.
/// Permanent architecture — do not change after public release.
pub const APP_IDENTIFIER: &str = "app.paperu.desktop";

/// The target website URL. Not required to be live for local builds.
pub const WEBSITE_URL: &str = "https://paperu.app";

/// The current product version (mirrors Cargo.toml / package.json).
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The default Windows executable name produced by the bundler.
pub const EXECUTABLE_NAME: &str = "Paperu";

/// A human-readable privacy summary used by the UI.
pub const PRIVACY_SUMMARY: &str = "Processed on this PC. 0 bytes uploaded.";

/// Canonical future website routes (centralised, not scattered).
pub mod web {
    const BASE: &str = "https://paperu.app";

    pub const HOME: &str = BASE;
    pub const DOWNLOAD: &str = "https://paperu.app/download";
    pub const PRICING: &str = "https://paperu.app/pricing";
    pub const PRIVACY: &str = "https://paperu.app/privacy";
    pub const HELP: &str = "https://paperu.app/help";
}
