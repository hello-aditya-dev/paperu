//! Application state shared across Tauri commands.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::database::Database;
use crate::tasks::TaskRegistry;

/// State managed by Tauri and injected into commands.
pub struct AppState {
    pub db: Database,
    pub tasks: TaskRegistry,
    pub app_data_dir: PathBuf,
    /// P0-E: Open With queue. When Paperu is launched with a file path
    /// as a CLI argument (Windows "Open With", macOS "open -a Paperu",
    /// Linux `xdg-open`), `setup` parses `std::env::args()`, validates
    /// the path, and pushes it here. The frontend pops the queue via
    /// the `consume_open_with_event` command on its first ready tick —
    /// this both signals "frontend ready" and retrieves the path.
    /// Subsequent launches (second instance) emit the
    /// `paperu://open-file` event directly, bypassing this queue.
    pub open_with_queue: Mutex<Vec<String>>,
}
