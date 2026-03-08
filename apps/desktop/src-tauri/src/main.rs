#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

#[tauri::command]
async fn ensure_daemon() -> Result<String, String> {
    let base_url = format!("http://{}:{}", domain::DEFAULT_API_HOST, domain::DEFAULT_API_PORT);
    if daemon_ready(&base_url).await {
        return Ok(base_url);
    }

    spawn_forged().map_err(|error| error.to_string())?;
    for _ in 0..24 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if daemon_ready(&base_url).await {
            return Ok(base_url);
        }
    }

    Err("Forge daemon did not become ready".to_string())
}

async fn daemon_ready(base_url: &str) -> bool {
    reqwest::Client::new()
        .get(format!("{base_url}/health"))
        .timeout(Duration::from_millis(800))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn spawn_forged() -> anyhow::Result<()> {
    let current = env::current_exe().unwrap_or_else(|_| PathBuf::from("forge-desktop"));
    let forged = current.with_file_name(if cfg!(windows) { "forged.exe" } else { "forged" });

    if forged.exists() {
        Command::new(forged)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .spawn()?;
        return Ok(());
    }

    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| anyhow::anyhow!("failed to locate workspace root"))?
        .to_path_buf();

    Command::new("cargo")
        .args(["run", "-p", "forged"])
        .current_dir(workspace_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ensure_daemon])
        .run(tauri::generate_context!())
        .expect("failed to run Forge desktop");
}
