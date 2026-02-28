mod commands;
mod config;
mod sidecar;
mod types;

use commands::AppState;
use sidecar::SidecarManager;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg = config::load_config();

    tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(cfg),
            sidecar: SidecarManager::new(),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn the sidecar process
            let state: tauri::State<AppState> = app.state();
            state.sidecar.spawn(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_home_dir,
            commands::read_dir,
            commands::classify_tiltfile_path,
            commands::get_status,
            commands::get_logs,
            commands::start_env,
            commands::stop_env,
            commands::restart_env,
            commands::trigger_resource,
            commands::enable_resource,
            commands::disable_resource,
            commands::get_login_item,
            commands::set_login_item,
            commands::discover_resources,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
