# <img src="assets/logo.png" alt="CommanderDog Logo" height="36" style="vertical-align: -6px; margin-right: 8px;" /> CommanderDog Wishlist & ChewToys Vision

> *"One Commander to replace them all."*  
> The ultimate goal of CommanderDog is to provide a single, unified, ultra-fast, cross-platform file manager that seamlessly replaces a fragmented suite of 10+ standalone utilities with built-in power-tools (**"ChewToys"**).

---

## 🧸 The "ChewToys" Replacement Suite

| Target App to Replace | Built-in ChewToy Replacement | Status / Implementation |
| :--- | :--- | :--- |
| **FileZilla & Mountain Duck** | **Multi-Protocol Remote VFS** | ✅ SFTP/SSH, SMB/CIFS, WebDAV, Proton Drive, Hetzner Storage Box, Google Drive, S3, NFS |
| **rclone & rsync** | **DeltaCopy Engine & Background Tasks** | 🔄 Fast streaming, bandwidth throttling, retry logic, background worker pool |
| **Bvckup 2 & SyncToy** | **Delta Backup & Sync Engine** | 📋 Two-Way Sync, Echo/Mirror, Contribute, Archive/Versioning, USN Journal indexing |
| **Syncthing** | **Live Syncthing Controller** | 📋 P2P folder sync triggers, peer throughput monitor, conflict resolver |
| **PuTTY & OpenSSH SCP** | **Slide-Up PTY Web Terminal** | ✅ Embedded WebSocket pseudo-terminal (`bash`/`zsh`/`powershell`/`cmd.exe`) in active folder |
| **Total Commander / MC** | **Orthodox Multi-Pane Commander** | ✅ 1-to-4 panes, orthodox keyboard shortcuts (<kbd>F3</kbd>-<kbd>F10</kbd>), batch operations |
| **XYplorer & Directory Opus** | **Power Explorer Suite** | 🔄 Resizable columns, thumbnail gallery, visual filters, mini-tree, flat/branch view |
| **Cryptomator / VeraCrypt** | **Transparent Encrypted Vaults** | ✅ AES-256-GCM + Argon2id RAM-only `.cdvault` virtual filesystem containers |
| **PDFsam / Acrobat Split** | **PDFDog Power Studio** | ✅ Pure-Rust visual PDF merge, split by page range, 90° rotation, and page organizer |
| **FastStone / Feh Viewer** | **High-DPI Media Quick View** | ✅ Mouse wheel folder browsing, focal zoom, slideshow, audio/video playback |
| **Beyond Compare / WinMerge** | **DiffDog File & Directory Compare** | ✅ Side-by-side text/code diffs with unified diff viewer; dir comparison engine in progress |
| **HandBrake / FFmpeg GUI** | **ConvertX Media Transcoder** | ✅ In-browser media conversion (images, audio, video, documents) |

---

## 🌟 Feature Wishlist & Ideas

### 1. View & UI Enhancements
- [ ] **Interactive Drag-to-Resize Columns**: Drag column dividers in pane headers to adjust widths smoothly with localStorage persistence.
- [ ] **Custom Column Chooser**: Toggle visible columns per pane (Permissions, Octal, Owner, Group, SHA-256 hash, Git status, Color tags).
- [ ] **Thumbnail Gallery / Card View**: Adjustable preview grid (Small, Medium, Large, Hero) with live image/video/PDF thumbnails.
- [ ] **Togglable Folder Tree Sidebar**: Optional classic collapsible directory tree on the left side of any pane.
- [ ] **Flat / Branch View**: Show all files within subfolders recursively in a single flat list.
- [ ] **Synchronized Dual Scrolling**: Lock vertical scroll positions across adjacent panes for side-by-side visual folder comparisons.

### 2. Backup, Sync & Cloud Pipelines
- [ ] **Bvckup 2 Style Delta Backup**:
  - Block-level binary delta copying (transfer only modified byte blocks of large files).
  - Fast change indexing via Windows USN Journal and Linux `inotify`/`fanotify`.
  - Historical snapshots & retention rules in `_archive/`.
- [ ] **Real-Time Folder Watchers**: Automated triggers upon file change or external drive connection.
- [ ] **Cloud Drive Sync Pipelines**: Background sync tasks for Google Drive, Proton Drive, and S3 buckets.

### 3. File Operations & Power Tools
- [ ] **Advanced Multi-Rename Tool (Total Commander Style)**:
  - Token replacer: `[N]`, `[E]`, `[C#]`, `[YMD]`, `[EXIF_Date]`, `[ID3_Artist]`, regex capture groups.
  - Live side-by-side preview with 1-click Undo.
- [ ] **Virtual Archive VFS**: Browse inside `.zip`, `.tar.gz`, `.7z`, `.rar`, `.iso` without full extraction.
- [ ] **Multi-Tab Workspaces**: Save and restore multi-pane arrangements and open directories as named workspace profiles.
- [ ] **Type-Ahead Quick Filter**: Instant keyboard search filtering visible rows with wildcard and regex support.

### 4. Security & Enterprise
- [ ] **Enterprise OIDC SSO**: Authentik, Authelia, Keycloak, Okta, and Google Workspace integration alongside PAM.
- [ ] **Collaborative Office (WOPI)**: Live in-browser editing of `.docx`, `.xlsx`, `.pptx` via ONLYOFFICE / Collabora Online.
