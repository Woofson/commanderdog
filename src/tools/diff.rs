use crate::vfs::checksum::calculate_sha256;
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::fs;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub line_num_left: Option<usize>,
    pub line_num_right: Option<usize>,
    pub tag: String, // "equal", "insert", "delete"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffResult {
    pub file_left: String,
    pub file_right: String,
    pub lines: Vec<DiffLine>,
    pub additions: usize,
    pub deletions: usize,
    pub is_identical: bool,
}

pub fn compare_files_text(
    file_left_name: &str,
    text_left: &str,
    file_right_name: &str,
    text_right: &str,
) -> FileDiffResult {
    let diff = TextDiff::from_lines(text_left, text_right);
    let mut lines = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;

    let mut left_idx = 1;
    let mut right_idx = 1;

    for change in diff.iter_all_changes() {
        let (tag_str, num_l, num_r) = match change.tag() {
            ChangeTag::Equal => {
                let l = left_idx;
                let r = right_idx;
                left_idx += 1;
                right_idx += 1;
                ("equal", Some(l), Some(r))
            }
            ChangeTag::Delete => {
                let l = left_idx;
                left_idx += 1;
                deletions += 1;
                ("delete", Some(l), None)
            }
            ChangeTag::Insert => {
                let r = right_idx;
                right_idx += 1;
                additions += 1;
                ("insert", None, Some(r))
            }
        };

        lines.push(DiffLine {
            line_num_left: num_l,
            line_num_right: num_r,
            tag: tag_str.to_string(),
            content: change.value().to_string(),
        });
    }

    FileDiffResult {
        file_left: file_left_name.to_string(),
        file_right: file_right_name.to_string(),
        lines,
        additions,
        deletions,
        is_identical: additions == 0 && deletions == 0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderEntryDiff {
    pub relative_path: String,
    pub status: String, // "identical", "modified", "left_only", "right_only"
    pub is_dir: bool,
    pub size_left: Option<u64>,
    pub size_right: Option<u64>,
    pub hash_left: Option<String>,
    pub hash_right: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderDiffResult {
    pub dir_left: String,
    pub dir_right: String,
    pub total_left_entries: usize,
    pub total_right_entries: usize,
    pub identical_count: usize,
    pub modified_count: usize,
    pub left_only_count: usize,
    pub right_only_count: usize,
    pub entries: Vec<FolderEntryDiff>,
}

pub fn compare_folders(
    dir_left_str: &str,
    dir_right_str: &str,
    recursive: bool,
    deep_hash_compare: bool,
    selected_items: Option<Vec<String>>,
) -> Result<FolderDiffResult, std::io::Error> {
    let p_left = Path::new(dir_left_str);
    let p_right = Path::new(dir_right_str);

    let mut map_left: HashMap<String, (bool, u64, Option<String>)> = HashMap::new();
    let mut map_right: HashMap<String, (bool, u64, Option<String>)> = HashMap::new();

    // If specific selected items were requested:
    if let Some(items) = selected_items {
        for item in items {
            let path_l = p_left.join(&item);
            let path_r = p_right.join(&item);

            if path_l.exists() {
                let is_dir = path_l.is_dir();
                let size = if is_dir { 0 } else { fs::metadata(&path_l).map_or(0, |m| m.len()) };
                let hash = if !is_dir && deep_hash_compare { calculate_sha256(&path_l).ok() } else { None };
                map_left.insert(item.clone(), (is_dir, size, hash));
            }
            if path_r.exists() {
                let is_dir = path_r.is_dir();
                let size = if is_dir { 0 } else { fs::metadata(&path_r).map_or(0, |m| m.len()) };
                let hash = if !is_dir && deep_hash_compare { calculate_sha256(&path_r).ok() } else { None };
                map_right.insert(item, (is_dir, size, hash));
            }
        }
    } else if !recursive {
        // Fast Immediate Level Compare: only read immediate children (O(N) ~ 5ms)
        if p_left.is_dir() {
            if let Ok(entries) = fs::read_dir(p_left) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    let size = if is_dir { 0 } else { entry.metadata().map_or(0, |m| m.len()) };
                    let hash = if !is_dir && deep_hash_compare { calculate_sha256(&entry.path()).ok() } else { None };
                    map_left.insert(name, (is_dir, size, hash));
                }
            }
        }

        if p_right.is_dir() {
            if let Ok(entries) = fs::read_dir(p_right) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    let size = if is_dir { 0 } else { entry.metadata().map_or(0, |m| m.len()) };
                    let hash = if !is_dir && deep_hash_compare { calculate_sha256(&entry.path()).ok() } else { None };
                    map_right.insert(name, (is_dir, size, hash));
                }
            }
        }
    } else {
        // Recursive WalkDir
        if p_left.is_dir() {
            for entry in WalkDir::new(p_left).max_depth(10).into_iter().filter_map(|e| e.ok()) {
                if let Ok(rel) = entry.path().strip_prefix(p_left) {
                    let rel_str = rel.to_string_lossy().to_string();
                    if rel_str.is_empty() {
                        continue;
                    }
                    let is_dir = entry.file_type().is_dir();
                    let size = if is_dir { 0 } else { entry.metadata().map_or(0, |m| m.len()) };
                    let hash = if !is_dir && deep_hash_compare {
                        calculate_sha256(entry.path()).ok()
                    } else {
                        None
                    };
                    map_left.insert(rel_str, (is_dir, size, hash));
                }
            }
        }

        if p_right.is_dir() {
            for entry in WalkDir::new(p_right).max_depth(10).into_iter().filter_map(|e| e.ok()) {
                if let Ok(rel) = entry.path().strip_prefix(p_right) {
                    let rel_str = rel.to_string_lossy().to_string();
                    if rel_str.is_empty() {
                        continue;
                    }
                    let is_dir = entry.file_type().is_dir();
                    let size = if is_dir { 0 } else { entry.metadata().map_or(0, |m| m.len()) };
                    let hash = if !is_dir && deep_hash_compare {
                        calculate_sha256(entry.path()).ok()
                    } else {
                        None
                    };
                    map_right.insert(rel_str, (is_dir, size, hash));
                }
            }
        }
    }

    let mut all_keys: HashSet<String> = HashSet::new();
    for k in map_left.keys() {
        all_keys.insert(k.clone());
    }
    for k in map_right.keys() {
        all_keys.insert(k.clone());
    }

    let mut sorted_keys: Vec<String> = all_keys.into_iter().collect();
    sorted_keys.sort();

    let mut entries = Vec::new();
    let mut identical_count = 0;
    let mut modified_count = 0;
    let mut left_only_count = 0;
    let mut right_only_count = 0;

    for key in sorted_keys {
        let in_left = map_left.get(&key);
        let in_right = map_right.get(&key);

        match (in_left, in_right) {
            (Some(l), Some(r)) => {
                let is_dir = l.0;
                let size_l = l.1;
                let size_r = r.1;
                let hash_l = l.2.clone();
                let hash_r = r.2.clone();

                let is_same = if is_dir {
                    true
                } else if deep_hash_compare && hash_l.is_some() && hash_r.is_some() {
                    hash_l == hash_r
                } else {
                    size_l == size_r
                };

                let status = if is_same {
                    identical_count += 1;
                    "identical"
                } else {
                    modified_count += 1;
                    "modified"
                };

                entries.push(FolderEntryDiff {
                    relative_path: key,
                    status: status.to_string(),
                    is_dir,
                    size_left: Some(size_l),
                    size_right: Some(size_r),
                    hash_left: hash_l,
                    hash_right: hash_r,
                });
            }
            (Some(l), None) => {
                left_only_count += 1;
                entries.push(FolderEntryDiff {
                    relative_path: key,
                    status: "left_only".to_string(),
                    is_dir: l.0,
                    size_left: Some(l.1),
                    size_right: None,
                    hash_left: l.2.clone(),
                    hash_right: None,
                });
            }
            (None, Some(r)) => {
                right_only_count += 1;
                entries.push(FolderEntryDiff {
                    relative_path: key,
                    status: "right_only".to_string(),
                    is_dir: r.0,
                    size_left: None,
                    size_right: Some(r.1),
                    hash_left: None,
                    hash_right: r.2.clone(),
                });
            }
            (None, None) => {}
        }
    }

    Ok(FolderDiffResult {
        dir_left: dir_left_str.to_string(),
        dir_right: dir_right_str.to_string(),
        total_left_entries: map_left.len(),
        total_right_entries: map_right.len(),
        identical_count,
        modified_count,
        left_only_count,
        right_only_count,
        entries,
    })
}
