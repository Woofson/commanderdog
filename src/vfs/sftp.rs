use super::{is_archive_file, DirectoryListing, FileEntry};
use ssh2::{KeyboardInteractivePrompt, Prompt, Session};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct SftpParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub remote_path: String,
}

struct KbdInteractiveHelper<'a> {
    password: &'a str,
}

impl<'a> KeyboardInteractivePrompt for KbdInteractiveHelper<'a> {
    fn prompt<'b>(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[Prompt<'b>],
    ) -> Vec<String> {
        prompts.iter().map(|_| self.password.to_string()).collect()
    }
}

pub struct SftpClient;

impl SftpClient {
    pub fn connect(params: &SftpParams) -> Result<Session, std::io::Error> {
        let addr_str = format!("{}:{}", params.host, params.port);
        let socket_addrs: Vec<_> = addr_str.to_socket_addrs()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, format!("Cannot resolve host {}: {}", params.host, e)))?
            .collect();

        if socket_addrs.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AddrNotAvailable,
                format!("No IP addresses found for host '{}'", params.host),
            ));
        }

        let tcp = TcpStream::connect_timeout(&socket_addrs[0], Duration::from_secs(10))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::TimedOut, format!("TCP connection to {}:{} failed: {}", params.host, params.port, e)))?;

        let mut sess = Session::new()?;
        sess.set_tcp_stream(tcp);
        sess.set_timeout(15000); // 15s timeout
        sess.handshake()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::ConnectionRefused, format!("SSH handshake failed with {}:{}: {}", params.host, params.port, e)))?;

        // 1. Password authentication
        if let Some(password) = params.password.as_deref().filter(|p| !p.is_empty()) {
            if sess.userauth_password(&params.user, password).is_ok() && sess.authenticated() {
                return Ok(sess);
            }

            // 1b. Fallback to keyboard-interactive authentication with provided password
            let mut prompt_handler = KbdInteractiveHelper { password };
            if sess.userauth_keyboard_interactive(&params.user, &mut prompt_handler).is_ok() && sess.authenticated() {
                return Ok(sess);
            }
        }

        // 2. Explicit key file authentication
        if let Some(ref key_path) = params.key_path {
            let p = Path::new(key_path);
            if p.exists() {
                if sess.userauth_pubkey_file(&params.user, None, p, params.password.as_deref()).is_ok() && sess.authenticated() {
                    return Ok(sess);
                }
            }
        }

        // 3. SSH Agent authentication (gracefully ignore if socket does not exist or agent fails)
        if !sess.authenticated() {
            if let Ok(mut agent) = sess.agent() {
                if agent.connect().is_ok() && agent.list_identities().is_ok() {
                    if let Ok(identities) = agent.identities() {
                        for identity in identities {
                            if agent.userauth(&params.user, &identity).is_ok() && sess.authenticated() {
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 4. Default user SSH keys in ~/.ssh/
        if !sess.authenticated() {
            if let Some(home) = dirs::home_dir() {
                let ssh_dir = home.join(".ssh");
                for key_name in &["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] {
                    let priv_key = ssh_dir.join(key_name);
                    if priv_key.exists() {
                        let pub_key = ssh_dir.join(format!("{}.pub", key_name));
                        let pub_ref = if pub_key.exists() { Some(pub_key.as_path()) } else { None };
                        if sess.userauth_pubkey_file(&params.user, pub_ref, &priv_key, params.password.as_deref()).is_ok() && sess.authenticated() {
                            break;
                        }
                    }
                }
            }
        }

        if !sess.authenticated() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!(
                    "SFTP authentication failed for user '{}' at {}:{}. Please verify password or SSH key.",
                    params.user, params.host, params.port
                ),
            ));
        }

        Ok(sess)
    }

    pub fn resolve_remote_path(sftp: &ssh2::Sftp, raw_path: &str) -> String {
        let clean = raw_path.trim();
        if clean.is_empty() || clean == "." || clean == "~" {
            if let Ok(real) = sftp.realpath(Path::new(".")) {
                return real.to_string_lossy().to_string();
            }
            "/".to_string()
        } else if clean.starts_with("~/") {
            let sub = clean.trim_start_matches("~/");
            if let Ok(real) = sftp.realpath(Path::new(".")) {
                let home_str = real.to_string_lossy().to_string();
                format!("{}/{}", home_str.trim_end_matches('/'), sub)
            } else {
                format!("/{}", sub)
            }
        } else {
            clean.to_string()
        }
    }

    pub fn list_dir(params: &SftpParams) -> Result<DirectoryListing, std::io::Error> {
        let sess = Self::connect(params)?;
        let sftp = sess.sftp().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("SFTP subsystem initialization failed: {}", e)))?;

        let resolved_path = Self::resolve_remote_path(&sftp, &params.remote_path);
        let path = if resolved_path.is_empty() { "/" } else { &resolved_path };
        let entries_raw = sftp.readdir(Path::new(path))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("Failed to read SFTP directory '{}': {}", path, e)))?;

        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_size = 0u64;

        for (p, stat) in entries_raw {
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            if name == "." || name == ".." {
                continue;
            }

            let is_dir = stat.is_dir();
            let size = stat.size.unwrap_or(0);
            let modified = stat.mtime;
            let raw_perm = stat.perm.unwrap_or(0o644);
            let mode_octal = format!("{:04o}", raw_perm & 0o7777);
            let permissions = if is_dir { format!("d{:o}", raw_perm & 0o777) } else { format!("-{:o}", raw_perm & 0o777) };
            let is_archive = !is_dir && is_archive_file(&name);

            let uid = stat.uid.unwrap_or(1000);
            let gid = stat.gid.unwrap_or(1000);

            if is_dir {
                total_dirs += 1;
            } else {
                total_files += 1;
                total_size += size;
            }

            let full_path = if path == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", path.trim_end_matches('/'), name)
            };

            let entry_uri = format!("sftp://{}@{}:{}{}", percent_encode(&params.user), params.host, params.port, full_path);

            entries.push(FileEntry {
                name: name.clone(),
                path: entry_uri,
                is_dir,
                is_symlink: false,
                is_empty: None,
                size,
                modified,
                permissions,
                mode_octal,
                owner: params.user.clone(),
                group: "remote".to_string(),
                uid,
                gid,
                mime_type: if is_dir { None } else { Some(mime_guess::from_path(&name).first_or_octet_stream().to_string()) },
                is_archive,
            });
        }

        entries.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        let parent_path = Path::new(path).parent().map(|p| {
            let p_str = p.to_string_lossy();
            let final_p = if p_str.is_empty() { "/" } else { &p_str };
            format!("sftp://{}@{}:{}{}", percent_encode(&params.user), params.host, params.port, final_p)
        });

        let current_uri = format!("sftp://{}@{}:{}{}", percent_encode(&params.user), params.host, params.port, path);

        Ok(DirectoryListing {
            current_path: current_uri,
            parent_path,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "sftp".to_string(),
            is_truncated: None,
            max_limit: None,
        })
    }

    pub fn download_file(
        host: &str,
        port: u16,
        user: &str,
        pass: Option<&str>,
        remote_path: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, std::io::Error> {
        let params = SftpParams {
            host: host.to_string(),
            port,
            user: user.to_string(),
            password: pass.map(|s| s.to_string()),
            key_path: None,
            remote_path: remote_path.to_string(),
        };
        let sess = Self::connect(&params)?;
        let sftp = sess.sftp().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("SFTP subsystem error: {}", e)))?;
        let resolved = Self::resolve_remote_path(&sftp, remote_path);
        let mut file = sftp.open(Path::new(&resolved))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("SFTP open error for '{}': {}", resolved, e)))?;

        let mut buffer = Vec::new();
        if max_bytes > 0 {
            let mut handle = (&mut file).take(max_bytes as u64);
            handle.read_to_end(&mut buffer)?;
        } else {
            file.read_to_end(&mut buffer)?;
        }

        Ok(buffer)
    }

    pub fn write_file(params: &SftpParams, data: &[u8]) -> Result<(), std::io::Error> {
        let sess = Self::connect(params)?;
        let sftp = sess.sftp().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("SFTP subsystem error: {}", e)))?;
        let resolved = Self::resolve_remote_path(&sftp, &params.remote_path);
        let mut file = sftp.create(Path::new(&resolved))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("SFTP create file error for '{}': {}", resolved, e)))?;
        file.write_all(data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("SFTP write error for '{}': {}", resolved, e)))?;
        Ok(())
    }

    pub fn parse_uri(uri: &str, default_user: Option<&str>, default_pass: Option<&str>) -> Result<SftpParams, String> {
        let clean = uri.strip_prefix("sftp://").ok_or_else(|| "Invalid SFTP URI: must start with 'sftp://'".to_string())?;

        let (auth_part, host_and_path) = if let Some(at) = clean.rfind('@') {
            (&clean[..at], &clean[at + 1..])
        } else {
            ("", clean)
        };

        let mut user = default_user.unwrap_or("root").to_string();
        let mut password = default_pass.filter(|p| !p.trim().is_empty()).map(|s| s.to_string());

        if !auth_part.is_empty() {
            if let Some(colon) = auth_part.find(':') {
                user = percent_decode(&auth_part[..colon]);
                password = Some(percent_decode(&auth_part[colon + 1..]));
            } else {
                user = percent_decode(auth_part);
            }
        }

        let (host_port, remote_path) = if let Some(slash) = host_and_path.find('/') {
            (&host_and_path[..slash], &host_and_path[slash..])
        } else {
            (host_and_path, "")
        };

        let (host, port) = if let Some(colon) = host_port.rfind(':') {
            let h = &host_port[..colon];
            let p = host_port[colon + 1..].parse::<u16>().unwrap_or(22);
            (h.to_string(), p)
        } else {
            (host_port.to_string(), 22)
        };

        let final_path = remote_path.to_string();

        Ok(SftpParams {
            host,
            port,
            user,
            password,
            key_path: None,
            remote_path: final_path,
        })
    }

    pub fn download_to_file(params: &SftpParams, local_dest: &Path) -> Result<(), String> {
        let sess = Self::connect(params)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let resolved = Self::resolve_remote_path(&sftp, &params.remote_path);
        let mut remote_file = sftp.open(Path::new(&resolved))
            .map_err(|e| format!("SFTP open error for {}: {}", resolved, e))?;
        let mut local_file = std::fs::File::create(local_dest)
            .map_err(|e| format!("Failed to create local file {}: {}", local_dest.display(), e))?;
        std::io::copy(&mut remote_file, &mut local_file)
            .map_err(|e| format!("SFTP download stream error: {}", e))?;
        Ok(())
    }

    pub fn upload_from_file(params: &SftpParams, local_src: &Path) -> Result<(), String> {
        let sess = Self::connect(params)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let resolved = Self::resolve_remote_path(&sftp, &params.remote_path);
        let mut remote_file = sftp.create(Path::new(&resolved))
            .map_err(|e| format!("SFTP create remote file error for {}: {}", resolved, e))?;
        let mut local_file = std::fs::File::open(local_src)
            .map_err(|e| format!("Failed to open local source {}: {}", local_src.display(), e))?;
        std::io::copy(&mut local_file, &mut remote_file)
            .map_err(|e| format!("SFTP upload stream error: {}", e))?;
        Ok(())
    }

    pub fn mkdir(params: &SftpParams) -> Result<(), String> {
        let sess = Self::connect(params)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let resolved = Self::resolve_remote_path(&sftp, &params.remote_path);
        sftp.mkdir(Path::new(&resolved), 0o755)
            .map_err(|e| format!("SFTP mkdir error: {}", e))?;
        Ok(())
    }

    pub fn rename(params: &SftpParams, new_remote_path: &str) -> Result<(), String> {
        let sess = Self::connect(params)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let resolved_from = Self::resolve_remote_path(&sftp, &params.remote_path);
        let resolved_to = Self::resolve_remote_path(&sftp, new_remote_path);
        sftp.rename(Path::new(&resolved_from), Path::new(&resolved_to), None)
            .map_err(|e| format!("SFTP rename error: {}", e))?;
        Ok(())
    }

    pub fn delete(params: &SftpParams, is_dir: bool) -> Result<(), String> {
        let sess = Self::connect(params)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let resolved = Self::resolve_remote_path(&sftp, &params.remote_path);
        if is_dir {
            sftp.rmdir(Path::new(&resolved))
                .map_err(|e| format!("SFTP rmdir error: {}", e))?;
        } else {
            sftp.unlink(Path::new(&resolved))
                .map_err(|e| format!("SFTP unlink error: {}", e))?;
        }
        Ok(())
    }
}

fn percent_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                if let (Some(d1), Some(d2)) = (hex_val(h1), hex_val(h2)) {
                    bytes.push((d1 << 4) | d2);
                    continue;
                }
            }
        } else if b == b'+' {
            bytes.push(b' ');
            continue;
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sftp_parse_uri_variations() {
        let p1 = SftpClient::parse_uri("sftp://user:secret@192.168.1.100:2222/var/log", None, None).unwrap();
        assert_eq!(p1.host, "192.168.1.100");
        assert_eq!(p1.port, 2222);
        assert_eq!(p1.user, "user");
        assert_eq!(p1.password.as_deref(), Some("secret"));
        assert_eq!(p1.remote_path, "/var/log");

        let p2 = SftpClient::parse_uri("sftp://admin@myserver.com/home/admin", None, None).unwrap();
        assert_eq!(p2.host, "myserver.com");
        assert_eq!(p2.port, 22);
        assert_eq!(p2.user, "admin");
        assert_eq!(p2.password, None);
        assert_eq!(p2.remote_path, "/home/admin");

        let p3 = SftpClient::parse_uri("sftp://user%40boop:p%40ss%3Aword@nas.local/data", None, None).unwrap();
        assert_eq!(p3.user, "user@boop");
        assert_eq!(p3.password.as_deref(), Some("p@ss:word"));
        assert_eq!(p3.host, "nas.local");
        assert_eq!(p3.remote_path, "/data");
    }
}
