//! Task engine contract (Rust mirror of `tasks.ts`).

use serde::{Deserialize, Serialize};

use super::common::{CorrelationId, FilePath, IsoTimestamp, TaskId};

/// Stable operation-kind discriminator. Mirrors `OperationKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationKind {
    #[serde(rename = "inspect_file")]
    InspectFile,
    #[serde(rename = "pdf.compress")]
    PdfCompress,
    #[serde(rename = "pdf.compress_target_size")]
    PdfCompressToTargetSize,
    #[serde(rename = "pdf.merge")]
    PdfMerge,
    #[serde(rename = "pdf.split")]
    PdfSplit,
    #[serde(rename = "pdf.convert")]
    PdfConvert,
    #[serde(rename = "image.resize")]
    ImageResize,
    #[serde(rename = "image.compress")]
    ImageCompress,
    #[serde(rename = "image.convert")]
    ImageConvert,
    #[serde(rename = "metadata.remove")]
    MetadataRemove,
    #[serde(rename = "sign.apply")]
    Sign,
}

/// Task lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    #[serde(rename = "queued")]
    Queued,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
}

impl TaskStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
        )
    }
}

/// Real progress for a running task.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub task_id: TaskId,
    /// 0..1 fractional progress, or null when indeterminate.
    pub fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processed_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    pub updated_at: IsoTimestamp,
}

/// A snapshot of a task at a point in time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: TaskId,
    pub kind: OperationKind,
    pub status: TaskStatus,
    pub label: String,
    pub created_at: IsoTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<IsoTimestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<IsoTimestamp>,
    pub source_files: Vec<FilePath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_files: Option<Vec<FilePath>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<TaskProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<crate::errors::AppError>,
    pub correlation_id: CorrelationId,
}

/// Arguments for the cancel_task command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTaskArgs {
    pub task_id: TaskId,
}
