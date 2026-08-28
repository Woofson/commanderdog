use super::{is_archive_file, DirectoryListing, FileContentResponse, FileEntry};
use crate::vfs::checksum::calculate_sha256;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tracing::info;

pub struct LocalFs;

impl LocalFs {
    /// Helper to get cached user and group name lookups
    fn get_user_group_maps() -> (HashMap<u32, String>, HashMap<u32, String>) {
        let mut users = HashMap::new();
        let mut groups = HashMap::new();

        if let Ok(passwd) = fs::read_to_string("/etc/passwd") {
            for line in passwd.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 3 {
                    if let Ok(uid) = parts[2].parse::<u32>() {
                        users.insert(uid, parts[0].to_string());
                    }
                }
            }
        }

        if let Ok(group_file) = fs::read_to_string("/etc/group") {
            for line in group_file.lines() {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 3 {
                    if let Ok(gid) = parts[2].parse::<u32>() {
                        groups.insert(gid, parts[0].to_string());
                    }
                }
            }
        }

        (users, groups)
    }

    fn mode_to_symbolic(mode: u32, is_dir: bool) -> String {
        let mut s = String::with_capacity(10);
        s.push(if is_dir { 'd' } else { '-' });
        s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
        s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
        s.push(if mode & 0o100 != 0 { 'x' } else { '-' });
        s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
        s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
        s.push(if mode & 0o010 != 0 { 'x' } else { '-' });
        s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
        s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
        s.push(if mode & 0o001 != 0 { 'x' } else { '-' });
        s
    }

    pub fn resolve_local_path(p: &str) -> PathBuf {
        if p == "~" {
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"))
        } else if let Some(stripped) = p.strip_prefix("~/") {
            if let Some(home) = dirs::home_dir() {
                home.join(stripped)
            } else {
                PathBuf::from(p)
            }
        } else {
            PathBuf::from(p)
        }
    }

    pub fn list_dir(path_str: &str, show_hidden: bool) -> Result<DirectoryListing, std::io::Error> {
        let path = Self::resolve_local_path(path_str);
        if !path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Directory not found: {}", path_str),
            ));
        }

        let canonical = path.canonicalize()?;
        let canonical_str = canonical.to_string_lossy().to_string();
        let parent_path = canonical.parent().map(|p| p.to_string_lossy().to_string());

        let (user_map, group_map) = Self::get_user_group_maps();

        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_size = 0u64;

        if canonical.is_dir() {
            let read_dir = fs::read_dir(&canonical)?;
            for entry_res in read_dir {
                if let Ok(entry) = entry_res {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if !show_hidden && file_name.starts_with('.') {
                        continue;
                    }

                    let file_path = entry.path();
                    let file_path_str = file_path.to_string_lossy().to_string();

                    let metadata = entry.metadata().ok();
                    let is_dir = metadata.as_ref().map_or(false, |m| m.is_dir());
                    let is_symlink = metadata.as_ref().map_or(false, |m| m.file_type().is_symlink());
                    let size = metadata.as_ref().map_or(0, |m| m.len());
                    let modified = metadata.as_ref().and_then(|m| {
                        m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()))
                    });

                    let raw_mode = metadata.as_ref().map(|m| m.mode()).unwrap_or(0o644);
                    let mode_octal = format!("{:04o}", raw_mode & 0o7777);
                    let permissions = Self::mode_to_symbolic(raw_mode, is_dir);

                    let uid = metadata.as_ref().map(|m| m.uid()).unwrap_or(1000);
                    let gid = metadata.as_ref().map(|m| m.gid()).unwrap_or(1000);

                    let owner = user_map.get(&uid).cloned().unwrap_or_else(|| uid.to_string());
                    let group = group_map.get(&gid).cloned().unwrap_or_else(|| gid.to_string());

                    let mime = if is_dir {
                        None
                    } else {
                        Some(mime_guess::from_path(&file_path).first_or_octet_stream().to_string())
                    };

                    let is_archive = !is_dir && is_archive_file(&file_name);
                    let is_empty = if is_dir {
                        std::fs::read_dir(&file_path).map(|mut r| r.next().is_none()).ok()
                    } else {
                        None
                    };

                    if is_dir {
                        total_dirs += 1;
                    } else {
                        total_files += 1;
                        total_size += size;
                    }

                    entries.push(FileEntry {
                        name: file_name,
                        path: file_path_str,
                        is_dir,
                        is_symlink,
                        is_empty,
                        size,
                        modified,
                        permissions,
                        mode_octal,
                        owner,
                        group,
                        uid,
                        gid,
                        mime_type: mime,
                        is_archive,
                    });
                }
            }
        }

        // Sort: directories first (alphabetical), then files (alphabetical)
        entries.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        Ok(DirectoryListing {
            current_path: canonical_str,
            parent_path,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "local".to_string(),
        })
    }

    /// Recursively flattens directory tree into a branch view
    pub fn list_branch_view(path_str: &str, show_hidden: bool, max_depth: Option<usize>) -> Result<DirectoryListing, std::io::Error> {
        let path = Self::resolve_local_path(path_str);
        if !path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Directory not found: {}", path_str),
            ));
        }

        let canonical = path.canonicalize()?;
        let canonical_str = canonical.to_string_lossy().to_string();
        let parent_path = canonical.parent().map(|p| p.to_string_lossy().to_string());

        let (user_map, group_map) = Self::get_user_group_maps();

        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_size = 0u64;

        let mut walker = walkdir::WalkDir::new(&canonical);
        if let Some(depth) = max_depth {
            walker = walker.max_depth(depth);
        }

        for entry_res in walker.into_iter().filter_map(|e| e.ok()) {
            if entry_res.path() == canonical {
                continue;
            }

            let file_name = entry_res.file_name().to_string_lossy().to_string();
            if !show_hidden && file_name.starts_with('.') {
                continue;
            }

            let rel_path = entry_res.path().strip_prefix(&canonical)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| file_name.clone());

            let file_path = entry_res.path();
            let file_path_str = file_path.to_string_lossy().to_string();

            let metadata = entry_res.metadata().ok();
            let is_dir = metadata.as_ref().map_or(false, |m| m.is_dir());
            let is_symlink = metadata.as_ref().map_or(false, |m| m.file_type().is_symlink());
            let size = metadata.as_ref().map_or(0, |m| m.len());
            let modified = metadata.as_ref().and_then(|m| {
                m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()))
            });

            let raw_mode = metadata.as_ref().map(|m| m.mode()).unwrap_or(0o644);
            let mode_octal = format!("{:04o}", raw_mode & 0o7777);
            let permissions = Self::mode_to_symbolic(raw_mode, is_dir);

            let uid = metadata.as_ref().map(|m| m.uid()).unwrap_or(1000);
            let gid = metadata.as_ref().map(|m| m.gid()).unwrap_or(1000);
            let owner = user_map.get(&uid).cloned().unwrap_or_else(|| uid.to_string());
            let group = group_map.get(&gid).cloned().unwrap_or_else(|| gid.to_string());

            let mime = if !is_dir {
                mime_guess::from_path(file_path).first_raw().map(|s| s.to_string())
            } else {
                None
            };

            let is_archive = !is_dir && is_archive_file(&file_name);
            let is_empty = if is_dir {
                std::fs::read_dir(&file_path).map(|mut r| r.next().is_none()).ok()
            } else {
                None
            };

            if is_dir {
                total_dirs += 1;
            } else {
                total_files += 1;
                total_size += size;
            }

            entries.push(FileEntry {
                name: rel_path,
                path: file_path_str,
                is_dir,
                is_symlink,
                is_empty,
                size,
                modified,
                permissions,
                mode_octal,
                owner,
                group,
                uid,
                gid,
                mime_type: mime,
                is_archive,
            });
        }

        // Sort: directories first (alphabetical), then files (alphabetical)
        entries.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        Ok(DirectoryListing {
            current_path: canonical_str,
            parent_path,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "branch".to_string(),
        })
    }

    pub fn chmod_entry(path_str: &str, mode: u32, recursive: bool) -> Result<(), std::io::Error> {
        let p = Self::resolve_local_path(path_str);
        if !p.exists() {
            return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Path not found"));
        }

        if recursive && p.is_dir() {
            for entry in walkdir::WalkDir::new(&p).into_iter().filter_map(|e| e.ok()) {
                fs::set_permissions(entry.path(), fs::Permissions::from_mode(mode))?;
            }
            Ok(())
        } else {
            fs::set_permissions(&p, fs::Permissions::from_mode(mode))
        }
    }

    pub fn chown_entry(path_str: &str, uid: Option<u32>, gid: Option<u32>, recursive: bool) -> Result<(), std::io::Error> {
        use std::os::unix::fs::chown;
        let p = Self::resolve_local_path(path_str);
        if !p.exists() {
            return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Path not found"));
        }

        if recursive && p.is_dir() {
            for entry in walkdir::WalkDir::new(&p).into_iter().filter_map(|e| e.ok()) {
                chown(entry.path(), uid, gid)?;
            }
            Ok(())
        } else {
            chown(&p, uid, gid)
        }
    }

    pub fn read_file(path_str: &str, max_bytes: usize) -> Result<FileContentResponse, std::io::Error> {
        let path = Self::resolve_local_path(path_str);
        if !path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("File not found: {}", path_str),
            ));
        }

        let metadata = fs::metadata(&path)?;
        let size = metadata.len();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let mime_type = mime_guess::from_path(&path).first_or_octet_stream().to_string();

        let mut file = File::open(&path)?;
        let mut buffer = Vec::new();
        let bytes_to_read = if max_bytes > 0 {
            std::cmp::min(size as usize, max_bytes)
        } else {
            size as usize
        };

        buffer.resize(bytes_to_read, 0);
        let actual_read = file.read(&mut buffer)?;
        buffer.truncate(actual_read);

        // Check if content is valid UTF-8
        match String::from_utf8(buffer.clone()) {
            Ok(text) => Ok(FileContentResponse {
                path: path_str.to_string(),
                name,
                content: text,
                is_binary: false,
                size,
                mime_type,
            }),
            Err(_) => {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
                Ok(FileContentResponse {
                    path: path_str.to_string(),
                    name,
                    content: b64,
                    is_binary: true,
                    size,
                    mime_type,
                })
            }
        }
    }

    pub fn write_file(path_str: &str, content: &[u8], atomic: bool) -> Result<(), std::io::Error> {
        let target_path = Self::resolve_local_path(path_str);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        if atomic {
            let temp_path = target_path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
            {
                let mut file = File::create(&temp_path)?;
                file.write_all(content)?;
                file.sync_all()?;
            }
            fs::rename(&temp_path, &target_path)?;
        } else {
            let mut file = File::create(&target_path)?;
            file.write_all(content)?;
            file.sync_all()?;
        }

        Ok(())
    }

    pub fn create_dir(path_str: &str) -> Result<(), std::io::Error> {
        let p = Self::resolve_local_path(path_str);
        fs::create_dir_all(&p)
    }

    pub fn rename_entry(from_str: &str, to_str: &str) -> Result<(), std::io::Error> {
        let from_p = Self::resolve_local_path(from_str);
        let to_p = Self::resolve_local_path(to_str);
        fs::rename(&from_p, &to_p)
    }

    pub fn delete_entry(
        path_str: &str,
        use_trash: bool,
        custom_trash: Option<&str>,
    ) -> Result<(), std::io::Error> {
        let path = Self::resolve_local_path(path_str);
        if !path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Target not found: {}", path_str),
            ));
        }

        if use_trash {
            let trash_base = if let Some(ct) = custom_trash {
                PathBuf::from(ct)
            } else if let Some(home) = dirs::home_dir() {
                home.join(".local/share/Trash/files")
            } else {
                PathBuf::from("/tmp/commanderdog_trash")
            };

            fs::create_dir_all(&trash_base)?;
            let file_name = path.file_name().unwrap_or_default();
            let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
            let trash_target = trash_base.join(format!("{}_{}", timestamp, file_name.to_string_lossy()));

            fs::rename(path, &trash_target)?;
            info!("Moved {} to trash: {}", path_str, trash_target.display());
            Ok(())
        } else {
            if path.is_dir() {
                fs::remove_dir_all(path)
            } else {
                fs::remove_file(path)
            }
        }
    }

    pub fn copy_file_paranoid(src_str: &str, dest_str: &str, verify: bool) -> Result<(), std::io::Error> {
        let src_path = Path::new(src_str);
        let dest_path = Path::new(dest_str);

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        if src_path.is_dir() {
            fs::create_dir_all(dest_path)?;
            for entry in walkdir::WalkDir::new(src_path) {
                let entry = entry.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                let rel = entry.path().strip_prefix(src_path).unwrap();
                let target = dest_path.join(rel);

                if entry.file_type().is_dir() {
                    fs::create_dir_all(&target)?;
                } else if entry.file_type().is_file() {
                    fs::copy(entry.path(), &target)?;
                    if verify {
                        let hash_src = calculate_sha256(entry.path())?;
                        let hash_dest = calculate_sha256(&target)?;
                        if hash_src != hash_dest {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::Other,
                                format!("Integrity check failed for {}", target.display()),
                            ));
                        }
                    }
                }
            }
            Ok(())
        } else {
            fs::copy(src_path, dest_path)?;
            if verify {
                let hash_src = calculate_sha256(src_path)?;
                let hash_dest = calculate_sha256(dest_path)?;
                if hash_src != hash_dest {
                    let _ = fs::remove_file(dest_path);
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("Paranoid verify failed: Hash mismatch for {}", dest_str),
                    ));
                }
            }
            Ok(())
        }
    }
}
