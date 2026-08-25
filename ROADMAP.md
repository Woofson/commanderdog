# 🗺️ CommanderDog Product Roadmap

> **Slogan**: *Multi-Tab Web Commander — By Woofson*  
> **Current Version**: `v0.2.13 (Release)`

This roadmap outlines planned capabilities, UX enhancements, and architectural milestones for CommanderDog, merging orthodox file commander power tools (Total Commander, Double Commander, Krusader, Directory Opus) with modern responsive web architecture.

---

## 🚀 1. Completed Milestones (v0.1.0 — v0.2.11)

- [x] **📱 Foldable & Adaptive Multi-Pane (`v0.3.0 UX`)**: Adaptive dual-pane breakpoint ($\ge 601\text{px}$), CSS viewport segments (`horizontal-viewport-segments: 2`), hinge/seam avoidance, and touch swipe gestures.
- [x] **🌲 Flat / Branch View (<kbd>Ctrl+B</kbd>)**: Recursive directory flattening into a unified pane view with global sorting (by size/date) and full batch operations.
- [x] **🔍 Live Content Grep & "Feed to Pane"**: Deep regex content search across trees with line snippets and 1-click **"Feed to Pane"** virtual results for batch operations.
- [x] **🏷️ Color Labels & Custom Tagging System**: SQLite-persisted color labels (🔴, 🟠, 🟡, 🟢, 🔵, 🟣) and custom text tag chips with context menu palette and interactive tag manager.
- [x] **🔀 Two-Way Visual Directory Synchronizer (`v0.2.11`)**: Side-by-side comparison between Left & Right directories with visual status indicators (**Newer ➔**, **Older ⬅**, **Identical ✔**, **Different Size ⚠️**, **Delete ✕**), 1-click direction override toggles, category filter chips, and Mirror/Smart 2-Way execution.
- [x] **📊 Visual Disk Usage Treemap & Storage Analyzer (`v0.2.11`)**: Rust recursive space aggregation engine with percentage consumption bars, 1-click folder drill-down, and Top 20 largest files table.
- [x] **📦 In-Browser Archive Engine**: Compress & Extract `.zip`, `.tar.gz`, `.tar.bz2`, `.tar.xz`, and `.7z` with custom compression levels.
- [x] **🔗 Link Sharing & Guest Upload Dropboxes**: Time/download-limited share links, password protection, guest `/share/:token` upload dropboxes, and active shares audit dashboard.
- [x] **⚡ Global Spotlight Quick-Switcher (<kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd>)**: Real-time fuzzy command palette searching across actions, common paths, bookmarks, and recent history.
- [x] **📚 Universal Document & PDF Reader**: In-browser PDF stream viewer with zoom/rotate/print/fullscreen, rich GitHub Markdown renderer with raw toggle, CSV/TSV interactive data grids with filter and sort, and web previews.
- [x] **📸 Rich Media Inspector & EXIF GPS Geotag Engine**: TIFF/EXIF binary camera parser, interactive Leaflet + OpenStreetMap location pin with Google/Apple Maps links, dominant color palette extraction, and byte-range video/audio stream player.
- [x] **🔐 Visual POSIX Permissions Matrix**: Visual $3\times 3$ `chmod`/`chown` matrix with octal calculator and recursive `-R` toggle.
- [x] **☁️ Multi-Cloud & Remote Storage**: SMB/CIFS, NFS, AWS S3/MinIO/R2, SFTP, WebDAV, Syncthing, and Proton Drive.

---

## 🎯 2. Active Next Priorities

### 🧩 1. Multi-Part File Splitter & Combiner
- **Split Large Files**: Split multi-gigabyte files into fixed-size chunks (e.g. `100MB`, `1GB`, `.001`, `.002`).
- **Join & Verify**: Concatenate split parts back into the original file with CRC32/SHA-256 integrity verification.

### 🔒 2. Transparent Encrypted Vaults (AES-256)
- **Zero-Knowledge Encrypted Folders**: Create password-protected encrypted vault directories.
- **On-the-Fly Decryption**: Files decrypt transparently in memory inside CommanderDog without exposing unencrypted files on disk.

### ⚙️ 3. Webhook & Automation Triggers
- **Folder Watchers**: Trigger automated actions when files arrive in a folder (e.g. auto-convert with ConvertX, decompress downloads, or run custom scripts).

### 🌐 4. OpenID Connect (OIDC) & SSO Integration
- **Enterprise SSO**: Support OpenID Connect (Authelia, Authentik, Keycloak, Okta, Google Workspace) alongside existing Linux PAM and SQLite auth engines.

### 📄 J. Collaborative Office Editing (ONLYOFFICE & Collabora WOPI)
- **WOPI / ONLYOFFICE Integration**: Live collaborative editing for `.docx`, `.xlsx`, `.pptx`.

---

## 📋 4. Release Phasing Matrix

```mermaid
graph TD
    A["v0.2.10 (Current)"] --> B["v0.3.0: Visual Synchronizer & Disk Treemap Analyzer"]
    B --> C["v0.3.5: Flat Branch View & Content Grep Feed-to-Pane"]
    C --> D["v0.4.0: Color Labels & File Splitter/Combiner"]
    D --> E["v0.4.5: Encrypted Vaults & Webhook Automations"]
    E --> F["v0.5.0: OIDC SSO & ONLYOFFICE / Collabora WOPI"]
```

