use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTagInfo {
    pub path: String,
    pub color_label: Option<String>, // "red", "orange", "yellow", "green", "blue", "purple", "gray"
    pub tags: Vec<String>,
    #[serde(default)]
    pub custom_icon: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetTagsRequest {
    pub paths: Vec<String>,
    #[serde(default)]
    pub color_label: Option<String>,
    #[serde(default)]
    pub clear_color: Option<bool>,
    #[serde(default)]
    pub custom_icon: Option<String>,
    #[serde(default)]
    pub clear_custom_icon: Option<bool>,
    pub add_tags: Option<Vec<String>>,
    pub remove_tags: Option<Vec<String>>,
    pub set_tags: Option<Vec<String>>,
}

pub struct TagManager {
    db: Arc<Mutex<Connection>>,
}

impl TagManager {
    pub fn new(db: Arc<Mutex<Connection>>) -> Result<Self, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS file_tags (
                path TEXT PRIMARY KEY,
                color_label TEXT,
                tags_json TEXT,
                custom_icon TEXT,
                updated_at INTEGER
            )",
            [],
        ).map_err(|e| format!("Failed to create file_tags table: {}", e))?;

        // Ensure custom_icon column exists for existing databases
        let _ = conn.execute("ALTER TABLE file_tags ADD COLUMN custom_icon TEXT", []);

        drop(conn);
        Ok(Self { db })
    }

    pub fn get_tags_for_path(&self, path: &str) -> Option<FileTagInfo> {
        let conn = self.db.lock().ok()?;
        conn.query_row(
            "SELECT path, color_label, tags_json, custom_icon, updated_at FROM file_tags WHERE path = ?1",
            params![path],
            |row| {
                let p: String = row.get(0)?;
                let color_label: Option<String> = row.get(1)?;
                let tags_json: Option<String> = row.get(2)?;
                let custom_icon: Option<String> = row.get(3)?;
                let updated_at: i64 = row.get(4)?;
                let tags: Vec<String> = tags_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default();
                Ok(FileTagInfo {
                    path: p,
                    color_label,
                    tags,
                    custom_icon,
                    updated_at,
                })
            },
        ).optional().ok().flatten()
    }

    pub fn get_all_tags(&self) -> Result<Vec<FileTagInfo>, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT path, color_label, tags_json, custom_icon, updated_at FROM file_tags")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            let p: String = row.get(0)?;
            let color_label: Option<String> = row.get(1)?;
            let tags_json: Option<String> = row.get(2)?;
            let custom_icon: Option<String> = row.get(3)?;
            let updated_at: i64 = row.get(4)?;
            let tags: Vec<String> = tags_json
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default();
            Ok(FileTagInfo {
                path: p,
                color_label,
                tags,
                custom_icon,
                updated_at,
            })
        }).map_err(|e| e.to_string())?;

        let mut list = Vec::new();
        for r in rows.filter_map(|r| r.ok()) {
            list.push(r);
        }
        Ok(list)
    }

    pub fn set_tags(&self, req: SetTagsRequest) -> Result<usize, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();
        let mut count = 0;

        for path in &req.paths {
            let existing: Option<(Option<String>, Option<String>, Option<String>)> = conn.query_row(
                "SELECT color_label, tags_json, custom_icon FROM file_tags WHERE path = ?1",
                params![path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).optional().unwrap_or(None);

            let cur_color = if req.clear_color == Some(true) {
                None
            } else if let Some(ref col) = req.color_label {
                if col.is_empty() || col == "none" || col == "clear" || col == "null" {
                    None
                } else {
                    Some(col.clone())
                }
            } else if let Some((ref old_col, _, _)) = existing {
                old_col.clone()
            } else {
                None
            };

            let cur_custom_icon = if req.clear_custom_icon == Some(true) {
                None
            } else if let Some(ref ico) = req.custom_icon {
                if ico.trim().is_empty() || ico == "none" || ico == "clear" || ico == "null" {
                    None
                } else {
                    Some(ico.trim().to_string())
                }
            } else if let Some((_, _, ref old_ico)) = existing {
                old_ico.clone()
            } else {
                None
            };

            let mut cur_tags: Vec<String> = if let Some(ref set_t) = req.set_tags {
                set_t.clone()
            } else if let Some((_, Some(ref old_tags_json), _)) = existing {
                serde_json::from_str(old_tags_json).unwrap_or_default()
            } else {
                Vec::new()
            };

            if let Some(ref add_t) = req.add_tags {
                for t in add_t {
                    let clean = t.trim().to_string();
                    if !clean.is_empty() && !cur_tags.contains(&clean) {
                        cur_tags.push(clean);
                    }
                }
            }

            if let Some(ref rem_t) = req.remove_tags {
                cur_tags.retain(|t| !rem_t.contains(t));
            }

            let tags_json = serde_json::to_string(&cur_tags).unwrap_or_else(|_| "[]".to_string());

            if cur_color.is_none() && cur_tags.is_empty() && cur_custom_icon.is_none() {
                conn.execute("DELETE FROM file_tags WHERE path = ?1", params![path])
                    .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO file_tags (path, color_label, tags_json, custom_icon, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(path) DO UPDATE SET
                        color_label = excluded.color_label,
                        tags_json = excluded.tags_json,
                        custom_icon = excluded.custom_icon,
                        updated_at = excluded.updated_at",
                    params![path, cur_color, tags_json, cur_custom_icon, now],
                ).map_err(|e| e.to_string())?;
            }
            count += 1;
        }

        Ok(count)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_tags_and_color_label_persistence_and_clearing() {
        let conn = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        let manager = TagManager::new(conn).unwrap();

        let path = "/test/file.txt".to_string();

        // 1. Set color to red, custom icon to rocket
        manager.set_tags(SetTagsRequest {
            paths: vec![path.clone()],
            color_label: Some("red".to_string()),
            clear_color: None,
            custom_icon: Some("🚀".to_string()),
            clear_custom_icon: None,
            add_tags: Some(vec!["urgent".to_string(), "invoice".to_string()]),
            remove_tags: None,
            set_tags: None,
        }).unwrap();

        let info = manager.get_tags_for_path(&path).unwrap();
        assert_eq!(info.color_label, Some("red".to_string()));
        assert_eq!(info.custom_icon, Some("🚀".to_string()));
        assert_eq!(info.tags, vec!["urgent".to_string(), "invoice".to_string()]);

        // 2. Clear color using clear_color: Some(true) while preserving icon & tags
        manager.set_tags(SetTagsRequest {
            paths: vec![path.clone()],
            color_label: Some("none".to_string()),
            clear_color: Some(true),
            custom_icon: None,
            clear_custom_icon: None,
            add_tags: None,
            remove_tags: None,
            set_tags: None,
        }).unwrap();

        let info2 = manager.get_tags_for_path(&path).unwrap();
        assert_eq!(info2.color_label, None);
        assert_eq!(info2.custom_icon, Some("🚀".to_string()));
        assert_eq!(info2.tags, vec!["urgent".to_string(), "invoice".to_string()]);

        // 3. Clear custom icon too
        manager.set_tags(SetTagsRequest {
            paths: vec![path.clone()],
            color_label: None,
            clear_color: None,
            custom_icon: None,
            clear_custom_icon: Some(true),
            add_tags: None,
            remove_tags: None,
            set_tags: None,
        }).unwrap();

        let info3 = manager.get_tags_for_path(&path).unwrap();
        assert_eq!(info3.custom_icon, None);

        // 4. Clear tags too -> record should be deleted from SQLite
        manager.set_tags(SetTagsRequest {
            paths: vec![path.clone()],
            color_label: None,
            clear_color: None,
            custom_icon: None,
            clear_custom_icon: None,
            add_tags: None,
            remove_tags: None,
            set_tags: Some(vec![]),
        }).unwrap();

        let info4 = manager.get_tags_for_path(&path);
        assert!(info4.is_none());
    }
}
