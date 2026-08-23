use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskInfo {
    pub id: String,
    pub name: String,
    pub action: String, // "copy", "move", "archive", "extract", "checksum", "download", "deltacopy", "upload"
    pub source: String,
    pub destination: String,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub files_processed: u64,
    pub total_files: u64,
    pub current_file: Option<String>,
    pub current_file_bytes: u64,
    pub current_file_total_bytes: u64,
    pub status: String, // "running", "completed", "failed", "cancelled", "paused"
    pub error_message: Option<String>,
    pub log_entries: Vec<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Clone)]
pub struct TaskManager {
    tasks: Arc<RwLock<HashMap<String, TaskInfo>>>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create_task(
        &self,
        name: &str,
        action: &str,
        source: &str,
        destination: &str,
        total_bytes: u64,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let task = TaskInfo {
            id: id.clone(),
            name: name.to_string(),
            action: action.to_string(),
            source: source.to_string(),
            destination: destination.to_string(),
            bytes_processed: 0,
            total_bytes,
            speed_bytes_per_sec: 0,
            files_processed: 0,
            total_files: 1,
            current_file: None,
            current_file_bytes: 0,
            current_file_total_bytes: 0,
            status: "running".to_string(),
            error_message: None,
            log_entries: vec![format!(
                "[{}] Task started: {} (Action: {})",
                Utc::now().format("%H:%M:%S"),
                name,
                action
            )],
            started_at: Utc::now().timestamp(),
            finished_at: None,
        };

        let mut map = self.tasks.write().await;
        map.insert(id.clone(), task);
        id
    }

    pub async fn update_progress(&self, id: &str, bytes_processed: u64, speed_bps: u64) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            task.bytes_processed = bytes_processed;
            task.speed_bytes_per_sec = speed_bps;
        }
    }

    pub async fn update_task_details(
        &self,
        id: &str,
        current_file: Option<&str>,
        cur_file_bytes: u64,
        cur_file_total: u64,
        files_processed: u64,
        total_files: u64,
        total_bytes_processed: u64,
        speed_bps: u64,
        log_msg: Option<&str>,
    ) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            if let Some(f) = current_file {
                task.current_file = Some(f.to_string());
            }
            task.current_file_bytes = cur_file_bytes;
            task.current_file_total_bytes = cur_file_total;
            task.files_processed = files_processed;
            task.total_files = total_files;
            task.bytes_processed = total_bytes_processed;
            task.speed_bytes_per_sec = speed_bps;

            if let Some(msg) = log_msg {
                let entry = format!("[{}] {}", Utc::now().format("%H:%M:%S"), msg);
                if task.log_entries.len() > 200 {
                    task.log_entries.remove(0);
                }
                task.log_entries.push(entry);
            }
        }
    }

    pub async fn add_log_entry(&self, id: &str, log_msg: &str) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            let entry = format!("[{}] {}", Utc::now().format("%H:%M:%S"), log_msg);
            if task.log_entries.len() > 200 {
                task.log_entries.remove(0);
            }
            task.log_entries.push(entry);
        }
    }

    pub async fn complete_task(&self, id: &str) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            task.status = "completed".to_string();
            task.bytes_processed = task.total_bytes;
            task.files_processed = task.total_files;
            task.finished_at = Some(Utc::now().timestamp());
            task.log_entries.push(format!(
                "[{}] Task completed successfully",
                Utc::now().format("%H:%M:%S")
            ));
        }
    }

    pub async fn fail_task(&self, id: &str, error: &str) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            task.status = "failed".to_string();
            task.error_message = Some(error.to_string());
            task.finished_at = Some(Utc::now().timestamp());
            task.log_entries.push(format!(
                "[{}] Error: {}",
                Utc::now().format("%H:%M:%S"),
                error
            ));
        }
    }

    pub async fn cancel_task(&self, id: &str) -> bool {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            if task.status == "running" || task.status == "paused" {
                task.status = "cancelled".to_string();
                task.finished_at = Some(Utc::now().timestamp());
                task.log_entries.push(format!(
                    "[{}] Task cancelled by user",
                    Utc::now().format("%H:%M:%S")
                ));
                return true;
            }
        }
        false
    }

    pub async fn pause_task(&self, id: &str) -> bool {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            if task.status == "running" {
                task.status = "paused".to_string();
                task.log_entries.push(format!(
                    "[{}] Task paused",
                    Utc::now().format("%H:%M:%S")
                ));
                return true;
            }
        }
        false
    }

    pub async fn resume_task(&self, id: &str) -> bool {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            if task.status == "paused" {
                task.status = "running".to_string();
                task.log_entries.push(format!(
                    "[{}] Task resumed",
                    Utc::now().format("%H:%M:%S")
                ));
                return true;
            }
        }
        false
    }

    pub async fn clear_completed(&self) {
        let mut map = self.tasks.write().await;
        map.retain(|_, task| task.status == "running" || task.status == "paused");
    }

    pub async fn list_tasks(&self) -> Vec<TaskInfo> {
        let map = self.tasks.read().await;
        let mut list: Vec<TaskInfo> = map.values().cloned().collect();
        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        list
    }
}
