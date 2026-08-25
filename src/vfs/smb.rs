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

impl SmbParams {
    /// Builds the user credentials prefix including domain and password if present
    pub fn auth_prefix(&self) -> String {
        let mut prefix = String::new();
        if let Some(ref u) = self.username {
            if let Some(ref d) = self.domain {
                if !d.is_empty() && d != "WORKGROUP" {
                    prefix.push_str(d);
                    prefix.push(';');
                }
            }
            prefix.push_str(u);
            if let Some(ref p) = self.password {
                prefix.push(':');
                prefix.push_str(p);
            }
            prefix.push('@');
        }
        prefix
    }

    /// Builds port suffix if non-default 445
    pub fn port_suffix(&self) -> String {
        if self.port != 445 && self.port > 0 {
            format!(":{}", self.port)
        } else {
            "".to_string()
        }
    }

    /// Reconstructs full SMB URI preserving credentials
    pub fn build_uri(&self, subpath: &str) -> String {
        let clean = subpath.trim_matches('/');
        if clean.is_empty() {
            format!("smb://{}{}{}/{}", self.auth_prefix(), self.host, self.port_suffix(), self.share)
        } else {
            format!("smb://{}{}{}/{}/{}", self.auth_prefix(), self.host, self.port_suffix(), self.share, clean)
        }
    }
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
                if !dom.is_empty() && dom != "WORKGROUP" {
                    format!("{}\\{}", dom, user)
                } else {
                    user.clone()
                }
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
            args.push("-N".to_string()); // Anonymous / Guest
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
            let out_msg = String::from_utf8_lossy(&output.stdout);
            let combined = if err_msg.trim().is_empty() { out_msg.to_string() } else { err_msg.to_string() };
            return Err(format!("SMB list failed: {}", combined.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_size: u64 = 0;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed.contains("blocks of size")
                || trimmed.contains("blocks available")
                || trimmed.starts_with("Domain=")
                || trimmed.starts_with("OS=")
                || trimmed.starts_with("Server=")
                || trimmed.starts_with("smb:")
            {
                continue;
            }

            let tokens: Vec<&str> = trimmed.split_whitespace().collect();
            if tokens.len() >= 7 {
                let attr = tokens[tokens.len() - 7];
                let size: u64 = tokens[tokens.len() - 6].parse().unwrap_or(0);
                let name = tokens[..tokens.len() - 7].join(" ");

                if name == "." || name == ".." {
                    continue;
                }

                let is_dir = attr.contains('D');

                let full_subpath = if params.subpath.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", params.subpath, name)
                };

                let entry_path = params.build_uri(&full_subpath);

                if is_dir {
                    total_dirs += 1;
                    entries.push(FileEntry {
                        name: name.clone(),
                        path: entry_path,
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
                } else {
                    total_files += 1;
                    total_size += size;
                    let is_archive = is_archive_file(&name);
                    entries.push(FileEntry {
                        name: name.clone(),
                        path: entry_path,
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
                        mime_type: Some(mime_guess::from_path(&name).first_or_octet_stream().to_string()),
                        is_archive,
                    });
                }
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

        let current_path = params.build_uri(&params.subpath);
        let parent_path = if params.subpath.is_empty() {
            None
        } else {
            let p = std::path::Path::new(&params.subpath);
            let parent_sub = p.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            Some(params.build_uri(&parent_sub))
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

    /// Read raw file bytes from SMB
    pub fn read_bytes(params: &SmbParams) -> VfsResult<Vec<u8>> {
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

        fs::read(&tmp_path).map_err(|e| format!("Read temp file error: {}", e))
    }

    /// Read file contents from SMB share (with base64 binary support)
    pub fn read_file(params: &SmbParams) -> VfsResult<FileContentResponse> {
        let bytes = Self::read_bytes(params)?;
        let file_name = params.subpath.rsplit('/').next().unwrap_or(&params.subpath).to_string();
        let mime = mime_guess::from_path(&file_name).first_or_octet_stream().to_string();
        let is_binary = bytes.iter().take(1024).any(|&b| b == 0);

        let content = if is_binary {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
        } else {
            String::from_utf8_lossy(&bytes).to_string()
        };

        Ok(FileContentResponse {
            path: params.build_uri(&params.subpath),
            name: file_name,
            content,
            is_binary,
            size: bytes.len() as u64,
            mime_type: mime,
        })
    }

    /// Download file directly from SMB to local path
    pub fn download_to_file(params: &SmbParams, local_dest: &std::path::Path) -> VfsResult<()> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        if let Some(parent) = local_dest.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let win_path = params.subpath.replace('/', "\\");
        let dest_str = local_dest.to_string_lossy();
        let smb_cmd = format!("get \"{}\" \"{}\"", win_path, dest_str);

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to download SMB file: {}", e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let out = String::from_utf8_lossy(&output.stdout);
            let msg = if err.trim().is_empty() { out.to_string() } else { err.to_string() };
            return Err(format!("SMB get failed: {}", msg.trim()));
        }

        Ok(())
    }

    /// Upload file directly from local path to SMB share
    pub fn upload_from_file(params: &SmbParams, local_src: &std::path::Path) -> VfsResult<()> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        if !local_src.exists() {
            return Err(format!("Local source file does not exist: {}", local_src.display()));
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let win_path = params.subpath.replace('/', "\\");
        let src_str = local_src.to_string_lossy();
        let smb_cmd = format!("put \"{}\" \"{}\"", src_str, win_path);

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to upload SMB file: {}", e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let out = String::from_utf8_lossy(&output.stdout);
            let msg = if err.trim().is_empty() { out.to_string() } else { err.to_string() };
            return Err(format!("SMB put failed: {}", msg.trim()));
        }

        Ok(())
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

    /// Create directory in SMB share
    pub fn mkdir(params: &SmbParams) -> VfsResult<()> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let win_path = params.subpath.replace('/', "\\");
        let smb_cmd = format!("mkdir \"{}\"", win_path);

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to create SMB directory: {}", e))?;
        if !output.status.success() {
            return Err(format!("SMB mkdir failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        Ok(())
    }

    /// Delete file or directory in SMB share
    pub fn delete(params: &SmbParams, is_dir: bool) -> VfsResult<()> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let win_path = params.subpath.replace('/', "\\");
        
        let smb_cmd = if is_dir {
            format!("deltree \"{}\"", win_path)
        } else {
            format!("del \"{}\"", win_path)
        };

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to delete SMB entry: {}", e))?;
        if !output.status.success() {
            // If del failed and we assumed file, try deltree
            if !is_dir {
                let rmdir_cmd = format!("deltree \"{}\"", win_path);
                let mut retry = Command::new("smbclient");
                retry.arg(&share_target);
                for a in Self::build_auth_arg(params) {
                    retry.arg(a);
                }
                retry.arg("-c").arg(&rmdir_cmd);
                if let Ok(out) = retry.output() {
                    if out.status.success() {
                        return Ok(());
                    }
                }
            }
            return Err(format!("SMB delete failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        Ok(())
    }

    /// Rename file or directory in SMB share
    pub fn rename(params: &SmbParams, new_subpath: &str) -> VfsResult<()> {
        if !Self::is_available() {
            return Err("Samba client utility ('smbclient') is not installed.".to_string());
        }

        let share_target = format!("//{}/{}", params.host, params.share);
        let old_win_path = params.subpath.replace('/', "\\");
        let new_win_path = new_subpath.replace('/', "\\");
        let smb_cmd = format!("rename \"{}\" \"{}\"", old_win_path, new_win_path);

        let mut cmd = Command::new("smbclient");
        cmd.arg(&share_target);
        for a in Self::build_auth_arg(params) {
            cmd.arg(a);
        }
        cmd.arg("-c").arg(&smb_cmd);

        let output = cmd.output().map_err(|e| format!("Failed to rename SMB entry: {}", e))?;
        if !output.status.success() {
            return Err(format!("SMB rename failed: {}", String::from_utf8_lossy(&output.stderr)));
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
            let out = String::from_utf8_lossy(&output.stdout);
            let msg = if err.trim().is_empty() { out.to_string() } else { err.to_string() };
            Err(format!("SMB Connection Failed: {}", msg.trim()))
        }
    }
}
