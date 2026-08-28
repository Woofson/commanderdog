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

/// Configures Linux desktop and Wayland/Hyprland environment variables before GTK/WebKit initializes
pub fn setup_linux_desktop_env() {
    #[cfg(target_os = "linux")]
    {
        // 1. Fix WebKitGTK Error 71 (Protocol error) on Wayland compositors (Hyprland, Sway, KDE, GNOME)
        // Disabling DMA-BUF renderer avoids Wayland wl_surface protocol errors
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }

        // 2. Fix GDK "Unable to load pointer from the cursor theme" spam on Hyprland / Wayland
        if std::env::var("XCURSOR_PATH").is_err() {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/home/bolt".to_string());
            let paths = format!("{}/.local/share/icons:{}/.icons:/usr/share/icons:/usr/local/share/icons:/usr/share/pixmaps", home, home);
            std::env::set_var("XCURSOR_PATH", paths);
        }

        if std::env::var("XCURSOR_THEME").is_err() {
            if let Ok(hypr_theme) = std::env::var("HYPRCURSOR_THEME") {
                if !hypr_theme.is_empty() {
                    std::env::set_var("XCURSOR_THEME", &hypr_theme);
                } else {
                    std::env::set_var("XCURSOR_THEME", "Adwaita");
                }
            } else {
                std::env::set_var("XCURSOR_THEME", "Adwaita");
            }
        }

        if std::env::var("XCURSOR_SIZE").is_err() {
            if let Ok(hypr_size) = std::env::var("HYPRCURSOR_SIZE") {
                if !hypr_size.is_empty() {
                    std::env::set_var("XCURSOR_SIZE", &hypr_size);
                } else {
                    std::env::set_var("XCURSOR_SIZE", "24");
                }
            } else {
                std::env::set_var("XCURSOR_SIZE", "24");
            }
        }

        // Disable verbose GLib/GDK diagnostic noise
        if std::env::var("G_ENABLE_DIAGNOSTIC").is_err() {
            std::env::set_var("G_ENABLE_DIAGNOSTIC", "0");
        }

        // 3. Directly suppress GDK "Unable to load pointer..." log messages via GLib C-FFI
        silence_gdk_pointer_logs();
    }
}

#[cfg(target_os = "linux")]
fn silence_gdk_pointer_logs() {
    unsafe {
        type GLogFunc = unsafe extern "C" fn(
            log_domain: *const std::ffi::c_char,
            log_level: i32,
            message: *const std::ffi::c_char,
            user_data: *mut std::ffi::c_void,
        );

        unsafe extern "C" fn filter_gdk_logger(
            _log_domain: *const std::ffi::c_char,
            _log_level: i32,
            message: *const std::ffi::c_char,
            _user_data: *mut std::ffi::c_void,
        ) {
            if !message.is_null() {
                let msg = std::ffi::CStr::from_ptr(message).to_string_lossy();
                if msg.contains("cursor theme") || msg.contains("pointer") || msg.contains("Unable to load") {
                    return; // Silently drop mouse pointer warnings
                }
            }
        }

        // Dynamically load libglib-2.0 to register log handler
        let glib_libs = ["libglib-2.0.so.0\0", "libglib-2.0.so\0"];
        for lib_name in &glib_libs {
            let handle = libc::dlopen(lib_name.as_ptr() as *const _, libc::RTLD_LAZY | libc::RTLD_GLOBAL);
            if !handle.is_null() {
                let set_handler_sym = b"g_log_set_handler\0";
                let func_ptr = libc::dlsym(handle, set_handler_sym.as_ptr() as *const _);
                if !func_ptr.is_null() {
                    let g_log_set_handler: unsafe extern "C" fn(
                        *const std::ffi::c_char,
                        i32,
                        GLogFunc,
                        *mut std::ffi::c_void,
                    ) -> u32 = std::mem::transmute(func_ptr);

                    // Suppress Gdk and Gdk-Wayland domain messages
                    let domain_gdk = b"Gdk\0";
                    g_log_set_handler(domain_gdk.as_ptr() as *const _, 0xFF, filter_gdk_logger, std::ptr::null_mut());

                    let domain_gdk_wayland = b"Gdk-Wayland\0";
                    g_log_set_handler(domain_gdk_wayland.as_ptr() as *const _, 0xFF, filter_gdk_logger, std::ptr::null_mut());
                }

                let default_sym = b"g_log_set_default_handler\0";
                let def_ptr = libc::dlsym(handle, default_sym.as_ptr() as *const _);
                if !def_ptr.is_null() {
                    let g_log_set_default_handler: unsafe extern "C" fn(
                        GLogFunc,
                        *mut std::ffi::c_void,
                    ) -> GLogFunc = std::mem::transmute(def_ptr);
                    g_log_set_default_handler(filter_gdk_logger, std::ptr::null_mut());
                }
                break;
            }
        }
    }
}
