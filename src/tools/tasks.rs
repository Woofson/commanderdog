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
    pub action: String, // "copy", "move", "archive", "extract", "checksum", "download"
    pub source: String,
    pub destination: String,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub status: String, // "running", "completed", "failed", "cancelled"
    pub error_message: Option<String>,
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
            status: "running".to_string(),
            error_message: None,
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

    pub async fn complete_task(&self, id: &str) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            task.status = "completed".to_string();
            task.bytes_processed = task.total_bytes;
            task.finished_at = Some(Utc::now().timestamp());
        }
    }

    pub async fn fail_task(&self, id: &str, error: &str) {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            task.status = "failed".to_string();
            task.error_message = Some(error.to_string());
            task.finished_at = Some(Utc::now().timestamp());
        }
    }

    pub async fn cancel_task(&self, id: &str) -> bool {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.get_mut(id) {
            if task.status == "running" {
                task.status = "cancelled".to_string();
                task.finished_at = Some(Utc::now().timestamp());
                return true;
            }
        }
        false
    }

    pub async fn list_tasks(&self) -> Vec<TaskInfo> {
        let map = self.tasks.read().await;
        let mut list: Vec<TaskInfo> = map.values().cloned().collect();
        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        list
    }
}
