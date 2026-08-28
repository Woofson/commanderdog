pub mod auth;
pub mod config;
pub mod server;
pub mod tools;
pub mod vfs;

use auth::AuthManager;
use config::AppConfig;
use server::{create_router, AppState};
use std::sync::Arc;
use tracing::info;

/// Creates the shared AppState for CommanderDog
pub fn create_app_state(config: &AppConfig) -> Result<AppState, Box<dyn std::error::Error + Send + Sync>> {
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
    let tag_mgr = tools::tags::TagManager::new(auth_mgr.db())?;

    Ok(AppState {
        config: Arc::new(config.clone()),
        auth: Arc::new(auth_mgr),
        tasks: Arc::new(task_mgr),
        tags: Arc::new(tag_mgr),
    })
}

/// Starts the CommanderDog HTTP server in a background task and returns the bound port
pub async fn start_background_server(mut config: AppConfig) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let state = create_app_state(&config)?;
    let app = create_router(state);

    let bind_host = if config.server.host.is_empty() {
        "127.0.0.1"
    } else {
        &config.server.host
    };

    let addr_str = format!("{}:{}", bind_host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr_str).await?;
    let local_addr = listener.local_addr()?;
    let bound_port = local_addr.port();
    config.server.port = bound_port;

    info!("CommanderDog embedded server listening on http://{}", local_addr);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("CommanderDog server error: {}", e);
        }
    });

    Ok(bound_port)
}
