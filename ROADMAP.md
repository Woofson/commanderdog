# 🗺️ CommanderDog Roadmap & Engineering Backlog

## ✅ Completed Features (v0.1.0 & v0.2.0)

### 🗂️ Core Navigation & UI Architecture
- [x] **Dynamic Multi-Pane Workspace**: 1-to-4 toggleable panels (`Alt+1..4`), single, dual-vertical, dual-horizontal, triple, and quad 2x2 layouts.
- [x] **Orthodox Keyboard & Function Keys**: Full Midnight Commander bindings (`Tab`, `F1`–`F10`, `Insert`, `Space`, `Ctrl+D`, `Shift+F6`).
- [x] **Touch & Empty-Space Gestures**: 450ms long-press context menu, double-click empty space parent jump, and mobile swipe navigation.
- [x] **Streamlined Top Toolbar**: Clean left-aligned logo with right-aligned layout switcher, unified `Tools ▾` menu, dedicated `Terminal` button, and `User Profile` dropdown.
- [x] **11 Built-in Themes**: Woofson Amber (Default), Gruvbox, Catppuccin Mocha, Catppuccin Latte, Tokyo Night, Monokai Pro, Solarized Dark, Ayu Dark, Nord Frost, Dracula, and Midnight Commander Blue.

### 👑 Administration, RBAC & Multi-User Auth
- [x] **Dedicated Administrator Control Panel (`👑 Admin Control Panel`)**: Strict role-guarded access for admins, completely separated from user preferences (`F10`).
- [x] **Granular Per-User RBAC Engine**: Assign user roles (`Admin`, `Standard User`, `Read-Only`), set home directories, and grant/restrict individual service access (`Local`, `SMB/CIFS`, `NFS`, `S3`, `SFTP`, `WebDAV`, `Terminal`, `Syncthing`, `ConvertX`).
- [x] **Native Linux PAM & Sudo Auto-Promotion**: Authenticate against local `/etc/shadow` accounts, automatically resolve Linux `sudo`/`wheel` group membership to Admin, and auto-sync user profiles to SQLite.
- [x] **User Profile Management**: In-app avatar selection, nickname customization, email management, and self-service password updates.

### 🌐 Storage, Network Mounts & Cloud Integrations
- [x] **Global Network Mounts with RBAC**: Admins can mount network shares (SMB/CIFS, NFS, S3, SFTP, WebDAV) and assign access permissions per user.
- [x] **Auto-Discovery in ⭐ Favorites**: Assigned network shares automatically appear under `🌐 Network & Global Mounts` in users' Favorites menu for 1-click jump.
- [x] **Protocols Supported**:
  - 🪟 Samba / Windows Shares (SMB / CIFS) via native client & domain auth
  - 🐧 Linux NFS (Network File System) automated export mounting to `/run/commanderdog/mounts/nfs/`
  - ☁️ S3 Object Storage (AWS, MinIO, Cloudflare R2, Backblaze B2, Hetzner S3) with AWS SigV4
  - 📦 Hetzner Storage Box 1-click fast preset (SFTP Port 23 & WebDAV HTTPS)
  - 🔒 SSH / SFTP remote servers
  - 🌐 WebDAV (Nextcloud, ownCloud, Synology, Apache/Nginx)
  - 🛡️ Proton Drive E2EE bridge
  - 🔄 Syncthing real-time continuous background synchronization dashboard
  - 🗄️ Virtual Archives (browse `.zip`, `.tar.gz`, `.tar.bz2`, `.tar.xz`, `.7z` as virtual directories).

### 🛠️ Built-in Tools, Comparison & Utilities
- [x] **ConvertX Universal File Converter**: Convert Images (WebP, PNG, JPEG, AVIF, BMP, TIFF), Audio (MP3, WAV, AAC, FLAC, OGG), Video (MP4, WebM, MKV, AVI, GIF), and Documents (PDF, TXT, HTML, DOCX).
- [x] **Syntax-Highlighted Editor**: Prism.js highlighting for 12+ languages, interactive Find & Replace with match navigation, and Mermaid.js markdown preview.
- [x] **Advanced File & Folder Diff Engine**: Fast folder comparison, selected files diff, deep cryptographic hash verification, and side-by-side text diff.
- [x] **Interactive Slide-Up Web Terminal (PTY)**: Linux pseudo-terminal running over WebSockets with shell mode locking.
- [x] **Paranoid Mode & DeltaCopy / TeraCopy Engine**: Pre-flight dry-runs, bit-for-bit SHA-256 verification, atomic writes, and XDG Trash recovery.
- [x] **Advanced Multi-File Bulk Renamer**: Regex find/replace, sequential numbering, case conversion, and real-time side-by-side preview.

### 📦 Packaging & Infrastructure
- [x] **Debian / Ubuntu `.deb` Package**: `dist/commanderdog_0.2.0_amd64.deb` with systemd unit.
- [x] **Arch Linux `PKGBUILD` & Alpine Linux `APKBUILD`**.
- [x] **Proxmox VE & Linux LXC Guide (`LXC.md`) & 1-Click Installer Script (`scripts/lxc-install.sh`)**.
- [x] **Docker & Docker Compose Deployment**.
- [x] **conf.d Snippet Hierarchy Engine** (`/etc/commanderdog/conf.d/*.toml`, `~/.config/commanderdog/conf.d/*.toml`, `./conf.d/*.toml`).

---

## 📋 Upcoming Backlog (v0.3.0 & Future Milestones)

### 🔑 1. OAuth2 / OpenID Connect (OIDC) Single Sign-On (SSO)
- [ ] Direct integration with OIDC identity providers:
  - **Authentik**
  - **Authelia**
  - **Keycloak**
  - **Google / GitHub / Generic OAuth2 Provider**
- [ ] Automatic OIDC group-to-role mapping (map IDP groups to CommanderDog admin/standard/readonly roles).
- [ ] Just-In-Time (JIT) user auto-provisioning upon initial SSO login.

### 🖱️ 2. Cross-Pane Drag-and-Drop Transfers
- [ ] Drag-and-drop files directly between open panels in the dual/quad grid to trigger copy/move dialogs.
- [ ] Native OS file drag-and-drop into any active pane for high-speed chunked uploads.

### 📖 3. In-Browser Document & Media Readers
- [ ] Embedded PDF document reader with zoom, page navigation, and text search.
- [ ] In-browser EPUB and comic archive (`.cbz`/`.cbr`) reader.
- [ ] Built-in audio/video player modal with playlist queuing.

### 🧩 4. Webhooks & Automation Actions
- [ ] Webhook triggers on file events (upload, rename, move, delete).
- [ ] Custom user script execution directly from the right-click context menu via `conf.d/30-actions.toml`.

### ⚡ 5. WASM / Plugin Extensibility Architecture
- [ ] WebAssembly (WASM) plugin hooks for custom file format previews, custom converters, and external cloud drivers.
