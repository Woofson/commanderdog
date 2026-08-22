use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParanoidVerificationReport {
    pub source: String,
    pub destination: String,
    pub source_sha256: String,
    pub dest_sha256: String,
    pub verified: bool,
    pub file_size: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DryRunPreview {
    pub action: String, // "copy", "move", "delete"
    pub sources: Vec<String>,
    pub destination_target: Option<String>,
    pub estimated_total_bytes: u64,
    pub potential_overwrites: Vec<String>,
    pub disk_space_available_bytes: u64,
    pub safe_to_proceed: bool,
    pub warnings: Vec<String>,
}

pub struct ParanoidEngine;

impl ParanoidEngine {
    pub fn dry_run(
        action: &str,
        sources: &[String],
        dest_dir: Option<&str>,
    ) -> Result<DryRunPreview, std::io::Error> {
        let mut total_bytes = 0u64;
        let mut potential_overwrites = Vec::new();
        let mut warnings = Vec::new();

        for src in sources {
            let p = Path::new(src);
            if p.exists() {
                if let Ok(meta) = p.metadata() {
                    total_bytes += meta.len();
                }

                if let Some(dest) = dest_dir {
                    let dest_path = Path::new(dest);
                    if let Some(name) = p.file_name() {
                        let target = dest_path.join(name);
                        if target.exists() {
                            potential_overwrites.push(target.to_string_lossy().to_string());
                        }
                    }
                }
            } else {
                warnings.push(format!("Source does not exist: {}", src));
            }
        }

        let disk_space_available = 100_000_000_000u64; // Fallback ~100GB or sysinfo

        if !potential_overwrites.is_empty() {
            warnings.push(format!("{} destination files will be overwritten", potential_overwrites.len()));
        }

        let safe = warnings.is_empty() || (warnings.len() == 1 && !potential_overwrites.is_empty());

        Ok(DryRunPreview {
            action: action.to_string(),
            sources: sources.to_vec(),
            destination_target: dest_dir.map(|s| s.to_string()),
            estimated_total_bytes: total_bytes,
            potential_overwrites,
            disk_space_available_bytes: disk_space_available,
            safe_to_proceed: safe,
            warnings,
        })
    }
}
