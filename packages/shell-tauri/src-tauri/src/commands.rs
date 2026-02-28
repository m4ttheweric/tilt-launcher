use crate::config;
use crate::sidecar::SidecarManager;
use crate::types::*;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub config: Mutex<Config>,
    pub sidecar: SidecarManager,
}

// ── Config commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_config(state: State<AppState>, config: Config) -> CommandResult {
    let normalized = config::normalize_config(config);
    if let Some(msg) = config::ensure_unique_ports(&normalized) {
        return CommandResult::fail(msg);
    }
    config::write_config(&normalized);
    *state.config.lock().unwrap() = normalized.clone();

    // Also update the sidecar's config so it stays in sync
    let _ = state.sidecar.call(
        "saveConfig",
        serde_json::json!({ "config": normalized }),
    );

    CommandResult::success()
}

// ── File / directory commands ────────────────────────────────────────

#[tauri::command]
pub fn get_home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub fn read_dir(dir_path: String) -> ReadDirResult {
    let resolved = expand_home(&dir_path);
    let dir = Path::new(&resolved);

    let raw_entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            return ReadDirResult {
                ok: false,
                path: resolved,
                entries: vec![],
                error: Some(e.to_string()),
            };
        }
    };

    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in raw_entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let full_path = entry.path();
        let meta = match fs::symlink_metadata(&full_path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_symlink = meta.is_symlink();
        let mut is_directory = meta.is_dir();
        let mut is_file = meta.file_type().is_file();
        let mut symlink_target = None;
        let mut real_path = None;

        if is_symlink {
            symlink_target = fs::read_link(&full_path)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            match fs::metadata(&full_path) {
                Ok(resolved) => {
                    is_directory = resolved.is_dir();
                    is_file = resolved.is_file();
                    real_path = fs::canonicalize(&full_path)
                        .ok()
                        .map(|p| p.to_string_lossy().to_string());
                }
                Err(_) => {
                    is_file = true; // broken symlink
                }
            }
        }

        entries.push(DirEntry {
            name,
            is_directory,
            is_file,
            is_symlink,
            symlink_target,
            real_path,
        });
    }

    entries.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.cmp(&b.name)
    });

    ReadDirResult {
        ok: true,
        path: resolved,
        entries,
        error: None,
    }
}

#[tauri::command]
pub fn classify_tiltfile_path(file_path: String) -> PickedTiltfile {
    let expanded = expand_home(&file_path);
    let path = Path::new(&expanded);

    // Check if it's a symlink
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_symlink() {
            let real = fs::canonicalize(path)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            return PickedTiltfile {
                path: expanded,
                is_symlink: true,
                real_path: real,
            };
        }
    }

    // Try reverse-mapping through symlinks
    if let Some(symlink_path) = find_symlink_for(&expanded) {
        return PickedTiltfile {
            path: symlink_path,
            is_symlink: true,
            real_path: Some(expanded),
        };
    }

    PickedTiltfile {
        path: expanded,
        is_symlink: false,
        real_path: None,
    }
}

// ── SDK commands — proxied to sidecar ───────────────────────────────

#[tauri::command]
pub fn get_status(state: State<AppState>) -> serde_json::Value {
    match state.sidecar.call("getStatus", serde_json::json!({})) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "envs": {}, "error": e }),
    }
}

#[tauri::command]
pub fn get_logs(state: State<AppState>, env_id: String) -> serde_json::Value {
    match state.sidecar.call("getLogs", serde_json::json!({ "envId": env_id })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "envLogs": [], "resourceLogs": {}, "error": e }),
    }
}

#[tauri::command]
pub fn start_env(state: State<AppState>, env_id: String) -> serde_json::Value {
    match state.sidecar.call("startEnv", serde_json::json!({ "envId": env_id })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn stop_env(state: State<AppState>, env_id: String) -> serde_json::Value {
    match state.sidecar.call("stopEnv", serde_json::json!({ "envId": env_id })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn restart_env(state: State<AppState>, env_id: String) -> serde_json::Value {
    match state.sidecar.call("restartEnv", serde_json::json!({ "envId": env_id })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn trigger_resource(state: State<AppState>, env_id: String, resource_name: String) -> serde_json::Value {
    match state.sidecar.call("triggerResource", serde_json::json!({ "envId": env_id, "resourceName": resource_name })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn enable_resource(state: State<AppState>, env_id: String, resource_name: String) -> serde_json::Value {
    match state.sidecar.call("enableResource", serde_json::json!({ "envId": env_id, "resourceName": resource_name })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn disable_resource(state: State<AppState>, env_id: String, resource_name: String) -> serde_json::Value {
    match state.sidecar.call("disableResource", serde_json::json!({ "envId": env_id, "resourceName": resource_name })) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn get_login_item() -> LoginItemSettings {
    // macOS login items require LaunchAgent plist — stub for now
    LoginItemSettings {
        open_at_login: false,
    }
}

#[tauri::command]
pub fn set_login_item(open_at_login: bool) -> CommandResult {
    let _ = open_at_login;
    CommandResult::success()
}

#[tauri::command]
pub fn discover_resources(
    state: State<AppState>,
    tiltfile_path: String,
    tilt_port: u16,
    timeout_ms: Option<u64>,
) -> serde_json::Value {
    let mut params = serde_json::json!({
        "tiltfilePath": tiltfile_path,
        "tiltPort": tilt_port,
    });
    if let Some(ms) = timeout_ms {
        params["timeoutMs"] = serde_json::json!(ms);
    }
    match state.sidecar.call("discoverResources", params) {
        Ok(v) => v,
        Err(e) => serde_json::json!({ "ok": false, "resources": [], "logs": [], "error": e }),
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn expand_home(p: &str) -> String {
    if p == "~" || p.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &p[1..]);
        }
    }
    p.to_string()
}

fn find_symlink_for(real_file_path: &str) -> Option<String> {
    let real_path = Path::new(real_file_path);
    let real_dir = real_path.parent()?;
    let filename = real_path.file_name()?.to_string_lossy();
    let home = dirs::home_dir()?;

    let scan_roots = [
        real_dir.parent().map(|p| p.to_path_buf()),
        Some(home.join("Documents/GitHub")),
        Some(home.join("Documents/Projects")),
        Some(home.join("repos")),
        Some(home.join("projects")),
        Some(home.join("src")),
        Some(home.join("dev")),
        Some(home.join("code")),
        Some(home.join("workspace")),
    ];

    for root in scan_roots.iter().flatten() {
        if !root.exists() {
            continue;
        }
        let entries = match fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let meta = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !meta.is_symlink() {
                continue;
            }
            let entry_real = match fs::canonicalize(&entry_path) {
                Ok(r) => r,
                Err(_) => continue,
            };
            // Directory symlink whose target is real_dir
            if entry_real == real_dir {
                return Some(format!("{}/{filename}", entry_path.display()));
            }
            // File symlink pointing directly to our file
            if entry_real == real_path {
                return Some(entry_path.to_string_lossy().to_string());
            }
            // Symlink ancestor — remap deeper path
            if let Ok(rel) = real_path.strip_prefix(&entry_real) {
                return Some(format!("{}/{}", entry_path.display(), rel.display()));
            }
        }
    }
    None
}
