# 📋 CommanderDog Factory Acceptance Test (FAT) & System Verification Plan

> **Document Version**: `1.0.0`  
> **Target Release**: `CommanderDog v0.2.13+`  
> **System Architecture**: Rust + Axum (Backend) + Vanilla ES6 Modular SPA (Frontend) + SQLite  
> **Author**: Bolt J. Woofson

---

## 🎯 Purpose & Methodology

This **Factory Acceptance Test (FAT)** checklist serves as a comprehensive, structured verification protocol to test all core orthodox commander workflows, cloud integrations, developer tools, viewers, and responsive multi-screen layouts before production deployment.

### 🚦 Test Grading Scale
- **[ ] PASS**: Expected behavior verified with zero regressions.
- **[ ] WARN**: Functional but minor UI glitch / non-blocking friction.
- **[ ] FAIL**: Crash, panic, data corruption, or workflow failure.

---

## 📑 1. Core Orthodox Pane Navigation & Window Management

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **PANE-01** | **Multi-Pane Layouts** | Click layout dropdown (Top-right) and cycle through: Single, Dual Vertical, Dual Horizontal, Quad (2x2), and 3-Pane. | Active panes dynamically re-layout smoothly; pane contents, headers, and footer counters persist without reloading. | [ ] PASS |
| **PANE-02** | **Keyboard Navigation** | Press <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> to cycle active pane focus; use <kbd>↑</kbd> / <kbd>↓</kbd> / <kbd>Home</kbd> / <kbd>End</kbd> to move cursor. | Focus outline/glow shifts instantly; cursor moves to row; status footer updates for currently focused item. | [ ] PASS |
| **PANE-03** | **Directory Traversal** | Press <kbd>Enter</kbd> on a directory; press <kbd>Backspace</kbd> or double-click `..` to go up; click interactive breadcrumb pills. | Path changes instantly; history back/forward buttons work; scroll position resets smoothly. | [ ] PASS |
| **PANE-04** | **Multi-Item Selection** | Test <kbd>Space</kbd> toggle, <kbd>Insert</kbd>, <kbd>Ctrl+Click</kbd>, <kbd>Shift+Click</kbd> range, and <kbd>Ctrl+A</kbd> (Select All). | Selected rows highlight with accent styling; mobile bottom bar updates counter `(N items)`. | [ ] PASS |
| **PANE-05** | **Quick Filter** | Type in the Quick Filter input (`filter-input-0`) with normal text and regex (e.g. `.*\.rs$`). | File list filters in real-time ($< 5\text{ms}$); footer shows filtered count vs total count. | [ ] PASS |
| **PANE-06** | **Flat / Branch View** | Press <kbd>Ctrl+B</kbd> or click *Flat / Branch View* in Tools menu. | Recursive directory flattening activates; shows all nested files in single list with `🌲 Flat Branch View` header badge and `[✕ Exit Branch]` button. | [ ] PASS |
| **PANE-07** | **Global Branch Sort** | Inside Branch View, click **Size** column header to sort descending. | Largest files across all nested subfolders bubble to the top immediately; double-clicking opens parent/file. | [ ] PASS |
| **PANE-08** | **Inter-Pane Drag & Drop** | Drag 3 selected files from Left Pane and drop onto Right Pane folder. | Drag ghost displays `(3 items)`; target row/pane glows amber; prompt modal appears offering **Copy**, **Move**, or **Cancel**. | [ ] PASS |
| **PANE-09** | **In-Memory Clipboard** | Select 2 files $\rightarrow$ <kbd>Ctrl+C</kbd> $\rightarrow$ Switch pane $\rightarrow$ <kbd>Ctrl+V</kbd>; test <kbd>Ctrl+X</kbd> (Cut) $\rightarrow$ Paste. | Copy duplicates files; Cut moves files; bottom task manager registers file transfer jobs. | [ ] PASS |

---

## 🗄️ 2. File Operations, Archiving & Bulk Renamer

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **FOP-01** | **<kbd>F5</kbd> Copy & <kbd>F6</kbd> Move** | Select file(s) $\rightarrow$ Press <kbd>F5</kbd> (Copy) / <kbd>F6</kbd> (Move) to opposite pane. | Pre-filled destination path shown in prompt modal; transfer executes with real-time progress. | [ ] PASS |
| **FOP-02** | **<kbd>F7</kbd> New Folder & File** | Press <kbd>F7</kbd> $\rightarrow$ create nested folder `test/sub1/sub2`; create empty text file. | Folders created recursively on disk; active pane auto-refreshes with new entry highlighted. | [ ] PASS |
| **FOP-03** | **<kbd>F8</kbd> / Delete & Trash** | Select files $\rightarrow$ press <kbd>Delete</kbd> (Move to Trash); Shift+Delete (Permanent Delete). | Paranoid confirmation modal displayed; files removed cleanly; counters updated. | [ ] PASS |
| **FOP-04** | **<kbd>F2</kbd> Inline Rename** | Press <kbd>F2</kbd> on a file $\rightarrow$ edit name inline $\rightarrow$ press <kbd>Enter</kbd>. | File renamed on filesystem; validation prevents illegal characters (`/`, null byte). | [ ] PASS |
| **FOP-05** | **Advanced Bulk Rename** | Select 10 files $\rightarrow$ press <kbd>Shift+F6</kbd> $\rightarrow$ Configure Search/Replace regex, 3-digit counter `[001]`, extension case transform. | Live preview table displays **Original Name** $\rightarrow$ **New Name** diff; 1-click **Apply Batch Rename** executes atomically. | [ ] PASS |
| **FOP-06** | **Archive Compression** | Select folder + 3 files $\rightarrow$ Right click $\rightarrow$ *Compress to Archive...* $\rightarrow$ Choose `.zip`, `.tar.gz`, `.tar.bz2`, `.tar.xz`, or `.7z`. | Archive created in background; progress shows in Floating Task Manager; file integrity verified. | [ ] PASS |
| **FOP-07** | **Archive Virtual Browse** | Double click a `.zip` or `.tar.gz` file. | Navigates into archive as virtual filesystem (`archive:///path/to.zip#subfolder`); files viewable/extractable without full decompression. | [ ] PASS |
| **FOP-08** | **Archive Extraction** | Right-click archive $\rightarrow$ *Extract Archive Here* (or to subfolder). | Unpacks clean tree with original file modes and timestamps preserved. | [ ] PASS |

---

## 🔍 3. Deep File Search, Live Grep & "Feed to Pane"

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SRC-01** | **Name Glob Search** | Open Search (<kbd>Ctrl+F</kbd>) $\rightarrow$ Target root `/home/bolt` $\rightarrow$ Name Pattern `*.rs` $\rightarrow$ Run Search. | Finds all Rust files across directory trees with size and modification dates. | [ ] PASS |
| **SRC-02** | **Live Content Grep** | Enter Content Query `async fn` $\rightarrow$ check Case Sensitive $\rightarrow$ Run Search. | Matches scanned with line numbers and highlighted syntax context snippets. | [ ] PASS |
| **SRC-03** | **Feed to Active Pane** | In search results table, click **`📥 Feed to Active Pane`**. | Closes search modal; populates active pane with virtual search results; breadcrumb shows `🔍 Search Results (N items) [✕ Exit Virtual]`. | [ ] PASS |
| **SRC-04** | **Virtual Pane Actions** | Inside virtual search pane, select 3 search results $\rightarrow$ press <kbd>F5</kbd> (Copy) to target pane. | Copies the underlying real files to the target pane; virtual pane selection remains intact. | [ ] PASS |

---

## 🏷️ 4. Color Labels & Custom Tagging System

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **TAG-01** | **Context Menu Palette** | Right-click file $\rightarrow$ Click 🔴 Red dot in context palette. | Context menu closes; file row receives solid red left-border accent (`.file-row-color-red`) and subtle background tint. | [ ] PASS |
| **TAG-02** | **Clear Color Label** | Right-click labeled file $\rightarrow$ Click ⚪ **✕ (Clear)** dot. | Left-border accent removed; SQLite record updated (`color_label = NULL`). | [ ] PASS |
| **TAG-03** | **Custom Text Tags** | Right-click file $\rightarrow$ *Edit Custom Tags...* $\rightarrow$ Enter `invoice, 2026, q3, reviewed` $\rightarrow$ Click *Apply Tags*. | Modal closes; inline `#invoice`, `#2026`, `#q3`, `#reviewed` chips render next to file name in table. | [ ] PASS |
| **TAG-04** | **Batch Tagging** | Select 5 files $\rightarrow$ *Edit Custom Tags...* $\rightarrow$ Select 🟢 Green + Enter `approved`. | All 5 files update in SQLite and display green accents + `#approved` chips simultaneously. | [ ] PASS |
| **TAG-05** | **Tag Persistence** | Hard refresh browser (<kbd>Ctrl+Shift+R</kbd>). | `loadAllFileTags()` fetches from `/api/fs/tags/all`; all color accents and tag chips re-render identically. | [ ] PASS |

---

## 🔀 5. Two-Way Visual Directory Synchronizer

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SYNC-01** | **Directory Comparison** | Open Sync Modal $\rightarrow$ Left: `/tmp/dirA`, Right: `/tmp/dirB` $\rightarrow$ Click **Compare Directories**. | Fast recursive scan; side-by-side table compares relative paths, byte sizes, and timestamps. | [ ] PASS |
| **SYNC-02** | **Difference Badging** | Inspect comparison results with modified, new, and missing files. | Badges render correctly: **Newer ➔** (Green), **Older ⬅** (Cyan), **Identical ✔** (Muted), **Different Size ⚠️** (Yellow), **Delete ✕** (Red). | [ ] PASS |
| **SYNC-03** | **Direction Overrides** | Click any file row direction arrow (e.g. flip ➔ to ⬅ or ✕ Skip). | Direction action toggles interactively; total sync volume recalculates. | [ ] PASS |
| **SYNC-04** | **Filter Chips** | Toggle filter chips: *Show Differences Only*, *Hide Identical*, *Newer Left*. | Comparison view filters items dynamically. | [ ] PASS |
| **SYNC-05** | **Sync Execution** | Select **Two-Way Smart Sync** $\rightarrow$ Click **Execute Synchronization**. | Transfers files in background; verifies timestamps; status displays 100% synchronized. | [ ] PASS |

---

## 📊 6. Visual Disk Usage & Storage Treemap Analyzer

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **DU-01** | **Space Aggregation** | Open Disk Usage Modal $\rightarrow$ Path `/home/bolt` $\rightarrow$ Click **Analyze Storage**. | Recursively aggregates folder sizes; renders colored percentage consumption bars. | [ ] PASS |
| **DU-02** | **Folder Drilldown** | Click any child directory in the analyzer list. | Navigates into the subfolder; path breadcrumb updates; recalculates relative percentages. | [ ] PASS |
| **DU-03** | **Top 20 Largest Files** | Scroll to the "Top 20 Largest Files" table. | Lists the heaviest individual files ranked by size; 1-click **Jump to File** navigates active pane to the file. | [ ] PASS |

---

## 💻 7. Multi-Tab Power Editor & Live Markdown Preview (<kbd>F4</kbd>)

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **EDIT-01** | **Multi-Tab Opening** | Open 3 files simultaneously with <kbd>F4</kbd>. | Opens floating editor with 3 labeled tabs; shows language icons and dirty state dots (`*`). | [ ] PASS |
| **EDIT-02** | **Split View Modes** | Switch view mode dropdown: *Single*, *Dual Vertical*, *Dual Horizontal*. | Dual editors appear side-by-side with independent scrolling, syntax highlighting, and line numbers. | [ ] PASS |
| **EDIT-03** | **Markdown + Live Mermaid** | Open `.md` document with Mermaid code block $\rightarrow$ Switch to *Split Markdown Preview*. | Right preview panel renders GitHub-flavored markdown with live SVG Mermaid diagrams. | [ ] PASS |
| **EDIT-04** | **Find & Replace** | Press <kbd>Ctrl+F</kbd> inside editor $\rightarrow$ search text $\rightarrow$ replace all. | Highlights occurrences; replaces matches with match count feedback. | [ ] PASS |
| **EDIT-05** | **Confd Config Assembler** | Open a `conf.d/` directory in editor. | Assembles ordered snippet files into unified virtual configuration tab; allows editing individual source snippets. | [ ] PASS |
| **EDIT-06** | **Window Dock & Minimize** | Click Minimize `[-]` on editor header $\rightarrow$ Click `📝 Editor (N files)` docked pill. | Window hides to bottom dock; clicking pill restores exact cursor position and split layout. | [ ] PASS |

---

## 📚 8. Universal Document, Media & EPUB Viewers (<kbd>F3</kbd>)

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **VIEW-01** | **PDF Stream Viewer** | Press <kbd>F3</kbd> on a `.pdf` document. | Renders in-browser PDF stream; zoom in/out, rotate 90°, page jump input, print, and fullscreen work smoothly. | [ ] PASS |
| **VIEW-02** | **CSV / TSV Data Grid** | Press <kbd>F3</kbd> on a `.csv` file. | Opens interactive spreadsheet table with sortable columns, column-filter search, and row pagination. | [ ] PASS |
| **VIEW-03** | **EXIF GPS Image Inspector** | Open JPEG photo with GPS EXIF metadata $\rightarrow$ *Media & EXIF Inspector*. | Displays camera model, ISO, shutter, aperture, dominant color swatches, and interactive Leaflet map pin with Apple/Google Maps links. | [ ] PASS |
| **VIEW-04** | **Audio / Video Player** | Open `.mp4` / `.mkv` / `.mp3` / `.flac` media file. | Plays media with byte-range HTTP streaming, seekbar, volume, playback speed (0.5x–2x), and loop toggle. | [ ] PASS |
| **VIEW-05** | **Comic / EPUB Reader** | Open `.cbz`, `.cbr`, or `.epub` book. | Unpacks pages in memory; allows touch swipe navigation, page thumbnail filmstrip, and single/dual page spread. | [ ] PASS |

---

## 🧮 9. Floating Calculator & Byte Math

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **CALC-01** | **Floating & Draggable** | Open via Tools $\rightarrow$ *Calculator* or Spotlight (<kbd>Ctrl+K</kbd> $\rightarrow$ `calc`). | Window opens; draggable by header; saves position to `localStorage`; dockable to bottom taskbar pill. | [ ] PASS |
| **CALC-02** | **Arithmetic & Keyboard** | Type `128 * 1024 + 512` on keyboard $\rightarrow$ press <kbd>Enter</kbd>. | Evaluates to `131584`; display updates with expression history. | [ ] PASS |
| **CALC-03** | **Byte Unit Math** | Type `50` $\rightarrow$ Click **MB** $\rightarrow$ Click **GB**. | Multiplies by $1024^2$ and $1024^3$; **SIZE** bar displays `50.00 GB`. | [ ] PASS |
| **CALC-04** | **Base Conversions** | Calculate `493` (decimal). | Converter bar shows **HEX**: `0x1ED`, **OCT**: `0755` (chmod permission!), **BIN**: `0b111101101`. | [ ] PASS |
| **CALC-05** | **History Tape & Copy** | Click **`📋 Copy`** $\rightarrow$ Click **`🕒 History`** drawer. | Copies value to clipboard; history drawer lists past calculations with 1-click recall. | [ ] PASS |

---

## 🔒 10. Security, Unix Permissions & Admin Panel

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **Visual $3\times 3$ Permissions** | Select file/folder $\rightarrow$ Right click $\rightarrow$ *Permissions & Ownership*. | $3\times 3$ matrix renders User/Group/Other Read/Write/Execute checkboxes; Octal box updates to `0755` / `0644`; Recursive `-R` toggle works. | [ ] PASS |
| **SEC-02** | **Interactive Terminal Console** | Press <kbd>\`</kbd> or <kbd>F4</kbd> (Terminal). | Opens WebSocket PTY terminal; interactive bash/zsh prompt responds to commands (`ls`, `top`, `htop`). | [ ] PASS |
| **SEC-03** | **Session Lock (<kbd>Ctrl+Alt+L</kbd>)** | Press <kbd>Ctrl+Alt+L</kbd> or <kbd>F12</kbd>. | Screen immediately locks with secure PIN/Password overlay; background requests halted until authenticated. | [ ] PASS |
| **SEC-04** | **Inactivity Lock** | Set inactivity lock to 1 minute in Settings $\rightarrow$ idle for 60s. | Session auto-locks; browser refresh maintains lock state. | [ ] PASS |
| **SEC-05** | **Admin Control Panel** | Log in as Admin $\rightarrow$ Profile $\rightarrow$ *Admin Control Panel*. | Manage users, passwords, storage quota caps, mount paths, and view real-time audit logs. | [ ] PASS |

---

## 🔗 11. Public Links, Guest Dropboxes & Remote Mounts

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SHARE-01** | **Expiring Share Link** | Right-click file $\rightarrow$ *Share Link / Guest Dropbox...* $\rightarrow$ Set password + 24hr expiry. | Generates public link `http://host/share/{token}`; non-authenticated guest can download after password entry. | [ ] PASS |
| **SHARE-02** | **Guest Upload Dropbox** | Create share on folder with **Guest Uploads Enabled**. | Guest portal provides drag-and-drop upload zone; uploaded files appear in host directory. | [ ] PASS |
| **REMOTE-01** | **Remote Storage Mounts** | Open Mounts Manager $\rightarrow$ Connect SFTP / SMB / S3 / WebDAV. | Mounts as virtual root (`sftp://user@host/path`); full browsing and file copying works seamlessly across local and remote panes. | [ ] PASS |

---

## 📱 12. Mobile, Touch & Foldable Dual-Screen Layouts

| Test ID | Subsystem / Feature | Test Procedure / Scenario | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **MOB-01** | **Foldable Dual-Pane Split** | Open on Samsung Galaxy Fold / Pixel Fold / Surface Duo (folded vs unfolded $\ge 601\text{px}$). | Auto-expands into dual panes; adheres to CSS viewport segments (`horizontal-viewport-segments: 2`) avoiding center hinge seam. | [ ] PASS |
| **MOB-02** | **Touch Bottom Sheet** | On mobile ($\le 768\text{px}$), tap bottom bar **⚡ Actions (N)**. | Context menu slides up as a bottom sheet with `max-width: calc(100vw - 20px)` and no horizontal overflow. | [ ] PASS |
| **MOB-03** | **Accordion Submenus** | In mobile context menu, tap **`Quick Copy to...`** or **`Custom Script Actions`**. | Submenu smoothly expands **vertically inline** as an accordion drawer with rotating chevron; zero horizontal scrolling. | [ ] PASS |
| **MOB-04** | **Consolidated Headers** | Open Power Editor or Image Viewer on mobile. | 11-button desktop toolbars collapse into compact **`⚙️ More ▾`** and **`🛠️ Tools ▾`** dropdowns for 100% thumb-friendly access. | [ ] PASS |

---

## 📦 13. Packaging & Distribution Verification

| Test ID | Artifact | Verification Command / Step | Expected Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **DIST-01** | **Standalone Binary** | `./target/release/commanderdog --version` | Outputs `commanderdog 0.2.13` with PAM support. | [ ] PASS |
| **DIST-02** | **Debian Package** | `dpkg -I ./dist/commanderdog_0.2.13_amd64.deb` | Valid package metadata, systemd service unit, and binaries. | [ ] PASS |
| **DIST-03** | **Tarball Release** | `tar -ztvf ./dist/commanderdog-v0.2.13-linux-x86_64.tar.gz` | Contains binary, web assets, and install helper. | [ ] PASS |
| **DIST-04** | **SHA-256 Checksums** | `sha256sum -c ./dist/SHA256SUMS` | All release artifacts pass checksum verification cleanly (`OK`). | [ ] PASS |

---

## 🚀 Sign-off & Release Certification

- **Test Engineer / Tester**: _______________________
- **Device(s) Tested**: Desktop (Chrome/Firefox), Mobile Phone (Safari/Chrome), Foldable Device.
- **Pass Rate**: _____ / 55 Test Cases
- **Release Decision**: `[ ] APPROVED FOR RELEASE` | `[ ] BLOCKED (REMEDIATION REQUIRED)`
