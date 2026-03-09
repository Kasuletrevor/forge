use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{Ipv4Addr, SocketAddr},
};

use anyhow::{Context, Result};
use api::router_with_health;
use app::ForgeService;
use domain::{DEFAULT_API_HOST, DEFAULT_API_PORT, ForgePaths, HealthResponse};
use persistence_sqlite::SqliteStore;
use tokio::{net::TcpListener, signal};
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<()> {
    let paths = ForgePaths::discover().map_err(|error| anyhow::anyhow!(error.message))?;
    ensure_runtime_directories(&paths)?;
    init_tracing(&paths)?;

    if let Err(error) = run(paths).await {
        error!("{error:#}");
        return Err(error);
    }

    Ok(())
}

async fn run(paths: ForgePaths) -> Result<()> {
    let first_run = !paths.config.exists() || !paths.database.exists();
    ensure_default_config(&paths)?;

    let store = SqliteStore::new(&paths.database_url())
        .await
        .with_context(|| format!("failed to open SQLite database at {}", paths.database.display()))?;
    store.run_migrations().await.with_context(|| {
        format!(
            "failed to apply SQLite migrations at {}",
            paths.database.display()
        )
    })?;

    let started_at = domain::now_timestamp();
    let health = HealthResponse {
        status: "ok".to_string(),
        api_base_url: paths.api_base_url(DEFAULT_API_HOST, DEFAULT_API_PORT),
        paths: paths.clone(),
        started_at,
        first_run,
    };

    let service = ForgeService::new(store);
    let app = router_with_health(service, health);
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, DEFAULT_API_PORT));
    let listener = TcpListener::bind(addr).await.with_context(|| {
        format!(
            "failed to bind to {DEFAULT_API_HOST}:{DEFAULT_API_PORT}; inspect {} for details",
            paths.daemon_log.display()
        )
    })?;

    info!(
        "Forge daemon listening on http://{DEFAULT_API_HOST}:{DEFAULT_API_PORT} (db={}, logs={})",
        paths.database.display(),
        paths.logs.display()
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("Forge daemon server exited unexpectedly")?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };
    ctrl_c.await;
}

fn init_tracing(paths: &ForgePaths) -> Result<()> {
    let log_path = paths.daemon_log.clone();
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "forged=info,api=info,app=info".into());

    let _ = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_env_filter(env_filter)
        .with_writer(move || -> TeeWriter<io::Stdout, std::fs::File> {
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .expect("failed to open Forge daemon log");
            TeeWriter::new(io::stdout(), file)
        })
        .try_init();

    Ok(())
}

fn ensure_runtime_directories(paths: &ForgePaths) -> Result<()> {
    fs::create_dir_all(&paths.root)
        .with_context(|| format!("failed to create {}", paths.root.display()))?;
    fs::create_dir_all(&paths.logs)
        .with_context(|| format!("failed to create {}", paths.logs.display()))?;
    Ok(())
}

fn ensure_default_config(paths: &ForgePaths) -> Result<()> {
    let content = format!(
        "[server]\nhost = \"{DEFAULT_API_HOST}\"\nport = {DEFAULT_API_PORT}\n\n[storage]\ndatabase = \"{}\"\nlogs = \"{}\"\ndaemon_log = \"{}\"\n",
        paths.database.display(),
        paths.logs.display(),
        paths.daemon_log.display()
    );

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&paths.config)
    {
        Ok(mut file) => {
            file.write_all(content.as_bytes()).with_context(|| {
                format!("failed to write {}", paths.config.display())
            })?;
            file.flush()
                .with_context(|| format!("failed to flush {}", paths.config.display()))?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error)
            .with_context(|| format!("failed to create {}", paths.config.display())),
    }
}

struct TeeWriter<A, B> {
    left: A,
    right: B,
}

impl<A, B> TeeWriter<A, B> {
    fn new(left: A, right: B) -> Self {
        Self { left, right }
    }
}

impl<A: Write, B: Write> Write for TeeWriter<A, B> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.left.write_all(buf)?;
        self.right.write_all(buf)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.left.flush()?;
        self.right.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_default_config_is_race_safe() {
        let root = tempfile::tempdir().expect("tempdir");
        let paths = ForgePaths::from_root(root.path().join(".forge"));
        ensure_runtime_directories(&paths).expect("runtime dirs");

        std::thread::scope(|scope| {
            for _ in 0..4 {
                let paths = paths.clone();
                scope.spawn(move || {
                    ensure_default_config(&paths).expect("config creation");
                });
            }
        });

        let config = fs::read_to_string(&paths.config).expect("config");
        assert!(config.contains("host = \"127.0.0.1\""));
        assert!(config.contains("daemon_log ="));
    }

    #[test]
    fn forge_paths_include_log_file() {
        let paths = ForgePaths::from_root(std::path::Path::new("C:\\temp\\forge").to_path_buf());
        assert!(paths
            .daemon_log
            .ends_with(std::path::Path::new("logs").join("forged.log")));
        assert_eq!(paths.database_url(), "sqlite://C:/temp/forge/forge.db");
    }
}
