//! Security foundation.
//!
//! Paperu's threat model is local-first: user documents never leave
//! the machine for core operations. This module centralises the
//! runtime security invariants so they are auditable in one place.
//!
//! See docs/security/ for the full threat model.

/// Assert (at compile/runtime intent) that Paperu is operating in
/// local-only mode. This is documentation-as-code: there is no
/// network client in the core file-operation path, and this constant
/// makes that intent explicit and greppable.
pub const LOCAL_FIRST: bool = true;

/// Whether remote upload of document content is permitted by the
/// core architecture. Always false for the foundation. A future
/// feature that genuinely requires upload must flip this through an
/// explicit, documented, opt-in architecture decision.
pub const REMOTE_UPLOAD_PERMITTED: bool = false;

/// Whether telemetry/remote analytics is on by default. Always
/// false. Any future telemetry must be opt-in.
pub const TELEMETRY_DEFAULT_ON: bool = false;

/// Return a human-readable privacy summary used by the UI.
pub fn privacy_summary() -> &'static str {
    "Processed on this PC. 0 bytes uploaded."
}
