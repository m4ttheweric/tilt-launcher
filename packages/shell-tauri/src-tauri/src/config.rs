use crate::types::Config;
use log::{error, info};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// Location of the config directory and file.
fn config_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Cannot determine home directory")
        .join(".config")
        .join("tilt-launcher")
}

fn config_path() -> PathBuf {
    if let Ok(p) = std::env::var("TILT_LAUNCHER_CONFIG") {
        return PathBuf::from(p);
    }
    config_dir().join("config.json")
}

pub fn load_config() -> Config {
    let dir = config_dir();
    fs::create_dir_all(&dir).ok();

    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str::<Config>(&contents) {
            Ok(parsed) => {
                info!("Loaded config from {}", path.display());
                normalize_config(parsed)
            }
            Err(e) => {
                // Parse error — back up the broken file instead of destroying it.
                let backup = path.with_extension("json.bak");
                error!("Failed to parse config, backing up to {}: {e}", backup.display());
                let _ = fs::rename(&path, &backup);
                let fallback = default_config();
                write_config(&fallback);
                fallback
            }
        },
        Err(_) => {
            info!("No config found, creating default at {}", path.display());
            let fallback = default_config();
            write_config(&fallback);
            fallback
        }
    }
}

pub fn write_config(config: &Config) {
    let dir = config_dir();
    fs::create_dir_all(&dir).ok();

    let path = config_path();
    let tmp = path.with_extension("json.tmp");

    match serde_json::to_string_pretty(config) {
        Ok(json) => {
            if let Err(e) = fs::write(&tmp, &json) {
                error!("Failed to write config tmp: {e}");
                return;
            }
            if let Err(e) = fs::rename(&tmp, &path) {
                error!("Failed to rename config: {e}");
            }
        }
        Err(e) => error!("Failed to serialize config: {e}"),
    }
}

pub fn normalize_config(mut raw: Config) -> Config {
    let mut used = HashSet::new();
    for (idx, env) in raw.environments.iter_mut().enumerate() {
        // Ensure each environment has a unique ID.
        if env.id.is_empty() {
            env.id = slugify(&env.name);
            if env.id.is_empty() {
                env.id = format!("env-{}", idx + 1);
            }
        }
        let base = env.id.clone();
        let mut unique = base.clone();
        let mut suffix = 2u32;
        while used.contains(&unique) {
            unique = format!("{base}-{suffix}");
            suffix += 1;
        }
        used.insert(unique.clone());
        env.id = unique;
    }
    if raw.theme_mode.is_empty() {
        raw.theme_mode = "system".into();
    }
    raw
}

pub fn ensure_unique_ports(config: &Config) -> Option<String> {
    let mut seen = std::collections::HashMap::new();
    for env in &config.environments {
        if let Some(owner) = seen.get(&env.tilt_port) {
            return Some(format!(
                "Port {} is used by both {owner} and {}.",
                env.tilt_port, env.name
            ));
        }
        seen.insert(env.tilt_port, env.name.clone());
    }
    None
}

fn default_config() -> Config {
    Config {
        theme_mode: "system".into(),
        environments: vec![],
    }
}

fn slugify(value: &str) -> String {
    value
        .to_lowercase()
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
        // Collapse consecutive dashes
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
