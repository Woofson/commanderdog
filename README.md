# 🐕 CommanderDog

> **Quad-Pane High-Performance Web File Commander**  
> Blending the orthodox speed and power of Total Commander / Midnight Commander with the modern responsiveness of Next Explorer.

---

## ✨ Features

- 🗂️ **Dynamic 1-to-4 Toggleable Panes**: Switch seamlessly between Single, Dual-Vertical, Dual-Horizontal, Triple, and 2x2 Quad layouts (`Alt+1`–`4`).
- ⚡ **Orthodox Commander Keybindings**: Full keyboard control (`Tab` switch pane, `F1` Help, `F2` Rename, `F3` Quick View, `F4` Dual-Pane Editor, `F5` Copy, `F6` Move, `F7` Mkdir, `F8` Delete/Trash, `Ctrl+D` Diff, `Insert`/`Space` multi-select).
- 🖱️ **Drag & Drop Engine**: Drag and drop effortlessly between any pane or from your host OS desktop to upload.
- 🌐 **Protocols & Virtual VFS**:
  - Local Linux filesystem
  - SSH / SFTP remote servers
  - WebDAV remote storage (Nextcloud, ownCloud, Apache)
  - Virtual archive browsing (open `.zip`, `.tar.gz`, `.tar.bz2`, `.tar.xz`, `.7z` directly as virtual directories).
- 🛡️ **Paranoid File Handling Mode**:
  - Pre-flight dry run collision and disk space inspection
  - Post-transfer SHA-256 integrity verification
  - Atomic writes & rollback protection
  - Safe XDG Trash bin recovery.
- ⚖️ **Side-by-Side File & Folder Diff**:
  - Visual folder comparison (count, size mismatches, hash differences, missing files)
  - Side-by-side text file diff with line-by-line additions, deletions, and inline highlights.
- 📝 **Dual-Pane Text & Markdown Editor**:
  - Built-in side-by-side file editor
  - Live Markdown preview with **Mermaid.js diagram rendering** (Flowcharts, sequences, Gantt charts, state diagrams).
- ⚙️ **conf.d Configuration Architecture**:
  - Scans and merges snippets from `/etc/commanderdog/conf.d/*.toml`, `~/.config/commanderdog/conf.d/*.toml`, and `./conf.d/*.toml`.
- 🎨 **Polished Themes**: Charcoal & Warm Amber / Golden Yellow Dark Theme default, with Midnight Commander Blue, Nord, and Dracula presets.
- 👥 **Multi-User Auth**: Native Linux PAM system users + Built-in SQLite user database with Argon2 password hashing.
- 🐳 **Docker & LXC Ready**: Standalone single binary with embedded web frontend and minimal container images.

---

## 🚀 Quick Start

### Build & Run Locally (Rust)

```bash
# Build release binary
cargo build --release

# Run CommanderDog
./target/release/commanderdog
```

Open your browser at **http://localhost:8080**  
Default credentials:
- **Username**: `admin`
- **Password**: `commanderdog`

---

## 🐳 Docker Setup

```bash
docker compose up -d --build
```

---

## 📁 conf.d Directory Structure

CommanderDog merges all `.toml` files in the `conf.d` directory in sorting order:

```
conf.d/
├── 00-server.toml      # Host, port, upload limits, roots
├── 10-auth.toml        # Authentication modes (mixed/builtin/pam)
├── 20-themes.toml      # Theme palettes and default appearance
└── 30-actions.toml     # Paranoid settings & context menu script actions
```

---

## ⌨️ Function Keys & Keybindings

| Key | Action |
| :--- | :--- |
| **`Tab` / `Shift+Tab`** | Switch Active Pane |
| **`F1`** | Help & Keybindings Modal |
| **`F2`** | Rename Selected Entry |
| **`F3`** | Quick View / Preview File |
| **`F4`** | Built-in Dual-Pane Editor & Markdown Viewer |
| **`F5`** | Copy Selected Items to Target Pane |
| **`F6`** | Move Selected Items to Target Pane |
| **`F7`** | Create New Folder |
| **`F8` / `Delete`** | Delete / Move to Trash |
| **`F9` / `Ctrl+D`** | Folder & File Comparison (Diff) |
| **`F10`** | Settings & Configuration |
| **`Alt+1` .. `Alt+4`** | Jump to Pane 1, 2, 3, or 4 |
| **`Insert` / `Space`** | Toggle Item Selection & Step Down |
| **`Ctrl+A`** | Select All in Active Pane |
| **`Ctrl+P`** | Toggle Paranoid File Handling Mode |

---

## 📜 License

MIT © Bolt J Woofson
