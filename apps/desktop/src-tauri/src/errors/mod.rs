//! Paperu unified error model.
//!
//! Every IPC failure is serialized as an `AppError`. The React layer
//! never receives an opaque string or a raw Rust panic. Errors carry
//! a stable code, category, severity, recoverability and message —
//! enough for the UI to decide whether to retry, recover or report,
//! and enough for engineers to diagnose without ever seeing private
//! document contents.
//!
//! Privacy contract:
//!   - Error messages must never embed file *contents*.
//!   - Paths may be included but are truncated when very long.
//!   - No secrets, licence keys, or tokens are ever placed in errors.
//!
//! Unknown failures are still converted into a structured
//! `internal.unknown` error — panics are caught at the command
//! boundary and never surface as raw text to the UI.

use std::fmt;
use std::io;

use serde::{Deserialize, Serialize};

use crate::contracts::common::CorrelationId;

// ── Categories ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCategory {
    #[serde(rename = "filesystem")]
    Filesystem,
    #[serde(rename = "validation")]
    Validation,
    #[serde(rename = "unsupported")]
    Unsupported,
    #[serde(rename = "permission")]
    Permission,
    #[serde(rename = "processing")]
    Processing,
    #[serde(rename = "database")]
    Database,
    #[serde(rename = "cancellation")]
    Cancellation,
    #[serde(rename = "resource")]
    Resource,
    #[serde(rename = "licensing")]
    Licensing,
    #[serde(rename = "internal")]
    Internal,
}

// ── Severity ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ErrorSeverity {
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "error")]
    #[default]
    Error,
    #[serde(rename = "critical")]
    Critical,
}

// ── Recoverability ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Recoverability {
    #[serde(rename = "retryable")]
    Retryable,
    #[serde(rename = "action_required")]
    #[default]
    ActionRequired,
    #[serde(rename = "fatal")]
    Fatal,
}

// ── Stable error codes ───────────────────────────────────────────

pub mod code {
    // filesystem
    pub const FILE_NOT_FOUND: &str = "filesystem.file_not_found";
    pub const PATH_INVALID: &str = "filesystem.path_invalid";
    pub const PATH_TOO_LONG: &str = "filesystem.path_too_long";
    pub const RESERVED_NAME: &str = "filesystem.reserved_name";
    pub const ACCESS_DENIED: &str = "filesystem.access_denied";
    pub const ALREADY_EXISTS: &str = "filesystem.already_exists";
    pub const DISK_FULL: &str = "filesystem.disk_full";
    pub const IO_FAILURE: &str = "filesystem.io_failure";
    // validation
    pub const INVALID_INPUT: &str = "validation.invalid_input";
    pub const EMPTY_INPUT: &str = "validation.empty_input";
    // unsupported
    pub const UNSUPPORTED_FORMAT: &str = "unsupported.format";
    pub const UNSUPPORTED_OPERATION: &str = "unsupported.operation";
    // permission
    pub const PERMISSION_DENIED: &str = "permission.denied";
    // processing
    pub const PROCESSING_FAILED: &str = "processing.failed";
    pub const OUTPUT_VALIDATION_FAILED: &str = "processing.output_validation_failed";
    // database
    pub const DATABASE_INIT_FAILED: &str = "database.init_failed";
    pub const DATABASE_MIGRATION_FAILED: &str = "database.migration_failed";
    pub const DATABASE_UNAVAILABLE: &str = "database.unavailable";
    // cancellation
    pub const TASK_CANCELLED: &str = "cancellation.task_cancelled";
    // resource
    pub const OUT_OF_MEMORY: &str = "resource.out_of_memory";
    pub const TIMEOUT: &str = "resource.timeout";
    // licensing
    pub const LICENCE_MISSING: &str = "licensing.missing";
    pub const LICENCE_EXPIRED: &str = "licensing.expired";
    pub const LICENCE_REVOKED: &str = "licensing.revoked";
    pub const FEATURE_NOT_ENTITLED: &str = "licensing.feature_not_entitled";
    // internal
    pub const UNKNOWN: &str = "internal.unknown";
    pub const NOT_IMPLEMENTED: &str = "internal.not_implemented";
}

// ── The error envelope ───────────────────────────────────────────

/// A structured application error. Serialized to IPC as JSON.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub category: ErrorCategory,
    pub severity: ErrorSeverity,
    pub recoverability: Recoverability,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<CorrelationId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

impl AppError {
    pub fn builder(
        code: impl Into<String>,
        category: ErrorCategory,
        message: impl Into<String>,
    ) -> AppErrorBuilder {
        AppErrorBuilder {
            code: code.into(),
            category,
            severity: ErrorSeverity::default(),
            recoverability: Recoverability::default(),
            message: message.into(),
            detail: None,
            technical: None,
            cause: None,
            correlation_id: None,
            task_id: None,
        }
    }

    /// Wrap an arbitrary failure as a structured `internal.unknown`
    /// error so the UI never sees raw text.
    pub fn unknown<E: fmt::Display>(err: &E) -> Self {
        Self::builder(
            code::UNKNOWN,
            ErrorCategory::Internal,
            "Something went wrong on this PC.",
        )
        .technical(err.to_string())
        .severity(ErrorSeverity::Error)
        .recoverability(Recoverability::Fatal)
        .build()
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

// ── Builder ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppErrorBuilder {
    code: String,
    category: ErrorCategory,
    severity: ErrorSeverity,
    recoverability: Recoverability,
    message: String,
    detail: Option<String>,
    technical: Option<String>,
    cause: Option<String>,
    correlation_id: Option<CorrelationId>,
    task_id: Option<String>,
}

impl AppErrorBuilder {
    pub fn severity(mut self, s: ErrorSeverity) -> Self {
        self.severity = s;
        self
    }
    pub fn recoverability(mut self, r: Recoverability) -> Self {
        self.recoverability = r;
        self
    }
    pub fn detail(mut self, d: impl Into<String>) -> Self {
        self.detail = Some(d.into());
        self
    }
    pub fn technical(mut self, t: impl Into<String>) -> Self {
        self.technical = Some(t.into());
        self
    }
    pub fn cause(mut self, c: impl Into<String>) -> Self {
        self.cause = Some(c.into());
        self
    }
    pub fn correlation_id(mut self, c: impl Into<String>) -> Self {
        self.correlation_id = Some(c.into());
        self
    }
    pub fn task_id(mut self, t: impl Into<String>) -> Self {
        self.task_id = Some(t.into());
        self
    }
    pub fn build(self) -> AppError {
        AppError {
            code: self.code,
            category: self.category,
            severity: self.severity,
            recoverability: self.recoverability,
            message: self.message,
            detail: self.detail,
            technical: self.technical,
            cause: self.cause,
            correlation_id: self.correlation_id,
            task_id: self.task_id,
        }
    }
}

// ── Conversions ───────────────────────────────────────────────────

impl From<io::Error> for AppError {
    fn from(err: io::Error) -> Self {
        use io::ErrorKind;
        let (code, category) = match err.kind() {
            ErrorKind::NotFound => (code::FILE_NOT_FOUND, ErrorCategory::Filesystem),
            ErrorKind::PermissionDenied => (code::ACCESS_DENIED, ErrorCategory::Filesystem),
            ErrorKind::AlreadyExists => (code::ALREADY_EXISTS, ErrorCategory::Filesystem),
            ErrorKind::TimedOut => (code::TIMEOUT, ErrorCategory::Resource),
            _ => (code::IO_FAILURE, ErrorCategory::Filesystem),
        };
        Self::builder(code, category, "Paperu could not access that file.")
            .technical(err.to_string())
            .severity(ErrorSeverity::Error)
            .recoverability(Recoverability::ActionRequired)
            .build()
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::builder(
            code::INVALID_INPUT,
            ErrorCategory::Validation,
            "Paperu received data it could not read.",
        )
        .technical(err.to_string())
        .build()
    }
}

/// Result alias used throughout the backend.
pub type Result<T> = std::result::Result<T, AppError>;
