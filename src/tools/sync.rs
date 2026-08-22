use crate::tools::deltacopy::{DeltaCopyEngine, DeltaCopyOptions};
use crate::tools::tasks::TaskManager;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOptions {
    pub mode: String, // "mirror", "update", "bidirectional"
    pub dry_run: bool,
    pub verify_checksum: bool,
    pub delete_orphans: bool,
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
    pub total_transfer_bytes: u64,
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
        let mut total_transfer_bytes = 0u64;

        let mut src_rel_set: HashSet<PathBuf> = HashSet::new();

        // Scan source
        for entry in WalkDir::new(src_path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let rel = entry.path().strip_prefix(src_path).unwrap().to_path_buf();
                src_rel_set.insert(rel.clone());

                let target_file = dest_path.join(&rel);
                let src_meta = entry.metadata().ok();
                let src_size = src_meta.as_ref().map(|m| m.len()).unwrap_or(0);

                if !target_file.exists() {
                    to_copy.push(rel.to_string_lossy().to_string());
                    total_transfer_bytes += src_size;
                } else {
                    let dest_meta = target_file.metadata().ok();
                    let _dest_size = dest_meta.as_ref().map(|m| m.len()).unwrap_or(0);

                    let is_modified = if let (Some(sm), Some(dm)) = (src_meta, dest_meta) {
                        if sm.len() != dm.len() {
                            true
                        } else if let (Ok(st), Ok(dt)) = (sm.modified(), dm.modified()) {
                            let diff = if st > dt {
                                st.duration_since(dt).unwrap_or_default()
                            } else {
                                dt.duration_since(st).unwrap_or_default()
                            };
                            diff.as_secs() >= 2
                        } else {
                            false
                        }
                    } else {
                        true
                    };

                    if is_modified {
                        to_update.push(rel.to_string_lossy().to_string());
                        total_transfer_bytes += src_size;
                    } else {
                        identical_count += 1;
                    }
                }
            }
        }

        // Check for orphans in destination if mirror or delete_orphans
        if (options.mode == "mirror" || options.delete_orphans) && dest_path.exists() {
            for entry in WalkDir::new(dest_path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let rel = entry.path().strip_prefix(dest_path).unwrap().to_path_buf();
                    if !src_rel_set.contains(&rel) {
                        to_delete.push(rel.to_string_lossy().to_string());
                    }
                }
            }
        }

        Ok(SyncAnalysis {
            source_dir: source.to_string(),
            dest_dir: destination.to_string(),
            mode: options.mode.clone(),
            to_copy,
            to_update,
            to_delete,
            identical_count,
            total_transfer_bytes,
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
        for rel in &analysis.to_delete {
            let p = dest_p.join(rel);
            if fs::remove_file(&p).is_ok() {
                deleted_count += 1;
            }
        }

        // 2. Perform DeltaCopy of new/updated files
        let delta_opts = DeltaCopyOptions {
            overwrite_mode: if options.mode == "mirror" { "delta_mtime_size".to_string() } else { "if_newer".to_string() },
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
