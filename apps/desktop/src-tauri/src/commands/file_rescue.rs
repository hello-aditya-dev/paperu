#![cfg(feature = "tauri-runtime")]
use crate::errors::Result;
use crate::file_rescue::{self, RescueDiagnosis};

#[tauri::command]
pub fn diagnose_file(path: String) -> Result<RescueDiagnosis> {
    file_rescue::diagnose(&path)
}
