use crate::tools::deltacopy::{DeltaCopyEngine, DeltaCopyOptions};
use crate::tools::tasks::TaskManager;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Instant, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOptions {
    pub mode: String, // "mirror_left_to_right", "mirror_right_to_left", "bidirectional_newer", "mirror", "update"
    pub dry_run: bool,
    pub verify_checksum: bool,
    pub delete_orphans: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncFileItem {
    pub rel_path: String,
    pub filename: String,
    pub status: String, // "left_only", "right_only", "identical", "modified_newer_left", "modified_newer_right", "size_conflict"
    pub src_size: u64,
    pub dest_size: u64,
    pub src_size_formatted: String,
    pub dest_size_formatted: String,
    pub src_mtime: u64,
    pub dest_mtime: u64,
    pub suggested_action: String, // "copy_right", "copy_left", "delete_right", "delete_left", "identical"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAnalysis {
    pub source_dir: String,
    pub dest_dir: String,
    pub mode: String,
    pub to_copy: Vec<String>,
    pub to_update: Vec<String>,
    pub to_delete: Vec<String>,
    pub identical_count: usize,
    pub left_only_count: usize,
    pub right_only_count: usize,
    pub modified_count: usize,
    pub total_transfer_bytes: u64,
    pub files: Vec<SyncFileItem>,
}

pub struct DirectorySyncEngine;

impl DirectorySyncEngine {
    pub fn analyze(source: &str, destination: &str, options: &SyncOptions) -> Result<SyncAnalysis, String> {
        let src_path = Path::new(source);
        let dest_path = Path::new(destination);

        if !src_path.exists() || !src_path.is_dir() {
            return Err(format!("Source directory does not exist: {}", source));
        }

        let mut to_copy = Vec::new();
        let mut to_update = Vec::new();
        let mut to_delete = Vec::new();
        let mut identical_count = 0;
        let mut left_only_count = 0;
        let mut right_only_count = 0;
        let mut modified_count = 0;
        let mut total_transfer_bytes = 0u64;
        let mut files = Vec::new();

        let mut src_rel_set: HashSet<PathBuf> = HashSet::new();

        // 1. Scan Source Files
        for entry in WalkDir::new(src_path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let rel = entry.path().strip_prefix(src_path).unwrap().to_path_buf();
                src_rel_set.insert(rel.clone());

                let target_file = dest_path.join(&rel);
                let src_meta = entry.metadata().ok();
                let src_size = src_meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let src_mtime = src_meta.as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                let filename = entry.file_name().to_string_lossy().to_string();
                let rel_str = rel.to_string_lossy().to_string();

                if !target_file.exists() {
                    to_copy.push(rel_str.clone());
                    left_only_count += 1;
                    total_transfer_bytes += src_size;

                    files.push(SyncFileItem {
                        rel_path: rel_str,
                        filename,
                        status: "left_only".to_string(),
                        src_size,
                        dest_size: 0,
                        src_size_formatted: format_size(src_size),
                        dest_size_formatted: "-".to_string(),
                        src_mtime,
                        dest_mtime: 0,
                        suggested_action: "copy_right".to_string(),
                    });
                } else {
                    let dest_meta = target_file.metadata().ok();
                    let dest_size = dest_meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    let dest_mtime = dest_meta.as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    let is_identical = src_size == dest_size && src_mtime.abs_diff(dest_mtime) < 2;

                    if is_identical {
                        identical_count += 1;
                        files.push(SyncFileItem {
                            rel_path: rel_str,
                            filename,
                            status: "identical".to_string(),
                            src_size,
                            dest_size,
                            src_size_formatted: format_size(src_size),
                            dest_size_formatted: format_size(dest_size),
                            src_mtime,
                            dest_mtime,
                            suggested_action: "identical".to_string(),
                        });
                    } else {
                        modified_count += 1;
                        to_update.push(rel_str.clone());
                        total_transfer_bytes += src_size;

                        let status = if src_mtime > dest_mtime {
                            "modified_newer_left"
                        } else if dest_mtime > src_mtime {
                            "modified_newer_right"
                        } else {
                            "size_conflict"
                        };

                        let suggested_action = if status == "modified_newer_right" && options.mode == "bidirectional_newer" {
                            "copy_left"
                        } else {
                            "copy_right"
                        };

                        files.push(SyncFileItem {
                            rel_path: rel_str,
                            filename,
                            status: status.to_string(),
                            src_size,
                            dest_size,
                            src_size_formatted: format_size(src_size),
                            dest_size_formatted: format_size(dest_size),
                            src_mtime,
                            dest_mtime,
                            suggested_action: suggested_action.to_string(),
                        });
                    }
                }
            }
        }

        // 2. Scan Destination for Right-Only Files
        if dest_path.exists() && dest_path.is_dir() {
            for entry in WalkDir::new(dest_path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let rel = entry.path().strip_prefix(dest_path).unwrap().to_path_buf();
                    if !src_rel_set.contains(&rel) {
                        let rel_str = rel.to_string_lossy().to_string();
                        let filename = entry.file_name().to_string_lossy().to_string();
                        let dest_meta = entry.metadata().ok();
                        let dest_size = dest_meta.as_ref().map(|m| m.len()).unwrap_or(0);
                        let dest_mtime = dest_meta.as_ref()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);

                        right_only_count += 1;
                        to_delete.push(rel_str.clone());

                        let suggested_action = if options.mode == "bidirectional_newer" {
                            "copy_left"
                        } else if options.mode == "mirror_right_to_left" {
                            "copy_left"
                        } else if options.mode == "mirror_left_to_right" || options.delete_orphans {
                            "delete_right"
                        } else {
                            "skip"
                        };

                        files.push(SyncFileItem {
                            rel_path: rel_str,
                            filename,
                            status: "right_only".to_string(),
                            src_size: 0,
                            dest_size,
                            src_size_formatted: "-".to_string(),
                            dest_size_formatted: format_size(dest_size),
                            src_mtime: 0,
                            dest_mtime,
                            suggested_action: suggested_action.to_string(),
                        });
                    }
                }
            }
        }

        files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

        Ok(SyncAnalysis {
            source_dir: source.to_string(),
            dest_dir: destination.to_string(),
            mode: options.mode.clone(),
            to_copy,
            to_update,
            to_delete,
            identical_count,
            left_only_count,
            right_only_count,
            modified_count,
            total_transfer_bytes,
            files,
        })
    }

    pub async fn execute_sync(
        task_manager: Arc<TaskManager>,
        source: &str,
        destination: &str,
        options: SyncOptions,
    ) -> Result<serde_json::Value, String> {
        let analysis = Self::analyze(source, destination, &options)?;

        if options.dry_run {
            return Ok(serde_json::to_value(&analysis).map_err(|e| e.to_string())?);
        }

        let start = Instant::now();

        // 1. Delete orphan files if required by mirror mode
        let mut deleted_count = 0;
        let dest_p = Path::new(destination);
        if options.mode == "mirror_left_to_right" || options.mode == "mirror" || options.delete_orphans {
            for rel in &analysis.to_delete {
                let p = dest_p.join(rel);
                if fs::remove_file(&p).is_ok() {
                    deleted_count += 1;
                }
            }
        }

        // 2. Perform DeltaCopy of new/updated files
        let delta_opts = DeltaCopyOptions {
            overwrite_mode: if options.mode.contains("mirror") { "delta_mtime_size".to_string() } else { "if_newer".to_string() },
            verify_checksum: options.verify_checksum,
            verify_algo: "crc32".to_string(),
            retry_count: 3,
            retry_delay_ms: 500,
            resume_partial: true,
            preserve_timestamps: true,
            preserve_permissions: true,
            delete_orphans: false,
        };

        let copy_sources = vec![source.to_string()];
        let cancel_token = Arc::new(AtomicBool::new(false));

        let copy_stats = DeltaCopyEngine::run_deltacopy(
            task_manager,
            copy_sources,
            destination.to_string(),
            delta_opts,
            cancel_token,
        ).await?;

        let duration_ms = start.elapsed().as_millis();

        Ok(serde_json::json!({
            "success": true,
            "copied": copy_stats.files_copied,
            "skipped": copy_stats.files_skipped,
            "deleted": deleted_count,
            "verified": copy_stats.verified_count,
            "duration_ms": duration_ms,
        }))
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
