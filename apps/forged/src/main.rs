use std::{
    fs,
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use api::router;
use app::ForgeService;
use domain::{DEFAULT_API_HOST, DEFAULT_API_PORT};
use persistence_sqlite::SqliteStore;
use tokio::{net::TcpListener, signal};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let paths = ForgePaths::discover()?;
    paths.ensure()?;
    paths.ensure_default_config()?;

    let store = SqliteStore::new(&paths.database_url()).await?;
    store.run_migrations().await?;

    let service = ForgeService::new(store);
    let app = router(service);
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, DEFAULT_API_PORT));
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {DEFAULT_API_HOST}:{DEFAULT_API_PORT}"))?;

    info!("Forge daemon listening on http://{DEFAULT_API_HOST}:{DEFAULT_API_PORT}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };
    ctrl_c.await;
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "forged=info,api=info,app=info".into()),
        )
        .init();
}

#[derive(Debug, Clone)]
struct ForgePaths {
    root: PathBuf,
    db: PathBuf,
    config: PathBuf,
    logs: PathBuf,
}

impl ForgePaths {
    fn discover() -> Result<Self> {
        let home = dirs::home_dir().context("failed to locate user home directory")?;
        let root = home.join(".forge");
        Ok(Self {
            db: root.join("forge.db"),
            config: root.join("config.toml"),
            logs: root.join("logs"),
            root,
        })
    }

    fn ensure(&self) -> Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(&self.logs)?;
        Ok(())
    }

    fn ensure_default_config(&self) -> Result<()> {
        if self.config.exists() {
            return Ok(());
        }

        let content = format!(
            "[server]\nhost = \"{DEFAULT_API_HOST}\"\nport = {DEFAULT_API_PORT}\n\n[storage]\ndatabase = \"{}\"\nlogs = \"{}\"\n",
            self.db.display(),
            self.logs.display()
        );
        fs::write(&self.config, content)?;
        Ok(())
    }

    fn database_url(&self) -> String {
        sqlite_url_from_path(&self.db)
    }
}

fn sqlite_url_from_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    format!("sqlite://{raw}")
}
