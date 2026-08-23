use crate::vfs::{FileEntry, VfsResult};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtonConfig {
    pub account: Option<String>,
    pub root_path: Option<String>,
    pub cli_binary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtonStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub active_account: Option<String>,
    pub storage_used_bytes: Option<u64>,
    pub storage_total_bytes: Option<u64>,
    pub cli_type: String, // "proton-drive", "proton-drive-cli", "rclone", "none"
}

pub struct ProtonDriveClient;

impl ProtonDriveClient {
    /// Detects if Proton Drive CLI or rclone proton backend is installed
    pub async fn check_status() -> ProtonStatus {
        // 1. Check for official 'proton-drive' CLI
        if let Ok(output) = Command::new("proton-drive")
            .arg("--version")
            .output()
            .await
        {
            if output.status.success() {
                let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let auth_res = Command::new("proton-drive").arg("status").output().await;
                let authed = auth_res.map(|o| o.status.success()).unwrap_or(false);

                return ProtonStatus {
                    installed: true,
                    authenticated: authed,
                    version: Some(ver),
                    active_account: Some("Proton Account".to_string()),
                    storage_used_bytes: None,
                    storage_total_bytes: None,
                    cli_type: "proton-drive".to_string(),
                };
            }
        }

        // 2. Check for 'proton-drive-cli'
        if let Ok(output) = Command::new("proton-drive-cli")
            .arg("--version")
            .output()
            .await
        {
            if output.status.success() {
                let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let auth_res = Command::new("proton-drive-cli").arg("status").output().await;
                let authed = auth_res.map(|o| o.status.success()).unwrap_or(false);

                return ProtonStatus {
                    installed: true,
                    authenticated: authed,
                    version: Some(ver),
                    active_account: Some("Proton Account".to_string()),
                    storage_used_bytes: None,
                    storage_total_bytes: None,
                    cli_type: "proton-drive-cli".to_string(),
                };
            }
        }

        // 3. Check for 'rclone' with proton backend
        if let Ok(output) = Command::new("rclone")
            .arg("version")
            .output()
            .await
        {
            if output.status.success() {
                let ver = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("rclone").to_string();
                let remotes_res = Command::new("rclone").arg("listremotes").output().await;
                let remotes_str = remotes_res.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
                let has_proton = remotes_str.lines().any(|l| l.to_lowercase().contains("proton"));

                return ProtonStatus {
                    installed: true,
                    authenticated: has_proton,
                    version: Some(ver),
                    active_account: if has_proton { Some("rclone proton:".to_string()) } else { None },
                    storage_used_bytes: None,
                    storage_total_bytes: None,
                    cli_type: "rclone".to_string(),
                };
            }
        }

        // 4. Check for local sync folder (~/ProtonDrive or ~/.proton-drive)
        let home = dirs::home_dir().unwrap_or_else(|| Path::new("/root").to_path_buf());
        let sync_dir1 = home.join("ProtonDrive");
        let sync_dir2 = home.join(".proton-drive");

        if sync_dir1.exists() || sync_dir2.exists() {
            return ProtonStatus {
                installed: true,
                authenticated: true,
                version: Some("FUSE / Sync Folder".to_string()),
                active_account: Some("Local Sync Mount".to_string()),
                storage_used_bytes: None,
                storage_total_bytes: None,
                cli_type: "local-sync".to_string(),
            };
        }

        ProtonStatus {
            installed: false,
            authenticated: false,
            version: None,
            active_account: None,
            storage_used_bytes: None,
            storage_total_bytes: None,
            cli_type: "none".to_string(),
        }
    }

    /// Lists directory entries via CLI or local sync
    pub async fn list_directory(path: &str) -> VfsResult<Vec<FileEntry>> {
        let clean_path = path.trim_start_matches("proton://").trim_start_matches('/');
        let status = Self::check_status().await;

        if !status.installed {
            return Err("Proton Drive CLI or rclone is not installed on this system. Install 'proton-drive' or configure an rclone proton remote.".to_string());
        }

        match status.cli_type.as_str() {
            "proton-drive" | "proton-drive-cli" => {
                let bin = &status.cli_type;
                let target = if clean_path.is_empty() { "/" } else { clean_path };
                let output = Command::new(bin)
                    .arg("ls")
                    .arg("-l")
                    .arg(target)
                    .output()
                    .await
                    .map_err(|e| format!("Failed to run {}: {}", bin, e))?;

                if !output.status.success() {
                    return Err(format!("Proton Drive error: {}", String::from_utf8_lossy(&output.stderr)));
                }

                let text = String::from_utf8_lossy(&output.stdout);
                let mut entries = Vec::new();

                for line in text.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        let is_dir = parts[0].starts_with('d') || parts[0] == "DIR";
                        let name = parts[parts.len() - 1];
                        let size: u64 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

                        entries.push(FileEntry {
                            name: name.to_string(),
                            path: format!("proton://{}/{}", clean_path, name).replace("//", "/"),
                            is_dir,
                            is_symlink: false,
                            is_empty: None,
                            size,
                            modified: Some(Utc::now().timestamp() as u64),
                            permissions: if is_dir { "drwxr-xr-x".to_string() } else { "-rw-r--r--".to_string() },
                            mode_octal: if is_dir { "0755".to_string() } else { "0644".to_string() },
                            owner: "proton".to_string(),
                            group: "proton".to_string(),
                            uid: 1000,
                            gid: 1000,
                            mime_type: None,
                            is_archive: name.ends_with(".zip") || name.ends_with(".tar.gz"),
                        });
                    }
                }

                Ok(entries)
            }
            "rclone" => {
                let remote_target = format!("proton:{}", clean_path);
                let output = Command::new("rclone")
                    .arg("lsf")
                    .arg("--format")
                    .arg("pst")
                    .arg(&remote_target)
                    .output()
                    .await
                    .map_err(|e| format!("Failed to run rclone: {}", e))?;

                if !output.status.success() {
                    return Err(format!("rclone proton error: {}", String::from_utf8_lossy(&output.stderr)));
                }

                let text = String::from_utf8_lossy(&output.stdout);
                let mut entries = Vec::new();

                for line in text.lines() {
                    let parts: Vec<&str> = line.split(';').collect();
                    if parts.len() >= 2 {
                        let name = parts[0].trim_end_matches('/');
                        let is_dir = parts[0].ends_with('/');
                        let size: u64 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

                        entries.push(FileEntry {
                            name: name.to_string(),
                            path: format!("proton://{}/{}", clean_path, name).replace("//", "/"),
                            is_dir,
                            is_symlink: false,
                            is_empty: None,
                            size,
                            modified: Some(Utc::now().timestamp() as u64),
                            permissions: if is_dir { "drwxr-xr-x".to_string() } else { "-rw-r--r--".to_string() },
                            mode_octal: if is_dir { "0755".to_string() } else { "0644".to_string() },
                            owner: "proton".to_string(),
                            group: "proton".to_string(),
                            uid: 1000,
                            gid: 1000,
                            mime_type: None,
                            is_archive: name.ends_with(".zip") || name.ends_with(".tar.gz"),
                        });
                    }
                }

                Ok(entries)
            }
            "local-sync" => {
                let home = dirs::home_dir().unwrap_or_else(|| Path::new("/root").to_path_buf());
                let sync_root = if home.join("ProtonDrive").exists() {
                    home.join("ProtonDrive")
                } else {
                    home.join(".proton-drive")
                };

                let target_dir = sync_root.join(clean_path);
                crate::vfs::local::LocalFs::list_dir(target_dir.to_str().unwrap_or("/"), true)
                    .map(|l| l.entries)
                    .map_err(|e| e.to_string())
            }
            _ => Err("Unsupported Proton Drive backend".to_string()),
        }
    }
}
