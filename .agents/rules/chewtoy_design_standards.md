# 🪟 ChewToy Design & Layout Language Specification

This rule defines the strict visual, layout, and architectural standards for creating new ChewToys (built-in power tools), floating windows, or modals in CommanderDog.

---

## 1. Primary Window & Modal Headers (`42px` min-height)
* **Full-Length Drag Handle**: The entire header bar must serve as an easy, non-fiddly drag handle (`cursor: grab;` with `:active { cursor: grabbing; }`).
* **Uniform 28px Sizing**: All primary header buttons, selects, and icon triggers must be uniform **`28px x 28px`** (or `28px` height) with `border-radius: var(--radius)` (`6px`) and `14px` icons.
* **Right-Aligned Layout Switchers**: Layout toggle groups (`.layout-btn-group`, view switches) must be right-aligned, **icon-only** (NO text labels), have descriptive tooltips (`title="..."`), and use the active amber accent glow (`rgba(245, 158, 11, 0.18)` + `var(--accent)`).
* **Flat & Stealthy Window Controls**: Window action buttons (Minimize `minus`, Maximize `maximize-2`, Dock `panel-left-close`, Float `external-link`/`picture-in-picture`, Close `x`) must share the flat, stealthy aesthetic:
  * Default: `border: 1px solid transparent; background: transparent; opacity: 0.7; border-radius: var(--radius);`
  * Hover: Soft white glow (`rgba(255, 255, 255, 0.08); opacity: 1;`)
  * Close Hover: Subtle calming red feedback (`rgba(239, 68, 68, 0.2); color: #ef4444;`)

---

## 2. Sub-Headers, Inner Toolbars & Workspace Actions (`26px` Standard)
* **Uniform 26px Sizing**: All secondary toolbars, workspace action bars (e.g. NoteDog workspace, Diff filters, Git staging bar, Disk Usage path row), and panel sub-headers must use **`26px x 26px`** buttons with `border-radius: var(--radius)` (`6px`) and `13px` icons.
* **Docked Tool Headers**: In-pane docked Chewtoys must use icon-only float/undock buttons (`external-link` / `26px`) without the text label `"Float"`.

---

## 3. Dual-Mode Architecture (Floating + In-Pane Docking)
* Every ChewToy must natively support dual operational modes:
  1. **Floating Window Mode**: Freely draggable, resizable, minimizable, and maximizable.
  2. **In-Pane Docking Mode**: Dockable directly into Panel 1 or Panel 2 with automatic panel state persistence.

---

## 4. Tool & Terminal Lifecycle Protocols
* Interactive CLI Chewtoys (e.g., Bite! Terminal) must cleanly handle EOF (`Ctrl+D`), `logout`, and `exit` to automatically close the docked drawer/window and reset PTY state.
* ChewToys must gracefully remember user preferences (active layouts, selected views, column sizes) via `localStorage` or backend configuration.
