//! Filesystem abstraction layer.
//!
//! Central file handling for Paperu. Features never manipulate
//! files independently — they go through this layer so that path
//! safety, metadata inspection, temp management and atomic
//! finalization stay consistent and non-destructive.
//!
//! Non-destructive model (see docs/architecture/file-handling.md):
//!   source → temporary output → validate output → move/rename
//!   atomically → report success
//! A failed operation must never destroy or corrupt the source.

pub mod inspect;
pub mod paths;
pub mod temp;

pub use inspect::*;
pub use paths::*;
pub use temp::*;
