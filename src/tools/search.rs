use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::{Duration, SystemTime};
use walkdir::WalkDir;

#[derive(Debug, Clone, Deserialize)]
pub struct SearchRequest {
    pub path: String,
    pub name_pattern: Option<String>,
    pub content_query: Option<String>,
    pub case_sensitive: Option<bool>,
    pub min_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
    pub modified_days: Option<u32>,
    pub file_type: Option<String>,
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResultItem {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub matched_lines: Vec<String>,
}

pub struct SearchEngine;

impl SearchEngine {
    pub fn search(req: SearchRequest) -> Result<Vec<SearchResultItem>, String> {
        let root = Path::new(&req.path);
        if !root.exists() {
            return Err(format!("Search directory does not exist: {}", req.path));
        }

        let max_results = req.max_results.unwrap_or(300);
        let case_sens = req.case_sensitive.unwrap_or(false);

        let name_regex = if let Some(ref pat) = req.name_pattern {
            if !pat.is_empty() {
                let re_str = if pat.contains('*') || pat.contains('?') {
                    format!("^{}$", pat.replace('.', "\\.").replace('*', ".*").replace('?', "."))
                } else {
                    pat.clone()
                };
                RegexBuilder::new(&re_str)
                    .case_insensitive(!case_sens)
                    .build()
                    .ok()
            } else {
                None
            }
        } else {
            None
        };

        let content_regex = if let Some(ref cq) = req.content_query {
            if !cq.is_empty() {
                RegexBuilder::new(cq)
                    .case_insensitive(!case_sens)
                    .build()
                    .ok()
            } else {
                None
            }
        } else {
            None
        };

        let now = SystemTime::now();
        let max_age = req.modified_days.map(|d| Duration::from_secs(d as u64 * 86400));

        let mut results = Vec::new();

        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if results.len() >= max_results {
                break;
            }

            let file_name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().is_dir();

            // 1. File Type Filter
            if let Some(ref ftype) = req.file_type {
                match ftype.as_str() {
                    "file" if is_dir => continue,
                    "dir" if !is_dir => continue,
                    "image" if is_dir || !is_image(&file_name) => continue,
                    "code" if is_dir || !is_code(&file_name) => continue,
                    "archive" if is_dir || !is_archive(&file_name) => continue,
                    _ => {}
                }
            }

            // 2. Name Pattern Filter
            if let Some(ref re) = name_regex {
                if !re.is_match(&file_name) {
                    continue;
                }
            }

            // 3. Metadata Filters (Size & Modified)
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta.as_ref().and_then(|m| m.modified().ok());

            if let Some(min_s) = req.min_size_bytes {
                if size < min_s { continue; }
            }
            if let Some(max_s) = req.max_size_bytes {
                if size > max_s { continue; }
            }

            if let (Some(mod_time), Some(age_limit)) = (modified, max_age) {
                if let Ok(elapsed) = now.duration_since(mod_time) {
                    if elapsed > age_limit {
                        continue;
                    }
                }
            }

            // 4. Content Search (grep)
            let mut matched_lines = Vec::new();
            if let Some(ref c_re) = content_regex {
                if is_dir || size > 10_000_000 {
                    continue; // Skip directory or large binary files
                }

                if let Ok(f) = File::open(entry.path()) {
                    let reader = BufReader::new(f);
                    for (line_num, line_res) in reader.lines().enumerate() {
                        if matched_lines.len() >= 3 {
                            break;
                        }
                        if let Ok(line) = line_res {
                            if c_re.is_match(&line) {
                                matched_lines.push(format!("L{}: {}", line_num + 1, line.trim()));
                            }
                        }
                    }
                }

                if matched_lines.is_empty() {
                    continue;
                }
            }

            let timestamp = modified.and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64);

            results.push(SearchResultItem {
                path: entry.path().to_string_lossy().to_string(),
                name: file_name,
                is_dir,
                size,
                modified: timestamp,
                matched_lines,
            });
        }

        Ok(results)
    }
}

fn is_image(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".webp") || lower.ends_with(".svg") || lower.ends_with(".gif")
}

fn is_code(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".rs") || lower.ends_with(".js") || lower.ends_with(".ts") || lower.ends_with(".py") || lower.ends_with(".html") || lower.ends_with(".css") || lower.ends_with(".json") || lower.ends_with(".toml") || lower.ends_with(".sh") || lower.ends_with(".go") || lower.ends_with(".c") || lower.ends_with(".cpp")
}

fn is_archive(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".zip") || lower.ends_with(".tar.gz") || lower.ends_with(".tgz") || lower.ends_with(".tar.bz2") || lower.ends_with(".tar") || lower.ends_with(".7z")
}
