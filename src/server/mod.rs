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
    pub tags: Arc<crate::tools::tags::TagManager>,
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // System & Platform Status
        .route("/api/system/status", get(handle_system_status))
        // Auth & Security API
        .route("/api/auth/login", post(handle_login))
        .route("/api/auth/logout", post(handle_logout))
        .route("/api/auth/unlock", post(handle_unlock_session))
        .route("/api/auth/security-settings", get(handle_get_security_settings).post(handle_update_security_settings))
        .route("/api/auth/me", get(handle_get_me))
        .route("/api/auth/profile", post(handle_update_profile))
        .route("/api/auth/users", get(handle_list_users).post(handle_create_user))
        .route("/api/auth/users/:username", delete(handle_delete_user).post(handle_update_user_rbac))
        // Global Network Mounts & Bookmarks API
        .route("/api/mounts/accessible", get(handle_list_accessible_mounts))
        .route("/api/mounts/all", get(handle_list_all_mounts))
        .route("/api/mounts", post(handle_create_or_update_mount))
        .route("/api/mounts/:id", delete(handle_delete_mount))
        .route("/api/bookmarks", get(handle_list_bookmarks).post(handle_create_bookmark))
        .route("/api/bookmarks/:id", delete(handle_delete_bookmark))
        // Public Link Sharing & Guest Dropbox
        .route("/share/:token", get(handle_public_share_page))
        .route("/api/shares", get(handle_list_shares).post(handle_create_share))
        .route("/api/shares/:id", delete(handle_delete_share))
        .route("/api/public/shares/:token", get(handle_public_get_share_meta))
        .route("/api/public/shares/:token/verify", post(handle_public_verify_share))
        .route("/api/public/shares/:token/download", get(handle_public_download_share))
        .route("/api/public/shares/:token/upload", post(handle_public_upload_share))
        // VFS File Operations
        .route("/api/fs/list", get(handle_list_dir))
        .route("/api/fs/tags", get(handle_get_file_tags))
        .route("/api/fs/tags/all", get(handle_get_all_tags))
        .route("/api/fs/tags/set", post(handle_set_tags))
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
        .route("/api/fs/download/batch", post(handle_download_batch))
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
        .route("/api/tools/disk-usage", get(handle_disk_usage))
        .route("/api/tools/split", post(handle_split_file))
        .route("/api/tools/combine", post(handle_combine_files))
        .route("/api/tools/syncthing/status", get(handle_syncthing_status))
        .route("/api/tools/syncthing/scan", post(handle_syncthing_scan))
        .route("/api/tools/search", post(handle_search))
        .route("/api/actions/run", post(handle_run_action))
        // Git Client & Version Control API
        .route("/api/git/status", get(handle_git_status))
        .route("/api/git/diff", get(handle_git_diff))
        .route("/api/git/stage", post(handle_git_stage))
        .route("/api/git/unstage", post(handle_git_unstage))
        .route("/api/git/commit", post(handle_git_commit))
        .route("/api/git/push", post(handle_git_push))
        .route("/api/git/pull", post(handle_git_pull))
        .route("/api/git/log", get(handle_git_log))
        .route("/api/tasks", get(handle_list_tasks))
        .route("/api/tasks/:id/cancel", post(handle_cancel_task))
        .route("/api/tasks/:id/pause", post(handle_pause_task))
        .route("/api/tasks/:id/resume", post(handle_resume_task))
        .route("/api/tasks/clear-completed", post(handle_clear_completed_tasks))
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
            tracing::info!(username = %user.username, is_pam = user.is_pam, role = %user.role, "User successfully authenticated");
            let token = state.auth.generate_token(&user).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create token: {}", e))
            })?;
            Ok(Json(LoginResponse { token, user }))
        }
        Err(e) => {
            tracing::warn!(username = %payload.username, error = %e, "Authentication failed");
            Err((StatusCode::UNAUTHORIZED, "Invalid username or password".to_string()))
        }
    }
}

#[derive(Serialize)]
pub struct SystemStatusResponse {
    pub version: String,
    pub standalone: bool,
    pub auth_enabled: bool,
    pub current_user: String,
    pub home_dir: String,
}

async fn handle_system_status(State(state): State<AppState>) -> Json<SystemStatusResponse> {
    let current_user = std::env::var("USER").unwrap_or_else(|_| "user".to_string());
    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());
    Json(SystemStatusResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        standalone: state.config.server.standalone || !state.config.server.enable_auth,
        auth_enabled: state.config.server.enable_auth && !state.config.server.standalone,
        current_user,
        home_dir,
    })
}

#[allow(dead_code)]
fn extract_claims_or_local(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::auth::Claims, (StatusCode, String)> {
    if !state.config.server.enable_auth || state.config.server.standalone {
        let current_user = std::env::var("USER").unwrap_or_else(|_| "user".to_string());
        let home_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());
        return Ok(crate::auth::Claims {
            sub: current_user,
            role: "admin".to_string(),
            home_dir,
            is_pam: false,
            exp: 9999999999,
        });
    }

    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

async fn handle_logout() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "success": true, "message": "Logged out" }))
}

async fn handle_get_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<User>, (StatusCode, String)> {
    if !state.config.server.enable_auth || state.config.server.standalone {
        let current_user = std::env::var("USER").unwrap_or_else(|_| "user".to_string());
        let home_dir = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());
        return Ok(Json(User {
            id: 1,
            username: current_user.clone(),
            nickname: Some(current_user),
            email: None,
            avatar_url: None,
            role: "admin".to_string(),
            home_dir,
            is_pam: false,
            is_disabled: false,
            allowed_services: "[\"*\"]".to_string(),
        }));
    }

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
                    is_disabled: false,
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
    #[serde(default)]
    is_disabled: Option<bool>,
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
        let updated = state.auth.update_user_rbac(
            &username,
            &payload.role,
            &services_json,
            payload.home_dir.as_deref(),
            payload.is_disabled.unwrap_or(false),
        )
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

#[derive(Deserialize)]
struct CreateBookmarkRequest {
    name: String,
    protocol: String,
    path: String,
    password: Option<String>,
}

#[derive(Deserialize)]
struct UnlockRequest {
    password: String,
}

async fn handle_unlock_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UnlockRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        match state.auth.authenticate(&claims.sub, &payload.password) {
            Ok(_) => Ok(Json(serde_json::json!({ "success": true, "message": "Session unlocked" }))),
            Err(e) => Err((StatusCode::UNAUTHORIZED, e.to_string())),
        }
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

async fn handle_list_bookmarks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::auth::UserBookmark>>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    let username = if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        match state.auth.verify_token(token_str) {
            Ok(c) => c.sub,
            Err(_) => "bolt".to_string(),
        }
    } else {
        "bolt".to_string()
    };

    let bookmarks = state.auth.list_bookmarks(&username)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list bookmarks: {}", e)))?;
    Ok(Json(bookmarks))
}

async fn handle_create_bookmark(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateBookmarkRequest>,
) -> Result<Json<crate::auth::UserBookmark>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    let username = if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        match state.auth.verify_token(token_str) {
            Ok(c) => c.sub,
            Err(_) => "bolt".to_string(),
        }
    } else {
        "bolt".to_string()
    };

    let bm = state.auth.create_bookmark(
        &username,
        &payload.name,
        &payload.protocol,
        &payload.path,
        payload.password.as_deref(),
    ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save bookmark: {}", e)))?;

    Ok(Json(bm))
}

async fn handle_delete_bookmark(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    let (username, is_admin) = if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        match state.auth.verify_token(token_str) {
            Ok(c) => (c.sub.clone(), c.role == "admin"),
            Err(_) => ("bolt".to_string(), false),
        }
    } else {
        ("bolt".to_string(), false)
    };

    state.auth.delete_bookmark(id, &username, is_admin)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete bookmark: {}", e)))?;

    Ok(Json(serde_json::json!({ "success": true, "message": "Bookmark removed" })))
}

async fn handle_get_security_settings(
    State(state): State<AppState>,
) -> Result<Json<crate::auth::SecuritySettings>, (StatusCode, String)> {
    let settings = state.auth.get_security_settings()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get security settings: {}", e)))?;
    Ok(Json(settings))
}

async fn handle_update_security_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<crate::auth::SecuritySettings>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let claims = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        if claims.role != "admin" {
            return Err((StatusCode::FORBIDDEN, "Only administrators can update security settings".to_string()));
        }

        state.auth.update_security_settings(&payload)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update security settings: {}", e)))?;

        Ok(Json(serde_json::json!({ "success": true, "message": "Security settings saved" })))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

// ---------------- LINK SHARING & DROPBOX HANDLERS ----------------

#[derive(Deserialize)]
struct CreateShareRequest {
    path: String,
    name: Option<String>,
    is_dir: bool,
    allow_upload: Option<bool>,
    password: Option<String>,
    expires_in_hours: Option<u64>,
    max_downloads: Option<u64>,
}

async fn handle_create_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateShareRequest>,
) -> Result<Json<crate::auth::ShareItem>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing authorization header".to_string()))?;

    let token_str = auth_header.strip_prefix("Bearer ").unwrap_or(auth_header);
    let claims = state.auth.verify_token(token_str)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("Invalid token: {}", e)))?;

    let name = payload.name.unwrap_or_else(|| {
        Path::new(&payload.path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });

    let expires_at = payload.expires_in_hours.map(|hrs| {
        (chrono::Utc::now() + chrono::Duration::hours(hrs as i64)).to_rfc3339()
    });

    let share = state.auth.create_share(
        &claims.sub,
        &payload.path,
        &name,
        payload.is_dir,
        payload.allow_upload.unwrap_or(false),
        payload.password.as_deref(),
        expires_at.as_deref(),
        payload.max_downloads.unwrap_or(0),
    ).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create share: {}", e)))?;

    Ok(Json(share))
}

async fn handle_list_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::auth::ShareItem>>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing authorization header".to_string()))?;

    let token_str = auth_header.strip_prefix("Bearer ").unwrap_or(auth_header);
    let claims = state.auth.verify_token(token_str)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("Invalid token: {}", e)))?;

    let is_admin = claims.role == "admin";
    let list = state.auth.list_shares(&claims.sub, is_admin)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list shares: {}", e)))?;

    Ok(Json(list))
}

async fn handle_delete_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<i64>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing authorization header".to_string()))?;

    let token_str = auth_header.strip_prefix("Bearer ").unwrap_or(auth_header);
    let claims = state.auth.verify_token(token_str)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("Invalid token: {}", e)))?;

    let is_admin = claims.role == "admin";
    state.auth.delete_share(id, &claims.sub, is_admin)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete share: {}", e)))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn handle_public_get_share_meta(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let share = state.auth.get_share_by_token(&token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?
        .ok_or((StatusCode::NOT_FOUND, "Share not found or expired".to_string()))?;

    if let Some(ref exp) = share.expires_at {
        if let Ok(exp_time) = chrono::DateTime::parse_from_rfc3339(exp) {
            if chrono::Utc::now() > exp_time {
                return Err((StatusCode::GONE, "This share link has expired".to_string()));
            }
        }
    }

    if share.max_downloads > 0 && share.download_count >= share.max_downloads {
        return Err((StatusCode::GONE, "This share link has reached its maximum download limit".to_string()));
    }

    let p = Path::new(&share.path);
    let size = if p.is_file() {
        std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    Ok(Json(serde_json::json!({
        "token": share.token,
        "name": share.name,
        "is_dir": share.is_dir,
        "allow_upload": share.allow_upload,
        "has_password": share.has_password,
        "size": size,
        "created_at": share.created_at,
        "expires_at": share.expires_at,
    })))
}

#[derive(Deserialize)]
struct VerifyPassRequest {
    password: String,
}

async fn handle_public_verify_share(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
    Json(payload): Json<VerifyPassRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let valid = state.auth.verify_share_password(&token, &payload.password)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Verification error: {}", e)))?;

    if valid {
        Ok(Json(serde_json::json!({ "valid": true })))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Incorrect password for this share".to_string()))
    }
}

async fn handle_public_download_share(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, String)> {
    let share = state.auth.get_share_by_token(&token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?
        .ok_or((StatusCode::NOT_FOUND, "Share not found or expired".to_string()))?;

    if let Some(ref exp) = share.expires_at {
        if let Ok(exp_time) = chrono::DateTime::parse_from_rfc3339(exp) {
            if chrono::Utc::now() > exp_time {
                return Err((StatusCode::GONE, "This share link has expired".to_string()));
            }
        }
    }

    if share.max_downloads > 0 && share.download_count >= share.max_downloads {
        return Err((StatusCode::GONE, "This share link has reached its maximum download limit".to_string()));
    }

    if share.has_password {
        let pass = query.get("password").map(|s| s.as_str()).unwrap_or("");
        let valid = state.auth.verify_share_password(&token, pass).unwrap_or(false);
        if !valid {
            return Err((StatusCode::UNAUTHORIZED, "Password required for this share".to_string()));
        }
    }

    let path = Path::new(&share.path);
    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "Target file or folder not found on server".to_string()));
    }

    let _ = state.auth.increment_share_downloads(&token);

    if path.is_dir() {
        let temp_zip = tempfile::Builder::new()
            .prefix("commanderdog_share_")
            .suffix(".zip")
            .tempfile()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Temp file error: {}", e)))?;
        let temp_path = temp_zip.path().to_str().unwrap().to_string();

        ArchiveHandler::create_zip(&[share.path.clone()], &temp_path)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Zip creation failed: {}", e)))?;

        let file_bytes = std::fs::read(&temp_path).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read generated zip: {}", e))
        })?;

        let zip_name = format!("{}.zip", share.name);
        let response = Response::builder()
            .header(header::CONTENT_TYPE, "application/zip")
            .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", zip_name))
            .body(Body::from(file_bytes))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)))?;

        return Ok(response);
    }

    let file_bytes = std::fs::read(path).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read file: {}", e))
    })?;

    let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", share.name))
        .body(Body::from(file_bytes))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)))?;

    Ok(response)
}

async fn handle_public_upload_share(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let share = state.auth.get_share_by_token(&token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {}", e)))?
        .ok_or((StatusCode::NOT_FOUND, "Share not found or expired".to_string()))?;

    if !share.is_dir || !share.allow_upload {
        return Err((StatusCode::FORBIDDEN, "Guest uploads are not enabled for this share".to_string()));
    }

    if let Some(ref exp) = share.expires_at {
        if let Ok(exp_time) = chrono::DateTime::parse_from_rfc3339(exp) {
            if chrono::Utc::now() > exp_time {
                return Err((StatusCode::GONE, "This share link has expired".to_string()));
            }
        }
    }

    let target_dir = Path::new(&share.path);
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err((StatusCode::NOT_FOUND, "Target dropbox folder does not exist on server".to_string()));
    }

    let mut saved_count = 0;
    while let Some(field) = multipart.next_field().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        let file_name = field.file_name().unwrap_or("uploaded_file").to_string();
        let safe_name = Path::new(&file_name).file_name().unwrap_or_default().to_string_lossy().to_string();
        if safe_name.is_empty() {
            continue;
        }

        let target_path = target_dir.join(&safe_name);
        let data = field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        std::fs::write(&target_path, &data).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write file {}: {}", safe_name, e)))?;
        saved_count += 1;
    }

    Ok(Json(serde_json::json!({ "success": true, "uploaded_files": saved_count })))
}

async fn handle_public_share_page(
    AxumPath(token): AxumPath<String>,
) -> Response {
    let html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CommanderDog Share Portal</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg-dark: #121214;
      --bg-panel: #18181b;
      --bg-header: #202024;
      --accent: #f59e0b;
      --accent-hover: #fbbf24;
      --text-main: #f4f4f5;
      --text-muted: #a1a1aa;
      --border: #3f3f46;
      --radius: 8px;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-dark);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }}
    .share-card {{
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 100%;
      max-width: 480px;
      padding: 28px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    }}
    .share-header {{
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }}
    .share-logo {{
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }}
    .share-title {{
      font-size: 16px;
      font-weight: 700;
      color: var(--text-main);
    }}
    .share-subtitle {{
      font-size: 12px;
      color: var(--text-muted);
    }}
    .file-info-box {{
      background: var(--bg-header);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 14px;
    }}
    .file-icon {{
      font-size: 32px;
    }}
    .file-name {{
      font-size: 14px;
      font-weight: 600;
      word-break: break-all;
    }}
    .file-meta {{
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }}
    .btn {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 12px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      text-decoration: none;
    }}
    .btn-accent {{
      background: var(--accent);
      color: #121214;
    }}
    .btn-accent:hover {{
      background: var(--accent-hover);
    }}
    .dropzone {{
      border: 2px dashed var(--border);
      border-radius: 6px;
      padding: 24px;
      text-align: center;
      margin-top: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      background: rgba(0,0,0,0.15);
    }}
    .dropzone.drag-over {{
      border-color: var(--accent);
      background: rgba(245, 158, 11, 0.08);
    }}
    .input-field {{
      width: 100%;
      padding: 10px 12px;
      background: var(--bg-dark);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-main);
      font-size: 13px;
      margin-bottom: 12px;
      outline: none;
    }}
    .input-field:focus {{
      border-color: var(--accent);
    }}
    .footer-text {{
      margin-top: 16px;
      font-size: 11px;
      color: var(--text-muted);
      text-align: center;
    }}
  </style>
</head>
<body>
  <div class="share-card" id="share-card">
    <div class="share-header">
      <div class="share-logo">📦</div>
      <div>
        <div class="share-title">CommanderDog Public Share</div>
        <div class="share-subtitle">Multi-Tab Web Commander - By Woofson</div>
      </div>
    </div>

    <div id="loading-state" style="text-align: center; padding: 24px; color: var(--text-muted);">
      Loading shared file information...
    </div>

    <div id="error-state" style="display: none; text-align: center; padding: 20px; color: #ef4444;"></div>

    <div id="password-state" style="display: none;">
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">🔒 This share is password protected. Enter the password to unlock download:</p>
      <input type="password" id="share-pass-input" class="input-field" placeholder="Enter share password...">
      <button class="btn btn-accent" onclick="unlockWithPassword()">Unlock Share</button>
    </div>

    <div id="content-state" style="display: none;">
      <div class="file-info-box">
        <div class="file-icon" id="item-icon">📄</div>
        <div style="flex: 1; min-width: 0;">
          <div class="file-name" id="item-name">Loading...</div>
          <div class="file-meta" id="item-meta">Calculating size...</div>
        </div>
      </div>

      <button class="btn btn-accent" id="btn-download" onclick="startDownload()">
        ⬇️ Download File
      </button>

      <div id="dropbox-section" style="display: none;">
        <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()">
          <input type="file" id="file-input" multiple style="display:none;" onchange="handleFileInput(this.files)">
          <div style="font-size: 24px; margin-bottom: 6px;">📥</div>
          <div style="font-weight: 600; font-size: 13px;">Guest Upload Dropbox</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Drag & drop files here or click to browse</div>
        </div>
        <div id="upload-status" style="margin-top: 10px; font-size: 12px; text-align: center; color: var(--accent);"></div>
      </div>
    </div>

    <div class="footer-text">
      Powered by CommanderDog • High Performance Fast File Transport
    </div>
  </div>

  <script>
    const token = "{token}";
    let shareMeta = null;
    let unlockedPass = "";

    function formatBytes(bytes) {{
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    }}

    async function loadMeta() {{
      try {{
        const res = await fetch(`/api/public/shares/${{token}}`);
        if (!res.ok) {{
          const err = await res.text();
          showError(err || 'Share not found or expired');
          return;
        }}
        shareMeta = await res.json();
        document.getElementById('loading-state').style.display = 'none';

        if (shareMeta.has_password && !unlockedPass) {{
          document.getElementById('password-state').style.display = 'block';
        }} else {{
          renderContent();
        }}
      }} catch (e) {{
        showError('Network error loading share');
      }}
    }}

    function showError(msg) {{
      document.getElementById('loading-state').style.display = 'none';
      document.getElementById('password-state').style.display = 'none';
      document.getElementById('content-state').style.display = 'none';
      const errEl = document.getElementById('error-state');
      errEl.style.display = 'block';
      errEl.textContent = '❌ ' + msg;
    }}

    async function unlockWithPassword() {{
      const pass = document.getElementById('share-pass-input').value;
      if (!pass) return;
      try {{
        const res = await fetch(`/api/public/shares/${{token}}/verify`, {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ password: pass }})
        }});
        if (res.ok) {{
          unlockedPass = pass;
          document.getElementById('password-state').style.display = 'none';
          renderContent();
        }} else {{
          alert('Incorrect password');
        }}
      }} catch (e) {{
        alert('Verification failed');
      }}
    }}

    function renderContent() {{
      document.getElementById('content-state').style.display = 'block';
      document.getElementById('item-name').textContent = shareMeta.name;
      document.getElementById('item-icon').textContent = shareMeta.is_dir ? '📁' : '📄';
      document.getElementById('item-meta').textContent = shareMeta.is_dir ? 'Folder (Downloads as Zip)' : formatBytes(shareMeta.size);
      
      const btn = document.getElementById('btn-download');
      btn.textContent = shareMeta.is_dir ? '⬇️ Download Folder (.zip)' : '⬇️ Download File';

      if (shareMeta.is_dir && shareMeta.allow_upload) {{
        document.getElementById('dropbox-section').style.display = 'block';
        setupDropzone();
      }}
    }}

    function startDownload() {{
      const url = `/api/public/shares/${{token}}/download${{unlockedPass ? '?password=' + encodeURIComponent(unlockedPass) : ''}}`;
      window.location.href = url;
    }}

    function setupDropzone() {{
      const dz = document.getElementById('dropzone');
      dz.ondragover = (e) => {{ e.preventDefault(); dz.classList.add('drag-over'); }};
      dz.ondragleave = () => dz.classList.remove('drag-over');
      dz.ondrop = (e) => {{
        e.preventDefault();
        dz.classList.remove('drag-over');
        if (e.dataTransfer.files) handleFileInput(e.dataTransfer.files);
      }};
    }}

    async function handleFileInput(files) {{
      if (!files || files.length === 0) return;
      const status = document.getElementById('upload-status');
      status.textContent = `Uploading ${{files.length}} file(s)...`;

      const fd = new FormData();
      for (let f of files) fd.append('files', f);

      try {{
        const res = await fetch(`/api/public/shares/${{token}}/upload`, {{
          method: 'POST',
          body: fd
        }});
        if (res.ok) {{
          status.textContent = `✅ Successfully uploaded ${{files.length}} file(s)!`;
        }} else {{
          status.textContent = `❌ Upload failed: ${{await res.text()}}`;
        }}
      }} catch (e) {{
        status.textContent = '❌ Upload failed due to network error';
      }}
    }}

    loadMeta();
  </script>
</body>
</html>"#, token = token);

    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(html))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "HTML load error").into_response())
}

// ---------------- VFS HANDLERS ----------------

#[derive(Deserialize)]
#[allow(dead_code)]
struct ListQuery {
    path: Option<String>,
    show_hidden: Option<bool>,
    flat: Option<bool>,
    max_depth: Option<usize>,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    pass: Option<String>,
}

#[derive(Deserialize)]
struct GetTagsQuery {
    path: Option<String>,
}

async fn handle_get_file_tags(
    State(state): State<AppState>,
    Query(query): Query<GetTagsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if let Some(p) = query.path {
        let tag_info = state.tags.get_tags_for_path(&p);
        Ok(Json(serde_json::json!({ "success": true, "tag": tag_info })))
    } else {
        let all = state.tags.get_all_tags().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(Json(serde_json::json!({ "success": true, "tags": all })))
    }
}

async fn handle_get_all_tags(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let all = state.tags.get_all_tags().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({ "success": true, "tags": all })))
}

async fn handle_set_tags(
    State(state): State<AppState>,
    Json(payload): Json<crate::tools::tags::SetTagsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let count = state.tags.set_tags(payload).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({ "success": true, "count": count })))
}

pub fn expand_tilde(path_str: &str) -> String {
    if path_str == "~" {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "~".to_string())
    } else if let Some(stripped) = path_str.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            home.join(stripped).to_string_lossy().to_string()
        } else {
            path_str.to_string()
        }
    } else {
        path_str.to_string()
    }
}

async fn handle_list_dir(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<DirectoryListing>, (StatusCode, String)> {
    let raw_path = query.path.unwrap_or_else(|| state.config.server.root_path.clone());
    let target_path = expand_tilde(&raw_path);
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
    } else if query.flat.unwrap_or(false) {
        LocalFs::list_branch_view(&target_path, show_hidden, query.max_depth)
            .map(Json)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to list branch view: {}", e)))
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
    if payload.path.starts_with("smb://") {
        let params = crate::vfs::smb::SmbClient::parse_uri(&payload.path, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
        crate::vfs::smb::SmbClient::mkdir(&params)
            .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to create SMB folder: {}", e)))
    } else if payload.path.starts_with("sftp://") {
        let params = crate::vfs::sftp::SftpClient::parse_uri(&payload.path, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SFTP URI: {}", e)))?;
        crate::vfs::sftp::SftpClient::mkdir(&params)
            .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to create SFTP folder: {}", e)))
    } else if payload.path.starts_with("nfs://") {
        let params = crate::vfs::nfs::NfsClient::parse_uri(&payload.path)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid NFS URI: {}", e)))?;
        let mount = crate::vfs::nfs::NfsClient::ensure_mounted(&params)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("NFS mount error: {}", e)))?;
        let local_target = mount.join(params.subpath.trim_start_matches('/'));
        LocalFs::create_dir(&local_target.to_string_lossy())
            .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to create NFS folder: {}", e)))
    } else {
        LocalFs::create_dir(&payload.path)
            .map(|_| Json(serde_json::json!({ "success": true, "path": payload.path })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to create folder: {}", e)))
    }
}

#[derive(Deserialize)]
struct RenameRequest {
    from: String,
    to: String,
}

async fn handle_rename(
    Json(payload): Json<RenameRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if payload.from.starts_with("smb://") {
        let params_from = crate::vfs::smb::SmbClient::parse_uri(&payload.from, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
        let target_subpath = if payload.to.starts_with("smb://") {
            let params_to = crate::vfs::smb::SmbClient::parse_uri(&payload.to, None, None)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
            params_to.subpath
        } else {
            payload.to.clone()
        };
        crate::vfs::smb::SmbClient::rename(&params_from, &target_subpath)
            .map(|_| Json(serde_json::json!({ "success": true })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to rename SMB item: {}", e)))
    } else if payload.from.starts_with("sftp://") {
        let params_from = crate::vfs::sftp::SftpClient::parse_uri(&payload.from, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SFTP URI: {}", e)))?;
        let target_remote = if payload.to.starts_with("sftp://") {
            let params_to = crate::vfs::sftp::SftpClient::parse_uri(&payload.to, None, None)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SFTP URI: {}", e)))?;
            params_to.remote_path
        } else {
            payload.to.clone()
        };
        crate::vfs::sftp::SftpClient::rename(&params_from, &target_remote)
            .map(|_| Json(serde_json::json!({ "success": true })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to rename SFTP item: {}", e)))
    } else if payload.from.starts_with("nfs://") {
        let params_from = crate::vfs::nfs::NfsClient::parse_uri(&payload.from)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid NFS URI: {}", e)))?;
        let mount = crate::vfs::nfs::NfsClient::ensure_mounted(&params_from)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("NFS mount error: {}", e)))?;
        let local_from = mount.join(params_from.subpath.trim_start_matches('/'));
        let local_to = if payload.to.starts_with("nfs://") {
            let params_to = crate::vfs::nfs::NfsClient::parse_uri(&payload.to)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid NFS URI: {}", e)))?;
            mount.join(params_to.subpath.trim_start_matches('/'))
        } else {
            std::path::PathBuf::from(&payload.to)
        };
        LocalFs::rename_entry(&local_from.to_string_lossy(), &local_to.to_string_lossy())
            .map(|_| Json(serde_json::json!({ "success": true })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to rename NFS item: {}", e)))
    } else {
        LocalFs::rename_entry(&payload.from, &payload.to)
            .map(|_| Json(serde_json::json!({ "success": true })))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to rename: {}", e)))
    }
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
        if path.starts_with("smb://") {
            match crate::vfs::smb::SmbClient::parse_uri(path, None, None) {
                Ok(params) => {
                    match crate::vfs::smb::SmbClient::delete(&params, false) {
                        Ok(_) => deleted.push(path.clone()),
                        Err(e) => errors.push(format!("{}: {}", path, e)),
                    }
                }
                Err(e) => errors.push(format!("{}: {}", path, e)),
            }
        } else if path.starts_with("sftp://") {
            match crate::vfs::sftp::SftpClient::parse_uri(path, None, None) {
                Ok(params) => {
                    match crate::vfs::sftp::SftpClient::delete(&params, false) {
                        Ok(_) => deleted.push(path.clone()),
                        Err(e) => errors.push(format!("{}: {}", path, e)),
                    }
                }
                Err(e) => errors.push(format!("{}: {}", path, e)),
            }
        } else if path.starts_with("nfs://") {
            match crate::vfs::nfs::NfsClient::parse_uri(path) {
                Ok(params) => {
                    match crate::vfs::nfs::NfsClient::ensure_mounted(&params) {
                        Ok(mount) => {
                            let local_target = mount.join(params.subpath.trim_start_matches('/'));
                            match LocalFs::delete_entry(&local_target.to_string_lossy(), false, None) {
                                Ok(_) => deleted.push(path.clone()),
                                Err(e) => errors.push(format!("{}: {}", path, e)),
                            }
                        }
                        Err(e) => errors.push(format!("{}: {}", path, e)),
                    }
                }
                Err(e) => errors.push(format!("{}: {}", path, e)),
            }
        } else {
            match LocalFs::delete_entry(path, use_trash, state.config.paranoid.custom_trash_dir.as_deref()) {
                Ok(_) => deleted.push(path.clone()),
                Err(e) => errors.push(format!("{}: {}", path, e)),
            }
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
    let task_id = state.tasks.create_task(
        &format!("Copy {} items", payload.sources.len()),
        "copy",
        &payload.sources.join(", "),
        &payload.destination,
        0,
    ).await;

    let tasks_mgr = state.tasks.clone();
    let tid = task_id.clone();
    let sources = payload.sources.clone();
    let destination = payload.destination.clone();

    tokio::spawn(async move {
        crate::vfs::transfer::VfsTransfer::execute_batch_transfer(
            tasks_mgr,
            tid,
            sources,
            destination,
            false,
            paranoid,
        ).await;
    });

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
    let task_id = state.tasks.create_task(
        &format!("Move {} items", payload.sources.len()),
        "move",
        &payload.sources.join(", "),
        &payload.destination,
        0,
    ).await;

    let tasks_mgr = state.tasks.clone();
    let tid = task_id.clone();
    let sources = payload.sources.clone();
    let destination = payload.destination.clone();

    tokio::spawn(async move {
        crate::vfs::transfer::VfsTransfer::execute_batch_transfer(
            tasks_mgr,
            tid,
            sources,
            destination,
            true,
            paranoid,
        ).await;
    });

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

async fn handle_pause_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Json<serde_json::Value> {
    let paused = state.tasks.pause_task(&id).await;
    Json(serde_json::json!({ "success": paused }))
}

async fn handle_resume_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Json<serde_json::Value> {
    let resumed = state.tasks.resume_task(&id).await;
    Json(serde_json::json!({ "success": resumed }))
}

async fn handle_clear_completed_tasks(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    state.tasks.clear_completed().await;
    Json(serde_json::json!({ "success": true }))
}

async fn handle_upload(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let dest_dir = query.get("destination").cloned().unwrap_or_else(|| "/tmp".to_string());
    let mut uploaded_files = Vec::new();
    let task_id = state.tasks.create_task("Upload Files", "upload", "Browser", &dest_dir, 0).await;

    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = field.file_name().unwrap_or("upload.bin").to_string();

        if let Ok(data) = field.bytes().await {
            let file_size = data.len() as u64;
            state.tasks.update_task_details(
                &task_id,
                Some(&file_name),
                file_size,
                file_size,
                uploaded_files.len() as u64 + 1,
                uploaded_files.len() as u64 + 1,
                file_size,
                0,
                None,
                None,
                Some(&format!("Uploaded {}", file_name)),
            ).await;

            if dest_dir.starts_with("smb://") {
                let params = match crate::vfs::smb::SmbClient::parse_uri(&dest_dir, None, None) {
                    Ok(mut p) => {
                        p.subpath = if p.subpath.is_empty() { file_name.clone() } else { format!("{}/{}", p.subpath, file_name) };
                        p
                    }
                    Err(e) => {
                        let err_msg = format!("Invalid SMB destination: {}", e);
                        state.tasks.fail_task(&task_id, &err_msg).await;
                        return Err((StatusCode::BAD_REQUEST, err_msg));
                    }
                };
                if let Err(e) = crate::vfs::smb::SmbClient::write_file(&params, &data) {
                    let err_msg = format!("Failed to write SMB upload: {}", e);
                    state.tasks.fail_task(&task_id, &err_msg).await;
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, err_msg));
                }
            } else {
                let target_path = Path::new(&dest_dir).join(&file_name);
                if let Err(e) = LocalFs::write_file(&target_path.to_string_lossy(), &data, true) {
                    let err_msg = format!("Failed to write upload: {}", e);
                    state.tasks.fail_task(&task_id, &err_msg).await;
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, err_msg));
                }
            }
            uploaded_files.push(file_name);
        }
    }

    state.tasks.complete_task(&task_id).await;
    Ok(Json(serde_json::json!({ "success": true, "uploaded": uploaded_files, "task_id": task_id })))
}

async fn handle_download(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, String)> {
    let path_str = query.get("path").ok_or((StatusCode::BAD_REQUEST, "Missing path param".to_string()))?;

    if path_str.starts_with("smb://") {
        let params = crate::vfs::smb::SmbClient::parse_uri(path_str, None, None)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid SMB URI: {}", e)))?;
        let file_bytes = crate::vfs::smb::SmbClient::read_bytes(&params)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Failed to download SMB file: {}", e)))?;
        let file_name = params.subpath.rsplit('/').next().unwrap_or(&params.subpath).to_string();
        let mime = mime_guess::from_path(&file_name).first_or_octet_stream().to_string();
        let is_inline = query.get("inline").map(|v| v == "true" || v == "1").unwrap_or(false);

        let disposition = if is_inline {
            format!("inline; filename=\"{}\"", file_name)
        } else {
            format!("attachment; filename=\"{}\"", file_name)
        };

        let response = Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_DISPOSITION, disposition)
            .header(header::ACCEPT_RANGES, "bytes")
            .body(Body::from(file_bytes))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)))?;

        return Ok(response);
    }

    let path = Path::new(path_str);

    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "File or folder not found".to_string()));
    }

    if path.is_dir() {
        let temp_zip = tempfile::Builder::new()
            .prefix("commanderdog_folder_")
            .suffix(".zip")
            .tempfile()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Temp file error: {}", e)))?;
        let temp_path = temp_zip.path().to_str().unwrap().to_string();

        ArchiveHandler::create_zip(&[path_str.to_string()], &temp_path)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Zip creation failed: {}", e)))?;

        let file_bytes = std::fs::read(&temp_path).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read generated zip: {}", e))
        })?;

        let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
        let zip_name = if dir_name.is_empty() { "folder.zip".to_string() } else { format!("{}.zip", dir_name) };

        let response = Response::builder()
            .header(header::CONTENT_TYPE, "application/zip")
            .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", zip_name))
            .body(Body::from(file_bytes))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)))?;

        return Ok(response);
    }

    let file_bytes = std::fs::read(path).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read file: {}", e))
    })?;

    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
    let is_inline = query.get("inline").map(|v| v == "true" || v == "1").unwrap_or(false);

    let disposition = if is_inline {
        format!("inline; filename=\"{}\"", file_name)
    } else {
        format!("attachment; filename=\"{}\"", file_name)
    };

    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::ACCEPT_RANGES, "bytes")
        .body(Body::from(file_bytes))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Response build error: {}", e)))?;

    Ok(response)
}

#[derive(Deserialize)]
struct BatchDownloadRequest {
    paths: Vec<String>,
}

async fn handle_download_batch(
    Json(payload): Json<BatchDownloadRequest>,
) -> Result<Response, (StatusCode, String)> {
    if payload.paths.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No paths specified for download".to_string()));
    }

    let temp_zip = tempfile::Builder::new()
        .prefix("commanderdog_batch_")
        .suffix(".zip")
        .tempfile()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Temp file error: {}", e)))?;
    let temp_path = temp_zip.path().to_str().unwrap().to_string();

    ArchiveHandler::create_zip(&payload.paths, &temp_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Batch zip creation failed: {}", e)))?;

    let file_bytes = std::fs::read(&temp_path).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read generated zip: {}", e))
    })?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let zip_name = if payload.paths.len() == 1 {
        let p = Path::new(&payload.paths[0]);
        let base = p.file_name().unwrap_or_default().to_string_lossy();
        format!("{}.zip", base)
    } else {
        format!("commanderdog_download_{}.zip", timestamp)
    };

    let response = Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", zip_name))
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

async fn handle_disk_usage(
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<crate::tools::disk_usage::DiskUsageReport>, (StatusCode, String)> {
    let path = query.get("path").ok_or((StatusCode::BAD_REQUEST, "Missing path param".to_string()))?;
    crate::tools::disk_usage::DiskUsageEngine::analyze(path)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Disk usage analysis failed: {}", e)))
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

// ---------------- GIT & VERSION CONTROL HANDLERS ----------------

#[derive(Deserialize)]
struct GitPathQuery {
    path: String,
}

#[derive(Deserialize)]
struct GitDiffQuery {
    path: String,
    file: Option<String>,
    #[serde(default)]
    staged: Option<bool>,
}

#[derive(Deserialize)]
struct GitLogQuery {
    path: String,
    #[serde(default)]
    count: Option<usize>,
}

#[derive(Deserialize)]
struct GitFilesRequest {
    path: String,
    #[serde(default)]
    files: Vec<String>,
}

#[derive(Deserialize)]
struct GitCommitRequest {
    path: String,
    message: String,
}

#[derive(Deserialize)]
struct GitPushRequest {
    path: String,
    remote: Option<String>,
    branch: Option<String>,
}

#[derive(Deserialize)]
struct GitPullRequest {
    path: String,
}

async fn handle_git_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GitPathQuery>,
) -> Result<Json<crate::tools::git::GitStatusResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::get_git_status(Path::new(&query.path)).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_diff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GitDiffQuery>,
) -> Result<Json<crate::tools::git::GitDiffResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::get_git_diff(Path::new(&query.path), query.file.as_deref(), query.staged.unwrap_or(false)).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_stage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GitFilesRequest>,
) -> Result<Json<crate::tools::git::GitActionResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::git_stage(Path::new(&payload.path), &payload.files).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_unstage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GitFilesRequest>,
) -> Result<Json<crate::tools::git::GitActionResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::git_unstage(Path::new(&payload.path), &payload.files).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_commit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GitCommitRequest>,
) -> Result<Json<crate::tools::git::GitActionResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::git_commit(Path::new(&payload.path), &payload.message).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GitPushRequest>,
) -> Result<Json<crate::tools::git::GitActionResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::git_push(Path::new(&payload.path), payload.remote.as_deref(), payload.branch.as_deref()).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_pull(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GitPullRequest>,
) -> Result<Json<crate::tools::git::GitActionResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::git_pull(Path::new(&payload.path)).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

async fn handle_git_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GitLogQuery>,
) -> Result<Json<Vec<crate::tools::git::GitCommitInfo>>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let res = crate::tools::git::get_git_log(Path::new(&query.path), query.count.unwrap_or(30)).await;
        return Ok(Json(res));
    }
    Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
}

// ---------------- FILE SPLITTER & COMBINER HANDLERS ----------------

async fn handle_split_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<crate::tools::splitter::SplitRequest>,
) -> Result<Json<crate::tools::splitter::SplitResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let source_path = Path::new(&payload.source_path);
        let dest_dir = payload.dest_dir.as_ref().map(|p| Path::new(p));
        let chunk_size = payload.chunk_size_mb.max(1) * 1024 * 1024;
        let gen_chk = payload.generate_checksum.unwrap_or(true);

        crate::tools::splitter::split_file_sync(source_path, dest_dir, chunk_size, gen_chk)
            .map(Json)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
}

async fn handle_combine_files(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<crate::tools::splitter::CombineRequest>,
) -> Result<Json<crate::tools::splitter::CombineResponse>, (StatusCode, String)> {
    let auth_header = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if let Some(token_str) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        let _ = state.auth.verify_token(token_str).map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        let parts: Vec<std::path::PathBuf> = payload.parts.iter().map(std::path::PathBuf::from).collect();
        let dest_path = Path::new(&payload.dest_path);

        crate::tools::splitter::combine_files_sync(&parts, dest_path, payload.expected_sha256.as_deref())
            .map(Json)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
    } else {
        Err((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))
    }
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
