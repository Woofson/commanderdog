use super::{is_archive_file, DirectoryListing, FileEntry};
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::path::Path;

pub struct SftpClient;

impl SftpClient {
    fn connect(
        host: &str,
        port: u16,
        user: &str,
        pass: Option<&str>,
        key_path: Option<&str>,
    ) -> Result<Session, std::io::Error> {
        let addr = format!("{}:{}", host, port);
        let tcp = TcpStream::connect(&addr)?;
        let mut sess = Session::new()?;
        sess.set_tcp_stream(tcp);
        sess.handshake()?;

        if let Some(password) = pass {
            sess.userauth_password(user, password)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::PermissionDenied, e))?;
        } else if let Some(key) = key_path {
            sess.userauth_pubkey_file(user, None, Path::new(key), None)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::PermissionDenied, e))?;
        } else {
            sess.userauth_agent(user)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::PermissionDenied, e))?;
        }

        if !sess.authenticated() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "SFTP authentication failed",
            ));
        }

        Ok(sess)
    }

    pub fn list_dir(
        host: &str,
        port: u16,
        user: &str,
        pass: Option<&str>,
        remote_path: &str,
    ) -> Result<DirectoryListing, std::io::Error> {
        let sess = Self::connect(host, port, user, pass, None)?;
        let sftp = sess.sftp().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        let path = if remote_path.is_empty() { "/" } else { remote_path };
        let entries_raw = sftp.readdir(Path::new(path))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

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

            entries.push(FileEntry {
                name: name.clone(),
                path: format!("sftp://{}@{}:{}{}", user, host, port, full_path),
                is_dir,
                is_symlink: false,
                is_empty: None,
                size,
                modified,
                permissions,
                mode_octal,
                owner: user.to_string(),
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
            format!("sftp://{}@{}:{}{}", user, host, port, if p_str.is_empty() { "/" } else { &p_str })
        });

        Ok(DirectoryListing {
            current_path: format!("sftp://{}@{}:{}{}", user, host, port, path),
            parent_path,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "sftp".to_string(),
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
        let sess = Self::connect(host, port, user, pass, None)?;
        let sftp = sess.sftp().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let mut file = sftp.open(Path::new(remote_path))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        let mut buffer = Vec::new();
        if max_bytes > 0 {
            let mut handle = (&mut file).take(max_bytes as u64);
            handle.read_to_end(&mut buffer)?;
        } else {
            file.read_to_end(&mut buffer)?;
        }

        Ok(buffer)
    }

    pub fn parse_uri(uri: &str, default_user: Option<&str>, default_pass: Option<&str>) -> Result<SftpParams, String> {
        let clean = uri.strip_prefix("sftp://").ok_or_else(|| "Invalid SFTP URI".to_string())?;
        let (auth_part, host_and_path) = if let Some(at) = clean.find('@') {
            (&clean[..at], &clean[at + 1..])
        } else {
            ("", clean)
        };

        let mut user = default_user.unwrap_or("root").to_string();
        let mut password = default_pass.map(|s| s.to_string());

        if !auth_part.is_empty() {
            if let Some(colon) = auth_part.find(':') {
                user = auth_part[..colon].to_string();
                password = Some(auth_part[colon + 1..].to_string());
            } else {
                user = auth_part.to_string();
            }
        }

        let (host_port, remote_path) = if let Some(slash) = host_and_path.find('/') {
            (&host_and_path[..slash], &host_and_path[slash..])
        } else {
            (host_and_path, "/")
        };

        let (host, port) = if let Some(colon) = host_port.find(':') {
            let h = &host_port[..colon];
            let p = host_port[colon + 1..].parse::<u16>().unwrap_or(22);
            (h.to_string(), p)
        } else {
            (host_port.to_string(), 22)
        };

        Ok(SftpParams {
            host,
            port,
            user,
            password,
            remote_path: remote_path.to_string(),
        })
    }

    pub fn download_to_file(params: &SftpParams, local_dest: &Path) -> Result<(), String> {
        let sess = Self::connect(&params.host, params.port, &params.user, params.password.as_deref(), None)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let mut remote_file = sftp.open(Path::new(&params.remote_path))
            .map_err(|e| format!("SFTP open error for {}: {}", params.remote_path, e))?;
        let mut local_file = std::fs::File::create(local_dest)
            .map_err(|e| format!("Failed to create local file {}: {}", local_dest.display(), e))?;
        std::io::copy(&mut remote_file, &mut local_file)
            .map_err(|e| format!("SFTP download stream error: {}", e))?;
        Ok(())
    }

    pub fn upload_from_file(params: &SftpParams, local_src: &Path) -> Result<(), String> {
        let sess = Self::connect(&params.host, params.port, &params.user, params.password.as_deref(), None)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        let mut remote_file = sftp.create(Path::new(&params.remote_path))
            .map_err(|e| format!("SFTP create remote file error for {}: {}", params.remote_path, e))?;
        let mut local_file = std::fs::File::open(local_src)
            .map_err(|e| format!("Failed to open local source {}: {}", local_src.display(), e))?;
        std::io::copy(&mut local_file, &mut remote_file)
            .map_err(|e| format!("SFTP upload stream error: {}", e))?;
        Ok(())
    }

    pub fn mkdir(params: &SftpParams) -> Result<(), String> {
        let sess = Self::connect(&params.host, params.port, &params.user, params.password.as_deref(), None)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        sftp.mkdir(Path::new(&params.remote_path), 0o755)
            .map_err(|e| format!("SFTP mkdir error: {}", e))?;
        Ok(())
    }

    pub fn rename(params: &SftpParams, new_remote_path: &str) -> Result<(), String> {
        let sess = Self::connect(&params.host, params.port, &params.user, params.password.as_deref(), None)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        sftp.rename(Path::new(&params.remote_path), Path::new(new_remote_path), None)
            .map_err(|e| format!("SFTP rename error: {}", e))?;
        Ok(())
    }

    pub fn delete(params: &SftpParams, is_dir: bool) -> Result<(), String> {
        let sess = Self::connect(&params.host, params.port, &params.user, params.password.as_deref(), None)
            .map_err(|e| format!("SFTP connect error: {}", e))?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP session error: {}", e))?;
        if is_dir {
            sftp.rmdir(Path::new(&params.remote_path))
                .map_err(|e| format!("SFTP rmdir error: {}", e))?;
        } else {
            sftp.unlink(Path::new(&params.remote_path))
                .map_err(|e| format!("SFTP unlink error: {}", e))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct SftpParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub remote_path: String,
}
