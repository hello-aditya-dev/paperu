//! Paperu IPC contracts — Rust side.
//!
//! These types are the formal mirror of `@paperu/contracts` on the
//! TypeScript side. They MUST serialize to identical JSON. Contract
//! tests (see `tests/contract_*.rs`) assert the shapes match the
//! canonical fixtures in `packages/test-fixtures/src/contracts/`.
//!
//! Adding or changing any type here is a contract change requiring:
//!   1. A matching change in the TS contracts package.
//!   2. An updated JSON fixture.
//!   3. Integrator sign-off (contracts are Integrator-owned).

pub mod common;
pub mod inspect;
pub mod recent_work;
pub mod settings;
pub mod tasks;

pub use common::*;
pub use inspect::*;
pub use recent_work::*;
pub use settings::*;
pub use tasks::*;
