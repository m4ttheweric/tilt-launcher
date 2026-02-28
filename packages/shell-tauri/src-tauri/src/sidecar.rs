use log::{error, info, warn};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

/// Manages the sidecar process and JSON-RPC communication.
pub struct SidecarManager {
    child: Mutex<Option<Child>>,
    pending: Arc<Mutex<std::collections::HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
    stdin_tx: Mutex<Option<mpsc::Sender<String>>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            pending: Arc::new(Mutex::new(std::collections::HashMap::new())),
            next_id: AtomicU64::new(1),
            stdin_tx: Mutex::new(None),
        }
    }

    /// Spawn the sidecar binary and start forwarding notifications as Tauri events.
    pub fn spawn(&self, app: AppHandle) {
        let bin = find_sidecar_binary();
        info!("[tauri] Spawning sidecar: {bin}");

        let mut child = match Command::new(&bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                error!("[tauri] Failed to spawn sidecar at {bin}: {e}");
                return;
            }
        };

        // Take ownership of stdin — communicate via a channel
        let mut stdin = child.stdin.take().expect("sidecar stdin");
        let (stdin_tx, stdin_rx) = mpsc::channel::<String>();
        thread::spawn(move || {
            while let Ok(line) = stdin_rx.recv() {
                if writeln!(stdin, "{line}").is_err() {
                    break;
                }
                if stdin.flush().is_err() {
                    break;
                }
            }
        });
        *self.stdin_tx.lock().unwrap() = Some(stdin_tx);

        // Read stdout — route responses and emit notifications
        let stdout = child.stdout.take().expect("sidecar stdout");
        let pending = Arc::clone(&self.pending);
        let app_clone = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                if line.trim().is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    // Response to an RPC request
                    let mut map = pending.lock().unwrap();
                    if let Some(tx) = map.remove(&id) {
                        if let Some(err) = msg.get("error") {
                            let message = err
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("Unknown error")
                                .to_string();
                            let _ = tx.send(Err(message));
                        } else {
                            let result = msg.get("result").cloned().unwrap_or(Value::Null);
                            let _ = tx.send(Ok(result));
                        }
                    }
                } else if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
                    // Push notification — emit as Tauri event
                    let params = msg.get("params").cloned().unwrap_or(Value::Null);
                    match method {
                        "statusUpdate" => {
                            let _ = app_clone.emit("status-update", &params);
                        }
                        "logDelta" => {
                            let _ = app_clone.emit("log-delta", &params);
                        }
                        "configUpdated" => {
                            let _ = app_clone.emit("config-updated", &params);
                        }
                        "ready" => {
                            info!("[tauri] Sidecar ready");
                        }
                        other => {
                            warn!("[tauri] Unknown sidecar notification: {other}");
                        }
                    }
                }
            }
            info!("[tauri] Sidecar stdout reader exited");
        });

        // Log stderr
        let stderr = child.stderr.take().expect("sidecar stderr");
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if !line.is_empty() {
                    warn!("[sidecar stderr] {line}");
                }
            }
        });

        *self.child.lock().unwrap() = Some(child);
    }

    /// Send a JSON-RPC request and block until the response arrives.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;

        let (tx, rx) = mpsc::channel();
        {
            let mut map = self.pending.lock().unwrap();
            map.insert(id, tx);
        }

        // Send to stdin writer thread
        {
            let stdin_tx = self.stdin_tx.lock().unwrap();
            match stdin_tx.as_ref() {
                Some(sender) => {
                    if sender.send(line).is_err() {
                        let mut map = self.pending.lock().unwrap();
                        map.remove(&id);
                        return Err("Sidecar stdin closed".into());
                    }
                }
                None => {
                    let mut map = self.pending.lock().unwrap();
                    map.remove(&id);
                    return Err("Sidecar not running".into());
                }
            }
        }

        // Wait for response with timeout
        match rx.recv_timeout(std::time::Duration::from_secs(60)) {
            Ok(result) => result,
            Err(_) => {
                let mut map = self.pending.lock().unwrap();
                map.remove(&id);
                Err(format!("RPC timeout: {method}"))
            }
        }
    }

    /// Shut down the sidecar process gracefully.
    pub fn shutdown(&self) {
        // Close the stdin channel to signal the sidecar to exit
        *self.stdin_tx.lock().unwrap() = None;

        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        info!("[tauri] Sidecar shut down");
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Find the sidecar binary. In dev, use the workspace build.
fn find_sidecar_binary() -> String {
    // Candidates in order of preference
    let candidates = [
        // Dev: workspace root (run from packages/shell-tauri)
        "../../packages/sidecar/dist/tilt-sidecar",
        // Dev: workspace root (run from project root)
        "packages/sidecar/dist/tilt-sidecar",
        // Bundled: next to the app binary
        "tilt-sidecar",
    ];

    for c in &candidates {
        let path = std::path::Path::new(c);
        if path.exists() {
            return path
                .canonicalize()
                .unwrap_or_else(|_| path.to_path_buf())
                .to_string_lossy()
                .to_string();
        }
    }

    // Fallback — assume it's on PATH
    "tilt-sidecar".into()
}
