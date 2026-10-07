//! Watch Folders — debounced filesystem watching via `notify` (CC0).
//! OSS harvest §22.
//!
//! Pure Rust (no Tauri dependency) so it compiles + tests on Linux without
//! the tauri-runtime feature. The Tauri wrapper lives in `commands/watch.rs`.
//!
//! notify uses ReadDirectoryChangesW (Windows), FSEvents (macOS), inotify
//! (Linux). Paperu implements its own 400ms path-dedupe debounce on top
//! (notify-debouncer-mini collapses event kinds to Any/AnyContinuous,
//! losing the create/modify/remove distinction the UX needs).
//!
//! Self-loop prevention filters Paperu's own output suffixes so a rule
//! doesn't re-trigger on Paperu's finalize_output writes.

use crate::errors::{code, AppError, ErrorCategory, Result};
use notify::{recommended_watcher, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// The event payload (emitted to the frontend by the Tauri wrapper).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub path: String,
    pub kind: String, // create | modify | remove | access | other
}

/// The active watcher. Holds the notify watcher (dropping it stops
/// watching) + the debounce thread. Dropping the watcher disconnects the
/// channel, which lets the debounce thread exit cleanly.
pub struct WatchService {
    watcher: Option<RecommendedWatcher>,
    debouncer_thread: Option<JoinHandle<()>>,
    current_path: Option<String>,
}

impl WatchService {
    pub fn new() -> Self {
        WatchService {
            watcher: None,
            debouncer_thread: None,
            current_path: None,
        }
    }

    /// Start watching a folder (recursive). Replaces any existing watcher.
    /// The callback is invoked for each debounced (400ms, path-deduped)
    /// change. Self-loop prevention filters Paperu's own output files.
    pub fn start<F>(&mut self, path: &str, callback: F) -> Result<()>
    where
        F: Fn(WatchEvent) + Send + 'static,
    {
        let p = PathBuf::from(path);
        if !p.is_dir() {
            return Err(AppError::builder(
                code::PATH_INVALID,
                ErrorCategory::Filesystem,
                "Choose an existing folder to watch.",
            )
            .technical(format!("not a directory: {path}"))
            .build());
        }
        // Channel for raw notify events → debounce thread.
        let (tx, rx) = mpsc::channel::<notify::Event>();
        let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                // Sending fails when the debounce thread exited (stop).
                let _ = tx.send(ev);
            }
        })
        .map_err(|e| {
            AppError::builder(
                code::PROCESSING_FAILED,
                ErrorCategory::Processing,
                "Paperu couldn't start watching that folder.",
            )
            .technical(e.to_string())
            .build()
        })?;
        watcher.watch(&p, RecursiveMode::Recursive).map_err(|e| {
            AppError::builder(
                code::PROCESSING_FAILED,
                ErrorCategory::Processing,
                "Paperu couldn't watch that folder. Check the path and permissions.",
            )
            .technical(e.to_string())
            .build()
        })?;
        // Debounce thread: collect unique (path → kind) for 400ms after the
        // last event, then flush the batch to the callback.
        let thread = std::thread::spawn(move || {
            let mut pending: HashMap<PathBuf, String> = HashMap::new();
            let mut last_event: Option<Instant> = None;
            loop {
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(ev) => {
                        let kind = event_kind_label(ev.kind);
                        for changed in &ev.paths {
                            let lossy = changed.to_string_lossy().to_string();
                            if is_paperu_output(&lossy) {
                                continue;
                            }
                            pending.insert(changed.clone(), kind.clone());
                        }
                        last_event = Some(Instant::now());
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        // Flush if 400ms passed since the last event.
                        if !pending.is_empty() {
                            if let Some(last) = last_event {
                                if last.elapsed() >= Duration::from_millis(400) {
                                    for (path, kind) in pending.drain() {
                                        callback(WatchEvent {
                                            path: path.to_string_lossy().to_string(),
                                            kind,
                                        });
                                    }
                                    last_event = None;
                                }
                            }
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        self.watcher = Some(watcher);
        self.debouncer_thread = Some(thread);
        self.current_path = Some(path.to_string());
        Ok(())
    }

    /// Stop the active watcher (if any). Safe to call when none is active.
    pub fn stop(&mut self) {
        // Dropping the watcher stops watching + disconnects the channel,
        // which lets the debounce thread exit on its next recv_timeout.
        self.watcher = None;
        self.debouncer_thread = None;
        self.current_path = None;
    }

    /// The currently-watched path (None if not watching).
    pub fn current_path(&self) -> Option<&str> {
        self.current_path.as_deref()
    }
}

impl Default for WatchService {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WatchService {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Map a notify EventKind to the coarse string label the UI shows.
fn event_kind_label(kind: EventKind) -> String {
    match kind {
        EventKind::Create(_) => "create".to_string(),
        EventKind::Modify(_) => "modify".to_string(),
        EventKind::Remove(_) => "remove".to_string(),
        EventKind::Access(_) => "access".to_string(),
        _ => "other".to_string(),
    }
}

/// True if the path looks like a Paperu finalize_output (so a Watch
/// Folder rule shouldn't re-trigger on Paperu's own writes).
pub fn is_paperu_output(path: &str) -> bool {
    path.contains("-paperu-")
        || path.contains("-portal-ready")
        || path.contains("-print-")
        || path.contains("-fit")
        || path.contains("-rescued")
        || path.contains("-archive")
        || path.contains("-tool")
        || path.contains("-converted")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn start_stop_watch_lifecycle() {
        let tmp = std::env::temp_dir().join(format!("paperu-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let mut svc = WatchService::new();
        assert!(svc.current_path().is_none());
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_cb = counter.clone();
        svc.start(tmp.to_str().unwrap(), move |_ev| {
            counter_cb.fetch_add(1, Ordering::SeqCst);
        })
        .expect("watcher should start on a real folder");
        assert_eq!(svc.current_path(), Some(tmp.to_str().unwrap()));
        // Create a file + wait past the 400ms debounce + the 100ms poll.
        std::fs::write(tmp.join("trigger.txt"), b"x").unwrap();
        std::thread::sleep(Duration::from_millis(1000));
        svc.stop();
        assert!(svc.current_path().is_none());
        // The watcher should have fired at least once for the new file.
        assert!(
            counter.load(Ordering::SeqCst) >= 1,
            "watcher should fire on file creation"
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn start_rejects_nonexistent_folder() {
        let mut svc = WatchService::new();
        let res = svc.start("/nonexistent/paperu-path-that-does-not-exist", |_| {});
        assert!(res.is_err(), "watcher must reject a nonexistent folder");
    }

    #[test]
    fn is_paperu_output_filters_finalize_outputs() {
        assert!(is_paperu_output("/home/user/doc-paperu-assignment.pdf"));
        assert!(is_paperu_output("/home/user/photo-portal-ready.jpg"));
        assert!(is_paperu_output("/home/user/report-print-2-up.pdf"));
        assert!(is_paperu_output("/home/user/img-fit.jpg"));
        assert!(is_paperu_output("/home/user/file-rescued.jpg"));
        assert!(is_paperu_output("/home/user/stuff-archive.zip"));
        assert!(is_paperu_output("/home/user/img-tool.png"));
        assert!(is_paperu_output("/home/user/file-converted.jpg"));
        // Normal files are NOT filtered.
        assert!(!is_paperu_output("/home/user/document.pdf"));
        assert!(!is_paperu_output("/home/user/photo.jpg"));
        assert!(!is_paperu_output("/home/user/notes.txt"));
    }

    #[test]
    fn watch_event_serializes_to_camel_case() {
        let ev = WatchEvent {
            path: "/x/y.txt".to_string(),
            kind: "create".to_string(),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["path"], "/x/y.txt");
        assert_eq!(json["kind"], "create");
    }

    #[test]
    fn event_kind_label_maps_correctly() {
        assert_eq!(
            event_kind_label(EventKind::Create(notify::event::CreateKind::File)),
            "create"
        );
        assert_eq!(
            event_kind_label(EventKind::Remove(notify::event::RemoveKind::File)),
            "remove"
        );
        assert_eq!(event_kind_label(EventKind::Any), "other");
    }
}
