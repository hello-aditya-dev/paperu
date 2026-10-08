//! Settings contract (Rust mirror of `settings.ts`).

use serde::{Deserialize, Serialize};

/// Schema version of the settings object.
pub const SETTINGS_VERSION: u32 = 1;

/// Theme preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemePreference {
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "dark")]
    Dark,
    #[serde(rename = "system")]
    System,
}

/// How to handle an output name collision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictStrategy {
    #[serde(rename = "fail")]
    Fail,
    #[serde(rename = "rename")]
    Rename,
    #[serde(rename = "overwrite")]
    Overwrite,
}

/// Update-check preference. Auto-install is never supported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdatePreference {
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "notify")]
    Notify,
}

/// The persisted settings object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub theme: ThemePreference,
    pub default_conflict_strategy: ConflictStrategy,
    pub default_output_dir: Option<String>,
    pub recent_files_limit: u32,
    pub update_preference: UpdatePreference,
    pub reduced_motion: bool,
    pub allow_diagnostics: bool,
    /// P4: separate consent for product analytics (coarse event
    /// types only — never paths, filenames, document contents).
    /// Distinct from `allow_diagnostics` so a user can opt into crash
    /// reporting without opting into usage analytics.
    pub allow_product_analytics: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            theme: ThemePreference::System,
            default_conflict_strategy: ConflictStrategy::Rename,
            default_output_dir: None,
            recent_files_limit: 25,
            update_preference: UpdatePreference::Notify,
            reduced_motion: false,
            allow_diagnostics: false,
            allow_product_analytics: false,
        }
    }
}

/// A partial settings patch. Unknown keys are rejected on apply.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default)]
    pub theme: Option<ThemePreference>,
    #[serde(default)]
    pub default_conflict_strategy: Option<ConflictStrategy>,
    #[serde(default)]
    pub default_output_dir: Option<Option<String>>,
    #[serde(default)]
    pub recent_files_limit: Option<u32>,
    #[serde(default)]
    pub update_preference: Option<UpdatePreference>,
    #[serde(default)]
    pub reduced_motion: Option<bool>,
    #[serde(default)]
    pub allow_diagnostics: Option<bool>,
    #[serde(default)]
    pub allow_product_analytics: Option<bool>,
}

impl SettingsPatch {
    /// Apply the patch in place. `version` is never touched.
    pub fn apply_to(&self, target: &mut Settings) {
        if let Some(v) = self.theme {
            target.theme = v;
        }
        if let Some(v) = self.default_conflict_strategy {
            target.default_conflict_strategy = v;
        }
        if let Some(v) = self.default_output_dir.as_ref() {
            target.default_output_dir = v.clone();
        }
        if let Some(v) = self.recent_files_limit {
            target.recent_files_limit = v;
        }
        if let Some(v) = self.update_preference {
            target.update_preference = v;
        }
        if let Some(v) = self.reduced_motion {
            target.reduced_motion = v;
        }
        if let Some(v) = self.allow_diagnostics {
            target.allow_diagnostics = v;
        }
        if let Some(v) = self.allow_product_analytics {
            target.allow_product_analytics = v;
        }
    }
}
