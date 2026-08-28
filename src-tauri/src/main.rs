// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use commanderdog::config::ConfigManager;
use commanderdog::start_background_server;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Load configuration in standalone mode
            let mut config = ConfigManager::load_all();
            config.server.standalone = true;
            config.server.enable_auth = false;
            config.server.host = "127.0.0.1".to_string();
            config.server.port = 0; // Ephemeral port allocation

            let handle = app.handle().clone();

            // Spawn embedded backend server in Tokio runtime
            tauri::async_runtime::spawn(async move {
                match start_background_server(config).await {
                    Ok(port) => {
                        let url = format!("http://127.0.0.1:{}", port);
                        tracing::info!("CommanderDog desktop backend bound to: {}", url);

                        // Create the primary standalone window pointing to the local embedded server
                        if let Err(e) = WebviewWindowBuilder::new(
                            &handle,
                            "main",
                            WebviewUrl::External(url.parse().unwrap()),
                        )
                        .title("CommanderDog")
                        .inner_size(1366.0, 840.0)
                        .min_inner_size(680.0, 480.0)
                        .resizable(true)
                        .center()
                        .build()
                        {
                            eprintln!("Failed to create main window: {}", e);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to start CommanderDog backend server: {}", e);
                    }
                }
            });

            // Configure System Tray
            let show_i = MenuItem::with_id(app, "show", "Show CommanderDog", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide CommanderDog", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running commander dog desktop application");
}
