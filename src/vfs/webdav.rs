use super::{is_archive_file, DirectoryListing, FileEntry};
use reqwest::Client;
use std::time::Duration;

pub struct WebDavClient;

impl WebDavClient {
    pub async fn list_dir(
        url: &str,
        user: Option<&str>,
        pass: Option<&str>,
    ) -> Result<DirectoryListing, Box<dyn std::error::Error + Send + Sync>> {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()?;

        let mut req = client.request(reqwest::Method::from_bytes(b"PROPFIND")?, url)
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8");

        if let (Some(u), Some(p)) = (user, pass) {
            req = req.basic_auth(u, Some(p));
        }

        let resp = req.send().await?;
        if !resp.status().is_success() && resp.status().as_u16() != 207 {
            return Err(format!("WebDAV PROPFIND error: HTTP {}", resp.status()).into());
        }

        let xml_body = resp.text().await?;
        let mut entries = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;
        let mut total_size = 0u64;

        for response_chunk in xml_body.split("<d:response>") {
            if !response_chunk.contains("</d:response>") {
                continue;
            }

            let href = response_chunk
                .split("<d:href>")
                .nth(1)
                .and_then(|s| s.split("</d:href>").next())
                .unwrap_or("")
                .trim();

            if href.is_empty() || href == url || href.trim_end_matches('/') == url.trim_end_matches('/') {
                continue;
            }

            let is_dir = response_chunk.contains("<d:collection/>") || response_chunk.contains("<d:collection />") || href.ends_with('/');
            let clean_name = href.trim_end_matches('/').split('/').last().unwrap_or("").to_string();

            if clean_name.is_empty() {
                continue;
            }

            let size = response_chunk
                .split("<d:getcontentlength>")
                .nth(1)
                .and_then(|s| s.split("</d:getcontentlength>").next())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);

            if is_dir {
                total_dirs += 1;
            } else {
                total_files += 1;
                total_size += size;
            }

            let is_archive = !is_dir && is_archive_file(&clean_name);

            entries.push(FileEntry {
                name: clean_name.clone(),
                path: format!("webdav://{}{}", url.trim_start_matches("http://").trim_start_matches("https://"), href),
                is_dir,
                is_symlink: false,
                is_empty: None,
                size,
                modified: None,
                permissions: if is_dir { "drwxr-xr-x".to_string() } else { "-rw-r--r--".to_string() },
                mode_octal: if is_dir { "0755".to_string() } else { "0644".to_string() },
                owner: "webdav".to_string(),
                group: "webdav".to_string(),
                uid: 1000,
                gid: 1000,
                mime_type: if is_dir { None } else { Some(mime_guess::from_path(&clean_name).first_or_octet_stream().to_string()) },
                is_archive,
            });
        }

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
            current_path: url.to_string(),
            parent_path: None,
            entries,
            total_files,
            total_dirs,
            total_size,
            protocol: "webdav".to_string(),
        })
    }
}
