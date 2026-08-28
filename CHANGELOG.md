# 📜 Changelog

All notable changes to **CommanderDog** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.1] - 2026-08-28

### 🛡️ Added — Configurable Storage Roots & Sandboxed User RBAC
- **Configurable Storage Roots (`[[storage.roots]]`)**:
  - Define any number of storage roots in `config.toml` (e.g. Mass Storage `/mnt/storage`, Application Data `/data`, Read-Only Backups `/mnt/backups`).
  - Each root supports `id`, `name`, `path`, `read_only: bool`, and `allowed_roles`.
- **System-Wide Sandboxing Switch (`allow_entire_system = false`)**:
  - Prevents CommanderDog from accessing arbitrary host files outside allowed storage roots and personal user homes.
  - When disabled, non-admin users and sandboxed accounts cannot traverse to `/etc`, `/sys`, or other unauthorized host paths.
- **Unified Path Validation Engine (`validate_path_access`)**:
  - Enforces path normalization (resolving `..`, `.`, traversal attacks) across all filesystem endpoints: listing, read, write, upload, download, move, copy, deltacopy, chmod, chown, delete, archive, diff, sync, and disk usage.
- **Per-User Allowed Roots RBAC (`allowed_roots`)**:
  - User accounts can be assigned specific allowed roots (e.g. `["storage", "data"]`) or `["*"]` for all roots.
  - Automatic SQLite migration: `ALTER TABLE users ADD COLUMN allowed_roots TEXT DEFAULT '["*"]'`.
- **Dynamic Home Directory Resolution**:
  - Linux PAM users dynamically resolve authentic `$HOME` from `/etc/passwd` (e.g. `/home/bolt`).
  - Virtual/Database users use configured `home_dir` with template fallback (`default_user_home_template = "/home/{username}"`).
- **Admin UI & Favorites Integration**:
  - Admin User Management table features interactive **Allowed Storage Roots** checkboxes alongside Protocol Services.
  - Pane **⭐ Quick Favorites** dropdown dynamically loads and renders authorized storage roots from `GET /api/storage/roots`.

### 🐳 Added — Multi-Arch Alpine & Debian Containers (GHCR)
- **Multi-Arch Docker Images (`linux/amd64`, `linux/arm64`)**:
  - `ghcr.io/woofson/commanderdog:alpine`: Ultra-lightweight static musl container (~18 MB).
  - `ghcr.io/woofson/commanderdog:latest` & `:bookworm`: Debian 12 Bookworm slim container (~35 MB).
- **Automated CI/CD Publishing**: GitHub Actions workflow (`.github/workflows/docker-publish.yml`) with automated QEMU multi-arch cross-compilation and GHCR publishing.

---

## [0.4.0] - 2026-08-28

### 🪓 Added — File Splitter, Git Client & User Home Startup
- **Multi-Part File Splitter & Combiner**:
  - Split large archives into sized chunks (`.001`, `.002`, ...) with `.sha256` integrity manifest generation.
  - 1-Click synchronous file combiner with automated SHA-256 checksum verification.
- **Integrated Git Client**:
  - Real-time Git status indicator for repository directories.
  - Side-by-side git diff viewer with staged vs unstaged file tracking.
  - Commit composer, Git log history, and branch push/pull operations.
- **Universal Tilde Expansion & User `$HOME` Startup**:
  - Panes automatically launch in `/home/$USER` on session start.
  - Universal path expansion for `~` and `~/...` across all directory and API handlers.

---

## [0.3.6] - 2026-08-28

### 🎨 Added — XDG Configuration, External Themes & Custom Palette Builder
- **Unified Fast-Path XDG Configuration**:
  - Sub-millisecond single-pass configuration loading from `~/.config/commanderdog/config.toml` (and `/etc/commanderdog/config.toml`).
- **External TOML Themes Discovery**:
  - Automatically loads custom `.toml` themes dropped into `~/.config/commanderdog/themes/` or `/etc/commanderdog/themes/`.
  - Supports single-theme flat files and multi-theme array files (`[[themes]]`).
- **In-Browser Web Custom Theme Creator & Exporter**:
  - Interactive theme designer in Settings (<kbd>F10</kbd>) with live color pickers and 1-click TOML download.
- **Tiling WM Borderless Mode**:
  - CLI flags `--no-decorations` / `--frameless` and configuration setting `window_decorations = false` for seamless Hyprland/Sway integration.

---

## [0.3.5] - 2026-08-26

### 🖥️ Added — Native Standalone Window & Wayland Explicit Sync
- **Standalone Native Desktop App (`commanderdog --standalone`)**:
  - Runs with native WebKitGTK / WebView2 engine without Electron overhead (~25–35 MB RAM footprint).
- **Wayland / Hyprland GDK Error 71 Resolution**:
  - Explicit synchronization handling to eliminate `wl_surface` protocol crashes on Wayland compositors.
- **Automated AUR Packaging**:
  - Arch Linux AUR packages: `commanderdog` (source) and `commanderdog-bin` (pre-compiled binary).

---

## [0.3.0] - 2026-08-24

### 🪟 Added — In-Pane Tool Docking & Power Tools
- **In-Pane Docking Engine (`⇲ Dock / ⇱ Float`)**:
  - Dock EditorDog, Terminal Console, Byte Calculator, Background Transfers, and Git Client directly into any active directory pane.
- **Dual-Pane Text & Markdown Editor**:
  - Syntax highlighting for 12+ programming languages, Find & Replace engine, and live Markdown preview with Mermaid.js diagram support.
- **ConvertX Universal File Converter**:
  - In-browser conversion for images (WebP, PNG, JPG, AVIF), audio (MP3, WAV, FLAC, OGG), video (MP4, WebM, MKV, GIF), and documents (PDF, TXT, HTML).

---

## [0.2.0] - 2026-08-22

### ⚡ Added — DeltaCopy Engine & Cloud Storage Integrations
- **DeltaCopy / RoboCopy / TeraCopy Engine**:
  - Delta-skip unchanged files, post-transfer cryptographic SHA-256 verification, and exponential backoff auto-retries.
- **Multi-Cloud & Remote Protocols**:
  - Samba/CIFS (`smb://`), NFSv3/v4 (`nfs://`), AWS S3/MinIO/R2, SFTP/SSH, WebDAV, Proton Drive E2EE, and Syncthing dashboard.
- **Visual POSIX Permissions ($3\times 3$ Matrix)**:
  - Interactive `chmod`/`chown` matrix with real-time octal calculation and system user/group synchronization.

---

## [0.1.0] - 2026-08-20

### 🚀 Initial Release
- Multi-Tab orthodox 1-to-4 toggleable file panes (`Alt+1`–`4`).
- Orthodox keyboard shortcuts (`Tab`, `F1`–`F10`, `Insert`, `Space`).
- Slide-up native Web Terminal (PTY over WebSockets).
- Real-time background task manager and floating progress indicator.
