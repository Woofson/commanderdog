use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskUsageItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub formatted_size: String,
    pub percentage: f64,
    pub file_count: usize,
    pub dir_count: usize,
    pub last_modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskUsageReport {
    pub root_path: String,
    pub total_bytes: u64,
    pub formatted_total: String,
    pub total_files: usize,
    pub total_dirs: usize,
    pub items: Vec<DiskUsageItem>,
    pub largest_files: Vec<DiskUsageItem>,
}

pub struct DiskUsageEngine;

impl DiskUsageEngine {
    pub fn analyze(path_str: &str) -> Result<DiskUsageReport, String> {
        let root = Path::new(path_str);
        if !root.exists() {
            return Err(format!("Path does not exist: {}", path_str));
        }

        let mut total_bytes = 0u64;
        let mut total_files = 0usize;
        let mut total_dirs = 0usize;
        let mut largest_files: Vec<DiskUsageItem> = Vec::new();

        let read_dir = fs::read_dir(root).map_err(|e| format!("Failed to read directory: {}", e))?;
        let mut items = Vec::new();

        for entry in read_dir.filter_map(|e| e.ok()) {
            let p = entry.path();
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            let is_dir = p.is_dir();
            let mut size_bytes = 0u64;
            let mut file_count = 0usize;
            let mut dir_count = 0usize;

            let last_modified = entry.metadata()
                .and_then(|m| m.modified())
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                .unwrap_or(0);

            if is_dir {
                dir_count += 1;
                total_dirs += 1;
                for sub in WalkDir::new(&p).into_iter().filter_map(|e| e.ok()) {
                    if let Ok(meta) = sub.metadata() {
                        if meta.is_file() {
                            let fsize = meta.len();
                            size_bytes += fsize;
                            file_count += 1;
                            total_files += 1;
                            total_bytes += fsize;

                            let sub_mtime = meta.modified()
                                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                                .unwrap_or(0);

                            largest_files.push(DiskUsageItem {
                                name: sub.file_name().to_string_lossy().to_string(),
                                path: sub.path().to_string_lossy().to_string(),
                                is_dir: false,
                                size_bytes: fsize,
                                formatted_size: format_size(fsize),
                                percentage: 0.0,
                                file_count: 1,
                                dir_count: 0,
                                last_modified: sub_mtime,
                            });
                        } else if meta.is_dir() && sub.path() != p {
                            dir_count += 1;
                            total_dirs += 1;
                        }
                    }
                }
            } else if let Ok(meta) = entry.metadata() {
                size_bytes = meta.len();
                file_count = 1;
                total_files += 1;
                total_bytes += size_bytes;

                largest_files.push(DiskUsageItem {
                    name: name.clone(),
                    path: p.to_string_lossy().to_string(),
                    is_dir: false,
                    size_bytes,
                    formatted_size: format_size(size_bytes),
                    percentage: 0.0,
                    file_count: 1,
                    dir_count: 0,
                    last_modified,
                });
            }

            items.push(DiskUsageItem {
                name,
                path: p.to_string_lossy().to_string(),
                is_dir,
                size_bytes,
                formatted_size: format_size(size_bytes),
                percentage: 0.0,
                file_count,
                dir_count,
                last_modified,
            });
        }

        for item in &mut items {
            item.percentage = if total_bytes > 0 {
                (item.size_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
        }

        items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

        largest_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        largest_files.truncate(20);
        for item in &mut largest_files {
            item.percentage = if total_bytes > 0 {
                (item.size_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
        }

        Ok(DiskUsageReport {
            root_path: path_str.to_string(),
            total_bytes,
            formatted_total: format_size(total_bytes),
            total_files,
            total_dirs,
            items,
            largest_files,
        })
    }
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
