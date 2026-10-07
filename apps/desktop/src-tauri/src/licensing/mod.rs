//! Licensing architecture (placeholder).
//!
//! Paperu will eventually ship as:
//!   - Free
//!   - Personal (₹399 lifetime)
//!   - Business (₹799 lifetime)
//!
//! This module defines a clean entitlement abstraction so future
//! agents do not hardwire business assumptions into the core.
//!
//! Boundaries (see docs/architecture/licensing.md):
//!   payment → licence entitlement → local feature gating
//! These three are kept separate. The desktop client never trusts
//! itself for payment verification; it only holds a local
//! entitlement view that a server can validate later.
//!
//! NO production Razorpay keys. NO fake licences. NO secrets.

use serde::{Deserialize, Serialize};

use crate::contracts::common::EditionId;

/// The product editions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Edition {
    #[serde(rename = "free")]
    Free,
    #[serde(rename = "personal")]
    Personal,
    #[serde(rename = "business")]
    Business,
}

impl Edition {
    pub fn as_id(&self) -> EditionId {
        match self {
            Edition::Free => "free".to_string(),
            Edition::Personal => "personal".to_string(),
            Edition::Business => "business".to_string(),
        }
    }
}

/// The local entitlement view. Foundation-only: always Free until a
/// real activation flow is implemented.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlement {
    pub edition: Edition,
    /// Whether the entitlement has been activated by a real licence.
    pub activated: bool,
    /// Offline grace state placeholder (days remaining, when applicable).
    pub offline_grace_days: Option<u32>,
}

impl Default for Entitlement {
    fn default() -> Self {
        Self {
            edition: Edition::Free,
            activated: false,
            offline_grace_days: None,
        }
    }
}

/// Foundation: the local entitlement is always the default (Free).
/// A future activation command will replace this with a verified
/// view; never trust the client for payment truth.
pub fn current_entitlement() -> Entitlement {
    Entitlement::default()
}
