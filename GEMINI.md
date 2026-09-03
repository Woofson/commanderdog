# 🐕 CommanderDog Project Rules & Development Guidelines

Welcome to the **CommanderDog** project repository. All agents and pair-programming sessions must strictly follow the rules and conventions below.

---

## 1. 🏷️ Versioning & Iteration Rules

* **Iteration Postfixes (`a-z`)**: Every time changes are made to the codebase, bump the version iteration using a postfix letter `a-z` (e.g. `0.7.1-a`, `0.7.1-b`, `0.7.1-c`...) in `Cargo.toml`.
* **Centralized Single Source of Truth**:
  * The version number is defined exclusively in `Cargo.toml` (`[package] version = "..."`).
  * The Rust backend automatically embeds this compile-time via `env!("CARGO_PKG_VERSION")` and serves it via `/api/config` and `/api/system/status`.
  * The frontend dynamically populates all UI badges (`#about-version-badge`, `.login-version-badge`) through `applyAppVersion()`.
  * **Token Efficiency**: Do NOT burn tokens editing hardcoded version strings across multiple HTML/JS files; updating `Cargo.toml` updates everything.

---

## 2. ⚡ Rebuild vs Refresh Notifications

At the end of every response after making changes, **always clearly inform the user** whether:
1. **Backend Recompile Needed**: When Rust code (`src/**/*.rs`), dependencies, or assets embedded into the binary have changed. Instruct the user to restart/rebuild with `cargo run` or `cargo build`.
2. **Browser Refresh Only Needed**: When changes were purely frontend or configuration that does not require binary recompilation. Instruct the user to perform a hard refresh (Ctrl+F5 / Cmd+Shift+R).

---

## 3. 🚀 Git Workflow & Release Channels

* **Command: `"push to git"`**:
  * Commit the modified files with a clean message and push to the remote Git repository.
  * **DO NOT trigger releases or publish packages.**
* **Command: `"push and release"`**:
  * Commit, tag, push, and execute release automation across **ALL** distribution channels:
    1. **Docker / GHCR**: `ghcr.io/woofson/commanderdog`
    2. **Arch Linux AUR**: `commanderdog` and `commanderdog-bin` PKGBUILDs.
    3. **Crates.io**: `cargo publish` using the `arf-` prefix rule (`arf-cmdr`).
    4. **Windows**: Scoop bucket and Winget package manifests (`packaging/windows/`).
* **Crates.io Upload Ready**: Cargo is fully configured and ready for upload to crates.io with publishing prefix rules.

---

## 4. 🎨 Brand & Theme Nomenclature

* **Creator & Lab**: Bolt J Woofson @ Woofsons Lab ([www.arf.ac](https://www.arf.ac)).
* **Publishing Prefix Rule**: All publishing packages, binaries, and crates must use the `arf-` or `arf_` prefix (e.g., `arf-cmdr` for CommanderDog/Shunt, `arf-remote` for RemoteDog).
* **Official Theme Names**:
  * **Dark Theme**: Strictly named **`Woofsons Amber Charcoal`** (ID: `amber-charcoal` / `charcoal`).
  * **Light Theme**: Strictly named **`Woofsons Amber Zink`** (ID: `zink`).

---

## 5. 🖥️ Viewport & UI Terminology

* **Viewport Terms**:
  * `Phone` (mobile touch)
  * `Tablet` (foldables / tablets touch)
  * `PC` (desktop / laptop mouse & keyboard)
* **Panels vs Tabs**:
  * File browsing areas are strictly termed **"Panels"** (e.g., Left Panel, Right Panel, Pane 1, Pane 2).
  * The word **"Tabs"** is strictly reserved for Settings modal tabs and Editor tabs.

---

## 6. 🛠️ Universal Viewer & Terminal Standards

* **Universal Document & Text Viewer**:
  * Dynamic tools (`tail -f`, line count selector `-n`, word wrap, refresh, scroll to bottom) and window actions must be **right-aligned** in `.doc-viewer-header-right`.
  * All buttons, selects, and icon controls must share a uniform **`28px` height**.
  * The entire header bar must serve as a non-fiddly drag handle (`cursor: grab;`).
* **Bite! Terminal Console & Nerd Fonts**:
  * Terminal uses embedded **`JetBrainsMono Nerd Font`** (bundled locally in `/assets/fonts/` and served directly by the backend).
  * Must support `eza --icons`, `starship`, `fish`, and powerline glyphs without missing boxes or tofu characters.
