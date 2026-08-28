use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitRequest {
    pub source_path: String,
    pub chunk_size_mb: u64,
    pub dest_dir: Option<String>,
    pub generate_checksum: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitResponse {
    pub success: bool,
    pub original_file: String,
    pub total_size_bytes: u64,
    pub chunk_size_bytes: u64,
    pub chunk_count: usize,
    pub parts: Vec<String>,
    pub sha256: String,
    pub manifest_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombineRequest {
    pub parts: Vec<String>,
    pub dest_path: String,
    pub expected_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombineResponse {
    pub success: bool,
    pub dest_path: String,
    pub total_bytes_written: u64,
    pub parts_joined: usize,
    pub sha256: String,
    pub is_verified: bool,
}

pub fn split_file_sync(
    source_path: &Path,
    dest_dir: Option<&Path>,
    chunk_size_bytes: u64,
    generate_checksum: bool,
) -> Result<SplitResponse, String> {
    if !source_path.exists() || !source_path.is_file() {
        return Err("Source file does not exist or is not a regular file".to_string());
    }

    let file_meta = fs::metadata(source_path).map_err(|e| e.to_string())?;
    let total_size = file_meta.len();
    if total_size == 0 {
        return Err("Source file is empty (0 bytes)".to_string());
    }

    let chunk_size = chunk_size_bytes.max(1024 * 1024); // min 1MB
    let target_dir = dest_dir.unwrap_or_else(|| source_path.parent().unwrap_or(Path::new(".")));
    fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;

    let file_name = source_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid filename".to_string())?;

    let mut source_file = File::open(source_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024]; // 1MB read buffer
    let mut parts = Vec::new();
    let mut part_idx = 1;

    let mut current_part_bytes = 0u64;
    let mut current_part_path = target_dir.join(format!("{}.{:03}", file_name, part_idx));
    let mut current_part_file = File::create(&current_part_path).map_err(|e| e.to_string())?;
    parts.push(current_part_path.to_string_lossy().to_string());

    let mut total_written_overall = 0u64;
    loop {
        let bytes_read = source_file.read(&mut buffer).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);

        let mut offset = 0;
        while offset < bytes_read {
            let remaining_in_part = chunk_size.saturating_sub(current_part_bytes) as usize;
            let to_write = (bytes_read - offset).min(remaining_in_part);

            current_part_file
                .write_all(&buffer[offset..offset + to_write])
                .map_err(|e| e.to_string())?;
            current_part_bytes += to_write as u64;
            total_written_overall += to_write as u64;
            offset += to_write;

            if current_part_bytes >= chunk_size && total_written_overall < total_size {
                part_idx += 1;
                current_part_bytes = 0;
                current_part_path = target_dir.join(format!("{}.{:03}", file_name, part_idx));
                current_part_file = File::create(&current_part_path).map_err(|e| e.to_string())?;
                parts.push(current_part_path.to_string_lossy().to_string());
            }
        }
    }

    let sha256_hash = format!("{:x}", hasher.finalize());

    let mut manifest_path_str = None;
    if generate_checksum {
        let manifest_path = target_dir.join(format!("{}.sha256", file_name));
        let manifest_content = format!("{}  {}\n", sha256_hash, file_name);
        let _ = fs::write(&manifest_path, manifest_content);
        manifest_path_str = Some(manifest_path.to_string_lossy().to_string());
    }

    Ok(SplitResponse {
        success: true,
        original_file: source_path.to_string_lossy().to_string(),
        total_size_bytes: total_size,
        chunk_size_bytes: chunk_size,
        chunk_count: parts.len(),
        parts,
        sha256: sha256_hash,
        manifest_path: manifest_path_str,
    })
}

pub fn combine_files_sync(
    part_paths: &[PathBuf],
    dest_path: &Path,
    expected_sha256: Option<&str>,
) -> Result<CombineResponse, String> {
    if part_paths.is_empty() {
        return Err("No file parts specified to combine".to_string());
    }

    let mut sorted_parts = part_paths.to_vec();
    sorted_parts.sort();

    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut dest_file = File::create(dest_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut total_written = 0u64;

    for part in &sorted_parts {
        if !part.exists() || !part.is_file() {
            return Err(format!("Part file missing or unreadable: {:?}", part));
        }

        let mut part_file = File::open(part).map_err(|e| e.to_string())?;
        loop {
            let bytes_read = part_file.read(&mut buffer).map_err(|e| e.to_string())?;
            if bytes_read == 0 {
                break;
            }
            dest_file
                .write_all(&buffer[..bytes_read])
                .map_err(|e| e.to_string())?;
            hasher.update(&buffer[..bytes_read]);
            total_written += bytes_read as u64;
        }
    }

    dest_file.flush().map_err(|e| e.to_string())?;

    let sha256_hash = format!("{:x}", hasher.finalize());
    let mut is_verified = true;
    if let Some(exp) = expected_sha256 {
        if !exp.trim().is_empty() {
            is_verified = sha256_hash.eq_ignore_ascii_case(exp.trim());
        }
    }

    Ok(CombineResponse {
        success: true,
        dest_path: dest_path.to_string_lossy().to_string(),
        total_bytes_written: total_written,
        parts_joined: sorted_parts.len(),
        sha256: sha256_hash,
        is_verified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_split_and_combine_integrity() {
        let temp_dir = tempdir().unwrap();
        let src_file = temp_dir.path().join("sample_test_data.bin");
        
        // Write 3MB of patterned test data
        let mut sample_data = Vec::new();
        for i in 0..(3 * 1024 * 1024) {
            sample_data.push((i % 256) as u8);
        }
        let mut f = File::create(&src_file).unwrap();
        f.write_all(&sample_data).unwrap();
        f.flush().unwrap();

        // Split into 1MB chunks
        let split_res = split_file_sync(&src_file, None, 1024 * 1024, true).unwrap();
        assert_eq!(split_res.chunk_count, 3);
        assert_eq!(split_res.parts.len(), 3);
        assert!(split_res.manifest_path.is_some());

        // Combine chunks into new file
        let combined_file = temp_dir.path().join("reconstructed_output.bin");
        let part_paths: Vec<PathBuf> = split_res.parts.iter().map(PathBuf::from).collect();
        let combine_res = combine_files_sync(&part_paths, &combined_file, Some(&split_res.sha256)).unwrap();

        assert_eq!(combine_res.total_bytes_written, 3 * 1024 * 1024);
        assert!(combine_res.is_verified);
        assert_eq!(combine_res.sha256, split_res.sha256);

        // Read reconstructed data and verify exact byte equality
        let reconstructed = fs::read(&combined_file).unwrap();
        assert_eq!(sample_data, reconstructed);
    }
}

