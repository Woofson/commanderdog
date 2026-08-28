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
    commanderdog::setup_linux_desktop_env();

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

    let mut config = ConfigManager::load_all();

    // Parse CLI Arguments
    let args: Vec<String> = std::env::args().collect();
    let mut is_server_mode = false;
    let mut auto_open = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--server" | "--headless" => {
                is_server_mode = true;
                config.server.standalone = false;
            }
            "--standalone" | "-s" => {
                config.server.standalone = true;
                config.server.enable_auth = false;
                if config.server.host == "0.0.0.0" {
                    config.server.host = "127.0.0.1".to_string();
                }
                auto_open = true;
            }
            "--no-auth" => {
                config.server.enable_auth = false;
            }
            "--open" | "-o" => {
                auto_open = true;
            }
            "--port" | "-p" => {
                if i + 1 < args.len() {
                    if let Ok(p) = args[i + 1].parse::<u16>() {
                        config.server.port = p;
                    }
                    i += 1;
                }
            }
            "--host" => {
                if i + 1 < args.len() {
                    config.server.host = args[i + 1].clone();
                    i += 1;
                }
            }
            "--no-decorations" | "--frameless" => {
                config.ui.window_decorations = false;
            }
            "--decorations" => {
                config.ui.window_decorations = true;
            }
            "--version" | "-v" => {
                println!("CommanderDog v{}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            "--help" | "-h" => {
                println!("CommanderDog v{} - Multi-Tab Web Commander", env!("CARGO_PKG_VERSION"));
                println!();
                println!("USAGE:");
                println!("    commanderdog [OPTIONS]");
                println!();
                println!("OPTIONS:");
                println!("    -s, --standalone    Run in standalone desktop mode (auto-authenticates as local user, opens browser/window)");
                println!("    -o, --open          Automatically open CommanderDog in default web browser / webview");
                println!("    -p, --port <PORT>   Override web server port (default: 3140 or config.toml setting)");
                println!("        --host <HOST>   Override web server bind host (default: 0.0.0.0)");
                println!("        --no-auth       Disable login authentication and run with local permissions");
                println!("        --no-decorations Launch without window titlebar/frame (ideal for Hyprland/tiling WMs)");
                println!("        --frameless     Alias for --no-decorations");
                println!("        --decorations   Force enable window titlebar and borders");
                println!("    -v, --version       Print version information");
                println!("    -h, --help          Print this help message");
                return Ok(());
            }
            _ => {}
        }
        i += 1;
    }

    info!("Starting CommanderDog v{} with active configuration...", env!("CARGO_PKG_VERSION"));

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

    let state = AppState {
        config: Arc::new(config.clone()),
        auth: Arc::new(auth_mgr),
        tasks: Arc::new(task_mgr),
        tags: Arc::new(tag_mgr),
    };

    let app = create_router(state);

    let addr: SocketAddr = format!("{}:{}", config.server.host, config.server.port).parse()?;
    info!("CommanderDog Web Server listening on http://{}", addr);
    if config.server.standalone || !config.server.enable_auth {
        let current_user = std::env::var("USER").unwrap_or_else(|_| "user".to_string());
        info!("MODE: Standalone Desktop Mode (Running with local credentials for '{}')", current_user);
    } else {
        info!("Default Admin User: '{}' (Change password in settings)", config.auth.default_admin_user);
    }
    info!("Default Theme: '{}'", config.themes.default_theme);
    info!("Paranoid File Verification: {}", if config.paranoid.enabled { "ENABLED" } else { "DISABLED" });

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound_addr = listener.local_addr()?;
    let open_url = format!("http://127.0.0.1:{}", bound_addr.port());
    let is_standalone = config.server.standalone;

    #[cfg(feature = "gui")]
    let has_display = std::env::var("DISPLAY").is_ok() || std::env::var("WAYLAND_DISPLAY").is_ok();
    #[cfg(not(feature = "gui"))]
    let has_display = false;

    let should_launch_gui = !is_server_mode && (is_standalone || has_display);

    if should_launch_gui && has_display {
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!("CommanderDog server error: {}", e);
            }
        });

        #[cfg(feature = "gui")]
        {
            let dec_status = if config.ui.window_decorations { "enabled" } else { "disabled (borderless/tiling mode)" };
            info!("Launching CommanderDog native desktop window (decorations: {}): {}", dec_status, open_url);
            run_native_gui(&open_url, "CommanderDog", config.ui.window_decorations)?;
            return Ok(());
        }
        #[cfg(not(feature = "gui"))]
        {
            info!("Native GUI feature not compiled in. Opening via browser launcher: {}", open_url);
            let u = open_url.clone();
            tokio::spawn(async move {
                let _ = open::that(&u);
            });
        }
    } else {
        if auto_open {
            let u = open_url.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                info!("Opening CommanderDog in browser: {}", u);
                let _ = open::that(&u);
            });
        }

        axum::serve(listener, app).await?;
    }

    Ok(())
}

#[cfg(feature = "gui")]
fn run_native_gui(url: &str, title: &str, decorations: bool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tao::dpi::LogicalSize;
    use tao::event::{Event, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoop};
    use tao::window::WindowBuilder;
    use wry::WebViewBuilder;

    #[cfg(target_os = "linux")]
    use tao::platform::unix::WindowExtUnix;
    #[cfg(target_os = "linux")]
    use wry::WebViewBuilderExtUnix;

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1366.0, 840.0))
        .with_min_inner_size(LogicalSize::new(680.0, 480.0))
        .with_resizable(true)
        .with_decorations(decorations)
        .build(&event_loop)?;

    let builder = WebViewBuilder::new().with_url(url);

    #[cfg(target_os = "linux")]
    let _webview = {
        let vbox = window.default_vbox().ok_or("Failed to obtain GTK default vbox for Wayland/X11")?;
        builder.build_gtk(vbox)?
    };

    #[cfg(not(target_os = "linux"))]
    let _webview = builder.build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
