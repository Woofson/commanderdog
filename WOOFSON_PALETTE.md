# 🐕 Woofson Design Specs — Golden Amber Palette

The official unified color palette and design tokens for the **Woofson** suite of applications (`CommanderDog`, `NoteDog`, `DotDog`).

---

## 🎨 Color Palette Tokens

| Token Name | Hex Code | RGB | Usage |
| :--- | :--- | :--- | :--- |
| **`bg-void`** | `#121214` | `18, 18, 20` | Main canvas background, deeply recessed areas |
| **`bg-panel`** | `#18181b` | `24, 24, 27` | Panes, cards, sidebars, modal surfaces |
| **`bg-header`** | `#202024` | `32, 32, 36` | Toolbar headers, breadcrumbs bar, status bars |
| **`bg-active`** | `#27272a` | `39, 39, 42` | Focused pane headers, active tabs, hover states |
| **`bg-selected`** | `rgba(245, 158, 11, 0.18)` | — | Selected table rows, highlight overlays |
| **`accent-core`** | `#f59e0b` | `245, 158, 11` | Primary brand accent (Amber 500), focus rings, badges |
| **`accent-hover`** | `#fbbf24` | `251, 191, 36` | Button hover, bright amber highlights, folder icons |
| **`accent-dark`** | `#d97706` | `217, 119, 6` | Pressed states, active borders |
| **`border-subtle`**| `#3f3f46` | `63, 63, 70` | Default panel and table borders (Zinc 700) |
| **`border-focus`** | `#f59e0b` | `245, 158, 11` | Active focused pane border, input focus |
| **`text-main`** | `#f4f4f5` | `244, 244, 245` | High-contrast body text, file names, headings |
| **`text-muted`** | `#a1a1aa` | `161, 161, 170` | Secondary metadata (sizes, dates, perms) |
| **`text-dim`** | `#71717a` | `113, 113, 122` | Gutters, separators, placeholders |

---

## 🚦 Functional Semantic Tokens

- **Success / Identical / Verified**: `#10b981` (Emerald 500)
- **Danger / Deleted / Overwrite**: `#ef4444` (Red 500)
- **Information / Remote SFTP / Symlink**: `#38bdf8` (Sky 400)
- **Archive / Compressed**: `#f472b6` (Pink 400)
- **Directories**: `#fbbf24` (Amber 400)
- **Code / Executable**: `#34d399` (Emerald 400)

---

## 💻 CSS Variables Definition

```css
:root {
  --woofson-bg-void: #121214;
  --woofson-bg-panel: #18181b;
  --woofson-bg-header: #202024;
  --woofson-bg-active: #27272a;
  --woofson-bg-selected: rgba(245, 158, 11, 0.18);
  --woofson-accent: #f59e0b;
  --woofson-accent-hover: #fbbf24;
  --woofson-accent-dark: #d97706;
  --woofson-border: #3f3f46;
  --woofson-text-main: #f4f4f5;
  --woofson-text-muted: #a1a1aa;
  --woofson-text-dim: #71717a;
  --woofson-success: #10b981;
  --woofson-danger: #ef4444;
  --woofson-info: #38bdf8;
  --woofson-archive: #f472b6;
}
```
