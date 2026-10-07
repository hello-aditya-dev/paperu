//! The Paperu task engine.
//!
//! Long-running operations run as tasks with a unique id, lifecycle
//! state, real progress, cancellation and a structured result/error.
//!
//! Design rules:
//!   - The UI thread is never blocked by a native operation.
//!   - Cancellation is a first-class primitive.
//!   - Progress is real, derived from the operation. Never faked.
//!   - A task always reaches a terminal state.
//!
//! For the foundation pass, the engine provides the model and the
//! cancellation primitive. Engine wiring for real long operations
//! (compression, conversion, etc.) is added by the Builder later.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use crate::contracts::common::{CorrelationId, TaskId};
use crate::contracts::tasks::{OperationKind, TaskInfo, TaskProgress, TaskStatus};

/// A handle held while a task runs, allowing cancellation.
struct RunningTask {
    info: TaskInfo,
    cancel: CancellationToken,
}

/// The in-memory registry of live tasks. Persisted history is a
/// future concern (task_history table already exists in the schema).
#[derive(Clone)]
pub struct TaskRegistry {
    inner: Arc<AsyncMutex<HashMap<TaskId, RunningTask>>>,
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    /// Register a new task, returning its id and a cancellation token
    /// the engine should check cooperatively.
    pub async fn register(
        &self,
        kind: OperationKind,
        label: impl Into<String>,
        source_files: Vec<String>,
        correlation_id: CorrelationId,
    ) -> (TaskId, CancellationToken) {
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = CancellationToken::new();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let info = TaskInfo {
            id: id.clone(),
            kind,
            status: TaskStatus::Queued,
            label: label.into(),
            created_at: now,
            started_at: None,
            completed_at: None,
            source_files,
            output_files: None,
            progress: None,
            error: None,
            correlation_id,
        };
        self.inner.lock().await.insert(
            id.clone(),
            RunningTask {
                info,
                cancel: cancel.clone(),
            },
        );
        (id, cancel)
    }

    /// Mark a task as running.
    pub async fn mark_running(&self, id: &TaskId) {
        if let Some(t) = self.inner.lock().await.get_mut(id) {
            t.info.status = TaskStatus::Running;
            t.info.started_at =
                Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        }
    }

    /// Update progress for a task.
    pub async fn report_progress(
        &self,
        id: &TaskId,
        fraction: Option<f64>,
        message: Option<String>,
    ) {
        if let Some(t) = self.inner.lock().await.get_mut(id) {
            t.info.progress = Some(TaskProgress {
                task_id: id.clone(),
                fraction,
                message,
                processed_bytes: None,
                total_bytes: None,
                updated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            });
        }
    }

    /// Request cancellation of a task. Best-effort.
    pub async fn cancel(&self, id: &TaskId) -> bool {
        if let Some(t) = self.inner.lock().await.get(id) {
            t.cancel.cancel();
            true
        } else {
            false
        }
    }

    /// Finalize a task with a terminal status and remove it from
    /// live tracking (history persistence is a future concern).
    pub async fn finish(&self, id: &TaskId, status: TaskStatus) {
        if let Some(mut t) = self.inner.lock().await.remove(id) {
            t.info.status = status;
            t.info.completed_at =
                Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        }
    }

    /// Snapshot a task by id.
    pub async fn get(&self, id: &TaskId) -> Option<TaskInfo> {
        self.inner.lock().await.get(id).map(|t| t.info.clone())
    }
}

impl Default for TaskRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Simple synchronous registry used for tests that do not need async.
#[derive(Default)]
pub struct TaskSnapshotStore {
    inner: Mutex<HashMap<TaskId, TaskInfo>>,
}

impl TaskSnapshotStore {
    pub fn put(&self, info: TaskInfo) {
        if let Ok(mut guard) = self.inner.lock() {
            let _ = guard.insert(info.id.clone(), info);
        }
    }
    pub fn get(&self, id: &TaskId) -> Option<TaskInfo> {
        self.inner.lock().ok()?.get(id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_cancel() {
        let reg = TaskRegistry::new();
        let (id, cancel) = reg
            .register(
                OperationKind::InspectFile,
                "Inspect",
                vec![],
                "corr-1".into(),
            )
            .await;
        reg.mark_running(&id).await;
        let info = reg.get(&id).await.unwrap();
        assert_eq!(info.status, TaskStatus::Running);
        assert!(reg.cancel(&id).await);
        assert!(cancel.is_cancelled());
        reg.finish(&id, TaskStatus::Cancelled).await;
        assert!(reg.get(&id).await.is_none(), "finished task is removed");
    }
}
