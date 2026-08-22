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
}
