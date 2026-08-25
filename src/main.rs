pub mod auth;
pub mod config;
pub mod server;
pub mod tools;
pub mod vfs;

use auth::AuthManager;
use config::ConfigManager;
use server::{create_router, AppState};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "commanderdog=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    println!(r#"
   ___                                          _           ___             
  / __\___  _ __ ___  _ __ ___   __ _ _ __   __| | ___ _ __/   \___   __ _ 
 / /  / _ \| '_ ` _ \| '_ ` _ \ / _` | '_ \ / _` |/ _ \ '__/ /\ / _ \ / _` |
/ /__| (_) | | | | | | | | | | | (_| | | | | (_| |  __/ | / /_// (_) | (_| |
\____/\___/|_| |_| |_|_| |_| |_|\__,_|_| |_|\__,_|\___|_|/___,' \___/ \__, |
                                                                       |___/ 
        Multi-Tab Web Commander - By Woofson
    "#);

    let config = ConfigManager::load_all();
    info!("Starting CommanderDog with active configuration...");

    let auth_mgr = AuthManager::new(
        &config.server.database_path,
        &config.server.jwt_secret,
        config.server.session_duration_hours,
        &config.auth.mode,
        &config.auth.pam_service,
        &config.auth.default_admin_user,
        &config.auth.default_admin_pass,
    )?;

    let task_mgr = tools::tasks::TaskManager::new();

    let state = AppState {
        config: Arc::new(config.clone()),
        auth: Arc::new(auth_mgr),
        tasks: Arc::new(task_mgr),
    };

    let app = create_router(state);

    let addr: SocketAddr = format!("{}:{}", config.server.host, config.server.port).parse()?;
    info!("CommanderDog Web Server listening on http://{}", addr);
    info!("Default Admin User: '{}' (Change password in settings)", config.auth.default_admin_user);
    info!("Default Theme: '{}'", config.themes.default_theme);
    info!("Paranoid File Verification: {}", if config.paranoid.enabled { "ENABLED" } else { "DISABLED" });

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
