use super::{is_archive_file, DirectoryListing, FileContentResponse, FileEntry, VfsResult};
use std::process::Command;
use std::fs;
use tempfile::NamedTempFile;

pub struct SmbClient;

#[derive(Debug, Clone)]
pub struct SmbParams {
    pub host: String,
    pub port: u16,
    pub share: String,
    pub subpath: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
}

impl SmbClient {
    /// Parse an smb:// URI into structured parameters
    /// Formats supported:
    /// - smb://host/share/subpath
    /// - smb://user@host/share/subpath
    /// - smb://user:password@host:445/share/subpath
    /// - smb://DOMAIN;user:password@host/share/subpath
    pub fn parse_uri(uri: &str, default_user: Option<&str>, default_pass: Option<&str>) -> VfsResult<SmbParams> {
        let clean = uri.strip_prefix("smb://").ok_or_else(|| "Invalid SMB URI (must start with smb://)".to_string())?;
        
        let (user_domain_pass, host_share_path) = if let Some(idx) = clean.find('@') {
            (&clean[..idx], &clean[idx + 1..])
        } else {
            ("", clean)
        };

        let mut domain = None;
        let mut username = default_user.map(|s| s.to_string());
        let mut password = default_pass.map(|s| s.to_string());

        if !user_domain_pass.is_empty() {
            let (dom_user, pass_part) = if let Some(colon) = user_domain_pass.find(':') {
                (&user_domain_pass[..colon], Some(&user_domain_pass[colon + 1..]))
            } else {
                (user_domain_pass, None)
            };

            if let Some(p) = pass_part {
                password = Some(p.to_string());
            }

            if let Some(semi) = dom_user.find(';') {
                domain = Some(dom_user[..semi].to_string());
                username = Some(dom_user[semi + 1..].to_string());
            } else {
                username = Some(dom_user.to_string());
            }
        }

        let parts: Vec<&str> = host_share_path.splitn(2, '/').collect();
        let host_port = parts[0];
        let share_and_subpath = if parts.len() > 1 { parts[1] } else { "" };

        let (host, port) = if let Some(colon) = host_port.find(':') {
            let h = &host_port[..colon];
            let p = host_port[colon + 1..].parse::<u16>().unwrap_or(445);
            (h.to_string(), p)
        } else {
            (host_port.to_string(), 445)
        };

        let (share, subpath) = if let Some(slash) = share_and_subpath.find('/') {
            (&share_and_subpath[..slash], &share_and_subpath[slash + 1..])
        } else {
            (share_and_subpath, "")
        };

        if share.is_empty() {
            return Err("SMB URI missing share name (e.g. smb://host/share)".to_string());
        }

        Ok(SmbParams {
            host,
            port,
            share: share.to_string(),
            subpath: subpath.trim_matches('/').to_string(),
            username,
            password,
            domain,
        })
    }

    /// Format credentials argument for smbclient (-U "DOMAIN\user%pass" or -N)
    fn build_auth_arg(params: &SmbParams) -> Vec<String> {
        let mut args = Vec::new();
        if let Some(ref user) = params.username {
            let full_user = if let Some(ref dom) = params.domain {
                format!("{}\\{}", dom, user)
            } else {
                user.clone()
            };

            let auth_str = if let Some(ref pass) = params.password {
                format!("{}%{}", full_user, pass)
            } else {
                full_user
            };
            args.push("-U".to_string());
            args.push(auth_str);
        } else {
            args.push("-N".to_string()); // Anonymous
        }

        if params.port != 445 && params.port > 0 {
            args.push("-p".to_string());
            args.push(params.port.to_string());
        }

        args
    }

    /// Check if smbclient is available in PATH
    pub fn is_available() -> bool {
        Command::new("smbclient")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// List directory contents over SMB/CIFS
    pub fn list_dir(params: &SmbParams) -> VfsResult<DirectoryListing> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed on the host. Install it with: sudo apt install smbclient (Debian/Ubuntu) or sudo dnf install samba-client (Fedora/RHEL).".to_string());
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let smb_cmd = if params.subpath.is_empty() {
            "ls".to_string()
        } else {
            let win_path = params.subpath.replace('/', "\\");
            format!("cd \"{}\"; ls", win_path)
        };

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to execute smbclient: {}", e))?;

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!("SMB list failed: {}", if err_msg.trim().is_empty() { String::from_utf8_lossy(&output.stdout).to_string() } else { err_msg.to_string() }));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_size: u64 = 0;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.contains("blocks of size") || trimmed.contains("blocks available") {
                continue;
            }

            // Example line formats:
            //   .                                   D        0  Sun Aug 23 16:00:00 2026
            //   ..                                  D        0  Sun Aug 23 16:00:00 2026
            //   Folder                              D        0  Sun Aug 23 16:05:00 2026
            //   file.txt                            A     1024  Sun Aug 23 16:10:00 2026
            //   My File.pdf                         A  1048576  Sun Aug 23 16:10:00 2026

            if let Some(pos_d) = trimmed.rfind("   D ") {
                let name = trimmed[..pos_d].trim();
                if name == "." || name == ".." {
                    continue;
                }
                total_dirs += 1;
                let full_subpath = if params.subpath.is_empty() {
                    name.to_string()
                } else {
                    format!("{}/{}", params.subpath, name)
                };

                let user_prefix = params.username.as_ref().map(|u| format!("{}@", u)).unwrap_or_default();
                let port_suffix = if params.port != 445 { format!(":{}", params.port) } else { "".to_string() };

                entries.push(FileEntry {
                    name: name.to_string(),
                    path: format!("smb://{}{}{}/{}/{}", user_prefix, params.host, port_suffix, params.share, full_subpath),
                    is_dir: true,
                    is_symlink: false,
                    is_empty: None,
                    size: 0,
                    modified: None,
                    permissions: "drwxr-xr-x".to_string(),
                    mode_octal: "0755".to_string(),
                    owner: "smb".to_string(),
                    group: "smb".to_string(),
                    uid: 1000,
                    gid: 1000,
                    mime_type: None,
                    is_archive: false,
                });
            } else if let Some(pos_a) = trimmed.rfind("   A ") {
                let name = trimmed[..pos_a].trim();
                if name == "." || name == ".." {
                    continue;
                }
                let rest = trimmed[pos_a + 5..].trim();
                let parts: Vec<&str> = rest.split_whitespace().collect();
                let size: u64 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);

                total_files += 1;
                total_size += size;

                let full_subpath = if params.subpath.is_empty() {
                    name.to_string()
                } else {
                    format!("{}/{}", params.subpath, name)
                };

                let user_prefix = params.username.as_ref().map(|u| format!("{}@", u)).unwrap_or_default();
                let port_suffix = if params.port != 445 { format!(":{}", params.port) } else { "".to_string() };
                let is_archive = is_archive_file(name);

                entries.push(FileEntry {
                    name: name.to_string(),
                    path: format!("smb://{}{}{}/{}/{}", user_prefix, params.host, port_suffix, params.share, full_subpath),
                    is_dir: false,
                    is_symlink: false,
                    is_empty: None,
                    size,
                    modified: None,
                    permissions: "-rw-r--r--".to_string(),
                    mode_octal: "0644".to_string(),
                    owner: "smb".to_string(),
                    group: "smb".to_string(),
                    uid: 1000,
                    gid: 1000,
                    mime_type: Some(mime_guess::from_path(name).first_or_octet_stream().to_string()),
                    is_archive,
                });
            }
        }

        // Sort: directories first, then alphabetical
        entries.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        let user_prefix = params.username.as_ref().map(|u| format!("{}@", u)).unwrap_or_default();
        let port_suffix = if params.port != 445 { format!(":{}", params.port) } else { "".to_string() };
        let current_path = if params.subpath.is_empty() {
            format!("smb://{}{}{}/{}", user_prefix, params.host, port_suffix, params.share)
        } else {
            format!("smb://{}{}{}/{}/{}", user_prefix, params.host, port_suffix, params.share, params.subpath)
        };

        let parent_path = if params.subpath.is_empty() {
            None
        } else {
            let p = std::path::Path::new(&params.subpath);
            let parent_sub = p.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            if parent_sub.is_empty() {
                Some(format!("smb://{}{}{}/{}", user_prefix, params.host, port_suffix, params.share))
            } else {
                Some(format!("smb://{}{}{}/{}/{}", user_prefix, params.host, port_suffix, params.share, parent_sub))
            }
        };

        Ok(DirectoryListing {
            current_path,
            parent_path,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "smb".to_string(),
        })
    }

    /// Read file contents from SMB share
    pub fn read_file(params: &SmbParams) -> VfsResult<FileContentResponse> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        let tmp_file = NamedTempFile::new().map_err(|e| format!("Temp file error: {}", e))?;
        let tmp_path = tmp_file.path().to_string_lossy().to_string();

        let share_target = format!("//{}/{}", params.host, params.share);
        let win_path = params.subpath.replace('/', "\\");
        let smb_cmd = format!("get \"{}\" \"{}\"", win_path, tmp_path);

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to read SMB file: {}", e))?;
        if !output.status.success() {
            return Err(format!("SMB get failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        let bytes = fs::read(&tmp_path).map_err(|e| format!("Read temp file error: {}", e))?;
        let file_name = params.subpath.rsplit('/').next().unwrap_or(&params.subpath).to_string();
        let mime = mime_guess::from_path(&file_name).first_or_octet_stream().to_string();
        let is_binary = bytes.iter().take(1024).any(|&b| b == 0);

        let content = if is_binary {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
        } else {
            String::from_utf8_lossy(&bytes).to_string()
        };

        Ok(FileContentResponse {
            path: format!("smb://{}/{}/{}", params.host, params.share, params.subpath),
            name: file_name,
            content,
            is_binary,
            size: bytes.len() as u64,
            mime_type: mime,
        })
    }

    /// Write file contents to SMB share
    pub fn write_file(params: &SmbParams, content: &[u8]) -> VfsResult<()> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        let tmp_file = NamedTempFile::new().map_err(|e| format!("Temp file error: {}", e))?;
        let tmp_path = tmp_file.path().to_string_lossy().to_string();
        fs::write(&tmp_path, content).map_err(|e| format!("Failed to write temp file: {}", e))?;

        let share_target = format!("//{}/{}", params.host, params.share);
        let win_path = params.subpath.replace('/', "\\");
        let smb_cmd = format!("put \"{}\" \"{}\"", tmp_path, win_path);

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to write SMB file: {}", e))?;
        if !output.status.success() {
            return Err(format!("SMB put failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        Ok(())
    }

    /// Test SMB connection
    pub fn test_connection(params: &SmbParams) -> VfsResult<String> {
        if !Self::is_available() {
            return Err("Samba client ('smbclient') is not installed on the server.\nInstall with: sudo apt install smbclient".to_string());
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg("ls");

        let output = cmd.output().map_err(|e| format!("Failed to run smbclient: {}", e))?;
        if output.status.success() {
            Ok(format!("✓ Successfully connected to SMB Share '//{}/{}'", params.host, params.share))
        } else {
            let err = String::from_utf8_lossy(&output.stderr);
            Err(format!("SMB Connection Failed: {}", if err.trim().is_empty() { String::from_utf8_lossy(&output.stdout).to_string() } else { err.to_string() }))
        }
    }
}
