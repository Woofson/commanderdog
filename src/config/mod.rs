use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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
    #[serde(default)]
    pub standalone: bool,
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
            standalone: false,
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
    #[serde(default = "default_true")]
    pub window_decorations: bool, // Tiled WM / Hyprland toggle (decorations on/off)
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            default_pane_count: default_pane_count(),
            default_layout: default_layout_name(),
            show_hidden_files: true,
            default_view_mode: default_view_mode(),
            window_decorations: true,
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

/// Config & External Theme Manager
pub struct ConfigManager;

impl ConfigManager {
    /// Loads configuration by scanning hierarchical config files, conf.d directories, and external theme folders:
    /// 1. Built-in defaults
    /// 2. /etc/commanderdog/config.toml & /etc/commanderdog/conf.d/*.toml
    /// 3. ./config.toml & ./conf.d/*.toml
    /// 4. ~/.config/commanderdog/config.toml & ~/.config/commanderdog/conf.d/*.toml (highest priority)
    /// 5. External themes from ~/.config/commanderdog/themes/*.toml & /etc/commanderdog/themes/*.toml
    pub fn load_all() -> AppConfig {
        let mut final_toml_val = toml::to_string(&AppConfig::default())
            .unwrap_or_default()
            .parse::<toml::Table>()
            .unwrap_or_default();

        // 1. Gather config files in strict precedence order
        let mut config_files = Vec::new();

        // System-level
        let sys_config = PathBuf::from("/etc/commanderdog/config.toml");
        if sys_config.is_file() {
            config_files.push(sys_config);
        }
        let sys_confd = PathBuf::from("/etc/commanderdog/conf.d");
        Self::collect_toml_files_sorted(&sys_confd, &mut config_files);

        // Local working directory
        let local_config = PathBuf::from("./config.toml");
        if local_config.is_file() {
            config_files.push(local_config);
        }
        let local_confd = PathBuf::from("./conf.d");
        Self::collect_toml_files_sorted(&local_confd, &mut config_files);

        // User XDG / Home directory (~/.config/commanderdog)
        if let Some(user_config_dir) = dirs::config_dir().map(|d| d.join("commanderdog")) {
            let user_config = user_config_dir.join("config.toml");
            if user_config.is_file() {
                config_files.push(user_config);
            }
            let user_confd = user_config_dir.join("conf.d");
            Self::collect_toml_files_sorted(&user_confd, &mut config_files);

            // Ensure ~/.config/commanderdog/themes directory exists
            let user_themes_dir = user_config_dir.join("themes");
            let _ = fs::create_dir_all(&user_themes_dir);
        }

        info!("ConfigManager found {} config/snippet files to merge", config_files.len());

        for file_path in config_files {
            info!("Merging configuration file: {}", file_path.display());
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

        let mut config: AppConfig = match toml::from_str::<AppConfig>(&final_toml_val.to_string()) {
            Ok(cfg) => cfg,
            Err(e) => {
                warn!("Error decoding merged configuration: {}, falling back to defaults", e);
                AppConfig::default()
            }
        };

        // 2. Discover and load external themes from themes/ directories
        Self::load_external_themes(&mut config);

        config
    }

    fn collect_toml_files_sorted(dir: &Path, files: &mut Vec<PathBuf>) {
        if dir.exists() && dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                let mut dir_files: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.extension().map_or(false, |ext| ext == "toml"))
                    .collect();
                dir_files.sort();
                files.extend(dir_files);
            }
        }
    }

    /// Scans external theme directories and loads theme definitions
    fn load_external_themes(config: &mut AppConfig) {
        let theme_dirs = vec![
            PathBuf::from("/etc/commanderdog/themes"),
            PathBuf::from("./themes"),
            dirs::config_dir().map(|d| d.join("commanderdog").join("themes")).unwrap_or_default(),
        ];

        let mut theme_files = Vec::new();
        for dir in theme_dirs {
            Self::collect_toml_files_sorted(&dir, &mut theme_files);
        }

        for file_path in theme_files {
            info!("Loading external theme definition: {}", file_path.display());
            if let Ok(content) = fs::read_to_string(&file_path) {
                let stem = file_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "custom".to_string());
                Self::parse_and_insert_themes(config, &content, &stem);
            }
        }
    }

    fn parse_and_insert_themes(config: &mut AppConfig, content: &str, file_stem: &str) {
        // Try parsing as multi-theme array struct: [[themes]] or [themes] themes = [...]
        #[derive(Deserialize)]
        struct MultiThemeContainer {
            themes: Option<Vec<ThemeDefinition>>,
            theme: Option<ThemeDefinition>,
        }

        if let Ok(container) = toml::from_str::<MultiThemeContainer>(content) {
            if let Some(list) = container.themes {
                for t in list {
                    Self::upsert_theme(&mut config.themes.themes, t);
                }
                return;
            }
            if let Some(t) = container.theme {
                Self::upsert_theme(&mut config.themes.themes, t);
                return;
            }
        }

        // Try parsing directly as a single flat ThemeDefinition:
        // id = "...", name = "...", bg_dark = "...", ...
        #[derive(Deserialize)]
        struct FlatTheme {
            id: Option<String>,
            name: Option<String>,
            bg_dark: String,
            bg_panel: String,
            bg_active: String,
            accent: String,
            accent_hover: Option<String>,
            text_main: String,
            text_muted: String,
            border: String,
        }

        if let Ok(flat) = toml::from_str::<FlatTheme>(content) {
            let id = flat.id.unwrap_or_else(|| file_stem.to_string());
            let name = flat.name.unwrap_or_else(|| {
                file_stem
                    .split(['-', '_'])
                    .map(|w| {
                        let mut c = w.chars();
                        match c.next() {
                            None => String::new(),
                            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                        }
                    })
                    .collect::<Vec<String>>()
                    .join(" ")
            });
            let accent = flat.accent.clone();
            let accent_hover = flat.accent_hover.unwrap_or(accent);

            let theme = ThemeDefinition {
                id,
                name,
                bg_dark: flat.bg_dark,
                bg_panel: flat.bg_panel,
                bg_active: flat.bg_active,
                accent: flat.accent,
                accent_hover,
                text_main: flat.text_main,
                text_muted: flat.text_muted,
                border: flat.border,
            };
            Self::upsert_theme(&mut config.themes.themes, theme);
        }
    }

    fn upsert_theme(themes: &mut Vec<ThemeDefinition>, new_theme: ThemeDefinition) {
        if let Some(existing) = themes.iter_mut().find(|t| t.id == new_theme.id) {
            *existing = new_theme;
        } else {
            themes.push(new_theme);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_external_theme_flat_parsing() {
        let mut config = AppConfig::default();
        let sample_toml = r##"
            id = "hyprland-cyan"
            name = "Hyprland Cyan"
            bg_dark = "#0b0f14"
            bg_panel = "#111822"
            bg_active = "#1b2533"
            accent = "#00e5ff"
            accent_hover = "#33ebff"
            text_main = "#e1e7ec"
            text_muted = "#7a889b"
            border = "#00e5ff"
        "##;

        ConfigManager::parse_and_insert_themes(&mut config, sample_toml, "hyprland-cyan");
        let theme = config.themes.themes.iter().find(|t| t.id == "hyprland-cyan");
        assert!(theme.is_some());
        let t = theme.unwrap();
        assert_eq!(t.name, "Hyprland Cyan");
        assert_eq!(t.accent, "#00e5ff");
    }

    #[test]
    fn test_external_theme_multi_parsing() {
        let mut config = AppConfig::default();
        let sample_toml = r##"
            [[themes]]
            id = "custom-one"
            name = "Custom One"
            bg_dark = "#101010"
            bg_panel = "#202020"
            bg_active = "#303030"
            accent = "#ff0055"
            accent_hover = "#ff3377"
            text_main = "#ffffff"
            text_muted = "#888888"
            border = "#444444"
        "##;

        ConfigManager::parse_and_insert_themes(&mut config, sample_toml, "themes");
        let theme = config.themes.themes.iter().find(|t| t.id == "custom-one");
        assert!(theme.is_some());
        assert_eq!(theme.unwrap().accent, "#ff0055");
    }

    #[test]
    fn test_deep_merge_tables() {
        let mut base_toml: toml::Table = r##"
            [themes]
            default_theme = "amber-charcoal"
            [ui]
            show_hidden_files = true
        "##.parse().unwrap();

        let overlay_toml: toml::Table = r##"
            [themes]
            default_theme = "catppuccin-mocha"
            [ui]
            window_decorations = false
        "##.parse().unwrap();

        ConfigManager::deep_merge_tables(&mut base_toml, overlay_toml);

        let themes_tbl = base_toml.get("themes").unwrap().as_table().unwrap();
        assert_eq!(themes_tbl.get("default_theme").unwrap().as_str().unwrap(), "catppuccin-mocha");

        let ui_tbl = base_toml.get("ui").unwrap().as_table().unwrap();
        assert_eq!(ui_tbl.get("show_hidden_files").unwrap().as_bool().unwrap(), true);
        assert_eq!(ui_tbl.get("window_decorations").unwrap().as_bool().unwrap(), false);
    }
}
