//! Application kit contract (Rust mirror of `application_kit.ts`).
//!
//! Records the user's reusable personal documents: photo, signature,
//! initials, resume, ID files, marksheets, certificates. NEVER stores
//! document bytes — only file references + metadata (§19, §76).

use serde::{Deserialize, Serialize};

/// The kind of application kit item. Drives the UI grouping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApplicationKitItemKind {
    Photo,
    Signature,
    Initials,
    Resume,
    Id,
    Marksheet,
    Certificate,
    Other,
}

impl ApplicationKitItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Photo => "photo",
            Self::Signature => "signature",
            Self::Initials => "initials",
            Self::Resume => "resume",
            Self::Id => "id",
            Self::Marksheet => "marksheet",
            Self::Certificate => "certificate",
            Self::Other => "other",
        }
    }
}

/// A single application kit item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationKitItem {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub file_path: String,
    pub file_name: String,
    pub file_kind: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub notes: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Request to add a new kit item.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddApplicationKitItemRequest {
    pub kind: String,
    pub label: String,
    pub file_path: String,
    pub file_name: String,
    pub file_kind: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub notes: Option<String>,
}

/// Request to update an existing kit item. All fields optional —
/// only provided fields are updated.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateApplicationKitItemRequest {
    pub id: String,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub sort_order: Option<i64>,
}
