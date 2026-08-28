# 📋 Changelog — CommanderDog

All notable changes to CommanderDog are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v0.3.6] — 2026-08-28

### Added
- **🎨 User Configuration & XDG Hierarchy**:
  - Automatically loads and merges `~/.config/commanderdog/config.toml` and `~/.config/commanderdog/conf.d/*.toml` with highest precedence over system defaults.
  - Added support for defining active `default_theme` directly in `config.toml`.
- **📁 External Theme Engine (`~/.config/commanderdog/themes/`)**:
  - Drop any `.toml` file into `~/.config/commanderdog/themes/` (or `/etc/commanderdog/themes/`) to automatically load custom color palettes.
  - Supports single flat theme files (`id`, `name`, `bg_dark`, `accent`, etc.) and multi-theme array files (`[[themes]]`).
- **✨ In-Browser Custom Theme Creator**:
  - Web UI theme creator under **Settings (<kbd>F10</kbd>) $\rightarrow$ Themes & Palette**.
  - Interactive color pickers for background, panel, and accent colors.
  - **Export to TOML**: 1-click download of ready-to-use `.toml` theme files.
  - Client-side custom theme persistence in browser `localStorage`.
- **🪟 Toggleable Native Window Decorations (Hyprland / Tiling WMs)**:
  - Added CLI flags `--no-decorations` and `--frameless` to launch clean borderless windows without titlebars.
  - Added `[ui] window_decorations = false` in `conf.d/50-ui.toml` / `config.toml`.
  - Added in-app toggle in Settings UI.
- **🖼️ Interactive Theme Swatch Cards**:
  - Visual theme cards in Settings showing color dots and active outline ring.
  - Dynamic registration of all external and custom themes into Spotlight search (<kbd>Ctrl+K</kbd>).

---

## [v0.3.5] — 2026-08-28

### Fixed
- **Wayland / Hyprland DMA-BUF Protocol Crash (GDK Error 71)**:
  - Automatically sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `__NV_DISABLE_EXPLICIT_SYNC=1` on Linux Wayland environments.
  - Eliminates Wayland `wl_surface` protocol crashes and allows smooth native rendering under Hyprland, Sway, and GNOME Wayland.

---

## [v0.3.4] — 2026-08-28

### Fixed
- **Cross-Platform Native Window Handle Resolution**:
  - Fixed `UnsupportedWindowHandle` error on Linux Wayland compositors by binding WebKitGTK directly to the GTK widget hierarchy via `build_gtk()`.
  - Retained direct raw window handles (`build(&window)`) for Windows (WebView2) and macOS (WKWebView).

---

## [v0.3.3] — 2026-08-28

### Changed
- **Release Automation**:
  - Added `scripts/release.sh` for one-command cleanup, version bump, package generation, git release, and AUR publishing.

---

## [v0.3.2] — 2026-08-28

### Added
- **Standalone Native OS Window Mode (`commanderdog --standalone`)**:
  - Runs CommanderDog in its own standalone native OS window (WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS) without launching external browser tabs.
  - Automatically authenticates as the local OS user without login prompts.

---

## [v0.3.1] — 2026-08-28

### Added
- **Auto-Start in User `$HOME`**:
  - Automatically initializes all directory panes in `/home/$USER` instead of the root directory `/`.
  - Added universal tilde expansion (`~` and `~/...`) in VFS backend and address bars.

---

## [v0.3.0] — 2026-08-28

### Added
- **🪟 In-Pane Tool Docking (`⇲ Dock / ⇱ Float`)**:
  - Dock EditorDog, Terminal Console, Byte Calculator, Background Transfers, and Git Client directly into any active directory pane.
- **🌲 Integrated Git Client & Version Control Engine**:
  - Live repository status badges, side-by-side git diff viewer, visual staging, commit composer, and Push/Pull/Log tools.
- **📦 Multi-Format Packaging**:
  - Arch Linux AUR packages: `commanderdog` (source) and `commanderdog-bin` (binary).
  - Alpine Linux `.apk` packaging in `scripts/build-packages.sh`.
- **🧩 Multi-Part File Splitter & Combiner**:
  - Split large archives into sized chunks with `.sha256` checksum manifests and 1-click combiner.

---

## [v0.2.0] — [v0.2.14] — 2026-08-23 — 2026-08-28

### Added
- Flat / Branch View (<kbd>Ctrl+B</kbd>) across recursive trees.
- Live Content Grep with **"Feed to Pane"** virtual lists.
- Two-Way Directory Synchronizer with smart compare.
- Disk Usage & Treemap Storage Analyzer.
- Proton Drive E2EE integration, AWS S3/MinIO, SMB/CIFS, and NFS mounts.
- Visual POSIX $3\times 3$ `chmod`/`chown` matrix editor.
- ConvertX media & document format converter.
- 11 built-in themes (Amber, Gruvbox, Catppuccin Mocha/Latte, Tokyo Night, Monokai, Nord, Dracula, etc.).
- Linux PAM authentication & SQLite session backend.
