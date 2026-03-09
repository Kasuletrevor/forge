#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, ExitStatus, Command, Stdio},
    time::Duration,
};

use tauri::AppHandle;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[tauri::command]
async fn ensure_daemon(app: AppHandle) -> Result<String, String> {
    let paths = domain::ForgePaths::discover().map_err(|error| error.message)?;
    let base_url = paths.api_base_url(domain::DEFAULT_API_HOST, domain::DEFAULT_API_PORT);
    let health_url = paths.health_url(domain::DEFAULT_API_HOST, domain::DEFAULT_API_PORT);
    if daemon_ready(&health_url).await {
        return Ok(base_url);
    }

    let mut process = spawn_forged(&app, &paths).map_err(|error| {
        format!(
            "failed to start Forge daemon: {error}. Inspect {} and {}",
            paths.daemon_log.display(),
            paths.config.display()
        )
    })?;
    let mut exit_status = None;
    for _ in 0..32 {
        if daemon_ready(&health_url).await {
            return Ok(base_url);
        }
        if exit_status.is_none() {
            exit_status = process.try_wait();
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    if daemon_ready(&health_url).await {
        return Ok(base_url);
    }

    Err(format_startup_failure(&paths, &health_url, exit_status))
}

async fn daemon_ready(health_url: &str) -> bool {
    reqwest::Client::new()
        .get(health_url)
        .timeout(Duration::from_millis(800))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

enum DaemonProcess {
    Sidecar,
    Child(Child),
}

impl DaemonProcess {
    fn try_wait(&mut self) -> Option<ExitStatus> {
        match self {
            Self::Sidecar => None,
            Self::Child(child) => child.try_wait().ok().flatten(),
        }
    }
}

fn spawn_forged(app: &AppHandle, paths: &domain::ForgePaths) -> anyhow::Result<DaemonProcess> {
    if let Ok(()) = spawn_bundled_sidecar(app, paths) {
        return Ok(DaemonProcess::Sidecar);
    }

    spawn_local_forged(paths).map(DaemonProcess::Child)
}

fn spawn_bundled_sidecar(app: &AppHandle, paths: &domain::ForgePaths) -> anyhow::Result<()> {
    let sidecar = app.shell().sidecar("forged")?;
    let (mut rx, _child) = sidecar.spawn()?;
    let log_path = paths.daemon_log.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(error) = write_command_event(&log_path, &event) {
                let _ = append_log_line(
                    &log_path,
                    &format!("failed to capture Forge sidecar output: {error}"),
                );
            }
        }
    });

    Ok(())
}

fn spawn_local_forged(paths: &domain::ForgePaths) -> anyhow::Result<Child> {
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.daemon_log)?;
    let stderr = stdout.try_clone()?;
    let current = env::current_exe().unwrap_or_else(|_| PathBuf::from("forge-desktop"));
    let forged = current.with_file_name(if cfg!(windows) { "forged.exe" } else { "forged" });

    if forged.exists() {
        return Command::new(forged)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .stdin(Stdio::null())
            .spawn()
            .map_err(Into::into);
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
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .stdin(Stdio::null())
        .spawn()
        .map_err(Into::into)
}

fn write_command_event(log_path: &Path, event: &CommandEvent) -> std::io::Result<()> {
    match event {
        CommandEvent::Stdout(line) => append_log_bytes(log_path, line),
        CommandEvent::Stderr(line) => append_log_bytes(log_path, line),
        CommandEvent::Error(line) => append_log_line(log_path, line),
        CommandEvent::Terminated(payload) => append_log_line(
            log_path,
            &format!("Forge sidecar terminated with code {:?}", payload.code),
        ),
        _ => Ok(()),
    }
}

fn append_log_bytes(log_path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(log_path)?;
    file.write_all(bytes)?;
    if !bytes.ends_with(b"\n") {
        file.write_all(b"\n")?;
    }
    file.flush()
}

fn append_log_line(log_path: &Path, line: &str) -> std::io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(log_path)?;
    writeln!(file, "{line}")
}

fn format_startup_failure(
    paths: &domain::ForgePaths,
    health_url: &str,
    exit_status: Option<ExitStatus>,
) -> String {
    let exit_detail = exit_status
        .map(|status| format!("daemon process exited early with status {status}; "))
        .unwrap_or_default();
    format!(
        "Forge daemon did not become ready at {health_url}; {exit_detail}inspect logs at {}, config at {}, and database at {}",
        paths.daemon_log.display(),
        paths.config.display(),
        paths.database.display()
    )
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![ensure_daemon])
        .run(tauri::generate_context!())
        .expect("failed to run Forge desktop");
}
