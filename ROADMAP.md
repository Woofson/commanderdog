# 🗺️ CommanderDog Product Roadmap

> **Slogan**: *Multi-Tab File Commander for Web & Native Desktop — By Woofson*  
> **Current Version**: `v0.6.0 (Windows Native Desktop, Installers & Package Distribution)`

This roadmap outlines completed capabilities, active architectural enhancements, and future milestones for CommanderDog, combining orthodox two-pane file commander power tools (Total Commander, Double Commander, Krusader, Directory Opus) with modern responsive web and native standalone desktop architecture.

---

## 🚀 1. Completed Milestones (v0.1.0 — v0.6.0)

### 🪟 Windows Native Desktop, Installers & Packaging (`v0.6.0`)
- [x] **Native Windows Desktop Integration (`CommanderDog.exe`)**:
  - Rust + Microsoft WebView2 (Edge Chromium) standalone desktop integration via Tauri v2 with embedded local server.
  - Windows System Tray icon, minimize-to-tray background handling, and smooth hardware acceleration.
- [x] **Windows Packaging & Installers**:
  - **Setup Installer (`.msi` / `.exe`)**: Automated NSIS & WiX installer packages with Desktop/Start Menu shortcuts.
  - **Portable `.zip` Distribution**: Standalone zero-install archive with portable config & database support.
  - **Package Managers**: Automated manifests for `winget install Woofson.CommanderDog` and Scoop bucket (`packaging/windows/`).
  - **Windows Explorer Context Menu**: 1-click `.reg` integration scripts adding *"Open in CommanderDog"* to directories and drives.
- [x] **Windows Filesystem & UNC Path Engine**:
  - Drive letter navigation (`C:\`, `D:\`, `Z:\`), Windows environment profile expansion (`%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`, `%TEMP%`), and Windows SMB UNC network shares (`\\server\share`).
  - Slide-up terminal console defaulting to Windows PowerShell / `COMSPEC` (`cmd.exe`).
- [x] **Automated Windows CI/CD Release Matrix**:
  - GitHub Actions workflow (`.github/workflows/release.yml`) targeting `x86_64-pc-windows-msvc` and attaching releases to GitHub tags.

### 🔒 Transparent Encrypted Vaults & Subsystem Deletions (`v0.5.5`)
- [x] **Transparent Encrypted Vaults (`.cdvault` / `.cdv`)**:
  - Zero-knowledge, self-contained password-protected virtual filesystem containers with AES-256-GCM authenticated encryption and Argon2id key derivation.
  - In-memory on-the-fly streaming with zero plaintext disk leakage and automatic inactivity lock timers.
- [x] **Subsystem & Cross-Mount Deletion Engine**:
  - Implemented cross-device copy+delete fallback for trash operations overcoming Linux `EXDEV` partition limitations.

### 🔒 Security, UI Modernization & Streamlined UX (`v0.5.0`)
- [x] **Zero-Leakage Credential Security & URI Sanitization**:
  - Backend and frontend sanitization across SFTP/SMB listings, Deep Search, Spotlight, Disk Usage, and toasts.
  - Ephemeral in-memory auth routing (`resolveAuthUri`) keeping passwords out of the DOM, history, and localStorage.
- [x] **Leftmost Unified Pane Customization**:
  - Streamlined `[ 🟡 1 ]` button on pane headers with 1-click popover: Renaming, 9-preset color swatches + hex picker, and border styling.
- [x] **Streamlined Top Navbar & App Launcher**:
  - Modern `layout-grid` app launcher icon; Settings unified into the User Profile menu and <kbd>F10</kbd>.
- [x] **Touch & Click Dropdown Auto-Dismiss**:
  - Opening tools automatically closes dropdowns cleanly on mobile, tablet, and desktop.
- [x] **1-Click Remote Disconnect & Close Archive**:
  - Instant `[ 🔌 ]` Unplug and `[ ✕ ]` Close Archive chips at index 0 on breadcrumbs.

---

## 🎯 2. What's Next on the Roadmap?

```mermaid
graph TD
    A["v0.6.0 (Live: Windows Native Desktop, WebView2, MSI/EXE Installers, Winget, Scoop, Portable ZIP)"] --> B["1. 📄 PDF Split & Merger Tool (Page Reorder, Rotate & Extract)"]
    B --> C["2. 🪟 Windows Service & Autostart Management (NT Service, Tray Auto-Launch)"]
    C --> D["3. ⚙️ Folder Automation Watchers & Webhooks (notify-rs)"]
    D --> E["4. 🌐 Enterprise OIDC SSO (Authentik, Keycloak, Okta)"]
    E --> F["5. 📝 Collaborative Office Live Editing (WOPI / ONLYOFFICE / Collabora)"]
```

### 📄 Milestone 1: PDF Split & Merger Tool (`v0.6.5`)
- **Multi-File PDF Merger**:
  - Combine multiple selected PDF documents into a single unified PDF with 1-click from pane selection.
  - Interactive drag-and-drop page and document reordering table.
  - Merge options: Table of Contents / Bookmark generation, page numbering stamps, and metadata preservation.
- **Precision PDF Splitter & Extractor**:
  - Split by page ranges (e.g., `1-4, 7, 10-15`), extract all pages as individual PDFs, or split into $N$-page bundles.
  - Split by bookmark chapters / outline sections.
- **Visual Page Organizer & Reorder Grid**:
  - Live thumbnail grid preview of all pages in the active document.
  - Rotate pages clockwise/counter-clockwise ($90^\circ / 180^\circ / 270^\circ$).
  - Delete blank or unwanted pages before export.
- **Pure-Rust High-Performance Engine (`lopdf` / `pdf-writer`)**:
  - Zero external dependency (runs without Ghostscript or Python).
  - Blazing-fast in-memory streaming and lossless compression.
- **Dockable Tool & Floating Modal**:
  - Launch from App Launcher, F-key toolbar, or right-click context menu on `.pdf` files.

---

### 🪟 Milestone 2: Windows Background Service & Autostart Management (`v0.6.6`)
- **Official Windows NT Service Architecture (`windows-service`)**:
  - Run CommanderDog server headlessly in the background as a registered Windows Service (`services.msc`).
  - Ideal for Windows Server, NAS, home labs, and multi-user environments without requiring active user logon.
  - CLI management commands:
    ```powershell
    commanderdog.exe service install   # Registers CommanderDog NT Service
    commanderdog.exe service uninstall # Removes NT Service cleanly
    commanderdog.exe service start     # Starts background service
    commanderdog.exe service stop      # Graceful service shutdown
    commanderdog.exe service status    # Service health & uptime query
    ```
  - Native Windows Event Log (`eventvwr.msc`) integration for audit and error tracking.
- **User Logon Autostart & System Tray Minimization**:
  - 1-Click toggle in Settings / Tray: *"Start on Windows Startup"*.
  - Managed via `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` and Startup folder.
  - Configurable start mode: Launch minimized directly into the System Tray with web server active (`--minimized` / `--tray-only`).
- **Windows Task Scheduler Integration (`schtasks`)**:
  - Helper scripts and manifest presets for scheduled starts on system boot, user idle, or wake-from-sleep.
- **In-App Service Manager Panel**:
  - View running service status, port bindings, memory usage, and restart service directly from the Settings UI.

---

### ⚙️ Milestone 3: Folder Automation Watchers & Webhooks (`v0.6.8`)
- **Real-Time Directory Watchers**: Inotify / notify-rs backend tracking specified directories.
- **Rule Engine**:
  - Automatically convert incoming images/media using ConvertX.
  - Automatically extract downloaded `.zip`/`.tar.gz`/`.7z` files.
  - Automatically trigger two-way sync or backup to remote S3/SMB/SFTP shares.
  - Execute custom user shell scripts or webhooks upon file creation/modification.

---

### 🌐 Milestone 4: Enterprise OIDC SSO & Collaborative Office (`v0.7.0`)
- **OpenID Connect (OIDC)**: Seamless login via Authentik, Authelia, Keycloak, Okta, and Google Workspace alongside Linux PAM.
- **Collaborative Office (WOPI)**: In-browser live editing for `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods` via ONLYOFFICE and Collabora Online integration.

---

## 📋 3. Release Version Matrix

| Version | Milestone Focus | Status |
| :--- | :--- | :--- |
| **`v0.3.0`** | In-Pane Tool Docking, ConvertX, Dual-Pane Editor | **Released** |
| **`v0.3.5`** | Wayland Native Windowing, GDK Error 71 Fix, AUR Automated Sync | **Released** |
| **`v0.3.6`** | XDG Fast-Path Config, External TOML Themes, Web Theme Creator, Tiling WM Frameless | **Released** |
| **`v0.4.0`** | Multi-Part File Splitter & Combiner, Integrated Git Client, Auto-$HOME Startup | **Released** |
| **`v0.4.1`** | Configurable Storage Roots, Filesystem Sandboxing, Per-User Root RBAC, Multi-Arch Alpine/Debian GHCR | **Released** |
| **`v0.4.2`** | Multi-Tier SSH/SFTP Auth, Dynamic PAM Zero-Dependency Engine, SFTP $HOME Resolution | **Released** |
| **`v0.5.0`** | **Zero-Leakage In-Memory Credentials, Leftmost Unified Pane Customizer, Modern Navbar, Tauri Tray** | **Released** |
| **`v0.5.5`** | **Transparent Encrypted Vaults (AES-256-GCM / Argon2id), Cross-Mount Deletion Engine** | **Released** |
| **`v0.6.0`** | **🪟 Windows Native Build & Release (MSI, Portable ZIP, Winget, Scoop, WebView2)** | **Released (Current)** |
| **`v0.6.5`** | **📄 PDF Split & Merger Tool (Visual Page Organizer, Lossless Extract & Merge)** | *Next Up* |
| **`v0.6.6`** | **🪟 Windows Background Service & System Autostart Management (NT Service, Tray Auto-Launch)** | *Planned* |
| **`v0.6.8`** | **⚙️ Folder Automation Watchers & Webhook Rules** | *Planned* |
| **`v0.7.0`** | **🌐 Enterprise OIDC SSO, Collaborative Office (WOPI) & Automation Engine** | *Planned* |
