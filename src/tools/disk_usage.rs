use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};
use walkdir::WalkDir;

const MAX_TOP_FILES: usize = 20;

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
    pub scan_duration_ms: u64,
    pub items: Vec<DiskUsageItem>,
    pub largest_files: Vec<DiskUsageItem>,
}

pub struct DiskUsageEngine;

struct SubScanResult {
    item: DiskUsageItem,
    top_files: Vec<DiskUsageItem>,
}

fn push_top_file(list: &mut Vec<DiskUsageItem>, item: DiskUsageItem) {
    if list.len() < MAX_TOP_FILES {
        list.push(item);
        list.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    } else if item.size_bytes > list.last().map(|x| x.size_bytes).unwrap_or(0) {
        list.pop();
        list.push(item);
        list.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    }
}

fn merge_top_files(a: &mut Vec<DiskUsageItem>, b: Vec<DiskUsageItem>) {
    for item in b {
        push_top_file(a, item);
    }
}

fn scan_subdir(dir_path: &Path, name: String, mtime: u64) -> SubScanResult {
    let mut size_bytes = 0u64;
    let mut file_count = 0usize;
    let mut dir_count = 1usize; // count this folder
    let mut top_files = Vec::with_capacity(MAX_TOP_FILES);

    for entry in WalkDir::new(dir_path)
        .follow_links(false)
        .max_depth(40)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                let fsize = meta.len();
                size_bytes += fsize;
                file_count += 1;

                let sub_mtime = meta
                    .modified()
                    .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                    .unwrap_or(0);

                push_top_file(
                    &mut top_files,
                    DiskUsageItem {
                        name: entry.file_name().to_string_lossy().to_string(),
                        path: entry.path().to_string_lossy().to_string(),
                        is_dir: false,
                        size_bytes: fsize,
                        formatted_size: format_size(fsize),
                        percentage: 0.0,
                        file_count: 1,
                        dir_count: 0,
                        last_modified: sub_mtime,
                    },
                );
            } else if meta.is_dir() && entry.path() != dir_path {
                dir_count += 1;
            }
        }
    }

    SubScanResult {
        item: DiskUsageItem {
            name,
            path: dir_path.to_string_lossy().to_string(),
            is_dir: true,
            size_bytes,
            formatted_size: format_size(size_bytes),
            percentage: 0.0,
            file_count,
            dir_count,
            last_modified: mtime,
        },
        top_files,
    }
}

impl DiskUsageEngine {
    pub fn analyze(path_str: &str) -> Result<DiskUsageReport, String> {
        let start = Instant::now();
        let root = Path::new(path_str);
        if !root.exists() {
            return Err(format!("Path does not exist: {}", path_str));
        }

        // Single file target
        if root.is_file() {
            let meta = fs::metadata(root).map_err(|e| format!("Failed to read metadata: {}", e))?;
            let size = meta.len();
            let mtime = meta
                .modified()
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                .unwrap_or(0);
            let name = root.file_name().unwrap_or_default().to_string_lossy().to_string();

            let item = DiskUsageItem {
                name: name.clone(),
                path: root.to_string_lossy().to_string(),
                is_dir: false,
                size_bytes: size,
                formatted_size: format_size(size),
                percentage: 100.0,
                file_count: 1,
                dir_count: 0,
                last_modified: mtime,
            };

            return Ok(DiskUsageReport {
                root_path: path_str.to_string(),
                total_bytes: size,
                formatted_total: format_size(size),
                total_files: 1,
                total_dirs: 0,
                scan_duration_ms: start.elapsed().as_millis() as u64,
                items: vec![item.clone()],
                largest_files: vec![item],
            });
        }

        let read_dir = fs::read_dir(root).map_err(|e| format!("Failed to read directory: {}", e))?;
        let mut dir_entries: Vec<(PathBuf, String, u64)> = Vec::new();
        let mut file_entries: Vec<(PathBuf, String, u64, u64)> = Vec::new();

        for entry in read_dir.filter_map(|e| e.ok()) {
            let p = entry.path();
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            let is_dir = p.is_dir();

            let last_modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
                .unwrap_or(0);

            if is_dir {
                dir_entries.push((p, name, last_modified));
            } else if let Ok(meta) = entry.metadata() {
                file_entries.push((p, name, last_modified, meta.len()));
            }
        }

        // Parallel scan across immediate subdirectories using Rayon
        let dir_results: Vec<SubScanResult> = dir_entries
            .into_par_iter()
            .map(|(path, name, mtime)| scan_subdir(&path, name, mtime))
            .collect();

        let mut total_bytes = 0u64;
        let mut total_files = 0usize;
        let mut total_dirs = 0usize;
        let mut items = Vec::new();
        let mut largest_files: Vec<DiskUsageItem> = Vec::with_capacity(MAX_TOP_FILES);

        // Process file entries
        for (path, name, mtime, size) in file_entries {
            total_bytes += size;
            total_files += 1;

            let item = DiskUsageItem {
                name: name.clone(),
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                size_bytes: size,
                formatted_size: format_size(size),
                percentage: 0.0,
                file_count: 1,
                dir_count: 0,
                last_modified: mtime,
            };

            push_top_file(&mut largest_files, item.clone());
            items.push(item);
        }

        // Process parallel directory results
        for res in dir_results {
            total_bytes += res.item.size_bytes;
            total_files += res.item.file_count;
            total_dirs += res.item.dir_count;

            merge_top_files(&mut largest_files, res.top_files);
            items.push(res.item);
        }

        // Calculate percentages
        for item in &mut items {
            item.percentage = if total_bytes > 0 {
                (item.size_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
        }

        for item in &mut largest_files {
            item.percentage = if total_bytes > 0 {
                (item.size_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
        }

        // Sort items by size descending
        items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        largest_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

        Ok(DiskUsageReport {
            root_path: path_str.to_string(),
            total_bytes,
            formatted_total: format_size(total_bytes),
            total_files,
            total_dirs,
            scan_duration_ms: start.elapsed().as_millis() as u64,
            items,
            largest_files,
        })
    }
}

pub fn format_size(bytes: u64) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_disk_usage_scan_and_report() {
        let temp = tempdir().unwrap();
        let base_path = temp.path();

        // Create file in root
        let file1_path = base_path.join("file1.txt");
        let mut file1 = File::create(&file1_path).unwrap();
        file1.write_all(b"Hello, 12345!").unwrap(); // 13 bytes

        // Create subdir with files
        let sub_dir = base_path.join("sub_dir");
        fs::create_dir(&sub_dir).unwrap();

        let file2_path = sub_dir.join("file2.bin");
        let mut file2 = File::create(&file2_path).unwrap();
        file2.write_all(&vec![0u8; 100]).unwrap(); // 100 bytes

        let report = DiskUsageEngine::analyze(base_path.to_str().unwrap()).unwrap();

        assert_eq!(report.total_bytes, 113);
        assert_eq!(report.total_files, 2);
        assert_eq!(report.total_dirs, 1);
        assert_eq!(report.items.len(), 2);

        // Subdir should be 100 bytes
        let dir_item = report.items.iter().find(|i| i.name == "sub_dir").unwrap();
        assert_eq!(dir_item.size_bytes, 100);
        assert!(dir_item.is_dir);

        // File1 should be 13 bytes
        let file_item = report.items.iter().find(|i| i.name == "file1.txt").unwrap();
        assert_eq!(file_item.size_bytes, 13);
        assert!(!file_item.is_dir);

        // Largest files should have both files
        assert_eq!(report.largest_files.len(), 2);
        assert_eq!(report.largest_files[0].name, "file2.bin");
        assert_eq!(report.largest_files[0].size_bytes, 100);
    }

    #[test]
    fn test_disk_usage_single_file() {
        let temp = tempdir().unwrap();
        let file_path = temp.path().join("single.txt");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"CommanderDog").unwrap(); // 12 bytes

        let report = DiskUsageEngine::analyze(file_path.to_str().unwrap()).unwrap();
        assert_eq!(report.total_bytes, 12);
        assert_eq!(report.total_files, 1);
        assert_eq!(report.total_dirs, 0);
        assert_eq!(report.items.len(), 1);
        assert_eq!(report.items[0].percentage, 100.0);
    }

    #[test]
    fn test_disk_usage_nonexistent() {
        let res = DiskUsageEngine::analyze("/path/that/definitely/does/not/exist_12345");
        assert!(res.is_err());
    }
}
