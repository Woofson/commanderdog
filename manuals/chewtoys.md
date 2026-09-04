# 🦴 CommanderDog Power Tools & ChewToys Manual

**CommanderDog** replaces a fragmented collection of separate desktop and command-line utilities with a unified, high-performance web and native interface. These integrated extensions are affectionately known as **"ChewToys"**.

---

## 1. 📝 NoteDog Notes Studio
* **Hierarchy**: Tree-structured markdown notebook with subdirectories, drag-and-drop hierarchy, and full-text keyword indexing.
* **Interactive Checklists**: Live `- [ ]` / `- [x]` interactive checklists with instant DOM state persistence.
* **Revision Snapshots**: Automated version snapshot engine saved to `.notedog_versions/` with side-by-side diff previews and 1-click restore.
* **Templates**: Built-in templates for Project Plans, SOPs, Daily Logs, and Meeting Minutes.
* **Encryption Detection**: Seamless awareness for NoteDog TUI `.md.enc` encrypted notes.

---

## 2. ⚡ Bite! Slide-Up PTY Terminal
* **Native WebSocket PTY**: Full pseudo-terminal session attached directly to the active pane's directory.
* **Shell Support**: Automatically detects and loads your default shell (`fish`, `zsh`, `bash`, `powershell`, `cmd.exe`).
* **Offline Nerd Fonts**: Bundled `JetBrainsMono Nerd Font` provides out-of-the-box support for `eza --icons`, `starship`, and powerline glyphs without missing boxes or tofu characters.
* **Dynamic Geometry**: Automatic `ResizeObserver` recalculates dimensions and synchronizes `{ cols, rows }` across pane and window resizes.

---

## 3. 🔄 Delta Backup & Sync Studio (SyncToy & Bvckup 2)
* **4 Replication Profiles**:
  1. `synchronize`: Bidirectional 2-way sync with newer-file conflict resolution.
  2. `echo`: 1-way mirror making destination an exact replica (prunes destination orphans).
  3. `contribute`: Additive replication copying additions & modifications (preserves destination orphans).
  4. `subscribe`: Historical versioning archiving changes into timestamped `_archive/` snapshot trees.
* **In-Place Block Delta Copy**: 64KB CRC32 chunk hashing skips unmodified blocks and patches modified byte blocks in-place directly on disk.
* **Scheduler & Webhooks**: Interval, daily (HH:MM), and continuous real-time triggers with Discord, Slack, and generic JSON webhook alerts.

---

## 4. 📄 PDF Power Studio
* **Pure-Rust Engine (`lopdf`)**:
  * Visual drag-and-drop page reordering and bookmark outlines.
  * Split by custom page ranges, extract single pages, or split into $N$-page bundles.
  * Visual page organizer grid with 90° clockwise/counter-clockwise rotation controls.

---

## 5. 🎞️ ConvertX Transcoder
* **Multi-Format Media Engine**:
  * Browser-native and server-assisted image, audio, video, and document format conversion.
  * Batch processing across selected files in active panels.

---

## 6. 🗄️ Transparent Encrypted Vaults (.cdvault)
* **Zero-Knowledge Security**: AES-256-GCM authenticated encryption + Argon2id key derivation.
* **In-Memory Streaming**: RAM-only virtual filesystem mount with zero plaintext leakage to disk.
* **Inactivity Lock**: Configurable automatic lock timer (default: 15 minutes) and 1-click breadcrumb lock.

---

## 7. ✂️ Multi-Part File Splitter & Combiner
* **Chunk Splitting**: Split oversized files into fixed-size chunks (e.g. for FAT32 filesystem limits, email attachments, or multi-part uploads).
* **Integrity Combining**: 1-click SHA-256 verified re-assembly back to the original file.
