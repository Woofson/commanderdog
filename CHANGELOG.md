# 📜 Changelog

All notable changes to **CommanderDog** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.3-rc5] - 2026-09-04

### 🎨 Dedicated ChewToy Icon Integrations & Customizable Tools Launchpad
- **Terminal (Bite!) Visual Identity**:
  - Integrated dedicated high-resolution graphical asset `assets/term.png` across the slide-up Terminal drawer header, in-pane docked terminal headers, panel right-click context menu ("Open in Terminal"), Tools dropdown, and Spotlight quick-actions.
- **Sleek & Larger Icons in Tools & Launchpad Dropdown**:
  - Standardized Tools & Utilities dropdown menu icons to 18px with crisp alignment and balanced vertical spacing.
- **Customizable & Rearrangable Tools Launchpad**:
  - **Native Drag-and-Drop Reordering**: Rearrange the order of ChewToys and tools in the Launchpad dropdown menu with real-time drag-and-drop handles (`⋮⋮`).
  - **1-Click Direction Controls**: Fast Move to Top (⤒), Move Up (▲), Move Down (▼), and Move to Bottom (⤓) ChewToy buttons.
  - **Item Visibility Toggles**: Checkboxes to show or hide any tool from the dropdown suite with active visible counter (`X / 16 Visible`).
  - **Dedicated Settings Tab & Dropdown Quick-Action**: Added "Tools Menu" manager tab in Settings Modal and an instant "Customize Tools Menu..." footer shortcut in the dropdown.
  - **State Persistence & Reset**: User preferences persist across sessions in `localStorage` with a 1-click "Reset Defaults" action.
- **EditorDog, Calculator & Task Manager Visual Identity**:
  - Integrated dedicated high-resolution graphical assets `assets/edit.png`, `assets/calc.png`, and `assets/task.png` across the entire application interface.
  - Upgraded the main header Task activity button (`#btn-header-tasks`), Tools & Launchpad dropdown items, floating window headers, minimized floating pills (`#tasks-pill`, `#editor-pill`, `#calc-pill`), and in-pane docked ChewToy titles to render their respective dedicated graphical icons.
  - Added full image icon support in the Spotlight Quick-Switcher (Ctrl+K).

## [0.7.2] - 2026-09-04

### 🪟 ChewToy Design System, Delta Sync Templates, Hostname Badges & Polish
- **Delta Backup & Sync Studio Templates & Visual Exclusion Builder**:
  - **1-Click Profile Templates**: Added quick replication presets (`🪞 NAS Mirror`, `💻 Codebase Sync`, `📦 Snapshot Vault`, `📸 Media Backup`) for both live diff studio and scheduled job creator.
  - **Visual Exclusion Builder**: Interactive preset exclusion chips (`node_modules`, `.git`, `target/`, `.cache/`, `tmp/`, `*.tmp`, `.DS_Store`, `Thumbs.db`, `*.log`, `dist/`, `*.bak`) with dynamic custom pattern tag input.
  - **Pattern Engine & SQLite Migration**: Integrated wildcard and substring path matching into sync scanning/execution and persisted exclusions per backup profile in SQLite.
- **ChewToy Design & Layout Language Specification**:
  - Enforced 42px header bar standard with full drag handle (`cursor: grab;`), uniform `28px` square buttons, and right-aligned icon-only layout switches.
  - Standardized flat stealthy window control buttons (Minimize, Maximize, Dock, Float, Close) across all ChewToys.
  - Unified sub-headers and inner workspace toolbars to `26px x 26px` buttons across NoteDog, Git Manager, Diff Engine, Disk Usage, and Sync Studio.
  - Docked in-pane ChewToys now use icon-only float buttons (`external-link`).
- **Terminal Console (Bite!) Lifecycle**:
  - Added clean handling for `Ctrl+D` (EOF), shell `logout`, and `exit` commands to automatically close the docked drawer/window and reset PTY state.
- **Chewtoy & Tools Launchpad Icon**:
  - Replaced generic grid icon with dedicated `assets/tool.png` icon on the main header Tools & Launchpad suite.
- **EditorDog Compact Canvas & Interactive Status Bar Selector**:
  - Removed redundant inner document pane sub-headers; tabs now connect directly to the editor canvas for maximum vertical space.
  - Interactive status bar language selector (`RUST ▾`, `JS / TS ▾`, etc.) with auto-detection and 1-click syntax mode switching.
- **Compact Breadcrumbs & Sleek Panel Git Badges**:
  - Tightened breadcrumb spacing (`gap: 2px;`), streamlined separator chips, and compacted storage root dropdown buttons.
  - Minified panel git branch badge (9.5px, 17px height, 10px icons) for an uncluttered path navigation bar.
- **Universal "New ▶" Context Menu & File Template Engine**:
  - Accessible anywhere across all file rows, cards, compact items, and empty background space.
  - Built-in rich templates for Plain Text (`.txt`), Markdown (`.md`), HTML5 (`.html`), CSS (`.css`), JavaScript (`.js`), TypeScript (`.ts`), Python (`.py`), Rust (`.rs`), Bash (`.sh`), JSON (`.json`), and YAML (`.yaml`).
  - Dynamic variable expansion: `{{TITLE}}` (humanized title), `{{FILENAME}}`, `{{NAME}}`, `{{DATE}}` (`YYYY-MM-DD`), `{{TIME}}`, `{{USER}}`, `{{ISO_DATE}}`, `{{YEAR}}`, `{{MONTH}}`, `{{DAY}}`, `{{AUTHOR}}`.
  - Interactive "Create from Template" dialog with real-time live preview code editor and instant EditorDog opening.
  - Full "Templates" manager tab in Settings to create, edit, duplicate, test, or delete custom file templates, plus 1-click "Save Selected File as Template" action.
- **Task Manager & Activity Polish**:
  - Balanced 32px height for main activity button, resolved stuck UI pill states, and added automated completed tasks pruning.
- **Documentation Reorganization**:
  - Reorganized root documentation into a structured [`manuals/`](manuals/README.md) hierarchy and synchronized `ROADMAP.md`.

---

## [0.7.1] - 2026-09-03

### 🎨 Universal Floating Viewers, Live Tail Streaming, Bundled Fonts & Themes
- **Universal Floating & Resizable Viewers**:
  - Detachable floating window mode for Universal Document/Text viewer and Image viewer with window geometry persistence in `localStorage`.
  - Non-fiddly, full title bar drag handle and desktop edge/corner resizing.
  - Live log follow mode (`tail -f`) with custom line count filtering (`-n 50`, `100`, `250`, `500`, `1000`, `All`), glowing live indicator, and word-wrap toggle.
  - Unified right-aligned header layout with uniform `28px` control buttons.
- **Offline Embedded JetBrainsMono Nerd Fonts**:
  - Embedded local `JetBrainsMono Nerd Font` and `Symbols Nerd Font` into the binary via `rust_embed` for native out-of-the-box `eza --icons`, `starship`, and `fish` powerline glyphs without requiring client OS font installations.
- **Official Woofsons Amber Palette & Auto-Merge Engine**:
  - Implemented official **`Woofsons Amber Charcoal`** (Dark) and **`Woofsons Amber Zink`** (Light) themes.
  - Automatic configuration merge ensuring new built-in themes are dynamically available even on existing installations with prior `config.toml` files.
  - Fixed white-on-white text contrast bug across all `<select>` and `<option>` elements globally.
- **Procedural Randomized Login Background & Version Sync**:
  - Dynamically computes random focal positions, radii, and amber opacities on each reload so no two logins look identical.
  - Centralized compile-time versioning in `Cargo.toml` with early unauthenticated API sync updating all `.login-version-badge` and UI badges dynamically.
- **Chewtoy Enhancements & Direct Downloads**:
  - **Right-Click Context Menu**: Added **"Save / Download File"** action directly in the file context menu for 1-click downloads.
  - **Notes (NoteDog Chewtoy)**: Fixed note loading authorization header resolution and added NoteDog TUI `.md.enc` encryption detection.
  - **Bite! Terminal Console**: Added dynamic `ResizeObserver` to docked terminal host automatically updating xterm dimensions and dispatching PTY WebSocket resize frames.
  - **Background Transfers & Task Manager**: Fixed stuck "Uploading..." floating pill by enforcing `.active` CSS class toggling in `finally` blocks.

---

## [0.7.0] - 2026-09-01

### 📝 NoteDog Notes Studio & Orthodox Power Tools Suite
- **NoteDog Hierarchical Markdown Notes Studio**:
  - **Tree Organizer & Notebook Structure**: Seamless creation, nesting, categorization, and editing of markdown documents with folder hierarchies.
  - **Interactive Checklists & Tasks**: Live interactive checklist parsing (`[ ]` / `[x]`) with instant status persistence.
  - **Template Engine**: Instant note creation from built-in templates (*Meeting Notes*, *Project Plan*, *Checklist / SOP*, *Daily Journal*).
  - **Automatic Snapshot Revision History**: In-place version snapshots stored under `.notedog_versions/` with 1-click preview and rollback.
  - **Instant Search & Tag Filtering**: Fast real-time keyword indexing and tag filtering across all user notes.
- **Enhanced Color Labels & Custom Tagging System**:
  - Direct metadata tagging with persistent SQLite indexes and file table badges.
  - Extended color preset palette (`🔴 🟠 🟡 🟢 🔵 🟣`) and instant filter shortcuts.
- **Multi-Platform Release & Packaging Updates**:
  - Linux packaging: Arch Linux (`PKGBUILD`, `commanderdog-bin.PKGBUILD`), Alpine Linux (`APKBUILD`), Debian/Ubuntu binaries, and multi-arch Docker images.
  - Windows packaging: Tauri v2 standalone native executable, MSI installer, NSIS setup, Scoop manifest, and Winget manifests.

---

## [0.6.9] - 2026-08-31

### ⚡ Bvckup 2 & SyncToy Delta Backup Engine, Background Daemons & Folder Watchers
- **4 Core Replication Profiles (SyncToy & Bvckup 2)**:
  - **🔄 Synchronize (Two-Way Sync)**: Bi-directional replication with collision and conflict detection, syncing newer files across both left and right panes.
  - **🪞 Echo / Mirror (One-Way Backup)**: Makes Destination an exact 1:1 replica of Source (left-to-right), updating modified files and automatically deleting destination orphans.
  - **➕ Contribute / Additive Backup**: Replicates additions and modifications from Source to Destination without deleting any destination files.
  - **🕰️ Subscribe / Historical Versioning**: Retains older versions of modified and deleted files in timestamped `_archive/YYYY-MM-DD_HHmmss/` snapshot trees with automatic retention pruning (e.g. 30 days).
- **Block-Level In-Place Binary Delta Copy Engine (Bvckup 2 Speed)**:
  - **Fine-Grained 64KB Chunk Hashing**: Compares source and destination blocks using CRC32 checksums, skipping identical blocks and writing *only* modified byte blocks in-place directly on disk.
  - **High-Speed Differential Patching**: Massive speedup for large databases, virtual disk images, video projects, and log files with zero redundant transfers.
  - **Cryptographic Verification**: Post-transfer bit-perfect integrity validation supporting CRC32 and SHA-256 signatures.
- **Automated Backup Profiles & Background Scheduler**:
  - **Persistent SQLite Backup Profile Manager**: Create, edit, toggle, and delete named backup jobs stored securely in the database.
  - **Background Tokio Scheduler Daemon**: Periodic automated execution for intervals (every X minutes/hours) and daily scheduled times (e.g. `02:00`).
  - **⚡ Real-Time Continuous Watchers**: Automated folder monitoring triggers syncing changes as soon as files are modified.
  - **Webhook Notifications**: Automated JSON POST webhook alerts on backup completion/failure for Discord, Slack, Telegram, Matrix, or custom servers.
  - **Execution History & Audit Log**: Audit log tracking timestamp, profile name, status (Success/Failed), files copied/updated/deleted/archived, and elapsed duration.
- **Upgraded Sync & Backup Studio UI**:
  - **3-Tab Navigation**: Seamless switching between *Live Diff & Replication*, *Backup Jobs & Scheduler*, and *Run History & Logs*.
  - **Interactive Profile Selection Cards**: Visual cards with descriptive summaries for Synchronize, Echo, Contribute, and Subscribe.
  - **Rich Action Badges & Filters**: Clear visual status indicators (`➔ Copy Right`, `⬅ Copy Left`, `⚡ Delta Patch`, `📦 Archive Old`, `🗑 Delete`, `✔ Equal`).
  - **1-Click Profile Creation**: Pre-fill and save any active diff comparison into a reusable automated backup job.

---

## [0.6.8] - 2026-08-31

### 📐 Resizable Columns, Custom Column Chooser, Multi-Size Grid & Folder Tree Sidebar
- **Interactive Drag-to-Resize Table Columns**:
  - **Dynamic Column Resizers**: Smooth grab-and-drag dividers on all table headers (`Name`, `Ext`, `Size`, `Modified`, `Created`, `Mode`, `Owner`, `Group`, `SHA-256`, `Tags`).
  - **Double-Click Auto-Fit (`autoFitColumn`)**: Double-clicking any column divider automatically scans DOM content widths and fits the column perfectly (with min 45px / max 600px limits).
  - **Auto-Fit All Columns**: One-click action to auto-fit all visible columns simultaneously.
  - **Sticky LocalStorage Persistence**: Column widths save to `localStorage.cd_col_widths` and seamlessly restore across sessions and panes.
- **Custom Column Chooser & Header Settings Popover**:
  - **Right-Click Table Header Chooser**: Right-clicking any column header opens a sleek popover with checkboxes to toggle any column on or off on the fly.
  - **Quick Header Slider Button**: Added `sliders-horizontal` tool button to pane top bar for instant column visibility customization.
  - **Extended Columns**: Added support for *Date Created*, *SHA-256 Checksum Preview*, and *Color Labels & Tags* directly in the file table.
  - **Reset to Defaults**: 1-click restore to standard orthodox column widths and visibility.
- **Thumbnail Gallery Multi-Size View Modes**:
  - **4 Card Preview Sizes**: Seamless switching between Small (`90px`), Medium (`130px`), Large (`180px`), and Extra Large (`260px`) grid cards.
  - **Rich Card Previews**: High-DPI thumbnails for images, videos, documents, audio discs, and folders with item counts.
- **Collapsible Directory Tree Sidebar Per Pane**:
  - **Pane Folder Tree (`[ 🌳 ]` Toggle)**: Added collapsible sidebar on the left side of any pane header.
  - **Expandable Hierarchy**: Live dynamic asynchronous subfolder expansion fetching subdirectories on demand.
  - **Active Node Sync**: Automatically highlights and navigates the tree node when browsing directories in the active pane.
  - **Draggable Sidebar Resizer**: Smooth drag divider to resize tree width between 120px and 450px with `localStorage` persistence.

---

## [0.6.7] - 2026-08-31

### 🖱️ Orthodox Context Menu & Submenus, Windows Properties Dialog & GitHub Markdown Engine
- **Orthodox Right-Click Context Menu & Submenus**:
  - **Full-Width Viewport & Touch Submenus Fix**: Eliminated media query pointer restrictions and parent clipping (`overflow: visible`), enabling multi-level flyout submenus across all display resolutions.
  - **Dynamic Collision Avoidance**: Automatically flips submenus to the left if near the right edge of the screen and offsets upwards if near the bottom viewport edge.
  - **Tiered Action Hierarchy**: Cleanly structured into *Open with...*, *Quick view (F3)*, *Edit (F4)*, *Properties (Alt+Enter)*, *Copy to...*, *Move to...*, *Clipboard Actions (Copy/Cut/Paste/Rename/Delete)*, *Archive Submenu*, and *Tools Submenu*.
- **Windows-Style Properties Dialog (`Alt+Enter`)**:
  - **Tab 1: General & Media/EXIF**: Detailed file metadata, dimensions, camera model, lens, exposure, audio/video stream codecs, and bitrate.
  - **Tab 2: Security & Permissions**: Interactive POSIX 3x3 permission matrix (`rwx` for User, Group, Others), octal display/input (`0755`), recursive permission applicator, and Owner/Group selectors.
  - **Tab 3: Checksums & Hashes**: On-demand calculation of SHA-256, MD5, and SHA-1 cryptographic hashes with 1-click clipboard copy.
  - **Tab 4: Color Labels & Tags**: Full palette selector and tag chip editor with instant SQLite persistence.
- **GitHub-Flavored Markdown (GFM) & HTML Rendering**:
  - **Raw HTML Tag Support**: Full support for `<details>`, `<summary>`, `<kbd>`, `<div>`, `<center>`, `<img>`, `<table>`, `<sup>`, `<sub>`, `<del>`, and `<br>` in EditorDog preview and Quick View.
  - **GitHub Alerts**: Dedicated callouts for `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, and `> [!CAUTION]`.
  - **Code Blocks & Mermaid**: PrismJS syntax highlighting with 1-click *"Copy Code"* buttons and live Mermaid diagram rendering.
  - **Dual-Engine Architecture**: Integrated `marked.js` with zero-dependency offline fallback parser for airgapped environments.
- **Refined Header Color Dot & Custom Tags**:
  - Top context header featuring a crisp circular dot with expandable mini color palette (`[ 🔴 🟠 🟡 🟢 🔵 🟣 ✕ ] [More...]`).
  - Dynamic tag icon glowing emerald green (`#22c55e`) when tags are present on the file, and neutral gray when unassigned.
  - Dedicated simple Custom Tags modal with chip pill management and instant add/remove.
  - Fixed database persistence bug where clearing color labels was only visual; now explicitly updates and clears SQLite records.

---

## [0.6.6] - 2026-08-31

### ⚙️ Windows NT Service, Autostart & Rich Filetype Icon Suite
- **Windows NT Service & Autostart Management**:
  - Headless background service management via `commanderdog service [install|uninstall|start|stop|status]`.
  - Windows registry Run key autostart and Linux desktop integration.
  - Minimization to system tray via `--minimized` / `--tray-only`.
- **Extended Rich MIME Icon Suite**:
  - Over 100+ specialized high-DPI vector icons for programming languages, 3D models, databases, media codecs, and system directories.
  - Multi-resolution Windows `.ico` bundle for Windows Taskbar and Start Menu.
- **Intelligent User Home Directory Fallback**:
  - Automatic resolution of PAM / LDAP / DB home directory on fresh login sessions, preventing access errors on restricted roots (`/`).

---

## [0.6.0] - 2026-08-30

### 🪟 Windows Native Desktop, Installers & Package Distribution
- **Microsoft WebView2 Native Desktop App (`CommanderDog.exe`)**:
  - Tauri v2 standalone desktop architecture targeting `x86_64-pc-windows-msvc` utilizing built-in Microsoft WebView2 runtime without Electron overhead.
  - Interactive Windows System Tray icon with quick Summon/Hide and Minimize-to-Tray on close.
- **Windows Packaging & Package Managers**:
  - **Setup Installers (`.msi` / `.exe`)**: Automated NSIS setup installer and WiX `.msi` bundle with Desktop and Start Menu shortcut generation.
  - **Portable `.zip` Distribution**: Zero-install standalone archive with in-place database (`commanderdog.db`) and configuration persistence.
  - **Windows Package Managers**: Automated **Winget** (`winget install Woofson.CommanderDog`) and **Scoop** bucket manifests in `packaging/windows/`.
  - **Windows Explorer Context Menu**: Added 1-click registration scripts (`register-context-menu.reg`) integrating *"Open in CommanderDog"* into directory and background right-click context menus.
- **Windows Filesystem & UNC Path Engine**:
  - Full drive letter breadcrumb navigation (`C:\`, `D:\`, `Z:\`).
  - Universal Windows environment variable resolution (`%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`, `%TEMP%`).
  - Windows UNC network share access (`\\server\share\path`).
  - Slide-up web terminal defaulting to Windows PowerShell / `COMSPEC` (`cmd.exe`).
- **Release Matrix CI/CD Pipeline**:
  - Created `.github/workflows/release.yml` for automated multi-target builds across `windows-latest` (MSVC) and `ubuntu-22.04` (Debian/Tarball) with automatic SHA-256 integrity checksum generation.
- **Documentation**:
  - Added comprehensive [**`WINDOWS.md`**](WINDOWS.md) installation, deployment, and packaging guide.

---

## [0.5.5] - 2026-08-29

### 🔒 Transparent Encrypted Vaults (AES-256-GCM / Argon2id) & Subsystem Deletions
- **Transparent Encrypted Vaults (`.cdvault` / `.cdv`)**:
  - Zero-knowledge, self-contained password-protected virtual filesystem containers.
  - Authenticated encryption powered by **AES-256-GCM** (96-bit random nonce + 128-bit authentication tag per data block).
  - Password key derivation via **Argon2id** with a 16-byte cryptographically secure salt.
  - Zero plaintext disk leakage: on-the-fly decryption and streaming directly in volatile RAM buffers.
  - Auto-lock inactivity timers (5m, 15m, 30m, 1h, 4h, session) with immediate memory purging upon lock.
  - 1-Click breadcrumb lock chip and full in-memory live editing with **EditorDog**.
  - Comprehensive documentation in [**`VAULT.md`**](VAULT.md).
- **Subsystem & Cross-Mount Deletion Engine**:
  - Implemented cross-device copy+delete fallback for trash operations overcoming Linux `EXDEV` limitations across separate mounts and subsystem partitions.
  - Added `force_remove_entry` with automatic `0777` permission correction and system `rm -rf --` CLI fallback for root/subsystem mounted folders.
- **Context Menu UX Hardening**:
  - Capture-phase global dismiss listener ensuring all context menu action clicks immediately close the menu.

---

## [0.5.0] - 2026-08-29

### 🔒 Security, UI Modernization & Streamlined UX Release
- **Comprehensive Credential Leakage Elimination & URI Sanitization**:
  - Audited and secured all frontend components and backend endpoints against credential exposure.
  - Sftp/Smb VFS backends (`src/vfs/sftp.rs`, `src/vfs/mod.rs`) strictly serialize clean `sftp://user@host:port/path` into `FileEntry` and `DirectoryListing` without embedded passwords.
  - Deep File Search, Spotlight, Disk Usage, File Operations, and Breadcrumbs automatically sanitize all displayed paths.
  - Ephemeral in-memory authentication router (`resolveAuthUri`) transparently handles session credentials over the wire while keeping DOM and storage 100% credential-free.
- **Leftmost Unified Pane Button & Customization Popover**:
  - Replaced scattered palette icons and rename badges with a single, leftmost `[ 🟡 1 ]` button on each pane header across Desktop, Laptop, Tablet, Foldable, and Mobile.
  - Integrated 1-click customization popover: Rename label, 9-preset color swatches + custom hex color picker, border width (`1px`–`4px`), and active ring style.
  - Streamlined default pane naming to clean, non-redundant numbers (`1`, `2`, `3`, `4`).
- **Streamlined Top Navbar & App Launcher**:
  - Swapped Tools menu icon with modern **`layout-grid`** app launcher grid icon.
  - Moved Settings into the User Profile main menu and preserved quick-access global shortcuts (<kbd>F10</kbd> / F-key bar).
  - Cleaned redundant Lock and Terminal buttons from the top bar.
- **Touch & Click Dropdown Auto-Dismiss**:
  - Launching tools (EditorDog, Calculator, Terminal, Git, Sync, Search) from menus immediately dismisses the parent dropdown.
- **1-Click Remote Disconnect & Close Archive**:
  - Added instant `[ 🔌 ]` Unplug and `[ ✕ ]` Close Archive chips directly in breadcrumbs at index 0 for mobile, tablet, and desktop.
- **SFTP Remote `$HOME` Resolution**:
  - Empty path or `~` now opens the remote user's home folder directly using `sftp.realpath(".")`.

---

## [0.4.2] - 2026-08-29

### 🔒 Fixed & Enhanced — SSH/SFTP Client & Multi-Tier Authentication
- **Multi-Tier SSH Authentication Engine**:
  - Fixed `"no auth socket"` / agent connection errors by isolating SSH-Agent queries to only occur when an agent is actually reachable and responsive.
  - Implemented multi-tier authentication cascade:
    1. **Password Authentication**: Standard password verification.
    2. **Keyboard-Interactive Fallback**: Automatic keyboard-interactive prompt handler for servers requiring interactive challenge-response or 2FA.
    3. **Explicit & User SSH Keys**: Automatic discovery of user identity keys (`~/.ssh/id_ed25519`, `~/.ssh/id_rsa`, `~/.ssh/id_ecdsa`, `~/.ssh/id_dsa`).
    4. **SSH Agent Discovery**: Graceful connection to `SSH_AUTH_SOCK` identities without failing hard if the socket is absent.
- **Robust SFTP URI Encoding & Credential Handling**:
  - Implemented standard percent-encoding and decoding for usernames and passwords containing special characters (e.g. `@`, `:`, `/`, `%`).
  - Fixed SFTP credential propagation in Frontend modals (`openRemoteModal`, `saveNewGlobalMount`, and `connectRemoteToActivePane`).
- **Zero-Dependency Runtime Dynamic PAM Engine**:
  - Replaced legacy `pam-auth` crate and `-lpam_misc` compile-time linking with native runtime dynamic loading (`dlopen("libpam.so.0")`).
  - Completely eliminates linker errors (`rust-lld: error: unable to find library -lpam_misc` / `-lpam`) across Arch Linux, CachyOS, Debian, Ubuntu, and Fedora.
  - `cargo run` now builds and runs immediately out-of-the-box on Linux while maintaining seamless local Linux user PAM authentication.
- **Complete SFTP VFS Operations**:
  - Added direct SFTP support to `handle_read_file`, `handle_write_file`, `handle_download`, `handle_upload`, and remote connection tester (`handle_test_remote`).

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
