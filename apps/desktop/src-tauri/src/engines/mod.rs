//! Processing engines (placeholder).
//!
//! The engines module is where future file-processing engines
//! (PDF compression, conversion, image resize, metadata removal,
//! signing, ...) will live. They are wired into the task runner and
//! speak the typed operation contracts.
//!
//! For the foundation pass, this module is intentionally empty of
//! real engines. It exists to establish the boundary so the Builder
//! can add engines without touching IPC, contracts or the task model.
//!
//! See docs/architecture/engines.md for the integration plan.

/// Marker: engines are not yet implemented. Any operation that would
/// require an engine must return `internal.not_implemented` rather
/// than pretending to succeed.
pub const ENGINES_AVAILABLE: bool = false;
