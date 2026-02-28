use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Core Config ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_theme")]
    pub theme_mode: String,
    #[serde(default)]
    pub environments: Vec<Environment>,
}

fn default_theme() -> String {
    "system".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub tiltfile_path: String,
    pub tilt_port: u16,
    #[serde(default)]
    pub external: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub selected_resources: Vec<String>,
    #[serde(default)]
    pub cached_resources: Vec<CachedResource>,
    #[serde(default)]
    pub service_mapping: Option<HashMap<String, ServiceMapping>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedResource {
    pub name: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMapping {
    pub label: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub resource_name: Option<String>,
}

// ── Status types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatusUpdate {
    pub envs: HashMap<String, EnvStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatus {
    pub status: String,
    #[serde(default)]
    pub resources: Vec<ResourceRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRow {
    pub name: String,
    pub label: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub endpoint: Option<String>,
    pub health: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub has_update: Option<bool>,
}

// ── Log types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogDelta {
    pub env_id: String,
    #[serde(default)]
    pub env_logs: Vec<String>,
    #[serde(default)]
    pub resource_logs: HashMap<String, Vec<String>>,
}

// ── File picker / dir reader ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedTiltfile {
    pub path: String,
    pub is_symlink: bool,
    #[serde(default)]
    pub real_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    #[serde(default)]
    pub symlink_target: Option<String>,
    #[serde(default)]
    pub real_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDirResult {
    pub ok: bool,
    pub path: String,
    pub entries: Vec<DirEntry>,
    #[serde(default)]
    pub error: Option<String>,
}

// ── Misc ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginItemSettings {
    pub open_at_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CommandResult {
    pub fn success() -> Self {
        Self { ok: true, error: None }
    }
    pub fn fail(msg: impl Into<String>) -> Self {
        Self { ok: false, error: Some(msg.into()) }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub ok: bool,
    #[serde(default)]
    pub resources: Vec<CachedResource>,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
}
