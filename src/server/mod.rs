pub mod terminal;

use crate::auth::{AuthManager, GlobalMount, User};
use crate::config::AppConfig;
use crate::tools::diff::compare_files_text;
use crate::tools::paranoid::ParanoidEngine;
use crate::tools::tasks::{TaskInfo, TaskManager};
use crate::vfs::archive::ArchiveHandler;
use crate::vfs::checksum::calculate_checksum;
use crate::vfs::local::LocalFs;
use crate::vfs::sftp::SftpClient;
use crate::vfs::webdav::WebDavClient;
use crate::vfs::DirectoryListing;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post},
    Router,
};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[derive(RustEmbed)]
#[folder = "frontend/"]
struct Asset;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub auth: Arc<AuthManager>,
    pub tasks: Arc<TaskManager>,
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Auth API
        .route("/api/auth/login", post(handle_login))
        .route("/api/auth/logout", post(handle_logout))
        .route("/api/auth/me", get(handle_get_me))
        .route("/api/auth/profile", post(handle_update_profile))
        .route("/api/auth/users", get(handle_list_users).post(handle_create_user))
        .route("/api/auth/users/:username", delete(handle_delete_user).post(handle_update_user_rbac))
        // Global Network Mounts & Permissions API
        .route("/api/mounts/accessible", get(handle_list_accessible_mounts))
        .route("/api/mounts/all", get(handle_list_all_mounts))
        .route("/api/mounts", post(handle_create_or_update_mount))
        .route("/api/mounts/:id", delete(handle_delete_mount))
        // VFS File Operations
        .route("/api/fs/list", get(handle_list_dir))
        .route("/api/fs/read", get(handle_read_file))
        .route("/api/fs/write", post(handle_write_file))
        .route("/api/fs/mkdir", post(handle_mkdir))
        .route("/api/fs/rename", post(handle_rename))
        .route("/api/fs/batch-rename", post(handle_batch_rename))
        .route("/api/fs/delete", post(handle_delete))
        .route("/api/fs/copy", post(handle_copy))
        .route("/api/fs/deltacopy", post(handle_deltacopy))
        .route("/api/fs/move", post(handle_move))
        .route("/api/fs/chmod", post(handle_chmod))
        .route("/api/fs/chown", post(handle_chown))
        .route("/api/fs/upload", post(handle_upload))
        .route("/api/fs/download", get(handle_download))
        .route("/api/fs/archive/create", post(handle_archive_create))
        .route("/api/fs/archive/extract", post(handle_archive_extract))
        .route("/api/fs/checksum", post(handle_calculate_checksum))
        // Remote Connections & Test
        .route("/api/remotes/test", post(handle_test_remote))
        .route("/api/remotes/proton/status", get(handle_proton_status))
        // Tools, Comparison & Tasks
        .route("/api/tools/diff/files", post(handle_diff_files))
        .route("/api/tools/diff/folders", post(handle_diff_folders))
        .route("/api/tools/convert", post(handle_convert_file))
        .route("/api/tools/paranoid/dry-run", post(handle_paranoid_dry_run))
        .route("/api/tools/sync/analyze", post(handle_sync_analyze))
        .route("/api/tools/sync/execute", post(handle_sync_execute))
        .route("/api/tools/syncthing/status", get(handle_syncthing_status))
        .route("/api/tools/syncthing/scan", post(handle_syncthing_scan))
        .route("/api/tools/search", post(handle_search))
        .route("/api/actions/run", post(handle_run_action))
        .route("/api/tasks", get(handle_list_tasks))
        .route("/api/tasks/:id/cancel", post(handle_cancel_task))
        // Terminal WebSocket
        .route("/api/ws/terminal", get(terminal::handle_terminal_ws))
        // System & Config Information
        .route("/api/config", get(handle_get_config))
        .route("/api/system/users-groups", get(handle_get_system_users_groups))
        .route("/api/system/confd-files", get(handle_get_confd_files))
        // Embedded Frontend Fallback
        .fallback(handle_static_asset)
        .layer(DefaultBodyLimit::max(state.config.server.upload_max_size_mb * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

// ---------------- AUTH HANDLERS ----------------

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
    user: User,
}

async fn handle_login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, String)> {
    match state.auth.authenticate(&payload.username, &payload.password) {
        Ok(user) => {
            let token = state.auth.generate_token(&user).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create token: {}", e))
            })?;
            Ok(Json(LoginResponse { token, user }))
        }
        Err(_) => Err((StatusCode::UNAUTHORIZED, "Invalid username or password".to_string())),
    }
}

async fn handle_logout() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "success": true, "message": "Logged out" }))
}

async fn handle_get_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<User>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        match state.auth.verify_token(token_str) {
            Ok(claims) => {
                if let Ok(Some(user)) = state.auth.get_user_by_username(&claims.sub) {
                    return Ok(Json(user));
                }
                // Automatically sync PAM user to database so they appear in Users table & RBAC
                if let Ok(synced_user) = state.auth.sync_pam_user_to_db(&claims.sub, &claims.role, &claims.home_dir) {
                    return Ok(Json(synced_user));
                }
                Ok(Json(User {
                    id: 0,
                    username: claims.sub,
                    nickname: None,
                    email: None,
                    avatar_url: None,
                    role: claims.role,
                    home_dir: claims.home_dir,
                    is_pam: claims.is_pam,
                    allowed_services: "[\"*\"]".to_string(),
                }))
            }
            Err(_) => Err((StatusCode::UNAUTHORIZED, "Invalid token".to_string())),
        }
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization header".to_string()))
    }
}

#[derive(Deserialize)]
struct UpdateProfileRequest {
    nickname: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
    new_password: Option<String>,
}

async fn handle_update_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let _ = state.auth.update_user_profile(
            &claims.sub,
            payload.nickname.as_deref(),
            payload.email.as_deref(),
            payload.avatar_url.as_deref(),
        ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update profile: {}", e)))?;

        if let Some(ref new_pass) = payload.new_password {
            if !new_pass.trim().is_empty() {
                let _ = state.auth.update_user_password(&claims.sub, new_pass)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update password: {}", e)))?;
            }
        }

        return Ok(Json(serde_json::json!({ "success": true, "message": "Profile updated successfully" })));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

#[derive(Deserialize)]
struct UpdateUserRbacRequest {
    role: String,
    allowed_services: Vec<String>,
    home_dir: Option<String>,
}

async fn handle_update_user_rbac(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(username): AxumPath<String>,
    Json(payload): Json<UpdateUserRbacRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        if claims.role != "admin" {
            return Err((StatusCode::FORBIDDEN, "Only administrators can modify user roles and permissions".to_string()));
        }

        let services_json = serde_json::to_string(&payload.allowed_services).unwrap_or_else(|_| "[\"*\"]".to_string());
        let updated = state.auth.update_user_rbac(&username, &payload.role, &services_json, payload.home_dir.as_deref())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update user RBAC: {}", e)))?;

        return Ok(Json(serde_json::json!({ "success": updated })));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<User>>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        if let Ok(claims) = state.auth.verify_token(token_str) {
            if claims.is_pam {
                let _ = state.auth.sync_pam_user_to_db(&claims.sub, &claims.role, &claims.home_dir);
            }
        }
    }
    state.auth.list_users().map(Json).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list users: {}", e))
    })
}

#[derive(Deserialize)]
struct CreateUserRequest {
    username: String,
    password: String,
    role: String,
    home_dir: String,
}

async fn handle_create_user(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<User>, (StatusCode, String)> {
    state
        .auth
        .create_user(&payload.username, &payload.password, &payload.role, &payload.home_dir)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to create user: {}", e)))
}

async fn handle_delete_user(
    State(state): State<AppState>,
    AxumPath(username): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    state.auth.delete_user(&username).map(|deleted| {
        Json(serde_json::json!({ "success": deleted }))
    }).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete user: {}", e)))
}

// ---------------- GLOBAL NETWORK MOUNTS & RBAC HANDLERS ----------------

#[derive(Deserialize)]
struct CreateMountRequest {
    name: String,
    protocol: String,
    target_uri: String,
    options_json: Option<String>,
    allowed_users: Option<Vec<String>>,
}

async fn handle_list_accessible_mounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<GlobalMount>>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let is_admin = claims.role == "admin";
        let mounts = state.auth.list_accessible_mounts(&claims.sub, is_admin)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list accessible mounts: {}", e)))?;
        Ok(Json(mounts))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

async fn handle_list_all_mounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<GlobalMount>>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        if claims.role != "admin" {
            return Err((StatusCode::FORBIDDEN, "Only administrators can view all mounts".to_string()));
        }
        let mounts = state.auth.list_all_mounts()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list all mounts: {}", e)))?;
        Ok(Json(mounts))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

async fn handle_create_or_update_mount(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateMountRequest>,
) -> Result<Json<GlobalMount>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        if claims.role != "admin" {
            return Err((StatusCode::FORBIDDEN, "Only administrators can create or configure global mounts".to_string()));
        }

        let allowed_users_str = if let Some(users) = payload.allowed_users {
            serde_json::to_string(&users).unwrap_or_else(|_| "[\"*\"]".to_string())
        } else {
            "[\"*\"]".to_string()
        };

        let options_str = payload.options_json.unwrap_or_else(|| "{}".to_string());

        let mount = state.auth.create_or_update_mount(
            &payload.name,
            &payload.protocol,
            &payload.target_uri,
            &options_str,
            &allowed_users_str,
        ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save global mount: {}", e)))?;

        Ok(Json(mount))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

async fn handle_delete_mount(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        if claims.role != "admin" {
            return Err((StatusCode::FORBIDDEN, "Only administrators can delete global mounts".to_string()));
        }

        state.auth.delete_mount(id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete mount: {}", e)))?;

        Ok(Json(serde_json::json!({ "success": true, "message": "Mount removed" })))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

// ---------------- VFS HANDLERS ----------------

#[derive(Deserialize)]
#[allow(dead_code)]
struct ListQuery {
    path: Option<String>,
    show_hidden: Option<bool>,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    pass: Option<String>,
}

async fn handle_list_dir(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<DirectoryListing>, (StatusCode, String)> {
    let target_path = query.path.unwrap_or_else(|| state.config.server.root_path.clone());
    let show_hidden = query.show_hidden.unwrap_or(state.config.ui.show_hidden_files);

    if target_path.starts_with("archive://") {
        let rest = target_path.strip_prefix("archive://").unwrap();
        let parts: Vec<&str> = rest.split('#').collect();
        let archive_file = parts[0];
        let subpath = if parts.len() > 1 { parts[1] } else { "" };
        ArchiveHandler::list_archive_contents(archive_file, subpath)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to list archive: {}", e)))
    } else if target_path.starts_with("sftp://") {
        let clean = target_path.strip_prefix("sftp://").unwrap();
        // format: user@host:port/path
        let parts: Vec<&str> = clean.splitn(2, '@').collect();
        let username = if parts.len() > 1 { parts[0] } else { query.user.as_deref().unwrap_or("root") };
        let host_rest = if parts.len() > 1 { parts[1] } else { parts[0] };

        let host_parts: Vec<&str> = host_rest.splitn(2, '/').collect();
        let host_port: Vec<&str> = host_parts[0].split(':').collect();
        let host = host_port[0];
        let port = if host_port.len() > 1 { host_port[1].parse::<u16>().unwrap_or(22) } else { 22 };
        let remote_path = if host_parts.len() > 1 { format!("/{}", host_parts[1]) } else { "/".to_string() };

        SftpClient::list_dir(host, port, username, query.pass.as_deref(), &remote_path)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("SFTP list failed: {}", e)))
    } else if target_path.starts_with("webdav://") || target_path.starts_with("http://") || target_path.starts_with("https://") {
        let url = if target_path.starts_with("webdav://") {
            format!("http://{}", target_path.strip_prefix("webdav://").unwrap())
        } else {
            target_path
        };
        WebDavClient::list_dir(&url, query.user.as_deref(), query.pass.as_deref()).await
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to list WebDAV: {}", e)))
    } else if target_path.starts_with("proton://") {
        let entries = crate::vfs::proton::ProtonDriveClient::list_directory(&target_path).await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Proton Drive list failed: {}", e)))?;
        let total_files = entries.iter().filter(|e| !e.is_dir).count();
        let total_dirs = entries.iter().filter(|e| e.is_dir).count();
        let total_size = entries.iter().map(|e| e.size).sum();
        let parent_path = if target_path == "proton://" || target_path == "proton:///" {
            None
        } else {
            let clean = target_path.trim_start_matches("proton://").trim_start_matches('/');
            let p = std::path::Path::new(clean);
            p.parent().and_then(|par| {
                let s = par.to_string_lossy().to_string();
                if s.is_empty() { Some("proton:///".to_string()) } else { Some(format!("proton:///{}", s)) }
            })
        };

        Ok(Json(DirectoryListing {
            current_path: target_path,
            parent_path,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "proton".to_string(),
        }))
    } else if target_path.starts_with("smb://") {
        let params = crate::vfs::smb::SmbClient::parse_uri(&target_path, query.user.as_deref(), query.pass.as_deref())
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
        crate::vfs::smb::SmbClient::list_dir(&params)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("SMB list failed: {}", e)))
    } else if target_path.starts_with("nfs://") {
        let params = crate::vfs::nfs::NfsClient::parse_uri(&target_path)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid NFS URI: {}", e)))?;
        crate::vfs::nfs::NfsClient::list_dir(&params, show_hidden)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("NFS list failed: {}", e)))
    } else {
        LocalFs::list_dir(&target_path, show_hidden)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to list local directory: {}", e)))
    }
}

#[derive(Deserialize)]
struct ReadFileQuery {
    path: String,
    max_bytes: Option<usize>,
}

async fn handle_read_file(
    Query(query): Query<ReadFileQuery>,
) -> Result<Json<crate::vfs::FileContentResponse>, (StatusCode, String)> {
    let max_b = query.max_bytes.unwrap_or(10_000_000);

    if query.path.starts_with("archive://") {
        let rest = query.path.strip_prefix("archive://").unwrap();
        let parts: Vec<&str> = rest.split('#').collect();
        let archive_file = parts[0];
        let subpath = if parts.len() > 1 { parts[1] } else { "" };
        ArchiveHandler::read_archive_entry(archive_file, subpath, max_b)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to read archive item: {}", e)))
    } else if query.path.starts_with("smb://") {
        let params = crate::vfs::smb::SmbClient::parse_uri(&query.path, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
        crate::vfs::smb::SmbClient::read_file(&params)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to read SMB file: {}", e)))
    } else {
        LocalFs::read_file(&query.path, max_b)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to read file: {}", e)))
    }
}

#[derive(Deserialize)]
struct WriteFileRequest {
    path: String,
    content: String,
    atomic: Option<bool>,
}

async fn handle_write_file(
    State(state): State<AppState>,
    Json(payload): Json<WriteFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if payload.path.starts_with("smb://") {
        let params = crate::vfs::smb::SmbClient::parse_uri(&payload.path, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
        crate::vfs::smb::SmbClient::write_file(&params, payload.content.as_bytes())
            .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save SMB file: {}", e)))
    } else {
        let atomic = payload.atomic.unwrap_or(state.config.paranoid.atomic_writes);
        LocalFs::write_file(&payload.path, payload.content.as_bytes(), atomic)
            .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save file: {}", e)))
    }
}

#[derive(Deserialize)]
struct MkdirRequest {
    path: String,
}

async fn handle_mkdir(
    Json(payload): Json<MkdirRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    LocalFs::create_dir(&payload.path)
        .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to create folder: {}", e)))
}

#[derive(Deserialize)]
struct RenameRequest {
    from: String,
    to: String,
}

async fn handle_rename(
    Json(payload): Json<RenameRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    LocalFs::rename_entry(&payload.from, &payload.to)
        .map(|_| Json(serde_json::json!({ "success": true })))
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to rename: {}", e)))
}

#[derive(Deserialize)]
struct BatchRenameItem {
    from: String,
    to: String,
}

#[derive(Deserialize)]
struct BatchRenameRequest {
    renames: Vec<BatchRenameItem>,
}

async fn handle_batch_rename(
    Json(payload): Json<BatchRenameRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut renamed = 0;
    let mut errors = Vec::new();

    for item in payload.renames {
        if item.from != item.to {
            match LocalFs::rename_entry(&item.from, &item.to) {
                Ok(_) => renamed += 1,
                Err(e) => errors.push(format!("{}: {}", item.from, e)),
            }
        }
    }

    if errors.is_empty() {
        Ok(Json(serde_json::json!({ "success": true, "renamed_count": renamed })))
    } else {
        Err((StatusCode::MULTI_STATUS, format!("Encountered errors: {}", errors.join("; "))))
    }
}

#[derive(Deserialize)]
struct DeleteRequest {
    paths: Vec<String>,
    use_trash: Option<bool>,
}

async fn handle_delete(
    State(state): State<AppState>,
    Json(payload): Json<DeleteRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let use_trash = payload.use_trash.unwrap_or(state.config.paranoid.trash_enabled);
    let mut deleted = Vec::new();
    let mut errors = Vec::new();

    for path in &payload.paths {
        match LocalFs::delete_entry(path, use_trash, state.config.paranoid.custom_trash_dir.as_deref()) {
            Ok(_) => deleted.push(path.clone()),
            Err(e) => errors.push(format!("{}: {}", path, e)),
        }
    }

    if errors.is_empty() {
        Ok(Json(serde_json::json!({ "success": true, "deleted": deleted })))
    } else {
        Err((StatusCode::MULTI_STATUS, format!("Encountered errors: {}", errors.join("; "))))
    }
}

#[derive(Deserialize)]
struct ChmodRequest {
    paths: Vec<String>,
    mode: u32,
    recursive: Option<bool>,
}

async fn handle_chmod(
    Json(payload): Json<ChmodRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rec = payload.recursive.unwrap_or(false);
    for p in &payload.paths {
        LocalFs::chmod_entry(p, payload.mode, rec)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Chmod failed for {}: {}", p, e)))?;
    }
    Ok(Json(serde_json::json!({ "success": true, "mode": format!("{:04o}", payload.mode) })))
}

#[derive(Deserialize)]
struct ChownRequest {
    paths: Vec<String>,
    owner: Option<String>,
    group: Option<String>,
    recursive: Option<bool>,
}

async fn handle_chown(
    Json(payload): Json<ChownRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rec = payload.recursive.unwrap_or(false);

    let uid_val: Option<u32> = if let Some(ref o) = payload.owner {
        if let Ok(u) = o.parse::<u32>() {
            Some(u)
        } else if let Ok(passwd) = fs::read_to_string("/etc/passwd") {
            passwd.lines().find_map(|l| {
                let parts: Vec<&str> = l.split(':').collect();
                if parts.len() >= 3 && parts[0] == o {
                    parts[2].parse::<u32>().ok()
                } else {
                    None
                }
            })
        } else {
            None
        }
    } else {
        None
    };

    let gid_val: Option<u32> = if let Some(ref g) = payload.group {
        if let Ok(gid) = g.parse::<u32>() {
            Some(gid)
        } else if let Ok(grp) = fs::read_to_string("/etc/group") {
            grp.lines().find_map(|l| {
                let parts: Vec<&str> = l.split(':').collect();
                if parts.len() >= 3 && parts[0] == g {
                    parts[2].parse::<u32>().ok()
                } else {
                    None
                }
            })
        } else {
            None
        }
    } else {
        None
    };

    for p in &payload.paths {
        LocalFs::chown_entry(p, uid_val, gid_val, rec)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Chown failed for {}: {}", p, e)))?;
    }

    Ok(Json(serde_json::json!({ "success": true, "uid": uid_val, "gid": gid_val })))
}

#[derive(Deserialize)]
struct TransferRequest {
    sources: Vec<String>,
    destination: String,
    paranoid: Option<bool>,
}

async fn handle_copy(
    State(state): State<AppState>,
    Json(payload): Json<TransferRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let paranoid = payload.paranoid.unwrap_or(state.config.paranoid.verify_after_transfer);
    let dest_dir = Path::new(&payload.destination);

    let task_id = state.tasks.create_task(
        &format!("Copy {} items", payload.sources.len()),
        "copy",
        &payload.sources.join(", "),
        &payload.destination,
        0,
    ).await;

    for src_str in &payload.sources {
        let src_path = Path::new(src_str);
        let target = if dest_dir.is_dir() {
            dest_dir.join(src_path.file_name().unwrap_or_default())
        } else {
            dest_dir.to_path_buf()
        };

        if let Err(e) = LocalFs::copy_file_paranoid(src_str, &target.to_string_lossy(), paranoid) {
            state.tasks.fail_task(&task_id, &e.to_string()).await;
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Copy failed for {}: {}", src_str, e)));
        }
    }

    state.tasks.complete_task(&task_id).await;
    Ok(Json(serde_json::json!({ "success": true, "task_id": task_id, "copied_count": payload.sources.len() })))
}

#[derive(Deserialize)]
struct DeltaCopyRequest {
    sources: Vec<String>,
    destination: String,
    options: Option<crate::tools::deltacopy::DeltaCopyOptions>,
}

async fn handle_deltacopy(
    State(state): State<AppState>,
    Json(payload): Json<DeltaCopyRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let opts = payload.options.unwrap_or_default();
    let tasks_mgr = state.tasks.clone();
    let cancel_token = Arc::new(std::sync::atomic::AtomicBool::new(false));

    tokio::spawn(async move {
        let _ = crate::tools::deltacopy::DeltaCopyEngine::run_deltacopy(
            tasks_mgr,
            payload.sources,
            payload.destination,
            opts,
            cancel_token,
        ).await;
    });

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "DeltaCopy transfer started in background queue",
    })))
}

async fn handle_move(
    State(state): State<AppState>,
    Json(payload): Json<TransferRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let paranoid = payload.paranoid.unwrap_or(state.config.paranoid.verify_after_transfer);
    let dest_dir = Path::new(&payload.destination);

    let task_id = state.tasks.create_task(
        &format!("Move {} items", payload.sources.len()),
        "move",
        &payload.sources.join(", "),
        &payload.destination,
        0,
    ).await;

    for src_str in &payload.sources {
        let src_path = Path::new(src_str);
        let target = if dest_dir.is_dir() {
            dest_dir.join(src_path.file_name().unwrap_or_default())
        } else {
            dest_dir.to_path_buf()
        };

        if std::fs::rename(src_str, &target).is_err() {
            if let Err(e) = LocalFs::copy_file_paranoid(src_str, &target.to_string_lossy(), paranoid) {
                state.tasks.fail_task(&task_id, &e.to_string()).await;
                return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Move copy failed: {}", e)));
            }
            let _ = LocalFs::delete_entry(src_str, false, None);
        }
    }

    state.tasks.complete_task(&task_id).await;
    Ok(Json(serde_json::json!({ "success": true, "task_id": task_id, "moved_count": payload.sources.len() })))
}

#[derive(Deserialize)]
struct TestRemoteRequest {
    protocol: String,
    host: String,
    port: Option<u16>,
    user: Option<String>,
    pass: Option<String>,
    bucket: Option<String>,
    region: Option<String>,
}

async fn handle_test_remote(
    Json(payload): Json<TestRemoteRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match payload.protocol.to_lowercase().as_str() {
        "sftp" => {
            let port = payload.port.unwrap_or(22);
            let user = payload.user.unwrap_or_else(|| "root".to_string());
            match SftpClient::list_dir(&payload.host, port, &user, payload.pass.as_deref(), "/") {
                Ok(listing) => Ok(Json(serde_json::json!({
                    "success": true,
                    "message": format!("Connected successfully to SFTP server (found {} items)", listing.entries.len()),
                }))),
                Err(e) => Err((StatusCode::BAD_REQUEST, format!("SFTP connection failed: {}", e))),
            }
        }
        "webdav" => {
            let url = payload.host;
            match WebDavClient::list_dir(&url, payload.user.as_deref(), payload.pass.as_deref()).await {
                Ok(listing) => Ok(Json(serde_json::json!({
                    "success": true,
                    "message": format!("Connected successfully to WebDAV storage (found {} items)", listing.entries.len()),
                }))),
                Err(e) => Err((StatusCode::BAD_REQUEST, format!("WebDAV connection failed: {}", e))),
            }
        }
        "s3" => {
            let s3_conf = crate::vfs::s3::S3Config {
                endpoint: payload.host,
                bucket: payload.bucket.unwrap_or_default(),
                region: payload.region.unwrap_or_else(|| "us-east-1".to_string()),
                access_key_id: payload.user.unwrap_or_default(),
                secret_access_key: payload.pass.unwrap_or_default(),
                path_style: Some(true),
            };
            let client = crate::vfs::s3::S3Client::new(s3_conf);
            match client.test_connection().await {
                Ok(_) => Ok(Json(serde_json::json!({
                    "success": true,
                    "message": "Connected successfully to S3 / Cloud Object Storage bucket!",
                }))),
                Err(e) => Err((StatusCode::BAD_REQUEST, format!("S3 connection failed: {}", e))),
            }
        }
        "proton" => {
            let status = crate::vfs::proton::ProtonDriveClient::check_status().await;
            if status.installed {
                if status.authenticated {
                    Ok(Json(serde_json::json!({
                        "success": true,
                        "message": format!("Proton Drive integration ready! Backend: {} (Version: {})", status.cli_type, status.version.unwrap_or_default()),
                    })))
                } else {
                    Ok(Json(serde_json::json!({
                        "success": false,
                        "message": format!("Proton Drive CLI detected ({}) but not yet logged in. Run '{} login' in terminal.", status.cli_type, status.cli_type),
                    })))
                }
            } else {
                Err((StatusCode::BAD_REQUEST, "Proton Drive CLI or rclone not detected on host. Install 'proton-drive' or configure an rclone proton remote.".to_string()))
            }
        }
        "smb" => {
            let port = payload.port.unwrap_or(445);
            let share = payload.bucket.unwrap_or_else(|| "share".to_string());
            let params = crate::vfs::smb::SmbParams {
                host: payload.host,
                port,
                share,
                subpath: "".to_string(),
                username: payload.user,
                password: payload.pass,
                domain: payload.region,
            };
            crate::vfs::smb::SmbClient::test_connection(&params)
                .map(|msg| Json(serde_json::json!({ "success": true, "message": msg })))
                .map_err(|e| (StatusCode::BAD_REQUEST, e))
        }
        "nfs" => {
            let port = payload.port.unwrap_or(2049);
            let export_path = payload.bucket.unwrap_or_else(|| "/".to_string());
            let params = crate::vfs::nfs::NfsParams {
                host: payload.host,
                port,
                export_path,
                subpath: "".to_string(),
                version: payload.region,
            };
            crate::vfs::nfs::NfsClient::test_connection(&params)
                .map(|msg| Json(serde_json::json!({ "success": true, "message": msg })))
                .map_err(|e| (StatusCode::BAD_REQUEST, e))
        }
        _ => Err((StatusCode::BAD_REQUEST, "Unsupported protocol".to_string())),
    }
}

async fn handle_proton_status() -> Json<crate::vfs::proton::ProtonStatus> {
    Json(crate::vfs::proton::ProtonDriveClient::check_status().await)
}

async fn handle_list_tasks(
    State(state): State<AppState>,
) -> Json<Vec<TaskInfo>> {
    Json(state.tasks.list_tasks().await)
}

async fn handle_cancel_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Json<serde_json::Value> {
    let cancelled = state.tasks.cancel_task(&id).await;
    Json(serde_json::json!({ "success": cancelled }))
}

async fn handle_upload(
    Query(query): Query<HashMap<String, String>>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let dest_dir = query.get("destination").cloned().unwrap_or_else(|| "/tmp".to_string());
    let mut uploaded_files = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = field.file_name().unwrap_or("upload.bin").to_string();
        let target_path = Path::new(&dest_dir).join(&file_name);

        if let Ok(data) = field.bytes().await {
            LocalFs::write_file(&target_path.to_string_lossy(), &data, true)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write upload: {}", e)))?;
            uploaded_files.push(file_name);
        }
    }

    Ok(Json(serde_json::json!({ "success": true, "uploaded": uploaded_files })))
}

async fn handle_download(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, String)> {
    let path_str = query.get("path").ok_or((StatusCode::BAD_REQUEST, "Missing path param".to_string()))?;
    let path = Path::new(path_str);

    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
    }

    let file_bytes = std::fs::read(path).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read file: {}", e))
    })?;

    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();

    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file_name),
        )
        .body(Body::from(file_bytes))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)))?;

    Ok(response)
}

#[derive(Deserialize)]
struct ArchiveCreateRequest {
    sources: Vec<String>,
    target_path: String,
    format: String,
}

async fn handle_archive_create(
    Json(payload): Json<ArchiveCreateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    match payload.format.to_lowercase().as_str() {
        "zip" => ArchiveHandler::create_zip(&payload.sources, &payload.target_path)
            .map(|_| Json(serde_json::json!({ "success": true, "archive": payload.target_path })))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Zip failed: {}", e))),
        "targz" | "tar.gz" => ArchiveHandler::create_targz(&payload.sources, &payload.target_path)
            .map(|_| Json(serde_json::json!({ "success": true, "archive": payload.target_path })))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Tar.gz failed: {}", e))),
        _ => Err((StatusCode::BAD_REQUEST, "Unsupported archive format".to_string())),
    }
}

#[derive(Deserialize)]
struct ArchiveExtractRequest {
    archive_path: String,
    target_dir: String,
}

async fn handle_archive_extract(
    Json(payload): Json<ArchiveExtractRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    ArchiveHandler::extract_archive(&payload.archive_path, &payload.target_dir)
        .map(|_| Json(serde_json::json!({ "success": true })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Extract failed: {}", e)))
}

#[derive(Deserialize)]
struct ChecksumRequest {
    path: String,
    algorithm: Option<String>,
}

async fn handle_calculate_checksum(
    Json(payload): Json<ChecksumRequest>,
) -> Result<Json<crate::vfs::checksum::ChecksumResult>, (StatusCode, String)> {
    let algo = payload.algorithm.unwrap_or_else(|| "sha256".to_string());
    calculate_checksum(&payload.path, &algo)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Checksum failed: {}", e)))
}

// ---------------- TOOLS & DIFF HANDLERS ----------------

#[derive(Deserialize)]
struct DiffFilesRequest {
    file_left: String,
    file_right: String,
}

async fn handle_diff_files(
    Json(payload): Json<DiffFilesRequest>,
) -> Result<Json<crate::tools::diff::FileDiffResult>, (StatusCode, String)> {
    let text_l = std::fs::read_to_string(&payload.file_left)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Cannot read left file {}: {}", payload.file_left, e)))?;
    let text_r = std::fs::read_to_string(&payload.file_right)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Cannot read right file {}: {}", payload.file_right, e)))?;

    let diff = compare_files_text(&payload.file_left, &text_l, &payload.file_right, &text_r);
    Ok(Json(diff))
}

#[derive(Deserialize)]
struct DiffFoldersRequest {
    dir_left: String,
    dir_right: String,
    recursive: Option<bool>,
    deep_hash: Option<bool>,
    selected_items: Option<Vec<String>>,
}

async fn handle_diff_folders(
    Json(payload): Json<DiffFoldersRequest>,
) -> Result<Json<crate::tools::diff::FolderDiffResult>, (StatusCode, String)> {
    let recursive = payload.recursive.unwrap_or(false);
    let deep = payload.deep_hash.unwrap_or(false);
    crate::tools::diff::compare_folders(&payload.dir_left, &payload.dir_right, recursive, deep, payload.selected_items)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Folder diff failed: {}", e)))
}

async fn handle_convert_file(
    Json(payload): Json<crate::tools::converter::ConvertRequest>,
) -> Result<Json<crate::tools::converter::ConvertResponse>, (StatusCode, String)> {
    crate::tools::converter::ConvertEngine::convert_file(&payload)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Conversion failed: {}", e)))
}

#[derive(Deserialize)]
struct DryRunRequest {
    action: String,
    sources: Vec<String>,
    destination: Option<String>,
}

async fn handle_paranoid_dry_run(
    Json(payload): Json<DryRunRequest>,
) -> Result<Json<crate::tools::paranoid::DryRunPreview>, (StatusCode, String)> {
    ParanoidEngine::dry_run(&payload.action, &payload.sources, payload.destination.as_deref())
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Dry run failed: {}", e)))
}

// ---------------- PHASE 4 HANDLERS (SYNC, SEARCH, SCRIPT ACTIONS) ----------------

#[derive(Deserialize)]
struct SyncRequest {
    source: String,
    destination: String,
    options: crate::tools::sync::SyncOptions,
}

async fn handle_sync_analyze(
    Json(payload): Json<SyncRequest>,
) -> Result<Json<crate::tools::sync::SyncAnalysis>, (StatusCode, String)> {
    crate::tools::sync::DirectorySyncEngine::analyze(&payload.source, &payload.destination, &payload.options)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Sync analysis failed: {}", e)))
}

async fn handle_sync_execute(
    State(state): State<AppState>,
    Json(payload): Json<SyncRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    crate::tools::sync::DirectorySyncEngine::execute_sync(
        state.tasks.clone(),
        &payload.source,
        &payload.destination,
        payload.options,
    ).await
    .map(Json)
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Sync execution failed: {}", e)))
}

async fn handle_search(
    Json(payload): Json<crate::tools::search::SearchRequest>,
) -> Result<Json<Vec<crate::tools::search::SearchResultItem>>, (StatusCode, String)> {
    crate::tools::search::SearchEngine::search(payload)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Search failed: {}", e)))
}

async fn handle_run_action(
    Json(payload): Json<crate::tools::actions::ActionExecutionRequest>,
) -> Result<Json<crate::tools::actions::ActionExecutionResult>, (StatusCode, String)> {
    crate::tools::actions::ActionRunner::execute(payload).await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Action execution error: {}", e)))
}

async fn handle_syncthing_status(
    State(state): State<AppState>,
) -> Json<crate::tools::syncthing::SyncthingStatusResponse> {
    let client = crate::tools::syncthing::SyncthingClient::new(state.config.syncthing.clone());
    Json(client.get_status().await)
}

#[derive(Deserialize)]
struct SyncthingScanRequest {
    folder_id: Option<String>,
    subpath: Option<String>,
}

async fn handle_syncthing_scan(
    State(state): State<AppState>,
    Json(payload): Json<SyncthingScanRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let client = crate::tools::syncthing::SyncthingClient::new(state.config.syncthing.clone());
    match client.trigger_scan(payload.folder_id.as_deref(), payload.subpath.as_deref()).await {
        Ok(msg) => Ok(Json(serde_json::json!({ "success": true, "message": msg }))),
        Err(e) => Err((StatusCode::BAD_REQUEST, e)),
    }
}

// ---------------- CONFIG & SYSTEM HANDLERS ----------------

async fn handle_get_config(
    State(state): State<AppState>,
) -> Json<AppConfig> {
    Json((*state.config).clone())
}

#[derive(Serialize)]
struct SystemUsersGroups {
    users: Vec<String>,
    groups: Vec<String>,
}

async fn handle_get_system_users_groups() -> Json<SystemUsersGroups> {
    let mut users = Vec::new();
    let mut groups = Vec::new();

    if let Ok(passwd) = fs::read_to_string("/etc/passwd") {
        for line in passwd.lines() {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 3 {
                users.push(parts[0].to_string());
            }
        }
    }

    if let Ok(grp) = fs::read_to_string("/etc/group") {
        for line in grp.lines() {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 3 {
                groups.push(parts[0].to_string());
            }
        }
    }

    users.sort();
    groups.sort();

    Json(SystemUsersGroups { users, groups })
}

#[derive(Serialize)]
struct ConfdFileInfo {
    path: String,
    filename: String,
    content: String,
}

async fn handle_get_confd_files() -> Json<Vec<ConfdFileInfo>> {
    let search_dirs = vec![
        PathBuf::from("/etc/commanderdog/conf.d"),
        dirs::config_dir().map(|d| d.join("commanderdog").join("conf.d")).unwrap_or_default(),
        PathBuf::from("./conf.d"),
    ];

    let mut result = Vec::new();

    for dir in search_dirs {
        if dir.exists() && dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.extension().map_or(false, |ext| ext == "toml") {
                        if let Ok(content) = fs::read_to_string(&p) {
                            result.push(ConfdFileInfo {
                                path: p.to_string_lossy().to_string(),
                                filename: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                                content,
                            });
                        }
                    }
                }
            }
        }
    }

    result.sort_by(|a, b| a.filename.cmp(&b.filename));
    Json(result)
}

// ---------------- STATIC ASSET EMBEDDED HANDLER ----------------

async fn handle_static_asset(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let file_path = if path.is_empty() { "index.html" } else { path };

    match Asset::get(file_path) {
        Some(content) => {
            let mime = mime_guess::from_path(file_path).first_or_octet_stream().to_string();
            Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .body(Body::from(content.data))
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Asset load error").into_response())
        }
        None => {
            if let Some(index) = Asset::get("index.html") {
                Response::builder()
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(index.data))
                    .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Index load error").into_response())
            } else {
                (StatusCode::NOT_FOUND, "Resource not found").into_response()
            }
        }
    }
}
