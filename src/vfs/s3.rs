use crate::vfs::{FileEntry, VfsResult};
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tracing::info;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Config {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub path_style: Option<bool>,
}

pub struct S3Client {
    config: S3Config,
    client: reqwest::Client,
}

impl S3Client {
    pub fn new(config: S3Config) -> Self {
        Self {
            config,
            client: reqwest::Client::builder().build().unwrap(),
        }
    }

    fn sha256_hex(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
        mac.update(data);
        mac.finalize().into_bytes().to_vec()
    }

    fn get_signature_key(key: &str, date_stamp: &str, region: &str, service: &str) -> Vec<u8> {
        let k_date = Self::hmac_sha256(format!("AWS4{}", key).as_bytes(), date_stamp.as_bytes());
        let k_region = Self::hmac_sha256(&k_date, region.as_bytes());
        let k_service = Self::hmac_sha256(&k_region, service.as_bytes());
        Self::hmac_sha256(&k_service, b"aws4_request")
    }

    pub fn build_url(&self, key: &str, query_params: &[(&str, &str)]) -> (String, String, String) {
        let raw_endpoint = self.config.endpoint.trim_end_matches('/');
        let path_style = self.config.path_style.unwrap_or(true);
        let clean_key = key.trim_start_matches('/');

        let (base_host, uri_path) = if path_style {
            let host = raw_endpoint.replace("https://", "").replace("http://", "");
            let path = if clean_key.is_empty() {
                format!("/{}", self.config.bucket)
            } else {
                format!("/{}/{}", self.config.bucket, clean_key)
            };
            (host, path)
        } else {
            let host = if raw_endpoint.starts_with("https://") {
                format!("{}.{}", self.config.bucket, raw_endpoint.trim_start_matches("https://"))
            } else {
                format!("{}.{}", self.config.bucket, raw_endpoint.trim_start_matches("http://"))
            };
            let path = format!("/{}", clean_key);
            (host, path)
        };

        let query_string = if query_params.is_empty() {
            String::new()
        } else {
            let mut sorted = query_params.to_vec();
            sorted.sort_by_key(|a| a.0);
            sorted.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("&")
        };

        let full_url = if query_string.is_empty() {
            format!("{}/{}", raw_endpoint, uri_path.trim_start_matches('/'))
        } else {
            format!("{}/{}?{}", raw_endpoint, uri_path.trim_start_matches('/'), query_string)
        };

        (full_url, base_host, uri_path)
    }

    pub fn sign(
        &self,
        method: &str,
        host: &str,
        uri_path: &str,
        query_params: &[(&str, &str)],
        payload_hash: &str,
    ) -> HeaderMap {
        let now = Utc::now();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = now.format("%Y%m%d").to_string();

        let mut canonical_headers = BTreeMap::new();
        canonical_headers.insert("host", host.to_string());
        canonical_headers.insert("x-amz-content-sha256", payload_hash.to_string());
        canonical_headers.insert("x-amz-date", amz_date.clone());

        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let canonical_headers_str = format!(
            "host:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
            host, payload_hash, amz_date
        );

        let canonical_query_str = if query_params.is_empty() {
            String::new()
        } else {
            let mut sorted = query_params.to_vec();
            sorted.sort_by_key(|a| a.0);
            sorted.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("&")
        };

        let canonical_request = format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            method,
            uri_path,
            canonical_query_str,
            canonical_headers_str,
            signed_headers,
            payload_hash
        );

        let canonical_request_hash = Self::sha256_hex(canonical_request.as_bytes());
        let credential_scope = format!("{}/{}/s3/aws4_request", date_stamp, self.config.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}\n{}",
            amz_date, credential_scope, canonical_request_hash
        );

        let signing_key = Self::get_signature_key(
            &self.config.secret_access_key,
            &date_stamp,
            &self.config.region,
            "s3",
        );
        let signature = hex::encode(Self::hmac_sha256(&signing_key, string_to_sign.as_bytes()));

        let auth_header = format!(
            "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
            self.config.access_key_id, credential_scope, signed_headers, signature
        );

        let mut headers = HeaderMap::new();
        headers.insert(HeaderName::from_static("x-amz-date"), HeaderValue::from_str(&amz_date).unwrap());
        headers.insert(HeaderName::from_static("x-amz-content-sha256"), HeaderValue::from_str(payload_hash).unwrap());
        headers.insert(HeaderName::from_static("authorization"), HeaderValue::from_str(&auth_header).unwrap());

        headers
    }

    pub async fn list_directory(&self, prefix: &str) -> VfsResult<Vec<FileEntry>> {
        let clean_prefix = prefix.trim_start_matches('/').trim_end_matches('/');
        let query_prefix = if clean_prefix.is_empty() {
            String::new()
        } else {
            format!("{}/", clean_prefix)
        };

        let query_params = vec![
            ("delimiter", "/"),
            ("list-type", "2"),
            ("prefix", &query_prefix),
        ];

        let payload_hash = Self::sha256_hex(b"");
        let (url, host, uri_path) = self.build_url("", &query_params);
        let headers = self.sign("GET", &host, &uri_path, &query_params, &payload_hash);

        let resp = self.client.get(&url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Failed to reach S3 endpoint: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("S3 ListBucket failed: {}", body));
        }

        let xml = resp.text().await.map_err(|e| e.to_string())?;
        let mut entries = Vec::new();

        for prefix_block in xml.split("<CommonPrefixes>").skip(1) {
            if let Some(p) = prefix_block.split("<Prefix>").nth(1).and_then(|s| s.split("</Prefix>").next()) {
                let name = p.trim_end_matches('/').rsplit('/').next().unwrap_or(p);
                entries.push(FileEntry {
                    name: name.to_string(),
                    path: format!("s3://{}/{}", self.config.bucket, p.trim_end_matches('/')),
                    is_dir: true,
                    is_symlink: false,
                    size: 0,
                    modified: Some(Utc::now().timestamp() as u64),
                    permissions: "drwxr-xr-x".to_string(),
                    mode_octal: "0755".to_string(),
                    owner: "s3".to_string(),
                    group: "s3".to_string(),
                    uid: 1000,
                    gid: 1000,
                    mime_type: None,
                    is_archive: false,
                });
            }
        }

        for content_block in xml.split("<Contents>").skip(1) {
            let key = content_block.split("<Key>").nth(1).and_then(|s| s.split("</Key>").next()).unwrap_or("");
            let size: u64 = content_block.split("<Size>").nth(1).and_then(|s| s.split("</Size>").next()).and_then(|s| s.parse().ok()).unwrap_or(0);
            
            if key == query_prefix || key.is_empty() {
                continue;
            }

            let name = key.rsplit('/').next().unwrap_or(key);
            let is_archive = name.ends_with(".zip") || name.ends_with(".tar.gz") || name.ends_with(".tgz");

            entries.push(FileEntry {
                name: name.to_string(),
                path: format!("s3://{}/{}", self.config.bucket, key),
                is_dir: false,
                is_symlink: false,
                size,
                modified: Some(Utc::now().timestamp() as u64),
                permissions: "-rw-r--r--".to_string(),
                mode_octal: "0644".to_string(),
                owner: "s3".to_string(),
                group: "s3".to_string(),
                uid: 1000,
                gid: 1000,
                mime_type: None,
                is_archive,
            });
        }

        Ok(entries)
    }

    pub async fn test_connection(&self) -> VfsResult<bool> {
        info!("Testing S3 connection to {}/{}", self.config.endpoint, self.config.bucket);
        match self.list_directory("").await {
            Ok(_) => Ok(true),
            Err(e) => Err(e),
        }
    }
}
