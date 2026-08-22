pub mod local;
pub mod sftp;
pub mod webdav;
pub mod archive;
pub mod checksum;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>, // Unix timestamp in seconds
    pub permissions: String,   // "rwxr-xr-x"
    pub mode_octal: String,    // "0755"
    pub owner: String,         // "bolt"
    pub group: String,         // "bolt"
    pub uid: u32,
    pub gid: u32,
    pub mime_type: Option<String>,
    pub is_archive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FileEntry>,
    pub total_files: usize,
    pub total_dirs: usize,
    pub total_size: u64,
    pub protocol: String, // "local", "sftp", "webdav", "archive"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContentResponse {
    pub path: String,
    pub name: String,
    pub content: String,
    pub is_binary: bool,
    pub size: u64,
    pub mime_type: String,
}

pub fn is_archive_file(path_or_name: &str) -> bool {
    let lower = path_or_name.to_lowercase();
    lower.ends_with(".zip")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
        || lower.ends_with(".tar.bz2")
        || lower.ends_with(".tbz2")
        || lower.ends_with(".tar.xz")
        || lower.ends_with(".txz")
        || lower.ends_with(".tar")
        || lower.ends_with(".7z")
        || lower.ends_with(".rar")
}
