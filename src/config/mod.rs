use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub themes: ThemeConfig,
    #[serde(default)]
    pub paranoid: ParanoidConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub custom_actions: Vec<CustomAction>,
    #[serde(default)]
    pub bookmarks: Vec<BookmarkConfig>,
    #[serde(default)]
    pub syncthing: crate::tools::syncthing::SyncthingConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            auth: AuthConfig::default(),
            themes: ThemeConfig::default(),
            paranoid: ParanoidConfig::default(),
            ui: UiConfig::default(),
            custom_actions: default_custom_actions(),
            bookmarks: default_bookmarks(),
            syncthing: crate::tools::syncthing::SyncthingConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_root_path")]
    pub root_path: String,
    #[serde(default = "default_upload_max_mb")]
    pub upload_max_size_mb: usize,
    #[serde(default = "default_true")]
    pub enable_auth: bool,
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,
    #[serde(default = "default_session_hours")]
    pub session_duration_hours: u64,
    #[serde(default = "default_db_path")]
    pub database_path: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            root_path: default_root_path(),
            upload_max_size_mb: default_upload_max_mb(),
            enable_auth: true,
            jwt_secret: default_jwt_secret(),
            session_duration_hours: default_session_hours(),
            database_path: default_db_path(),
        }
    }
}

fn default_host() -> String { "0.0.0.0".to_string() }
fn default_port() -> u16 { 8080 }
fn default_root_path() -> String { "/".to_string() }
fn default_upload_max_mb() -> usize { 10240 } // 10 GB
fn default_true() -> bool { true }
fn default_jwt_secret() -> String { "commanderdog-super-secret-jwt-key-2026".to_string() }
fn default_session_hours() -> u64 { 72 }
fn default_db_path() -> String { "commanderdog.db".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    #[serde(default = "default_auth_mode")]
    pub mode: String, // "mixed", "builtin", "pam", "none"
    #[serde(default = "default_pam_service")]
    pub pam_service: String,
    #[serde(default = "default_false")]
    pub allow_guest: bool,
    #[serde(default = "default_admin_username")]
    pub default_admin_user: String,
    #[serde(default = "default_admin_password")]
    pub default_admin_pass: String,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            mode: default_auth_mode(),
            pam_service: default_pam_service(),
            allow_guest: false,
            default_admin_user: default_admin_username(),
            default_admin_pass: default_admin_password(),
        }
    }
}

fn default_auth_mode() -> String { "mixed".to_string() }
fn default_pam_service() -> String { "login".to_string() }
fn default_false() -> bool { false }
fn default_admin_username() -> String { "admin".to_string() }
fn default_admin_password() -> String { "commanderdog".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    #[serde(default = "default_theme_name")]
    pub default_theme: String,
    #[serde(default = "default_themes")]
    pub themes: Vec<ThemeDefinition>,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            default_theme: default_theme_name(),
            themes: default_themes(),
        }
    }
}

fn default_theme_name() -> String { "amber-charcoal".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeDefinition {
    pub id: String,
    pub name: String,
    pub bg_dark: String,
    pub bg_panel: String,
    pub bg_active: String,
    pub accent: String,
    pub accent_hover: String,
    pub text_main: String,
    pub text_muted: String,
    pub border: String,
}

fn default_themes() -> Vec<ThemeDefinition> {
    vec![
        ThemeDefinition {
            id: "amber-charcoal".to_string(),
            name: "Woofson Amber (Default)".to_string(),
            bg_dark: "#121214".to_string(),
            bg_panel: "#18181b".to_string(),
            bg_active: "#27272a".to_string(),
            accent: "#f59e0b".to_string(),
            accent_hover: "#fbbf24".to_string(),
            text_main: "#f4f4f5".to_string(),
            text_muted: "#a1a1aa".to_string(),
            border: "#3f3f46".to_string(),
        },
        ThemeDefinition {
            id: "gruvbox".to_string(),
            name: "Gruvbox Dark".to_string(),
            bg_dark: "#1d2021".to_string(),
            bg_panel: "#282828".to_string(),
            bg_active: "#3c3836".to_string(),
            accent: "#fabd2f".to_string(),
            accent_hover: "#fe8019".to_string(),
            text_main: "#ebdbb2".to_string(),
            text_muted: "#a89984".to_string(),
            border: "#504945".to_string(),
        },
        ThemeDefinition {
            id: "catppuccin-mocha".to_string(),
            name: "Catppuccin Mocha".to_string(),
            bg_dark: "#181825".to_string(),
            bg_panel: "#1e1e2e".to_string(),
            bg_active: "#313244".to_string(),
            accent: "#cba6f7".to_string(),
            accent_hover: "#f5c2e7".to_string(),
            text_main: "#cdd6f4".to_string(),
            text_muted: "#a6adc8".to_string(),
            border: "#45475a".to_string(),
        },
        ThemeDefinition {
            id: "catppuccin-latte".to_string(),
            name: "Catppuccin Latte (Light)".to_string(),
            bg_dark: "#dce0e8".to_string(),
            bg_panel: "#eff1f5".to_string(),
            bg_active: "#e6e9ef".to_string(),
            accent: "#8839ef".to_string(),
            accent_hover: "#1e66f5".to_string(),
            text_main: "#4c4f69".to_string(),
            text_muted: "#6c6f85".to_string(),
            border: "#bcc0cc".to_string(),
        },
        ThemeDefinition {
            id: "tokyo-night".to_string(),
            name: "Tokyo Night".to_string(),
            bg_dark: "#16161e".to_string(),
            bg_panel: "#1a1b26".to_string(),
            bg_active: "#24283b".to_string(),
            accent: "#7aa2f7".to_string(),
            accent_hover: "#7dcfff".to_string(),
            text_main: "#c0caf5".to_string(),
            text_muted: "#9aa5ce".to_string(),
            border: "#3b4261".to_string(),
        },
        ThemeDefinition {
            id: "monokai".to_string(),
            name: "Monokai Pro".to_string(),
            bg_dark: "#1e1f1c".to_string(),
            bg_panel: "#272822".to_string(),
            bg_active: "#3e3d32".to_string(),
            accent: "#ffd866".to_string(),
            accent_hover: "#a9dc76".to_string(),
            text_main: "#f8f8f2".to_string(),
            text_muted: "#939293".to_string(),
            border: "#49483e".to_string(),
        },
        ThemeDefinition {
            id: "solarized-dark".to_string(),
            name: "Solarized Dark".to_string(),
            bg_dark: "#00212b".to_string(),
            bg_panel: "#002b36".to_string(),
            bg_active: "#073642".to_string(),
            accent: "#268bd2".to_string(),
            accent_hover: "#2aa198".to_string(),
            text_main: "#839496".to_string(),
            text_muted: "#657b83".to_string(),
            border: "#586e75".to_string(),
        },
        ThemeDefinition {
            id: "ayu-dark".to_string(),
            name: "Ayu Dark".to_string(),
            bg_dark: "#0b0e14".to_string(),
            bg_panel: "#0f1419".to_string(),
            bg_active: "#1f2430".to_string(),
            accent: "#e6b450".to_string(),
            accent_hover: "#ffb454".to_string(),
            text_main: "#e6e1cf".to_string(),
            text_muted: "#707a8c".to_string(),
            border: "#252e37".to_string(),
        },
        ThemeDefinition {
            id: "nord".to_string(),
            name: "Nord Frost".to_string(),
            bg_dark: "#242933".to_string(),
            bg_panel: "#2e3440".to_string(),
            bg_active: "#3b4252".to_string(),
            accent: "#88c0d0".to_string(),
            accent_hover: "#81a1c1".to_string(),
            text_main: "#eceff4".to_string(),
            text_muted: "#d8dee9".to_string(),
            border: "#4c566a".to_string(),
        },
        ThemeDefinition {
            id: "dracula".to_string(),
            name: "Dracula Dark".to_string(),
            bg_dark: "#1e1f29".to_string(),
            bg_panel: "#282a36".to_string(),
            bg_active: "#44475a".to_string(),
            accent: "#bd93f9".to_string(),
            accent_hover: "#ff79c6".to_string(),
            text_main: "#f8f8f2".to_string(),
            text_muted: "#6272a4".to_string(),
            border: "#6272a4".to_string(),
        },
        ThemeDefinition {
            id: "midnight-blue".to_string(),
            name: "Midnight Commander Blue".to_string(),
            bg_dark: "#000044".to_string(),
            bg_panel: "#000088".to_string(),
            bg_active: "#0000aa".to_string(),
            accent: "#00ffff".to_string(),
            accent_hover: "#ffffff".to_string(),
            text_main: "#ffffff".to_string(),
            text_muted: "#a0a0ff".to_string(),
            border: "#00aaff".to_string(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParanoidConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_checksum_algo")]
    pub checksum_algorithm: String, // "sha256", "md5", "sha1"
    #[serde(default = "default_true")]
    pub verify_after_transfer: bool,
    #[serde(default = "default_true")]
    pub atomic_writes: bool,
    #[serde(default = "default_true")]
    pub trash_enabled: bool,
    pub custom_trash_dir: Option<String>,
    #[serde(default = "default_true")]
    pub confirm_delete: bool,
    #[serde(default = "default_true")]
    pub confirm_overwrite: bool,
}

impl Default for ParanoidConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            checksum_algorithm: default_checksum_algo(),
            verify_after_transfer: true,
            atomic_writes: true,
            trash_enabled: true,
            custom_trash_dir: None,
            confirm_delete: true,
            confirm_overwrite: true,
        }
    }
}

fn default_checksum_algo() -> String { "sha256".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default = "default_pane_count")]
    pub default_pane_count: usize, // 1 to 4
    #[serde(default = "default_layout_name")]
    pub default_layout: String, // "quad", "dual-vertical", "dual-horizontal", "single", "triple"
    #[serde(default = "default_true")]
    pub show_hidden_files: bool,
    #[serde(default = "default_view_mode")]
    pub default_view_mode: String, // "details", "compact", "grid"
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            default_pane_count: default_pane_count(),
            default_layout: default_layout_name(),
            show_hidden_files: true,
            default_view_mode: default_view_mode(),
        }
    }
}

fn default_pane_count() -> usize { 2 }
fn default_layout_name() -> String { "dual-vertical".to_string() }
fn default_view_mode() -> String { "details".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomAction {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub command: String,
    pub applicable_to: String, // "file", "folder", "archive", "all"
    #[serde(default)]
    pub in_background: bool,
}

fn default_custom_actions() -> Vec<CustomAction> {
    vec![
        CustomAction {
            id: "sha256-calc".to_string(),
            label: "Calculate SHA-256 Checksum".to_string(),
            icon: "shield-check".to_string(),
            command: "builtin:checksum:sha256".to_string(),
            applicable_to: "file".to_string(),
            in_background: false,
        },
        CustomAction {
            id: "folder-diff".to_string(),
            label: "Compare with Other Pane (Diff)".to_string(),
            icon: "columns-2".to_string(),
            command: "builtin:diff".to_string(),
            applicable_to: "all".to_string(),
            in_background: false,
        },
        CustomAction {
            id: "compress-zip".to_string(),
            label: "Compress to .zip".to_string(),
            icon: "archive".to_string(),
            command: "builtin:archive:zip".to_string(),
            applicable_to: "all".to_string(),
            in_background: true,
        },
        CustomAction {
            id: "compress-targz".to_string(),
            label: "Compress to .tar.gz".to_string(),
            icon: "archive".to_string(),
            command: "builtin:archive:targz".to_string(),
            applicable_to: "all".to_string(),
            in_background: true,
        },
        CustomAction {
            id: "compress-7z".to_string(),
            label: "Compress to .7z".to_string(),
            icon: "archive".to_string(),
            command: "builtin:archive:7z".to_string(),
            applicable_to: "all".to_string(),
            in_background: true,
        },
        CustomAction {
            id: "extract-here".to_string(),
            label: "Extract Archive Here".to_string(),
            icon: "unarchive".to_string(),
            command: "builtin:archive:extract".to_string(),
            applicable_to: "archive".to_string(),
            in_background: true,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkConfig {
    pub id: String,
    pub name: String,
    pub protocol: String, // "local", "sftp", "webdav"
    pub path: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
}

fn default_bookmarks() -> Vec<BookmarkConfig> {
    vec![
        BookmarkConfig {
            id: "home".to_string(),
            name: "Home Directory".to_string(),
            protocol: "local".to_string(),
            path: dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "/home".to_string()),
            host: None,
            port: None,
            username: None,
        },
        BookmarkConfig {
            id: "root".to_string(),
            name: "Root Filesystem".to_string(),
            protocol: "local".to_string(),
            path: "/".to_string(),
            host: None,
            port: None,
            username: None,
        },
    ]
}

/// conf.d Directory Reader & Hierarchical Merger
pub struct ConfigManager;

impl ConfigManager {
    /// Loads configuration by scanning multiple potential conf.d directories:
    /// 1. Built-in defaults
    /// 2. /etc/commanderdog/conf.d/*.toml
    /// 3. ~/.config/commanderdog/conf.d/*.toml
    /// 4. ./conf.d/*.toml (current working directory)
    pub fn load_all() -> AppConfig {
        let mut final_toml_val = toml::to_string(&AppConfig::default())
            .unwrap_or_default()
            .parse::<toml::Table>()
            .unwrap_or_default();

        let search_dirs = vec![
            PathBuf::from("/etc/commanderdog/conf.d"),
            dirs::config_dir().map(|d| d.join("commanderdog").join("conf.d")).unwrap_or_default(),
            PathBuf::from("./conf.d"),
        ];

        let mut discovered_files = Vec::new();

        for dir in search_dirs {
            if dir.exists() && dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&dir) {
                    let mut dir_files: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.extension().map_or(false, |ext| ext == "toml"))
                        .collect();
                    dir_files.sort();
                    discovered_files.extend(dir_files);
                }
            }
        }

        info!("ConfigManager found {} conf.d snippet files to merge", discovered_files.len());

        for file_path in discovered_files {
            info!("Merging conf.d snippet: {}", file_path.display());
            match fs::read_to_string(&file_path) {
                Ok(content) => {
                    match content.parse::<toml::Table>() {
                        Ok(table) => {
                            Self::deep_merge_tables(&mut final_toml_val, table);
                        }
                        Err(e) => {
                            warn!("Failed to parse TOML from {}: {}", file_path.display(), e);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to read {}: {}", file_path.display(), e);
                }
            }
        }

        match toml::from_str::<AppConfig>(&final_toml_val.to_string()) {
            Ok(config) => config,
            Err(e) => {
                warn!("Error decoding merged configuration: {}, falling back to defaults", e);
                AppConfig::default()
            }
        }
    }

    fn deep_merge_tables(base: &mut toml::Table, overlay: toml::Table) {
        for (key, value) in overlay {
            match value {
                toml::Value::Table(overlay_subtable) => {
                    if let Some(toml::Value::Table(base_subtable)) = base.get_mut(&key) {
                        Self::deep_merge_tables(base_subtable, overlay_subtable);
                    } else {
                        base.insert(key, toml::Value::Table(overlay_subtable));
                    }
                }
                _ => {
                    base.insert(key, value);
                }
            }
        }
    }
}
