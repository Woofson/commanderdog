# 🗺️ CommanderDog Roadmap & Future Backlog

## ✅ Completed Features
- [x] **Orthodox Quad-Pane Architecture**: 1-to-4 toggleable panels (`Alt+1..4`), dual vertical/horizontal/triple layouts.
- [x] **Orthodox Keybindings**: Full Midnight Commander / Total Commander bindings (`Tab`, `F1`–`F10`, `Insert`, `Space`, `Ctrl+D`).
- [x] **Native Linux PAM & SQLite Authentication**: Direct PAM login against local `/etc/shadow` accounts and auto-group administrator resolution.
- [x] **Paranoid Mode & DeltaCopy / TeraCopy Engine**: Bit-for-bit CRC32 verification, auto-retry on locks, and pre-flight dry-runs.
- [x] **Multi-Cloud & Remote VFS Support**:
  - SFTP / SSH (Port 22 / 23)
  - WebDAV (Nextcloud / Synology / ownCloud)
  - S3 Object Storage (AWS, MinIO, Cloudflare R2, Backblaze B2, Hetzner S3)
  - 📦 Hetzner Storage Box Quick Preset
  - 🛡️ Proton Drive E2EE Cloud Bridge
  - 🔄 Syncthing Real-Time Sync Dashboard & Scanner
- [x] **Directory Sync & Deep Search**: 1-Way Mirror, Update, 2-Way Sync, filename globbing & full-text grep.
- [x] **Slide-Up Linux PTY Terminal**: Full interactive PTY terminal drawer (`Ctrl+\``).
- [x] **Mobile & Touch Optimization**: Long-press context menu, touchscreen swipe navigation, and responsive layout.
- [x] **Containerization & Native Packaging**: Production `Dockerfile`, `docker-compose.yml`, Proxmox `LXC.md` guide, `scripts/lxc-install.sh`, Debian `.deb`, Arch `PKGBUILD`, and Alpine `APKBUILD`.

---

## 📋 Upcoming Backlog / Planned Features

### 🔑 1. OAuth2 / OIDC Single Sign-On (SSO)
- Integration with OpenID Connect (OIDC) identity providers:
  - **Authentik**
  - **Authelia**
  - **Keycloak**
  - **Google / GitHub / Generic OAuth2 Provider**
- Group-to-role mapping (mapping OIDC groups to CommanderDog admin/editor/read-only roles).
- Automatic user provisioning upon initial login.

### 🧩 2. Plugin & Custom Extension API
- WASM / Rust dynamic plugins for file format viewers and custom tools.
- Webhook triggers on file upload, move, or deletion events.
