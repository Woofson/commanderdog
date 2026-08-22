use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::error;

#[derive(Deserialize)]
pub struct TerminalQuery {
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

pub async fn handle_terminal_ws(
    ws: WebSocketUpgrade,
    Query(query): Query<TerminalQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_terminal_socket(socket, query))
}

async fn handle_terminal_socket(socket: WebSocket, query: TerminalQuery) {
    let pty_system = native_pty_system();
    let cols = query.cols.unwrap_or(100);
    let rows = query.rows.unwrap_or(24);

    let pair = match pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to open PTY: {}", e);
            return;
        }
    };

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);

    if let Some(ref cwd) = query.cwd {
        let p = std::path::Path::new(cwd);
        if p.exists() && p.is_dir() {
            cmd.cwd(p);
        }
    }

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to spawn shell process in PTY: {}", e);
            return;
        }
    };

    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to clone PTY reader: {}", e);
            return;
        }
    };

    let mut writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            error!("Failed to take PTY writer: {}", e);
            return;
        }
    };

    let (ws_sender, mut ws_receiver) = socket.split();
    let ws_sender = Arc::new(tokio::sync::Mutex::new(ws_sender));

    let (pty_out_tx, mut pty_out_rx) = mpsc::channel::<Vec<u8>>(100);

    // Blocking thread for reading from PTY master
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if pty_out_tx.blocking_send(buffer[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Task forwarding PTY output -> WebSocket
    let ws_sender_clone = ws_sender.clone();
    let pty_to_ws = tokio::spawn(async move {
        while let Some(data) = pty_out_rx.recv().await {
            let mut sender = ws_sender_clone.lock().await;
            if sender.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
    });

    // Task forwarding WebSocket input -> PTY master writer
    let ws_to_pty = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // Check for JSON resize command
                    if text.starts_with('{') && text.contains("resize") {
                        if let Ok(val) = serde_json::from_str::<HashMap<String, usize>>(&text) {
                            if let (Some(&c), Some(&r)) = (val.get("cols"), val.get("rows")) {
                                let _ = pair.master.resize(PtySize {
                                    rows: r as u16,
                                    cols: c as u16,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                                continue;
                            }
                        }
                    }
                    if writer.write_all(text.as_bytes()).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                Message::Binary(bytes) => {
                    if writer.write_all(&bytes).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = pty_to_ws => {},
        _ = ws_to_pty => {},
    }

    let _ = child.kill();
}
