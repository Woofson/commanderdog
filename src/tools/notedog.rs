use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDogFile {
    pub name: String,
    pub filename: String,
    pub path: String,
    pub relative_path: String,
    pub is_encrypted: bool,
    pub modified_sec: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDogSection {
    pub name: String,
    pub path: String,
    pub notes: Vec<NoteDogFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDogNotebook {
    pub name: String,
    pub path: String,
    pub sections: Vec<NoteDogSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDogInfo {
    pub root_folder: String,
    pub notebooks: Vec<NoteDogNotebook>,
    pub total_notes: usize,
    pub total_notebooks: usize,
    pub total_sections: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteVersionItem {
    pub filename: String,
    pub path: String,
    pub timestamp_sec: u64,
    pub formatted_time: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTemplate {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub content: String,
}

/// Resolve the NoteDog notes root directory.
/// 1. If `override_path` is provided, expand and use that.
/// 2. If `config_folder` is configured in CommanderDog (e.g. `[notedog] notes_folder = "..."`), use that.
/// 3. If `~/.config/notedog/notedog.toml` exists with `note_folder = "..."`, use that.
/// 4. Default to `~/Notes`.
pub fn get_notedog_root_dir(override_path: Option<&str>, config_folder: Option<&str>) -> PathBuf {
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));

    // 1. Override path if supplied
    if let Some(ov) = override_path {
        let trimmed = ov.trim();
        if !trimmed.is_empty() {
            let mut folder = trimmed.to_string();
            if folder.starts_with("~/") {
                folder = folder.replacen("~", &home_dir.to_string_lossy(), 1);
            }
            let p = PathBuf::from(folder);
            if !p.exists() {
                let _ = fs::create_dir_all(&p);
            }
            return p;
        }
    }

    // 2. Check CommanderDog config.toml [notedog] notes_folder
    if let Some(cf) = config_folder {
        let trimmed = cf.trim();
        if !trimmed.is_empty() && trimmed != "~/Notes" {
            let mut folder = trimmed.to_string();
            if folder.starts_with("~/") {
                folder = folder.replacen("~", &home_dir.to_string_lossy(), 1);
            }
            let p = PathBuf::from(folder);
            if !p.exists() {
                let _ = fs::create_dir_all(&p);
            }
            return p;
        }
    }

    // 3. Check config in ~/.config/notedog/notedog.toml
    let config_path = home_dir.join(".config").join("notedog").join("notedog.toml");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("note_folder") {
                    if let Some((_, val)) = trimmed.split_once('=') {
                        let mut folder = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        if folder.starts_with("~/") {
                            folder = folder.replacen("~", &home_dir.to_string_lossy(), 1);
                        }
                        let p = PathBuf::from(folder);
                        if !p.exists() {
                            let _ = fs::create_dir_all(&p);
                        }
                        return p;
                    }
                }
            }
        }
    }

    // 4. Default notes folder
    let default_notes = if let Some(cf) = config_folder {
        let mut folder = cf.trim().to_string();
        if folder.starts_with("~/") {
            folder = folder.replacen("~", &home_dir.to_string_lossy(), 1);
        }
        PathBuf::from(folder)
    } else {
        home_dir.join("Notes")
    };

    if !default_notes.exists() {
        let _ = fs::create_dir_all(&default_notes);
        ensure_starter_notes(&default_notes);
    }
    default_notes
}

/// Create starter notes if the root folder is completely empty
pub fn ensure_starter_notes(root: &Path) {
    let personal_general = root.join("Personal").join("General");
    if !personal_general.exists() {
        let _ = fs::create_dir_all(&personal_general);
        let welcome_path = personal_general.join("01_Welcome.md");
        if !welcome_path.exists() {
            let welcome_text = r##"# 🐶 Welcome to NoteDog!

NoteDog is a vibrant, modern **Notes & Markdown Studio** chewtoy seamlessly integrated into CommanderDog.

---

## 🎨 Color-Supported Markdown
NoteDog supports rich inline color tags that render beautifully in live preview **and** stay 100% compatible with Obsidian, VSCode, and GitHub:

- Use standard HTML spans: <span style="color:#FF8C00">Warm Dark Orange</span> or <span style="color:#FFD700">Gold Accent</span>!
- Or HTML font tags: <font color="#FFA500">Bright Amber Text</font>
- Or quick shorthand: {[#E67E22]Warm Border Color}

### ⚡ Feature Checklist
- [x] 3-Tier Hierarchy: `Notebook` > `Section` > `Note`
- [x] Dockable in any pane or float as a desktop window
- [x] Interactive task tickboxes (click to check/uncheck in preview!)
- [x] Mermaid & Flowchart diagram rendering
- [x] Endless revision history with live diffs and instant rollback
- [x] Shared themes and colors with CommanderDog

---

> *"Organization is the key to clarity."*
"##;
            let _ = fs::write(welcome_path, welcome_text);
        }
    }
}

/// Scan the NoteDog hierarchy
pub fn scan_notedog_hierarchy(override_path: Option<&str>, config_folder: Option<&str>) -> NoteDogInfo {
    let root = get_notedog_root_dir(override_path, config_folder);
    let mut notebooks = Vec::new();
    let mut total_notes = 0;
    let mut total_sections = 0;

    if let Ok(entries) = fs::read_dir(&root) {
        let mut nb_dirs: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && !p.file_name().unwrap_or_default().to_string_lossy().starts_with('.')
            })
            .collect();
        nb_dirs.sort();

        for nb_path in nb_dirs {
            let nb_name = nb_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let mut sections = Vec::new();
            if let Ok(sec_entries) = fs::read_dir(&nb_path) {
                let mut sec_dirs: Vec<PathBuf> = sec_entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_dir()
                            && !p.file_name().unwrap_or_default().to_string_lossy().starts_with('.')
                    })
                    .collect();
                sec_dirs.sort();

                for sec_path in sec_dirs {
                    let sec_name = sec_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();

                    let mut notes = Vec::new();
                    if let Ok(note_entries) = fs::read_dir(&sec_path) {
                        let mut note_files: Vec<PathBuf> = note_entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.path())
                            .filter(|p| {
                                if p.is_file() {
                                    let name = p.file_name().unwrap_or_default().to_string_lossy();
                                    (name.ends_with(".md") || name.ends_with(".md.enc") || name.ends_with(".txt"))
                                        && !name.starts_with('.')
                                } else {
                                    false
                                }
                            })
                            .collect();
                        note_files.sort();

                        for note_path in note_files {
                            let filename = note_path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let clean_name = filename
                                .strip_suffix(".md.enc")
                                .or_else(|| filename.strip_suffix(".md"))
                                .or_else(|| filename.strip_suffix(".txt"))
                                .unwrap_or(&filename)
                                .to_string();
                            let is_encrypted = filename.ends_with(".md.enc");

                            let meta = fs::metadata(&note_path);
                            let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                            let modified_sec = meta
                                .as_ref()
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            let relative_path = format!("{}/{}/{}", nb_name, sec_name, filename);

                            notes.push(NoteDogFile {
                                name: clean_name,
                                filename,
                                path: note_path.to_string_lossy().to_string(),
                                relative_path,
                                is_encrypted,
                                modified_sec,
                                size_bytes,
                            });
                            total_notes += 1;
                        }
                    }

                    total_sections += 1;
                    sections.push(NoteDogSection {
                        name: sec_name,
                        path: sec_path.to_string_lossy().to_string(),
                        notes,
                    });
                }
            }

            notebooks.push(NoteDogNotebook {
                name: nb_name,
                path: nb_path.to_string_lossy().to_string(),
                sections,
            });
        }
    }

    NoteDogInfo {
        root_folder: root.to_string_lossy().to_string(),
        total_notebooks: notebooks.len(),
        total_sections,
        total_notes,
        notebooks,
    }
}

/// Helper to get the version history directory for a note
fn get_version_dir_for_note(note_path: &Path) -> PathBuf {
    let root = if let Some(parent3) = note_path.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
        parent3.to_path_buf()
    } else {
        get_notedog_root_dir(None, None)
    };
    let versions_root = root.join(".notedog_versions");
    let filename = note_path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let parent = note_path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "default".to_string());
    let grand = note_path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "default".to_string());

    versions_root.join(grand).join(parent).join(filename)
}

/// Create a snapshot revision when saving a note
pub fn create_note_snapshot(note_path: &Path, content: &[u8]) -> io::Result<()> {
    let version_dir = get_version_dir_for_note(note_path);
    fs::create_dir_all(&version_dir)?;

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let nanos = now.subsec_nanos();

    // Check if identical to last version to avoid duplicate revisions
    if let Ok(entries) = fs::read_dir(&version_dir) {
        let mut rev_files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().map_or(false, |ext| ext == "rev"))
            .collect();
        rev_files.sort();
        if let Some(latest) = rev_files.last() {
            if let Ok(latest_bytes) = fs::read(latest) {
                if latest_bytes == content {
                    return Ok(());
                }
            }
        }
    }

    let dt: DateTime<Local> = DateTime::from(SystemTime::now());
    let formatted = dt.format("%Y-%m-%d_%H-%M-%S").to_string();
    let rev_filename = format!("{}_{}_{}.rev", secs, nanos, formatted);
    let target = version_dir.join(rev_filename);

    fs::write(target, content)
}

/// List all version history snapshots for a note
pub fn list_note_versions(note_path: &Path) -> Vec<NoteVersionItem> {
    let version_dir = get_version_dir_for_note(note_path);
    let mut versions = Vec::new();

    if !version_dir.exists() {
        return versions;
    }

    if let Ok(entries) = fs::read_dir(&version_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "rev") {
                let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let parts: Vec<&str> = filename.split('_').collect();
                let ts_sec: u64 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
                
                let dt: DateTime<Local> = if ts_sec > 0 {
                    DateTime::from(UNIX_EPOCH + std::time::Duration::from_secs(ts_sec))
                } else {
                    DateTime::from(SystemTime::now())
                };
                let formatted_time = dt.format("%Y-%m-%d %H:%M:%S").to_string();
                let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

                versions.push(NoteVersionItem {
                    filename,
                    path: path.to_string_lossy().to_string(),
                    timestamp_sec: ts_sec,
                    formatted_time,
                    size_bytes,
                });
            }
        }
    }

    versions.sort_by(|a, b| b.timestamp_sec.cmp(&a.timestamp_sec));
    versions
}

/// Available smart templates
pub fn get_builtin_templates() -> Vec<NoteTemplate> {
    let now: DateTime<Local> = DateTime::from(SystemTime::now());
    let date_str = now.format("%Y-%m-%d %H:%M").to_string();

    vec![
        NoteTemplate {
            id: "blank".to_string(),
            name: "Blank Note".to_string(),
            icon: "📄".to_string(),
            description: "Empty markdown note".to_string(),
            content: format!("# {{{{title}}}}\n\nWrite your notes here...\n"),
        },
        NoteTemplate {
            id: "todo".to_string(),
            name: "Todo & Checklist".to_string(),
            icon: "✅".to_string(),
            description: "Interactive task list with tickboxes".to_string(),
            content: format!(
                r#"# 📝 {{{{title}}}}

**Date**: {}

## ⚡ Priority Tasks
- [ ] 
- [ ] 
- [ ] 

## 📌 Secondary Items
- [ ] 

## 💡 Notes & Ideas
- 
"#,
                date_str
            ),
        },
        NoteTemplate {
            id: "shopping".to_string(),
            name: "Shopping & Grocery List".to_string(),
            icon: "🛒".to_string(),
            description: "Categorized produce, dairy, bakery & pantry".to_string(),
            content: format!(
                r#"# 🛒 {{{{title}}}}

**Date**: {}

## 🥦 Fresh Produce & Vegetables
- [ ] Apples / Fruit
- [ ] Greens / Salad

## 🥛 Dairy & Refrigerated
- [ ] Milk
- [ ] Cheese
- [ ] Eggs
- [ ] Butter

## 🍞 Bakery & Pantry
- [ ] Bread / Rolls
- [ ] Pasta / Rice
- [ ] Coffee / Tea

## 🧼 Household & Essentials
- [ ] Paper Towels
- [ ] Dish Soap
"#,
                date_str
            ),
        },
        NoteTemplate {
            id: "meeting".to_string(),
            name: "Meeting & Agenda".to_string(),
            icon: "📅".to_string(),
            description: "Structured agenda, discussion notes and action items".to_string(),
            content: format!(
                r#"# 📅 {{{{title}}}}

**Date & Time**: {}
**Participants**: 
**Location / Link**: 

## 🎯 Meeting Goals
1. 

## 💬 Discussion Notes
- 

## ⚡ Action Items
- [ ] **Who**: Task description
- [ ] **Who**: Follow-up item
"#,
                date_str
            ),
        },
        NoteTemplate {
            id: "retro".to_string(),
            name: "Sprint / Project Retro".to_string(),
            icon: "🚀".to_string(),
            description: "What went well, what needs improvement, and next steps".to_string(),
            content: format!(
                r#"# 🚀 {{{{title}}}}

**Date**: {}

## 🟢 What Went Well
- 

## 🔴 What Needs Improvement
- 

## 💡 Key Learnings
- 

## ⚡ Action Items
- [ ] 
"#,
                date_str
            ),
        },
        NoteTemplate {
            id: "mermaid".to_string(),
            name: "Mermaid Flowchart Diagram".to_string(),
            icon: "📊".to_string(),
            description: "Visual flowchart with decision trees and process blocks".to_string(),
            content: format!(
                r#"# 📊 {{{{title}}}}

**Created**: {}

## 🌲 Process Flowchart
```mermaid
graph TD
    A[Start Process] --> B{{Check Conditions}}
    B -->|Passed| C[Execute Next Step]
    B -->|Failed| D[Log Diagnostic Error]
    C --> E[Final Result]
    D --> E
```

### 📝 Notes & Architecture Details
- Block **A**: Entry point
- Block **B**: Validation logic
"#,
                date_str
            ),
        },
    ]
}
