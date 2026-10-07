//! Application state shared across Tauri commands.

use std::path::PathBuf;

use crate::database::Database;
use crate::tasks::TaskRegistry;

/// State managed by Tauri and injected into commands.
pub struct AppState {
    pub db: Database,
    pub tasks: TaskRegistry,
    pub app_data_dir: PathBuf,
}
