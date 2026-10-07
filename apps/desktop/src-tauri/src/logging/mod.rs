//! Structured local logging.
//!
//! Paperu logs locally only — there is no remote logging, no
//! telemetry, no crash upload. Logs are rotated and bounded so they
//! cannot grow unbounded on disk.
//!
//! Content policy:
//!   - Never log file *contents*.
//!   - Paths may be logged (they aid diagnosis and are not secret in
//!     the local-first threat model) but very long paths are trimmed.
//!   - Never log secrets, licence keys, tokens.
//!
//! Operations carry a correlation/task id for cross-referencing.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

static GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// Initialise the global tracing subscriber. Idempotent.
///
/// Writes to a daily-rotated file under `log_dir` and, in debug
/// builds, also to stderr. Returns a `WorkerGuard` whose lifetime
/// keeps the non-blocking writer flushed; it is stored in a static.
pub fn init(log_dir: &Path) {
    if GUARD.get().is_some() {
        return;
    }

    let file_appender = RollingFileAppender::new(Rotation::DAILY, log_dir, "paperu.log");

    let (non_blocking, guard) = NonBlocking::new(file_appender);
    let _ = GUARD.set(guard);

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,paperu=debug"));

    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .json()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer);

    // In debug builds, mirror human-readable output to stderr.
    #[cfg(debug_assertions)]
    let registry = registry.with(
        fmt::layer()
            .with_writer(std::io::stderr)
            .with_target(true)
            .compact(),
    );

    let _ = registry.try_init();
}

/// Resolve the default log directory for Paperu under the user's
/// local data directory. Caller ensures the directory exists.
pub fn default_log_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs")
}

/// Trim a path for logging so absurdly long paths do not flood logs.
pub fn trim_path(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    if s.len() > 256 {
        format!("{}…({} chars)", &s[..64], s.len())
    } else {
        s
    }
}
