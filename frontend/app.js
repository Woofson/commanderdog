// CommanderDog Multi-Tab Web Commander - By Woofson
const App = {
  panes: [],
  activePaneIndex: 0,
  layout: localStorage.getItem('cd_layout') || 'layout-dual-vertical',
  paranoidMode: true,
  token: localStorage.getItem('cd_token') || '',
  user: null,
  config: null,
  contextItem: null,
  contextPaneIndex: 0,
  systemUsers: [],
  systemGroups: [],
  showHiddenDefault: localStorage.getItem('cd_show_hidden') !== 'false',
  showFKeyBar: localStorage.getItem('cd_show_fkeys') !== 'false',
  fontSize: parseInt(localStorage.getItem('cd_font_size') || '13', 10),
  quickDestinations: JSON.parse(localStorage.getItem('cd_quick_destinations') || 'null') || [
    { name: 'Home (~)', path: '~' },
    { name: 'Downloads', path: '~/Downloads' },
    { name: 'Documents', path: '~/Documents' },
    { name: 'Desktop', path: '~/Desktop' },
    { name: 'Temporary Files (/tmp)', path: '/tmp' },
  ],
  clipboard: null,
  dblclickUpDir: localStorage.getItem('cd_dblclick_up') !== 'false',
  showParentDir: localStorage.getItem('cd_show_parent_dir') !== 'false',
  autoOpenTasks: localStorage.getItem('cd_auto_open_tasks') !== 'false',
  taskVerbosity: localStorage.getItem('cd_task_verbosity') || 'detailed',
};

function getBasename(path) {
  if (!path) return '';
  return path.split('/').filter(Boolean).pop() || path;
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const formatFileSize = formatBytes;

class PaneState {
  constructor(id, initialPath = '/') {
    this.id = id;
    this.path = localStorage.getItem(`cd_pane_path_${id}`) || initialPath;
    this.entries = [];
    this.selected = new Set();
    this.cursorIndex = 0;
    this.filterText = '';
    this.history = [this.path];
    this.historyIndex = 0;
    this.sortBy = 'name';
    this.sortAsc = true;
    this.totalSize = 0;
    this.protocol = 'local';
    this.showHidden = App.showHiddenDefault;
    this.viewMode = 'details'; // 'details', 'compact', 'grid'
    this.isBranchView = false;
    this.isVirtual = false;
    this.virtualTitle = '';
    this.customName = null;
  }
}

function loadPaneCustomNames() {
  try {
    const saved = JSON.parse(localStorage.getItem('cd_pane_custom_names') || '[]');
    if (Array.isArray(saved)) {
      saved.forEach((name, i) => {
        if (App.panes[i]) App.panes[i].customName = name;
      });
    }
  } catch (e) {}
}

function savePaneCustomNames() {
  const names = App.panes.map(p => p.customName || null);
  localStorage.setItem('cd_pane_custom_names', JSON.stringify(names));
}

function promptRenamePane(index) {
  const pane = App.panes[index];
  if (!pane) return;
  const currentName = pane.customName || `Pane ${index + 1}`;
  const newName = prompt(`Enter custom name for Pane ${index + 1} (leave empty to reset):`, currentName === `Pane ${index + 1}` ? '' : currentName);
  if (newName !== null) {
    pane.customName = newName.trim() || null;
    savePaneCustomNames();
    updatePaneTitles();
    showToast(pane.customName ? `Pane ${index + 1} renamed to "${pane.customName}"` : `Pane ${index + 1} name reset`, 'info');
  }
}

function updatePaneTitles() {
  App.panes.forEach((pane, pIdx) => {
    const displayName = pane.customName || `Pane ${pIdx + 1}`;
    document.querySelectorAll(`.mobile-pane-tab[data-pane-idx="${pIdx}"]`).forEach(tab => {
      tab.innerHTML = `<img src="assets/folder-closed.png" style="width:13px; height:13px; vertical-align:middle; margin-right:4px;"> ${escapeHtml(displayName)}`;
      tab.title = `${escapeHtml(displayName)} (Double-click or right-click to rename)`;
    });
    const titleBadge = document.getElementById(`pane-title-badge-${pIdx}`);
    if (titleBadge) {
      titleBadge.textContent = displayName;
    }
  });
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  initPanes();
  setupEventListeners();
  setupKeyboardNavigation();
  setupHistoryNavigation();
  applyFKeyBarState();
  applyFontSize(App.fontSize);
  applyBorderSettings();
  applyTheme(localStorage.getItem('cd_theme') || 'amber-charcoal');
  startTasksPolling();
  initInactivityTracker();
  checkAuthAndLoad();
});

function initPanes() {
  const defaultCount = 4;
  for (let i = 0; i < defaultCount; i++) {
    App.panes.push(new PaneState(i, '/'));
  }
  loadPaneCustomNames();
}

function applyUserHomeToPanes() {
  const home = (App.user && App.user.home_dir && App.user.home_dir.trim() !== '') ? App.user.home_dir : null;
  if (home && home !== '/') {
    App.panes.forEach((pane, idx) => {
      const saved = localStorage.getItem(`cd_pane_path_${idx}`);
      if (!saved || saved === '/' || pane.path === '/') {
        pane.path = home;
        pane.history = [home];
        pane.historyIdx = 0;
        localStorage.setItem(`cd_pane_path_${idx}`, home);
      }
    });
  }
}

async function checkAuthAndLoad() {
  try {
    const sysResp = await fetch('/api/system/status');
    if (sysResp.ok) {
      const sysData = await sysResp.json();
      App.isStandalone = sysData.standalone;
      if (sysData.standalone || !sysData.auth_enabled) {
        // Standalone desktop mode: auto-load local user without login prompt!
        const meResp = await fetch('/api/auth/me');
        if (meResp.ok) {
          App.user = await meResp.json();
          updateHeaderProfile(App.user);
          hideModal('login-modal');
          await loadConfig();
          await loadSystemUsersGroups();
          await loadAdminSecuritySettings();
          await loadAllFileTags();
          applyUserHomeToPanes();
          renderAllPanes();
          return;
        }
      }
    }
  } catch (e) {
    // Proceed to standard token check
  }

  if (App.token) {
    try {
      const resp = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        App.user = await resp.json();
        updateHeaderProfile(App.user);
        hideModal('login-modal');
        await loadConfig();
        await loadSystemUsersGroups();
        await loadAdminSecuritySettings();
        await loadAllFileTags();

        // If session was locked before browser refresh, keep session locked!
        if (localStorage.getItem('cd_is_locked') === 'true') {
          lockSession();
          return;
        }

        applyUserHomeToPanes();
        renderAllPanes();
        return;
      }
    } catch (e) {
      console.warn('Auth check failed:', e);
    }
  }

  showModal('login-modal');
  setTimeout(() => {
    document.getElementById('login-username')?.focus();
  }, 100);
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      App.config = await res.json();
      App.paranoidMode = App.config.paranoid.enabled;
      updateParanoidBadge();

      // Merge client-side custom themes saved in browser localStorage
      try {
        const localCustoms = JSON.parse(localStorage.getItem('cd_custom_themes') || '[]');
        if (Array.isArray(localCustoms) && localCustoms.length > 0) {
          if (!App.config.themes) App.config.themes = { themes: [] };
          if (!Array.isArray(App.config.themes.themes)) App.config.themes.themes = [];
          localCustoms.forEach(lt => {
            const idx = App.config.themes.themes.findIndex(t => t.id === lt.id);
            if (idx >= 0) App.config.themes.themes[idx] = lt;
            else App.config.themes.themes.push(lt);
          });
        }
      } catch (e) {}

      populateThemeSelectors();

      // Apply theme: localStorage preference or config.toml default_theme
      const savedTheme = localStorage.getItem('cd_theme');
      const activeTheme = savedTheme || App.config?.themes?.default_theme || 'amber-charcoal';
      applyTheme(activeTheme);

      // Configure Global Refresh button visibility (off by default)
      updateGlobalRefreshButtonVisibility();

      // Configure Logout vs Exit button
      updateLogoutOrExitButton();
    }
  } catch (e) {
    console.error('Config fetch failed:', e);
  }
}

function updateGlobalRefreshButtonVisibility() {
  const saved = localStorage.getItem('cd_show_global_refresh');
  const show = saved !== null ? (saved === 'true') : (App.config?.ui?.show_global_refresh === true);

  const btn = document.getElementById('btn-refresh-all');
  const sep = document.getElementById('sep-refresh-all');
  if (btn) btn.style.display = show ? 'inline-flex' : 'none';
  if (sep) sep.style.display = show ? 'block' : 'none';
}

function toggleGlobalRefreshButton(enabled) {
  localStorage.setItem('cd_show_global_refresh', enabled);
  updateGlobalRefreshButtonVisibility();
  showToast(enabled ? 'Global Header Refresh button enabled' : 'Global Header Refresh button hidden', 'info');
}

function toggleCustomThemeCreator() {
  const el = document.getElementById('custom-theme-creator');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function saveCustomBrowserTheme() {
  const nameInput = document.getElementById('custom-theme-name');
  const name = nameInput?.value.trim() || 'Custom Theme';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'custom-' + Date.now();
  const accent = document.getElementById('custom-theme-accent')?.value || '#00e5ff';
  const bg_dark = document.getElementById('custom-theme-bg-dark')?.value || '#0b0f14';
  const bg_panel = document.getElementById('custom-theme-bg-panel')?.value || '#111822';
  const bg_active = bg_panel;
  const border = accent;
  const text_main = '#f4f4f5';
  const text_muted = '#a1a1aa';

  const newTheme = {
    id,
    name,
    bg_dark,
    bg_panel,
    bg_active,
    accent,
    accent_hover: accent,
    text_main,
    text_muted,
    border
  };

  if (!App.config) App.config = {};
  if (!App.config.themes) App.config.themes = { themes: [] };
  if (!Array.isArray(App.config.themes.themes)) App.config.themes.themes = [];

  const existingIdx = App.config.themes.themes.findIndex(t => t.id === id);
  if (existingIdx >= 0) App.config.themes.themes[existingIdx] = newTheme;
  else App.config.themes.themes.push(newTheme);

  let localCustoms = [];
  try {
    localCustoms = JSON.parse(localStorage.getItem('cd_custom_themes') || '[]');
  } catch (e) {}
  localCustoms = localCustoms.filter(t => t.id !== id);
  localCustoms.push(newTheme);
  localStorage.setItem('cd_custom_themes', JSON.stringify(localCustoms));

  populateThemeSelectors();
  applyTheme(id);
  toggleCustomThemeCreator();
  showToast(`Custom theme "${name}" created and applied!`, 'success');
}

function exportCustomThemeToml() {
  const name = document.getElementById('custom-theme-name')?.value.trim() || 'Custom Theme';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'custom';
  const accent = document.getElementById('custom-theme-accent')?.value || '#00e5ff';
  const bg_dark = document.getElementById('custom-theme-bg-dark')?.value || '#0b0f14';
  const bg_panel = document.getElementById('custom-theme-bg-panel')?.value || '#111822';

  const toml = `# CommanderDog Theme Definition
id = "${id}"
name = "${name}"
bg_dark = "${bg_dark}"
bg_panel = "${bg_panel}"
bg_active = "${bg_panel}"
accent = "${accent}"
accent_hover = "${accent}"
text_main = "#f4f4f5"
text_muted = "#a1a1aa"
border = "${accent}"
`;

  const blob = new Blob([toml], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.toml`;
  a.click();
  showToast(`Exported ${id}.toml! You can drop this into ~/.config/commanderdog/themes/`, 'info');
}

function populateThemeSelectors() {
  if (!App.config?.themes?.themes || !Array.isArray(App.config.themes.themes)) return;
  const selectors = [
    document.getElementById('settings-theme-selector'),
    document.getElementById('theme-selector')
  ];

  const curVal = localStorage.getItem('cd_theme') || App.config?.themes?.default_theme || 'amber-charcoal';

  selectors.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    App.config.themes.themes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    sel.value = curVal;
  });

  // Populate visual theme swatch cards
  const grid = document.getElementById('theme-swatch-grid');
  if (grid) {
    grid.innerHTML = '';
    App.config.themes.themes.forEach(t => {
      const card = document.createElement('div');
      card.className = `theme-swatch-card ${t.id === curVal ? 'active' : ''}`;
      card.id = `theme-card-${t.id}`;
      card.onclick = () => applyTheme(t.id);

      card.innerHTML = `
        <div class="theme-swatch-preview">
          <span class="theme-swatch-dot" style="background: ${t.bg_dark};" title="Background: ${t.bg_dark}"></span>
          <span class="theme-swatch-dot" style="background: ${t.bg_panel};" title="Panel: ${t.bg_panel}"></span>
          <span class="theme-swatch-dot" style="background: ${t.accent};" title="Accent: ${t.accent}"></span>
          <span class="theme-swatch-dot" style="background: ${t.text_main};" title="Text: ${t.text_main}"></span>
        </div>
        <div class="theme-swatch-name">${escapeHtml(t.name)}</div>
      `;
      grid.appendChild(card);
    });
  }
}

async function loadSystemUsersGroups() {
  try {
    const res = await fetch('/api/system/users-groups');
    if (res.ok) {
      const data = await res.json();
      App.systemUsers = data.users;
      App.systemGroups = data.groups;
    }
  } catch (e) {
    console.error('Users/Groups load error:', e);
  }
}

function renderAllPanes() {
  const container = document.getElementById('panes-grid');
  container.className = `panes-container ${App.layout}`;
  container.innerHTML = '';

  let visibleCount = getVisiblePaneCount();

  for (let i = 0; i < visibleCount; i++) {
    const pane = App.panes[i];
    const paneEl = createPaneElement(pane, i);
    container.appendChild(paneEl);
    loadPaneDirectory(i, pane.path);
  }

  applyPaneColors();
  if (window.lucide) lucide.createIcons();
}

function createPaneElement(pane, index) {
  const el = document.createElement('div');
  el.className = `pane ${index === App.activePaneIndex ? 'active' : ''}`;
  el.id = `pane-${index}`;
  el.onclick = () => setActivePane(index);

  // Enable HTML5 Drag & Drop Target
  el.ondragover = (e) => {
    e.preventDefault();
    el.classList.add('drag-over');
  };
  el.ondragleave = () => el.classList.remove('drag-over');
  el.ondrop = (e) => handlePaneDrop(e, index);

  const visibleCount = getVisiblePaneCount();
  const colors = getPaneColors();
  let mobileTabs = '';
  if (visibleCount > 1) {
    mobileTabs = `
      <div class="mobile-pane-switcher-bar">
        ${Array.from({ length: visibleCount }).map((_, pIdx) => {
          const color = colors[pIdx] || 'default';
          const isCustom = color.startsWith('#') || color.startsWith('rgb');
          const colorClass = (!isCustom && color !== 'default') ? `pane-tab-color-${color}` : (isCustom ? 'pane-tab-color-custom' : '');
          const customStyle = isCustom ? `style="border-color:${color}; color:${color}; --pane-custom-border:${color};"` : '';
          const tabName = App.panes[pIdx]?.customName || `Pane ${pIdx + 1}`;
          return `
            <button class="mobile-pane-tab ${colorClass} ${pIdx === index ? 'active' : ''}" ${customStyle} data-pane-idx="${pIdx}" onclick="event.stopPropagation(); setActivePane(${pIdx})" ondblclick="event.stopPropagation(); promptRenamePane(${pIdx})" oncontextmenu="event.preventDefault(); event.stopPropagation(); promptRenamePane(${pIdx})" title="${escapeHtml(tabName)} (Double-click or right-click to rename)">
              <img src="assets/folder-closed.png" style="width:13px; height:13px; vertical-align:middle; margin-right:4px;"> ${escapeHtml(tabName)}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  const paneTitle = pane.customName || `Pane ${index + 1}`;

  if (pane.dockedTool) {
    const tool = pane.dockedTool;
    const toolTitles = {
      'editor': '💻 EditorDog',
      'terminal': '📟 Terminal Console',
      'calculator': '🧮 Calculator',
      'git': '🌲 Git Manager',
      'tasks': '⚡ Transfers & Queue'
    };
    el.innerHTML = `
      ${mobileTabs}
      <div class="pane-header">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
          <span style="font-weight: 700; font-size: 12px; color: var(--accent);">${toolTitles[tool] || 'Docked Tool'}</span>
          <span class="badge" style="font-size: 9px;">DOCKED PANE ${index + 1}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button class="btn btn-xs btn-outline" onclick="event.stopPropagation(); undockToolFromPane(${index})" title="Undock to Floating Window"><i data-lucide="external-link" style="width:11px; height:11px;"></i> Float</button>
          <button class="btn btn-xs btn-icon btn-danger" onclick="event.stopPropagation(); closeDockedTool(${index})" title="Close Docked Tool"><i data-lucide="x" style="width:11px; height:11px;"></i></button>
        </div>
      </div>
      <div class="pane-content" id="pane-content-${index}" style="padding: 0; overflow: hidden; display: flex; flex-direction: column;">
        <div id="docked-tool-mount-${index}" style="flex: 1; height: 100%; width: 100%; display: flex; flex-direction: column; overflow: hidden;"></div>
      </div>
    `;
    return el;
  }

  el.innerHTML = `
    ${mobileTabs}
    <div class="pane-header">
      <div class="pane-nav-btns">
        <button onclick="navPaneHistory(${index}, -1)" title="Back"><i data-lucide="arrow-left"></i></button>
        <button onclick="navPaneHistory(${index}, 1)" title="Forward"><i data-lucide="arrow-right"></i></button>
        <button onclick="navPaneUp(${index})" title="Parent Directory (Backspace)"><i data-lucide="arrow-up"></i></button>
        <button onclick="refreshPane(${index})" title="Refresh"><i data-lucide="rotate-cw"></i></button>
        <button onclick="openRemoteModal(${index})" class="desktop-header-tool" title="Connect Remote SFTP / WebDAV Server"><i data-lucide="network"></i></button>
      </div>

      <!-- Path bar & Breadcrumbs -->
      <div class="pane-path-bar" onclick="enablePathInput(${index})">
        <div class="pane-breadcrumbs" id="pane-crumbs-${index}"></div>
        <input type="text" class="pane-path-input" id="pane-input-${index}" onkeydown="handlePathKey(event, ${index})" onblur="disablePathInput(${index})">
      </div>

      <!-- Favorites & Quick Bookmarks (Desktop) -->
      <div class="pane-favorites-wrapper desktop-header-tool">
        <button class="btn btn-icon" id="btn-favorites-${index}" onclick="openPaneFavoritesMenu(event, ${index})" oncontextmenu="event.preventDefault(); openBookmarksManager();" title="Favorites & Bookmarks (Left-click: Quick Jump, Right-click: Manage)">
          <i data-lucide="star" style="color: var(--accent);"></i>
        </button>
      </div>

      <!-- Pane Border Identification Color Selector & Label (Desktop) -->
      <div class="pane-color-wrapper desktop-header-tool">
        <button class="btn btn-icon pane-idx-badge" id="pane-idx-badge-${index}" onclick="event.stopPropagation(); cyclePaneColor(${index})" oncontextmenu="event.preventDefault(); event.stopPropagation(); openPaneColorPicker(event, ${index})" title="Pane ${index + 1} Identification Color (Left-click: Cycle, Right-click: Palette & Color Picker)">
          <i data-lucide="palette"></i>
        </button>
      </div>

      <!-- Pane Custom Label Badge (Desktop) -->
      <div class="pane-title-badge-wrapper desktop-header-tool">
        <span class="pane-title-badge" id="pane-title-badge-${index}" onclick="event.stopPropagation(); promptRenamePane(${index})" oncontextmenu="event.preventDefault(); event.stopPropagation(); promptRenamePane(${index})" title="Pane Label (Click or right-click to Rename)">${escapeHtml(paneTitle)}</span>
      </div>

      <!-- Foldable & Touch Cross-Pane Transfer Button (Desktop) -->
      <button class="btn btn-icon pane-quick-transfer-btn desktop-header-tool" onclick="event.stopPropagation(); setActivePane(${index}); triggerCopy();" title="Transfer / Copy to Other Pane (F5)">
        <i data-lucide="arrow-right-left" style="color: var(--accent);"></i>
      </button>

      <!-- Direct Device Upload Button (Desktop) -->
      <button class="btn btn-icon pane-upload-btn desktop-header-tool" onclick="event.stopPropagation(); setActivePane(${index}); triggerDeviceUpload(${index});" title="Upload Files from Device to this Directory">
        <i data-lucide="upload-cloud"></i>
      </button>

      <!-- Combined Pane Menu Button (Mobile & Foldable Viewports) -->
      <div class="pane-tools-wrapper mobile-foldable-tool">
        <button class="btn btn-icon pane-tools-btn" id="pane-tools-btn-${index}" onclick="openPaneToolsMenu(event, ${index})" title="Pane Tools (Transfer, Upload, Color, etc.)">
          <i data-lucide="more-vertical"></i>
        </button>
      </div>

      <input type="text" class="pane-quick-filter" placeholder="Filter (/)..." id="pane-filter-${index}" oninput="handleFilterInput(${index}, this.value)">
    </div>

    <div class="pane-content" id="pane-content-${index}">
      <div class="pull-refresh-indicator" id="pull-refresh-${index}" style="display: none; height: 0px; overflow: hidden; justify-content: center; align-items: center; background: rgba(0,0,0,0.3); color: var(--accent); font-size: 11px; font-weight: 700; transition: height 0.1s linear; border-bottom: 1px dashed var(--border);">
        <i data-lucide="rotate-cw" class="pull-refresh-spinner" style="width: 14px; margin-right: 6px;"></i>
        <span class="pull-refresh-label">Pull down to refresh...</span>
      </div>
      <table class="file-table">
        <thead>
          <tr>
            <th style="width: 28px; text-align: center;"></th>
            <th onclick="sortPane(${index}, 'name')">Name</th>
            <th style="width: 75px;" onclick="sortPane(${index}, 'size')">Size</th>
            <th style="width: 125px;" onclick="sortPane(${index}, 'modified')">Modified</th>
            <th style="width: 70px;">Mode</th>
            <th style="width: 80px;">Owner</th>
          </tr>
        </thead>
        <tbody id="pane-tbody-${index}"></tbody>
      </table>
    </div>

    <div class="pane-footer" id="pane-footer-${index}">
      <span>0 items</span>
      <span>0 B</span>
    </div>
  `;

  const content = el.querySelector('.pane-content');
  if (content) {
    content.ondblclick = (e) => {
      if (e.target.closest('tr.file-row')) return;
      if (App.dblclickUpDir) {
        navPaneUp(index);
      }
    };
    content.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isTouch = window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;
      if (isTouch) return false;
      if (e.target.closest('tr.file-row')) return;
      setActivePane(index);
      showEmptySpaceContextMenu(e.clientX, e.clientY, index);
    };

    // Mobile Pull-to-Refresh
    let pullStartY = 0;
    let isPulling = false;
    let pullDistance = 0;

    content.addEventListener('touchstart', (e) => {
      if (content.scrollTop <= 0 && e.touches.length === 1) {
        pullStartY = e.touches[0].clientY;
        isPulling = true;
        pullDistance = 0;
      } else {
        isPulling = false;
      }
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (!isPulling || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const diffY = currentY - pullStartY;
      if (diffY > 0 && content.scrollTop <= 0) {
        pullDistance = Math.min(80, diffY * 0.45);
        const indicator = document.getElementById(`pull-refresh-${index}`);
        if (indicator) {
          indicator.style.display = 'flex';
          indicator.style.height = `${pullDistance}px`;
          const label = indicator.querySelector('.pull-refresh-label');
          const icon = indicator.querySelector('.pull-refresh-spinner');
          if (pullDistance > 45) {
            if (label) label.textContent = 'Release to refresh...';
            if (icon) icon.style.transform = `rotate(${pullDistance * 4}deg)`;
          } else {
            if (label) label.textContent = 'Pull down to refresh...';
            if (icon) icon.style.transform = `rotate(${pullDistance * 2}deg)`;
          }
        }
      } else {
        pullDistance = 0;
        const indicator = document.getElementById(`pull-refresh-${index}`);
        if (indicator) {
          indicator.style.display = 'none';
          indicator.style.height = '0px';
        }
      }
    }, { passive: true });

    content.addEventListener('touchend', () => {
      if (isPulling && pullDistance > 45) {
        const indicator = document.getElementById(`pull-refresh-${index}`);
        if (indicator) {
          const label = indicator.querySelector('.pull-refresh-label');
          const icon = indicator.querySelector('.pull-refresh-spinner');
          if (label) label.textContent = 'Refreshing...';
          if (icon) icon.classList.add('animate-spin');
          if (navigator.vibrate) navigator.vibrate(30);
        }
        setTimeout(() => {
          refreshPane(index);
          const ind = document.getElementById(`pull-refresh-${index}`);
          if (ind) {
            ind.style.display = 'none';
            ind.style.height = '0px';
            const icon = ind.querySelector('.pull-refresh-spinner');
            if (icon) icon.classList.remove('animate-spin');
          }
        }, 300);
      } else {
        const indicator = document.getElementById(`pull-refresh-${index}`);
        if (indicator) {
          indicator.style.display = 'none';
          indicator.style.height = '0px';
        }
      }
      isPulling = false;
      pullDistance = 0;
    });
  }

  return el;
}

function setActivePane(index) {
  App.activePaneIndex = index;
  document.querySelectorAll('.pane').forEach((p, idx) => {
    if (idx === index) p.classList.add('active');
    else p.classList.remove('active');
  });

  document.querySelectorAll('.mobile-pane-tab').forEach((tab) => {
    const pIdx = parseInt(tab.getAttribute('data-pane-idx'), 10);
    if (pIdx === index) tab.classList.add('active');
    else tab.classList.remove('active');
  });
}

function togglePaneDotfiles(paneIndex) {
  const pane = App.panes[paneIndex];
  pane.showHidden = !pane.showHidden;
  const btn = document.getElementById(`btn-dotfiles-${paneIndex}`);
  if (btn) {
    if (pane.showHidden) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  loadPaneDirectory(paneIndex, pane.path);
}

async function loadPaneDirectory(paneIndex, targetPath, pushHistory = true, selectItemName = null) {
  if (targetPath === '~' || (typeof targetPath === 'string' && targetPath.startsWith('~/'))) {
    const userHome = (App.user && App.user.home_dir && App.user.home_dir !== '/') ? App.user.home_dir : '/';
    targetPath = targetPath === '~' ? userHome : (userHome.endsWith('/') ? userHome : userHome + '/') + targetPath.substring(2);
  }

  const pane = App.panes[paneIndex];
  pane.path = targetPath;
  if (!selectItemName) {
    pane.selected.clear();
  }
  localStorage.setItem(`cd_pane_path_${paneIndex}`, targetPath);

  if (pushHistory && window.history && history.pushState) {
    history.pushState({ type: 'dir', paneIndex, path: targetPath }, '', '');
  }

  try {
    const flatParam = pane.isBranchView ? '&flat=true' : '';
    const url = `/api/fs/list?path=${encodeURIComponent(targetPath)}&show_hidden=${pane.showHidden}${flatParam}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (!resp.ok) {
      const errText = await resp.text();
      showToast(`Failed to load directory: ${errText}`, 'error');
      console.error(`Failed to load ${targetPath}:`, errText);
      return;
    }

    const data = await resp.json();
    pane.path = data.current_path;
    pane.parentPath = data.parent_path;
    pane.entries = data.entries;
    pane.totalSize = data.total_size;

    if (selectItemName && pane.entries) {
      pane.selected.clear();
      const cleanName = selectItemName.split('/').pop();
      const match = pane.entries.find(e => e.name === cleanName || e.name === selectItemName || e.path === selectItemName || e.path.endsWith('/' + cleanName));
      if (match) {
        pane.selected.add(match.path);
        const idx = pane.entries.indexOf(match);
        if (idx !== -1) pane.cursorIndex = idx;
      }
    }

    renderPaneBreadcrumbs(paneIndex, pane.path);
    if (pane.dockedTool) {
      renderDockedPaneTool(paneIndex);
    } else {
      renderPaneTable(paneIndex);
    }
    updatePaneFooter(paneIndex, data);
    fetchGitStatusForPane(paneIndex, pane.path);
  } catch (e) {
    console.error('Directory load error:', e);
  }
}

function renderPaneBreadcrumbs(paneIndex, pathStr) {
  const pane = App.panes[paneIndex];
  const container = document.getElementById(`pane-crumbs-${paneIndex}`);
  if (!container) return;
  container.innerHTML = '';

  if (pane && pane.isBranchView) {
    const branchBadge = document.createElement('span');
    branchBadge.className = 'branch-view-badge';
    branchBadge.innerHTML = '<i data-lucide="git-branch" style="width:11px; height:11px;"></i> Flat Branch View';
    container.appendChild(branchBadge);

    const pathCrumb = document.createElement('span');
    pathCrumb.className = 'crumb';
    pathCrumb.style.maxWidth = '180px';
    pathCrumb.style.overflow = 'hidden';
    pathCrumb.style.textOverflow = 'ellipsis';
    pathCrumb.textContent = pathStr;
    container.appendChild(pathCrumb);

    const exitBtn = document.createElement('button');
    exitBtn.className = 'btn btn-xs';
    exitBtn.style.marginLeft = 'auto';
    exitBtn.style.padding = '1px 6px';
    exitBtn.textContent = '✕ Exit Branch';
    exitBtn.onclick = (e) => { e.stopPropagation(); toggleBranchView(paneIndex); };
    container.appendChild(exitBtn);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (pane && pane.isVirtual) {
    const virtBadge = document.createElement('span');
    virtBadge.className = 'virtual-pane-badge';
    virtBadge.innerHTML = `<i data-lucide="search" style="width:11px; height:11px;"></i> ${escapeHtml(pane.virtualTitle || 'Search Results')}`;
    container.appendChild(virtBadge);

    const exitBtn = document.createElement('button');
    exitBtn.className = 'btn btn-xs';
    exitBtn.style.marginLeft = 'auto';
    exitBtn.style.padding = '1px 6px';
    exitBtn.textContent = '✕ Exit Virtual';
    exitBtn.onclick = (e) => { e.stopPropagation(); exitVirtualPane(paneIndex); };
    container.appendChild(exitBtn);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (pathStr.startsWith('archive://')) {
    const raw = pathStr.replace('archive://', '');
    const [arch, sub] = raw.split('#');
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'crumb';
    rootCrumb.textContent = '📦 ' + (arch.split('/').pop() || 'archive');
    rootCrumb.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, `archive://${arch}#`); };
    container.appendChild(rootCrumb);

    if (sub) {
      const subParts = sub.split('/').filter(Boolean);
      let buildSub = '';
      subParts.forEach(part => {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        container.appendChild(sep);

        buildSub += (buildSub ? '/' : '') + part;
        const target = `archive://${arch}#${buildSub}`;
        const c = document.createElement('span');
        c.className = 'crumb';
        c.textContent = part;
        c.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, target); };
        container.appendChild(c);
      });
    }
    return;
  }

  const protoMatch = pathStr.match(/^([a-zA-Z0-9_-]+):\/\/(.*)$/);
  if (protoMatch) {
    const proto = protoMatch[1].toLowerCase();
    const rest = protoMatch[2];

    const slashIdx = rest.indexOf('/');
    let serverBase = rest;
    let subpath = '';
    if (slashIdx !== -1) {
      if (proto === 'smb') {
        const afterHostSlash = rest.indexOf('/', slashIdx + 1);
        if (afterHostSlash !== -1) {
          serverBase = rest.substring(0, afterHostSlash);
          subpath = rest.substring(afterHostSlash + 1);
        } else {
          serverBase = rest;
          subpath = '';
        }
      } else {
        serverBase = rest.substring(0, slashIdx);
        subpath = rest.substring(slashIdx + 1);
      }
    }

    let displayBase = serverBase;
    if (displayBase.includes('@')) {
      const atIdx = displayBase.indexOf('@');
      const auth = displayBase.substring(0, atIdx);
      const hostPart = displayBase.substring(atIdx + 1);
      if (auth.includes(':')) {
        const userPart = auth.split(':')[0];
        displayBase = `${userPart}@${hostPart}`;
      }
    }

    const protoIcon = proto === 'smb' ? '🪟 ' : (proto === 'sftp' ? '🔒 ' : (proto === 'nfs' ? '📁 ' : (proto === 'webdav' ? '🌐 ' : '☁️ ')));
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'crumb';
    rootCrumb.textContent = `${protoIcon}${proto}://${displayBase}`;
    const rootTarget = `${proto}://${serverBase}`;
    rootCrumb.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, rootTarget); };
    container.appendChild(rootCrumb);

    if (subpath) {
      const parts = subpath.split('/').filter(Boolean);
      let curSub = '';
      parts.forEach(part => {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        container.appendChild(sep);

        curSub += (curSub ? '/' : '') + part;
        const target = `${proto}://${serverBase}/${curSub}`;
        const c = document.createElement('span');
        c.className = 'crumb';
        c.textContent = part;
        c.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, target); };
        container.appendChild(c);
      });
    }
    return;
  }

  const parts = pathStr.split('/').filter(Boolean);
  const rootCrumb = document.createElement('span');
  rootCrumb.className = 'crumb';
  rootCrumb.textContent = '/';
  rootCrumb.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, '/'); };
  container.appendChild(rootCrumb);

  let currentBuild = '';
  parts.forEach((part) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '/';
    container.appendChild(sep);

    currentBuild += '/' + part;
    const target = currentBuild;

    const c = document.createElement('span');
    c.className = 'crumb';
    c.textContent = part;
    c.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, target); };
    container.appendChild(c);
  });
}

function renderPaneTable(paneIndex) {
  const pane = App.panes[paneIndex];
  const tbody = document.getElementById(`pane-tbody-${paneIndex}`);
  if (!tbody) return;

  tbody.innerHTML = '';

  let filtered = pane.entries;
  if (pane.filterText) {
    const ft = pane.filterText.toLowerCase();
    filtered = filtered.filter(e => e.name.toLowerCase().includes(ft));
  }

  // Sort
  filtered.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let cmp = 0;
    if (pane.sortBy === 'name') cmp = a.name.localeCompare(b.name);
    else if (pane.sortBy === 'size') cmp = a.size - b.size;
    else if (pane.sortBy === 'modified') cmp = (a.modified || 0) - (b.modified || 0);
    return pane.sortAsc ? cmp : -cmp;
  });

  const isTouchDevice = window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;

  // Parent directory ".." row when not at root (and enabled in settings)
  if (App.showParentDir && pane.path !== '/' && pane.path !== '' && !pane.filterText) {
    const parentTr = document.createElement('tr');
    parentTr.className = 'file-row parent-dir-row';
    parentTr.draggable = !isTouchDevice;

    let parentTouchStart = 0;
    parentTr.ontouchstart = () => { parentTouchStart = Date.now(); };
    parentTr.ontouchend = (e) => {
      if (Date.now() - parentTouchStart < 400) {
        e.preventDefault();
        setActivePane(paneIndex);
        navPaneUp(paneIndex);
      }
    };

    parentTr.onclick = (e) => {
      e.stopPropagation();
      setActivePane(paneIndex);
      if (isTouchDevice) {
        navPaneUp(paneIndex);
      } else {
        pane.selected.clear();
        pane.cursorIndex = -1;
        renderPaneTable(paneIndex);
      }
    };

    parentTr.ondblclick = (e) => {
      e.stopPropagation();
      setActivePane(paneIndex);
      navPaneUp(paneIndex);
    };

    if (!isTouchDevice) {
      parentTr.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        parentTr.classList.add('drag-over-row');
      };

      parentTr.ondragleave = () => parentTr.classList.remove('drag-over-row');

      parentTr.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        parentTr.classList.remove('drag-over-row');
        const parts = pane.path.split('/').filter(Boolean);
        parts.pop();
        const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
        handlePaneDrop(e, paneIndex, parent);
      };
    }

    parentTr.innerHTML = `
      <td class="file-cell file-cell-icon">
        <div class="row-icon-wrapper">
          <img src="assets/folder-open.png" class="file-icon-img" alt="Parent Directory" style="width: 17px; height: 17px;">
        </div>
      </td>
      <td class="file-cell file-cell-name">
        <span class="file-name-text" style="font-weight: 700; color: var(--accent); font-size: 13px;">..</span>
      </td>
      <td class="file-cell file-cell-mono file-cell-size" style="color: var(--accent); font-weight: 600;">&lt;UP&gt;</td>
      <td class="file-cell file-cell-mono">-</td>
      <td class="file-cell file-cell-mono">-</td>
      <td class="file-cell file-cell-mono">-</td>
    `;
    tbody.appendChild(parentTr);
  }

  filtered.forEach((entry, idx) => {
    const tagInfo = fileTagsMap.get(entry.path);
    let colorClass = '';
    let tagsHtml = '';
    if (tagInfo) {
      if (tagInfo.color_label && tagInfo.color_label !== 'none') {
        colorClass = `file-row-color-${tagInfo.color_label}`;
      }
      if (tagInfo.tags && tagInfo.tags.length > 0) {
        tagsHtml = tagInfo.tags.map(t => `<span class="file-tag-badge">#${escapeHtml(t)}</span>`).join('');
      }
    }

    const isSelected = pane.selected.has(entry.path);
    const tr = document.createElement('tr');
    tr.className = `file-row ${isSelected ? 'selected' : ''} ${idx === pane.cursorIndex ? 'cursor-focus' : ''} ${colorClass}`;
    tr.draggable = !isTouchDevice;

    if (!isTouchDevice) {
      tr.ondragstart = (e) => {
        const selectedPaths = pane.selected.size > 0 ? Array.from(pane.selected) : [entry.path];
        e.dataTransfer.setData('text/plain', JSON.stringify({
          sourcePane: paneIndex,
          paths: selectedPaths
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
      };

      tr.ondragover = (e) => {
        if (entry.is_dir) {
          e.preventDefault();
          e.stopPropagation();
          tr.classList.add('drag-over-row');
        }
      };

      tr.ondragleave = () => {
        if (entry.is_dir) {
          tr.classList.remove('drag-over-row');
        }
      };

      tr.ondrop = (e) => {
        if (entry.is_dir) {
          e.preventDefault();
          e.stopPropagation();
          tr.classList.remove('drag-over-row');
          handlePaneDrop(e, paneIndex, entry.path);
        }
      };
    }

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isScrolling = false;
    let isLongPress = false;
    let touchTimer = null;

    // Standard Android tap-and-hold (long-press 400ms) for multi-select
    tr.ontouchstart = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isScrolling = false;
      isLongPress = false;

      touchTimer = setTimeout(() => {
        if (isScrolling) return;
        isLongPress = true;
        setActivePane(paneIndex);
        App.contextItem = entry;
        App.contextPaneIndex = paneIndex;

        // Toggle selection on tap-and-hold
        if (pane.selected.has(entry.path)) {
          pane.selected.delete(entry.path);
        } else {
          pane.selected.add(entry.path);
        }
        renderPaneTable(paneIndex);
        updateMobileBottomBar();

        if (navigator.vibrate) navigator.vibrate(50);
      }, 400);
    };

    tr.ontouchmove = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > 8 || dy > 8) {
        isScrolling = true;
        if (touchTimer) {
          clearTimeout(touchTimer);
          touchTimer = null;
        }
      }
    };

    tr.ontouchend = (e) => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }

      if (isLongPress) {
        e.preventDefault();
        return;
      }

      if (isScrolling) return;

      const pressDuration = Date.now() - touchStartTime;
      // Valid touch tap (<400ms without scrolling)
      if (pressDuration < 400) {
        e.preventDefault();
        setActivePane(paneIndex);

        // If in Multi-Select Mode (1 or more items selected):
        if (pane.selected.size > 0) {
          if (pane.selected.has(entry.path)) {
            pane.selected.delete(entry.path);
          } else {
            pane.selected.add(entry.path);
          }
          renderPaneTable(paneIndex);
          updateMobileBottomBar();
          return;
        }

        // Normal browsing mode: Single tap opens folder / file
        openFileByType(entry, paneIndex);
      }
    };

    tr.onclick = (e) => {
      const isTouch = window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;
      if (isTouch) return; // Touch handled by touchend

      setActivePane(paneIndex);
      if (e.shiftKey || e.ctrlKey) {
        if (pane.selected.has(entry.path)) pane.selected.delete(entry.path);
        else pane.selected.add(entry.path);
      } else {
        pane.selected.clear();
        pane.selected.add(entry.path);
      }
      pane.cursorIndex = idx;
      renderPaneTable(paneIndex);
      updateMobileBottomBar();
    };

    tr.ondblclick = () => {
      openFileByType(entry, paneIndex);
    };

    tr.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isTouch = window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;
      if (isTouch) {
        return false; // On touch, long-press only selects the item. The user opens actions via the Actions button.
      }
      App.contextItem = entry;
      App.contextPaneIndex = paneIndex;
      showContextMenu(e.clientX, e.clientY);
    };

    let iconHtml = '';
    const isMobile = window.innerWidth <= 768;
    const showCheckBadge = isSelected && isMobile;

    if (showCheckBadge) {
      iconHtml = `<i data-lucide="check" class="file-icon check-icon" style="width: 15px; height: 15px;"></i>`;
    } else if (entry.is_dir) {
      iconHtml = `<img src="assets/folder-closed.png" class="file-icon-img" alt="Folder" style="width: 17px; height: 17px;">`;
    } else {
      let iconType = 'text';
      let iconName = 'file-text';
      if (entry.is_archive) {
        iconType = 'archive';
        iconName = 'file-archive';
      } else if (isImageExtension(entry.name)) {
        iconType = 'image';
        iconName = 'image';
      } else if (isPdfExtension(entry.name)) {
        iconType = 'pdf';
        iconName = 'file-text';
      } else if (isAudioExtension(entry.name)) {
        iconType = 'audio';
        iconName = 'music';
      } else if (isVideoExtension(entry.name)) {
        iconType = 'video';
        iconName = 'video';
      } else if (isComicBookExtension(entry.name)) {
        iconType = 'book';
        iconName = 'book-open';
      }
      iconHtml = `<i data-lucide="${iconName}" class="file-icon ${iconType}" style="width: 15px; height: 15px;"></i>`;
    }

    tr.innerHTML = `
      <td class="file-cell file-cell-icon">
        <div class="row-icon-wrapper ${showCheckBadge ? 'selected' : ''}">
          ${iconHtml}
        </div>
      </td>
      <td class="file-cell file-cell-name">
        <span class="file-name-text">${escapeHtml(entry.name)}</span>${tagsHtml}
      </td>
      <td class="file-cell file-cell-mono file-cell-size">${entry.is_dir ? '<DIR>' : formatBytes(entry.size)}</td>
      <td class="file-cell file-cell-mono">${formatDate(entry.modified)}</td>
      <td class="file-cell file-cell-mono" title="${entry.permissions}">${entry.mode_octal || entry.permissions}</td>
      <td class="file-cell file-cell-mono">${entry.owner}:${entry.group}</td>
    `;

    tbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
  updateMobileBottomBar();
}

function updatePaneFooter(paneIndex, data) {
  const footer = document.getElementById(`pane-footer-${paneIndex}`);
  if (footer) {
    footer.innerHTML = `
      <span>${data.total_dirs} dirs, ${data.total_files} files</span>
      <span>Total: ${formatBytes(data.total_size)}</span>
    `;
  }
}

// ---------------- PERMISSIONS MANAGER (CHMOD / CHOWN) ----------------

let activePermEntry = null;

function triggerPermissions() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  activePermEntry = item;
  document.getElementById('perm-target-name').textContent = item.name;
  document.getElementById('perm-target-path').textContent = item.path;

  // Parse mode octal or permissions
  let mode = 0o755;
  if (item.mode_octal) {
    mode = parseInt(item.mode_octal, 8);
  }

  setPermCheckboxesFromMode(mode);
  populateOwnerGroupDropdowns(item.owner, item.group);
  showModal('permissions-modal');
}

function setPermCheckboxesFromMode(mode) {
  // Owner (u)
  document.getElementById('perm-u-r').checked = (mode & 0o400) !== 0;
  document.getElementById('perm-u-w').checked = (mode & 0o200) !== 0;
  document.getElementById('perm-u-x').checked = (mode & 0o100) !== 0;

  // Group (g)
  document.getElementById('perm-g-r').checked = (mode & 0o040) !== 0;
  document.getElementById('perm-g-w').checked = (mode & 0o020) !== 0;
  document.getElementById('perm-g-x').checked = (mode & 0o010) !== 0;

  // Others (o)
  document.getElementById('perm-o-r').checked = (mode & 0o004) !== 0;
  document.getElementById('perm-o-w').checked = (mode & 0o002) !== 0;
  document.getElementById('perm-o-x').checked = (mode & 0o001) !== 0;

  document.getElementById('perm-octal-display').textContent = '0' + (mode & 0o777).toString(8);
}

function updatePermFromCheckboxes() {
  let mode = 0;
  if (document.getElementById('perm-u-r').checked) mode |= 0o400;
  if (document.getElementById('perm-u-w').checked) mode |= 0o200;
  if (document.getElementById('perm-u-x').checked) mode |= 0o100;

  if (document.getElementById('perm-g-r').checked) mode |= 0o040;
  if (document.getElementById('perm-g-w').checked) mode |= 0o020;
  if (document.getElementById('perm-g-x').checked) mode |= 0o010;

  if (document.getElementById('perm-o-r').checked) mode |= 0o004;
  if (document.getElementById('perm-o-w').checked) mode |= 0o002;
  if (document.getElementById('perm-o-x').checked) mode |= 0o001;

  document.getElementById('perm-octal-display').textContent = '0' + (mode & 0o777).toString(8);
}

function applyPermPreset(presetMode) {
  setPermCheckboxesFromMode(presetMode);
}

function populateOwnerGroupDropdowns(currentOwner, currentGroup) {
  const uSel = document.getElementById('perm-owner-select');
  const gSel = document.getElementById('perm-group-select');

  uSel.innerHTML = '';
  gSel.innerHTML = '';

  App.systemUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    if (u === currentOwner) opt.selected = true;
    uSel.appendChild(opt);
  });

  App.systemGroups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    if (g === currentGroup) opt.selected = true;
    gSel.appendChild(opt);
  });
}

document.getElementById('btn-save-permissions')?.addEventListener('click', async () => {
  if (!activePermEntry) return;

  const modeStr = document.getElementById('perm-octal-display').textContent;
  const modeVal = parseInt(modeStr, 8);
  const recursive = document.getElementById('perm-recursive').checked;
  const owner = document.getElementById('perm-owner-select').value;
  const group = document.getElementById('perm-group-select').value;

  const paths = [activePermEntry.path];

  // 1. Chmod
  await fetch('/api/fs/chmod', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ paths, mode: modeVal, recursive })
  });

  // 2. Chown
  await fetch('/api/fs/chown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ paths, owner, group, recursive })
  });

  closeModal('permissions-modal');
  refreshPane(App.activePaneIndex);
});

// ---------------- SETTINGS & CONF.D INSPECTOR ----------------

function switchSettingsTab(tabId) {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.querySelectorAll('.settings-tab-btn').forEach(btn => btn.classList.remove('active'));
  modal.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));

  if (window.event && window.event.currentTarget && window.event.currentTarget.classList.contains('settings-tab-btn')) {
    window.event.currentTarget.classList.add('active');
  } else {
    modal.querySelector(`[onclick*="${tabId}"]`)?.classList.add('active');
  }
  document.getElementById(tabId)?.classList.add('active');

  if (tabId === 'tab-bookmarks') loadBookmarksList();
}

function switchAdminTab(tabId) {
  const modal = document.getElementById('admin-panel-modal');
  if (!modal) return;
  modal.querySelectorAll('.settings-tab-btn').forEach(btn => btn.classList.remove('active'));
  modal.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));

  if (window.event && window.event.currentTarget && window.event.currentTarget.classList.contains('settings-tab-btn')) {
    window.event.currentTarget.classList.add('active');
  } else {
    modal.querySelector(`[onclick*="${tabId}"]`)?.classList.add('active');
  }
  document.getElementById(tabId)?.classList.add('active');

  if (tabId === 'admin-tab-users') loadUsersTable();
  if (tabId === 'admin-tab-storage') loadAdminGlobalMounts();
  if (tabId === 'admin-tab-config') loadMasterConfigEditor();
  if (tabId === 'admin-tab-security') loadAdminSecuritySettings();
}

async function loadUsersTable() {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 16px;">Loading user database & RBAC permissions...</td></tr>';

  try {
    const resp = await fetch('/api/auth/users', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const users = await resp.json();
      tbody.innerHTML = users.map(u => {
        let allowed = [];
        try {
          allowed = typeof u.allowed_services === 'string' ? JSON.parse(u.allowed_services) : (u.allowed_services || ['*']);
        } catch (_) {
          allowed = ['*'];
        }
        const hasAll = allowed.includes('*');

        const services = ['local', 'smb', 'nfs', 's3', 'sftp', 'webdav', 'terminal', 'syncthing', 'converters', 'upload', 'download'];
        const serviceLabels = {
          'local': 'Local',
          'smb': 'SMB/CIFS',
          'nfs': 'NFS',
          's3': 'S3',
          'sftp': 'SFTP',
          'webdav': 'WebDAV',
          'terminal': 'Terminal',
          'syncthing': 'Syncthing',
          'converters': 'ConvertX',
          'upload': 'Upload',
          'download': 'Download'
        };

        const safeUname = escapeHtml(u.username);
        const isDisabled = !!u.is_disabled;

        return `
          <tr class="admin-user-row">
            <td class="admin-user-cell">
              <div style="font-weight: 700; font-size: 13px; color: var(--text-main); display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <div class="profile-avatar-thumb" style="width: 22px; height: 22px;">
                  ${u.avatar_url && (u.avatar_url.startsWith('data:image') || u.avatar_url.startsWith('http') || u.avatar_url.startsWith('/')) ? `<img src="${escapeHtml(u.avatar_url)}" alt="Avatar">` : escapeHtml(u.avatar_url || '👤')}
                </div>
                <span>${safeUname}</span>
                ${u.is_pam ? '<span class="badge" style="font-size:9px; background:rgba(56,189,248,0.2); color:var(--info); border:1px solid rgba(56,189,248,0.35);">PAM / LINUX</span>' : '<span class="badge" style="font-size:9px; background:rgba(245,158,11,0.2); color:var(--accent); border:1px solid rgba(245,158,11,0.35);">DATABASE</span>'}
              </div>
              <div style="font-size: 11px; color: var(--text-dim); padding-left: 30px;">${escapeHtml(u.email || (u.nickname ? `@${u.nickname}` : 'System user account'))}</div>
              <div style="margin-top: 6px; padding-left: 30px;">
                <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px;">
                  <input type="checkbox" id="user-disabled-${safeUname}" ${isDisabled ? 'checked' : ''} onchange="handleUserDisabledToggle('${safeUname}', this.checked)">
                  <span id="user-disabled-badge-${safeUname}" style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; color: ${isDisabled ? 'var(--danger)' : 'var(--success)'}; background: ${isDisabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)'}; border: 1px solid ${isDisabled ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.35)'};">
                    ${isDisabled ? '⛔ Account Disabled' : '🟢 Active'}
                  </span>
                </label>
              </div>
            </td>
            <td class="admin-user-cell">
              <select id="user-role-${safeUname}" class="pane-quick-filter" style="padding: 6px 8px; font-size: 11px; width: 100%;">
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
                <option value="user" ${u.role === 'user' ? 'selected' : ''}>Standard User</option>
                <option value="readonly" ${u.role === 'readonly' ? 'selected' : ''}>Read-Only</option>
              </select>
            </td>
            <td class="admin-user-cell">
              <input type="text" id="user-home-${safeUname}" class="pane-quick-filter" value="${escapeHtml(u.home_dir)}" style="width: 100%; padding: 6px 8px; font-size: 11px;">
            </td>
            <td class="admin-user-cell">
              <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px;">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; font-size: 10px;">
                  ${services.map(svc => {
                    const isChecked = hasAll || allowed.includes(svc);
                    return `
                      <label style="display: flex; align-items: center; gap: 4px; font-weight: normal; cursor: pointer; color: ${isChecked ? 'var(--text-main)' : 'var(--text-muted)'};">
                        <input type="checkbox" id="svc-${safeUname}-${svc}" ${isChecked ? 'checked' : ''}>
                        <span>${serviceLabels[svc]}</span>
                      </label>
                    `;
                  }).join('')}
                </div>
              </div>
            </td>
            <td class="admin-user-cell" style="text-align: center;">
              <div style="display: flex; gap: 6px; justify-content: center;">
                <button class="btn btn-accent" style="padding: 6px 10px; font-size: 11px;" onclick="saveUserRbac('${safeUname}')" title="Save RBAC Permissions">
                  <i data-lucide="save" style="width: 12px;"></i> Save
                </button>
                <button class="btn btn-danger" style="padding: 6px 8px; font-size: 11px;" onclick="deleteUserAccount('${safeUname}')" title="Delete User">
                  <i data-lucide="trash-2" style="width: 12px;"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
      if (window.lucide) lucide.createIcons();
    }
  } catch (e) {
    console.error('loadUsersTable error:', e);
  }
}

function handleUserDisabledToggle(username, isChecked) {
  const badge = document.getElementById(`user-disabled-badge-${username}`);
  if (badge) {
    badge.textContent = isChecked ? '⛔ Account Disabled' : '🟢 Active';
    badge.style.color = isChecked ? 'var(--danger)' : 'var(--success)';
    badge.style.background = isChecked ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)';
    badge.style.borderColor = isChecked ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.35)';
  }
}

async function saveUserRbac(username) {
  const roleSelect = document.getElementById(`user-role-${username}`);
  const homeInput = document.getElementById(`user-home-${username}`);
  const disabledCb = document.getElementById(`user-disabled-${username}`);
  const role = roleSelect?.value || 'user';
  const home_dir = homeInput?.value || '/';
  const is_disabled = disabledCb ? disabledCb.checked : false;

  const services = ['local', 'smb', 'nfs', 's3', 'sftp', 'webdav', 'terminal', 'syncthing', 'converters', 'upload', 'download'];
  const allowed_services = [];

  for (const svc of services) {
    const cb = document.getElementById(`svc-${username}-${svc}`);
    if (cb && cb.checked) {
      allowed_services.push(svc);
    }
  }

  try {
    const resp = await fetch(`/api/auth/users/${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({
        role: role,
        allowed_services: allowed_services,
        home_dir: home_dir,
        is_disabled: is_disabled
      })
    });

    if (resp.ok) {
      showToast(`RBAC & status for '${username}' saved!`, 'success');
      loadUsersTable();
    } else {
      showToast(`Failed to save RBAC: ${await resp.text()}`, 'error');
    }
  } catch (e) {
    showToast(`Save error: ${e}`, 'error');
  }
}

async function deleteUserAccount(username) {
  const confirmed = await showConfirmDialog({
    title: 'Delete User Account',
    subtitle: 'Admin Control Panel',
    message: `Are you sure you want to delete user account '${username}'?`,
    icon: 'user-x',
    type: 'danger',
    confirmText: 'Delete User',
    cancelText: 'Cancel',
  });
  if (!confirmed) return;

  try {
    const resp = await fetch(`/api/auth/users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      showToast(`User '${username}' deleted`, 'success');
      loadUsersTable();
    } else {
      showToast('Failed to delete user: ' + await resp.text(), 'error');
    }
  } catch (e) {
    showToast('Delete error: ' + e, 'error');
  }
}

async function loadMasterConfigEditor() {
  const textarea = document.getElementById('admin-config-editor-textarea');
  const pathBadge = document.getElementById('admin-config-path-badge');
  const statusEl = document.getElementById('admin-config-status');

  if (textarea) textarea.value = '# Loading configuration file...';
  if (statusEl) statusEl.style.display = 'none';

  try {
    const resp = await fetch('/api/system/config-file', {
      headers: { 'Authorization': `Bearer ${App.token || localStorage.getItem('cd_token') || ''}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (textarea) textarea.value = data.content;
      if (pathBadge) pathBadge.textContent = data.path;
      if (!data.is_writable && statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--accent)';
        statusEl.textContent = '⚠️ Config file directory is read-only. Changes cannot be saved directly.';
      }
    } else {
      const err = await resp.text();
      if (textarea) textarea.value = `# Error loading config: ${err}`;
    }
  } catch (e) {
    if (textarea) textarea.value = `# Network error fetching config: ${e}`;
  }
}

async function saveMasterConfigFile() {
  const textarea = document.getElementById('admin-config-editor-textarea');
  const statusEl = document.getElementById('admin-config-status');
  const saveBtn = document.getElementById('btn-save-master-config');
  if (!textarea) return;

  const content = textarea.value;
  if (saveBtn) saveBtn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = 'Validating and saving configuration...';
  }

  try {
    const resp = await fetch('/api/system/config-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token || localStorage.getItem('cd_token') || ''}`
      },
      body: JSON.stringify({ content })
    });

    if (resp.ok) {
      const data = await resp.json();
      showToast('Master config.toml saved successfully!', 'success');
      if (statusEl) {
        statusEl.style.color = 'var(--success, #10b981)';
        statusEl.textContent = `✓ ${data.message}`;
      }
    } else {
      const err = await resp.text();
      showToast('Failed to save config.toml', 'error');
      if (statusEl) {
        statusEl.style.color = 'var(--danger, #ef4444)';
        statusEl.textContent = `✗ ${err}`;
      }
    }
  } catch (e) {
    showToast(`Error saving config: ${e}`, 'error');
    if (statusEl) {
      statusEl.style.color = 'var(--danger, #ef4444)';
      statusEl.textContent = `✗ Error: ${e}`;
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function triggerServerReload() {
  showToast('Reloading configuration into memory...', 'info');
  try {
    const resp = await fetch('/api/system/reload-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token || localStorage.getItem('cd_token') || ''}`
      }
    });

    if (resp.ok) {
      await loadConfig();
      showToast('✓ Configuration successfully reloaded into running server memory!', 'success');
    } else {
      const err = await resp.text();
      showToast(`✗ Failed to reload config: ${err}`, 'error');
    }
  } catch (e) {
    showToast(`Error reloading configuration: ${e}`, 'error');
  }
}

async function triggerServerRestart() {
  const confirmed = confirm('Are you sure you want to restart the CommanderDog server process? Active connections will momentarily reconnect.');
  if (!confirmed) return;

  showToast('Restarting CommanderDog server...', 'info');
  try {
    await fetch('/api/system/restart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token || localStorage.getItem('cd_token') || ''}`
      }
    });
  } catch (e) {}

  setTimeout(() => {
    location.reload();
  }, 1500);
}

function showAddUserPrompt() {
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-password').value = '';
  document.getElementById('new-user-password').type = 'password';
  document.getElementById('new-user-role').value = 'user';
  document.getElementById('new-user-home').value = '/';
  const err = document.getElementById('add-user-error');
  if (err) {
    err.style.display = 'none';
    err.textContent = '';
  }
  showModal('add-user-modal');
  document.getElementById('new-user-username')?.focus();
}

async function submitAddUser() {
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;
  const home_dir = document.getElementById('new-user-home').value.trim() || '/';
  const err = document.getElementById('add-user-error');

  if (!username || !password) {
    if (err) {
      err.style.display = 'block';
      err.textContent = 'Username and password are required.';
    }
    return;
  }

  try {
    const resp = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ username, password, role, home_dir })
    });

    if (resp.ok) {
      closeModal('add-user-modal');
      loadUsersTable();
    } else {
      const msg = await resp.text();
      if (err) {
        err.style.display = 'block';
        err.textContent = `Failed to create user: ${msg}`;
      }
    }
  } catch (e) {
    if (err) {
      err.style.display = 'block';
      err.textContent = `Error: ${e}`;
    }
  }
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

// ---------------- TRANSFERS & DRAG-AND-DROP ----------------
let pendingInterpaneTransfer = null;

async function handlePaneDrop(e, targetPaneIndex, subfolderPath) {
  e.preventDefault();
  const targetPane = App.panes[targetPaneIndex];
  const paneEl = document.getElementById(`pane-${targetPaneIndex}`);
  if (paneEl) paneEl.classList.remove('drag-over');

  const destPath = subfolderPath || targetPane.path;

  // OS Desktop Drag & Drop Upload
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const fileCount = e.dataTransfer.files.length;
    const formData = new FormData();
    for (let f of e.dataTransfer.files) {
      formData.append('files', f);
    }

    const pill = document.getElementById('tasks-pill');
    const pillText = document.getElementById('tasks-pill-text');
    if (pill && pillText) {
      pill.style.display = 'flex';
      pillText.textContent = `Uploading ${fileCount} file(s)...`;
    }

    try {
      const resp = await fetch(`/api/fs/upload?destination=${encodeURIComponent(destPath)}`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        showToast('Upload completed successfully!', 'success');
        refreshPane(targetPaneIndex);
      } else {
        showToast(`Upload failed: ${await resp.text()}`, 'error');
      }
    } catch (err) {
      showToast(`Upload error: ${err}`, 'error');
    }
    return;
  }

  // Inter-Pane Transfer
  const rawData = e.dataTransfer.getData('text/plain');
  if (rawData) {
    try {
      const { sourcePane, paths } = JSON.parse(rawData);
      if (sourcePane === targetPaneIndex && !subfolderPath) return;

      pendingInterpaneTransfer = {
        sourcePane,
        paths,
        destination: destPath,
        targetPaneIndex
      };

      if (e.shiftKey) {
        executeInterpaneDrop('move');
      } else if (e.altKey) {
        executeInterpaneDrop('copy');
      } else {
        const msgEl = document.getElementById('interpane-drop-msg');
        if (msgEl) {
          msgEl.innerHTML = `Transfer <strong>${paths.length} item(s)</strong> to: <br><code style="background:var(--bg-dark); padding:3px 6px; border-radius:4px; display:inline-block; margin-top:6px; word-break:break-all;">${escapeHtml(destPath)}</code>`;
        }
        showModal('interpane-drop-modal');
      }
    } catch (err) {
      console.error('Inter-pane transfer error:', err);
    }
  }
}

function executeInterpaneDrop(action) {
  closeModal('interpane-drop-modal');
  if (!pendingInterpaneTransfer) return;
  const { paths, destination, targetPaneIndex } = pendingInterpaneTransfer;
  pendingInterpaneTransfer = null;

  if (App.paranoidMode) {
    showParanoidConfirm(action, paths, destination, () => {
      executeTransfer(action, paths, destination, targetPaneIndex);
    });
  } else {
    executeTransfer(action, paths, destination, targetPaneIndex);
  }
}

async function executeTransfer(action, sources, destination, refreshTargetPaneIdx) {
  const endpoint = action === 'move' ? '/api/fs/move' : '/api/fs/copy';
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ sources, destination, paranoid: App.paranoidMode })
  });

  if (resp.ok) {
    showToast(`${action === 'move' ? 'Moved' : 'Copied'} ${sources.length} item(s)`, 'success');
    refreshPane(refreshTargetPaneIdx);
    refreshPane(App.activePaneIndex);
  } else {
    showToast(`Transfer failed: ${await resp.text()}`, 'error');
  }
}

// ---------------- KEYBOARD NAVIGATION & SHORTCUTS ----------------

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Global Spotlight Trigger (Ctrl+K, Cmd+K, Ctrl+P)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      toggleSpotlightModal();
      return;
    }

    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (e.key === 'Escape') {
        hideContextMenu();
        closeModal();
      }
      return;
    }

    if (e.key === 'Escape') {
      hideContextMenu();
      closeModal();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        lockSession();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        triggerCopyClipboard();
        return;
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        triggerCutClipboard();
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        triggerPaste(App.activePaneIndex);
        return;
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        toggleBranchView(App.activePaneIndex);
        return;
      }
    }

    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        const count = getVisiblePaneCount();
        setActivePane((App.activePaneIndex + (e.shiftKey ? -1 : 1) + count) % count);
        break;
      case 'F1': e.preventDefault(); openHelpModal(); break;
      case 'F2': e.preventDefault(); triggerRename(); break;
      case 'F3': e.preventDefault(); triggerView(); break;
      case 'F4': e.preventDefault(); triggerEditor(); break;
      case 'F5': e.preventDefault(); triggerCopy(); break;
      case 'F6': e.preventDefault(); triggerMove(); break;
      case 'F7': e.preventDefault(); triggerMkdir(); break;
      case 'F8':
      case 'Delete': e.preventDefault(); triggerDelete(); break;
      case 'F9': e.preventDefault(); triggerDiff(); break;
      case 'F10': e.preventDefault(); openSettingsModal(); break;
      case 'F12': e.preventDefault(); lockSession(); break;
      case 'ArrowDown':
        e.preventDefault();
        if (pane.cursorIndex < pane.entries.length - 1) {
          pane.cursorIndex++;
          renderPaneTable(App.activePaneIndex);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (pane.cursorIndex > 0) {
          pane.cursorIndex--;
          renderPaneTable(App.activePaneIndex);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (pane.entries[pane.cursorIndex]) {
          const entry = pane.entries[pane.cursorIndex];
          if (entry.is_dir || entry.is_archive) loadPaneDirectory(App.activePaneIndex, entry.path);
          else openEditorWithFile(entry.path);
        }
        break;
      case 'Backspace':
        e.preventDefault();
        navPaneUp(App.activePaneIndex);
        break;
      case ' ':
      case 'Insert':
        e.preventDefault();
        if (pane.entries[pane.cursorIndex]) {
          const item = pane.entries[pane.cursorIndex];
          if (pane.selected.has(item.path)) pane.selected.delete(item.path);
          else pane.selected.add(item.path);
          if (pane.cursorIndex < pane.entries.length - 1) pane.cursorIndex++;
          renderPaneTable(App.activePaneIndex);
        }
        break;
    }

    if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      const targetIdx = parseInt(e.key) - 1;
      if (targetIdx < getVisiblePaneCount()) setActivePane(targetIdx);
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      triggerDiff();
    }

    if (e.ctrlKey && (e.key === '`' || e.key === '~' || e.key === '\\')) {
      e.preventDefault();
      toggleTerminal();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearchModal();
    }

    if ((e.shiftKey && e.key === 'F6') || (e.ctrlKey && e.key.toLowerCase() === 'm')) {
      e.preventDefault();
      triggerBulkRename();
    }

    const imgModal = document.getElementById('image-viewer-modal');
    if (imgModal && imgModal.classList.contains('active')) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); navImageViewer(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navImageViewer(1); }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomImage(0.2); }
      if (e.key === '-') { e.preventDefault(); zoomImage(-0.2); }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); rotateImage(90); }
    }
  });
}

function getVisiblePaneCount() {
  if (App.layout === 'layout-single') return 1;
  if (App.layout === 'layout-dual-vertical' || App.layout === 'layout-dual-horizontal') return 2;
  if (App.layout === 'layout-triple') return 3;
  return 4;
}

// ---------------- DUAL-PANE EDITOR & CODE VIEWER (SYNTAX HIGHLIGHTING & FIND/REPLACE) ----------------
function detectLanguageFromPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    'rs': 'rust',
    'py': 'python',
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'typescript',
    'html': 'html',
    'htm': 'html',
    'xml': 'xml',
    'css': 'css',
    'scss': 'css',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'sql': 'sql',
    'md': 'markdown',
    'markdown': 'markdown',
    'c': 'clike',
    'cpp': 'clike',
    'h': 'clike',
    'hpp': 'clike',
    'dockerfile': 'docker',
  };
  return map[ext] || 'markup';
}

// ========================================================
// 📝 REVISED MULTI-TAB DEVELOPER POWER EDITOR & CONF.D ASSEMBLER
// ========================================================

// ========================================================
// 📝 FLOATING MULTI-TAB POWER DEVELOPER EDITOR & CONF.D ASSEMBLER
// ========================================================

let editorTabs = [];
let activeTabIdLeft = null;
let activeTabIdRight = null;
let editorActivePane = 'left';
let editorViewMode = 'single-editor'; // 'single-editor', 'dual-vertical', 'dual-horizontal', 'split-markdown'
let editorTabCounter = 1;
let editorTabSize = 2;
let editorFindMatches = [];
let currentMatchIndex = -1;
let findOptions = { matchCase: false, matchWord: false, useRegex: false };
let pendingConfdDirPath = null;
let pendingConfdFiles = [];
let topFloatingZIndex = 1600;

function bringFloatingWindowToFront(el) {
  if (!el) return;
  topFloatingZIndex++;
  el.style.zIndex = topFloatingZIndex;
}

function getActiveEditorTab(pane = 'left') {
  const tabId = pane === 'left' ? activeTabIdLeft : activeTabIdRight;
  return editorTabs.find(t => t.id === tabId) || editorTabs[0] || null;
}

function getEditorTabById(id) {
  return editorTabs.find(t => t.id === id) || null;
}

function createNewEditorTab(initialContent = '', defaultName = null, filePath = null, isConfd = false, confdFiles = []) {
  const tabId = 'tab_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const name = defaultName || (filePath ? getBasename(filePath) : `Untitled-${editorTabCounter++}`);
  const detectedLang = filePath ? detectLanguageFromPath(filePath) : 'markup';

  const newTab = {
    id: tabId,
    path: filePath,
    filename: name,
    content: initialContent,
    origContent: initialContent,
    isDirty: false,
    lang: detectedLang,
    isConfdAssembled: isConfd,
    confdFiles: confdFiles,
    cursor: { line: 1, col: 1 },
    scrollTop: 0
  };

  editorTabs.push(newTab);
  switchActiveEditorTab(tabId, 'left');
  renderEditorTabs();
  return newTab;
}

function openFloatingEditor() {
  const win = document.getElementById('floating-editor-window');
  const pill = document.getElementById('editor-pill');
  if (pill) pill.style.display = 'none';
  if (win) {
    win.style.display = 'flex';
    bringFloatingWindowToFront(win);
  }
  initEditorDragResize();
}

function restoreFloatingEditor() {
  openFloatingEditor();
}

function minimizeFloatingEditor() {
  const win = document.getElementById('floating-editor-window');
  const pill = document.getElementById('editor-pill');
  const pillText = document.getElementById('editor-pill-text');
  const pillDirty = document.getElementById('editor-pill-dirty');

  if (win) win.style.display = 'none';
  if (pill) {
    pill.style.display = 'flex';
    const dirtyCount = editorTabs.filter(t => t.isDirty).length;
    const tabCount = editorTabs.length;
    if (pillText) pillText.textContent = `📝 EditorDog (${tabCount} file${tabCount === 1 ? '' : 's'})`;
    if (pillDirty) pillDirty.style.display = dirtyCount > 0 ? 'inline-block' : 'none';
    if (window.lucide) lucide.createIcons();
  }
}

function maximizeFloatingEditor() {
  const win = document.getElementById('floating-editor-window');
  if (!win) return;
  win.classList.toggle('maximized');
}

async function openEditorWithFile(filePath) {
  const existingTab = editorTabs.find(t => t.path === filePath);
  if (existingTab) {
    switchActiveEditorTab(existingTab.id, 'left');
    const dockedIdx = App.panes.findIndex(p => p.dockedTool === 'editor');
    if (dockedIdx !== -1) {
      renderDockedPaneTool(dockedIdx);
    } else {
      openFloatingEditor();
    }
    return;
  }

  try {
    const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      const data = await resp.json();
      createNewEditorTab(data.content, null, filePath, false, []);
      
      const isMd = filePath.endsWith('.md') || filePath.endsWith('.markdown');
      const viewModeSelect = document.getElementById('editor-view-mode');
      if (viewModeSelect) {
        viewModeSelect.value = isMd ? 'split-markdown' : 'single-editor';
        handleEditorViewModeChange(viewModeSelect.value);
      }

      const dockedIdx = App.panes.findIndex(p => p.dockedTool === 'editor');
      if (dockedIdx !== -1) {
        renderDockedPaneTool(dockedIdx);
      } else {
        openFloatingEditor();
      }
    } else {
      showToast('Failed to read file: ' + await resp.text(), 'error');
    }
  } catch (e) {
    showToast('Read error: ' + e, 'error');
  }
}

// ---------------- CONF.D MODULAR CONFIG ASSEMBLER ----------------

async function checkAndPromptConfdDirectory(dirPath) {
  try {
    const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const files = data.entries.filter(e => !e.is_dir);
      if (files.length > 0) {
        pendingConfdDirPath = dirPath;
        pendingConfdFiles = files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        
        const dirNameEl = document.getElementById('confd-modal-dirname');
        if (dirNameEl) dirNameEl.textContent = getBasename(dirPath);
        const listEl = document.getElementById('confd-modal-filelist');
        if (listEl) {
          listEl.innerHTML = pendingConfdFiles.map(f => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 0;">
              <span>📄 <b>${escapeHtml(f.name)}</b></span>
              <span style="color: var(--text-dim); font-size: 10px;">${formatBytes(f.size)}</span>
            </div>
          `).join('');
        }
        showModal('confd-assembler-modal');
        return;
      }
    }
  } catch (e) {
    console.error('conf.d check error:', e);
  }
  openFloatingEditor();
}

async function executeOpenConfdAssembled() {
  closeModal('confd-assembler-modal');
  if (!pendingConfdFiles || pendingConfdFiles.length === 0) return;

  const confdFolderName = getBasename(pendingConfdDirPath) || 'conf.d';
  showToast(`Assembling ${pendingConfdFiles.length} config files...`, 'info');

  const assembledParts = [];

  for (const f of pendingConfdFiles) {
    try {
      const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(f.path)}`, {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      let content = '';
      if (resp.ok) {
        const data = await resp.json();
        content = data.content;
      }
      assembledParts.push({
        path: f.path,
        filename: f.name,
        content: content
      });
    } catch (err) {
      console.warn('Failed reading conf.d part:', f.path, err);
    }
  }

  let fullBuffer = `# =========================================================================\n# 🧩 COMMANDERDOG MODULAR CONFIG COMPILATION: ${confdFolderName}\n# Directory: ${pendingConfdDirPath}\n# Assembled: ${assembledParts.length} files in execution order\n# Edits are saved individually to each respective file on Ctrl+S.\n# =========================================================================\n\n`;

  for (const part of assembledParts) {
    fullBuffer += `# =========================================================================\n`;
    fullBuffer += `# 📁 [FILE START: ${part.filename}] (${part.path})\n`;
    fullBuffer += `# =========================================================================\n`;
    fullBuffer += part.content.endsWith('\n') ? part.content : part.content + '\n';
    fullBuffer += `# =========================================================================\n`;
    fullBuffer += `# 🏁 [FILE END: ${part.filename}]\n`;
    fullBuffer += `# =========================================================================\n\n`;
  }

  const tab = createNewEditorTab(fullBuffer, `${confdFolderName} [Assembled]`, pendingConfdDirPath, true, assembledParts);
  populateConfdJumpDropdown(tab);

  const viewModeSelect = document.getElementById('editor-view-mode');
  if (viewModeSelect) {
    viewModeSelect.value = 'single-editor';
    handleEditorViewModeChange('single-editor');
  }

  openFloatingEditor();
  showToast(`Assembled ${assembledParts.length} files into unified config view!`, 'success');
}

async function executeOpenConfdSeparateTabs() {
  closeModal('confd-assembler-modal');
  if (!pendingConfdFiles || pendingConfdFiles.length === 0) return;

  for (const f of pendingConfdFiles) {
    await openEditorWithFile(f.path);
  }
  openFloatingEditor();
}

function populateConfdJumpDropdown(tab) {
  const jumpSel = document.getElementById('editor-confd-jump');
  const statusConfd = document.getElementById('editor-confd-status');
  const sepConfd = document.getElementById('editor-confd-sep');

  if (!jumpSel) return;

  if (tab && tab.isConfdAssembled && tab.confdFiles && tab.confdFiles.length > 0) {
    jumpSel.style.display = 'inline-block';
    if (statusConfd) statusConfd.style.display = 'inline-block';
    if (sepConfd) sepConfd.style.display = 'inline-block';

    jumpSel.innerHTML = `<option value="">Jump to Section (${tab.confdFiles.length})...</option>` +
      tab.confdFiles.map(f => `<option value="${escapeHtml(f.filename)}">📁 ${escapeHtml(f.filename)}</option>`).join('');
  } else {
    jumpSel.style.display = 'none';
    if (statusConfd) statusConfd.style.display = 'none';
    if (sepConfd) sepConfd.style.display = 'none';
  }
}

function jumpToConfdSection(filename) {
  if (!filename) return;
  const textarea = document.getElementById('editor-text-left');
  if (!textarea) return;

  const targetHeader = `[FILE START: ${filename}]`;
  const text = textarea.value;
  const index = text.indexOf(targetHeader);

  if (index !== -1) {
    textarea.focus();
    textarea.setSelectionRange(index, index + targetHeader.length);

    const linesBefore = text.substring(0, index).split('\n').length;
    const lineHeight = 19;
    textarea.scrollTop = Math.max(0, (linesBefore - 4) * lineHeight);
    syncGutterScroll('left');
    handleEditorInput('left');
  }
}

// ---------------- TAB SWITCHING & RENDERING ----------------

function switchActiveEditorTab(tabId, targetPane = 'left') {
  const targetTab = getEditorTabById(tabId);
  if (!targetTab) return;

  const prevTabId = targetPane === 'left' ? activeTabIdLeft : activeTabIdRight;
  if (prevTabId) {
    const prevTab = getEditorTabById(prevTabId);
    const textarea = document.getElementById(`editor-text-${targetPane}`);
    if (prevTab && textarea) {
      prevTab.content = textarea.value;
      prevTab.scrollTop = textarea.scrollTop;
      prevTab.selectionStart = textarea.selectionStart;
      prevTab.selectionEnd = textarea.selectionEnd;
    }
  }

  if (targetPane === 'left') activeTabIdLeft = tabId;
  else activeTabIdRight = tabId;

  const textarea = document.getElementById(`editor-text-${targetPane}`);
  const titleEl = document.getElementById(`editor-file-title-${targetPane}`);
  const tagEl = document.getElementById(`editor-file-tag-${targetPane}`);

  if (textarea) {
    textarea.value = targetTab.content;
    textarea.scrollTop = targetTab.scrollTop || 0;
    if (targetTab.selectionStart !== undefined) {
      textarea.selectionStart = targetTab.selectionStart;
      textarea.selectionEnd = targetTab.selectionEnd;
    }
  }

  if (titleEl) {
    titleEl.textContent = targetTab.path ? sanitizeCredentials(targetTab.path) : targetTab.filename;
    titleEl.title = targetTab.path || targetTab.filename;
  }

  if (tagEl) {
    tagEl.textContent = targetTab.isConfdAssembled ? 'CONFD' : targetTab.lang.toUpperCase();
  }

  const langSelect = document.getElementById('editor-language-select');
  if (langSelect) langSelect.value = targetTab.lang || 'auto';

  populateConfdJumpDropdown(targetTab);
  updateEditorGutter(targetPane);
  handleEditorInput(targetPane);
  renderEditorTabs();
}

function closeEditorTab(tabId, force = false) {
  const tabIndex = editorTabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  const tab = editorTabs[tabIndex];

  if (tab.isDirty && !force) {
    if (!confirm(`"${tab.filename}" has unsaved changes. Close without saving?`)) {
      return;
    }
  }

  editorTabs.splice(tabIndex, 1);

  if (editorTabs.length === 0) {
    createNewEditorTab();
  } else {
    if (activeTabIdLeft === tabId) {
      const nextIndex = Math.min(tabIndex, editorTabs.length - 1);
      switchActiveEditorTab(editorTabs[nextIndex].id, 'left');
    }
    if (activeTabIdRight === tabId) {
      activeTabIdRight = editorTabs[0]?.id || null;
    }
  }

  renderEditorTabs();
}

function closeEditorModal() {
  const dirtyCount = editorTabs.filter(t => t.isDirty).length;
  if (dirtyCount > 0) {
    if (!confirm(`You have ${dirtyCount} file(s) with unsaved changes. Close editor?`)) {
      return;
    }
  }
  const win = document.getElementById('floating-editor-window');
  const pill = document.getElementById('editor-pill');
  if (win) win.style.display = 'none';
  if (pill) pill.style.display = 'none';
}

let editorDragInitialized = false;

function initEditorDragResize() {
  if (editorDragInitialized) return;
  editorDragInitialized = true;

  const win = document.getElementById('floating-editor-window');
  const header = document.getElementById('editor-header');
  if (!win || !header) return;

  const savedLeft = localStorage.getItem('cd_editor_x');
  const savedTop = localStorage.getItem('cd_editor_y');
  const savedWidth = localStorage.getItem('cd_editor_w');
  const savedHeight = localStorage.getItem('cd_editor_h');

  if (savedLeft && savedTop) {
    win.style.left = `${Math.min(window.innerWidth - 100, Math.max(0, parseInt(savedLeft, 10)))}px`;
    win.style.top = `${Math.min(window.innerHeight - 60, Math.max(35, parseInt(savedTop, 10)))}px`;
  }
  if (savedWidth) win.style.width = `${Math.min(window.innerWidth - 20, Math.max(360, parseInt(savedWidth, 10)))}px`;
  if (savedHeight) win.style.height = `${Math.min(window.innerHeight - 40, Math.max(240, parseInt(savedHeight, 10)))}px`;

  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let winStartX = 0, winStartY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
    if (win.classList.contains('maximized')) return;
    isDragging = true;
    bringFloatingWindowToFront(win);
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = win.getBoundingClientRect();
    winStartX = rect.left;
    winStartY = rect.top;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'move';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const newX = Math.max(0, Math.min(window.innerWidth - 100, winStartX + dx));
    const newY = Math.max(35, Math.min(window.innerHeight - 60, winStartY + dy));
    win.style.left = `${newX}px`;
    win.style.top = `${newY}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (win.style.left) localStorage.setItem('cd_editor_x', parseInt(win.style.left, 10));
      if (win.style.top) localStorage.setItem('cd_editor_y', parseInt(win.style.top, 10));
    }
  });

  setupFloatingWindowResizers(win);
}

function setupFloatingWindowResizers(win) {
  const handles = {
    top: document.getElementById('editor-resize-top'),
    bottom: document.getElementById('editor-resize-bottom'),
    left: document.getElementById('editor-resize-left'),
    right: document.getElementById('editor-resize-right'),
    corner: document.getElementById('editor-resize-corner')
  };

  let resizeMode = null;
  let startX = 0, startY = 0;
  let startW = 0, startH = 0;
  let startLeft = 0, startTop = 0;

  Object.entries(handles).forEach(([mode, handle]) => {
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (win.classList.contains('maximized')) return;
      resizeMode = mode;
      bringFloatingWindowToFront(win);
      startX = e.clientX;
      startY = e.clientY;
      const rect = win.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      document.body.style.userSelect = 'none';
      if (mode === 'top' || mode === 'bottom') document.body.style.cursor = 'ns-resize';
      else if (mode === 'left' || mode === 'right') document.body.style.cursor = 'ew-resize';
      else document.body.style.cursor = 'nwse-resize';
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizeMode) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (resizeMode === 'bottom' || resizeMode === 'corner') {
      const newH = Math.max(240, Math.min(window.innerHeight - startTop - 20, startH + dy));
      win.style.height = `${newH}px`;
    }
    if (resizeMode === 'right' || resizeMode === 'corner') {
      const newW = Math.max(360, Math.min(window.innerWidth - startLeft - 20, startW + dx));
      win.style.width = `${newW}px`;
    }
    if (resizeMode === 'left') {
      const newW = Math.max(360, startW - dx);
      const newLeft = startLeft + (startW - newW);
      if (newLeft >= 0) {
        win.style.width = `${newW}px`;
        win.style.left = `${newLeft}px`;
      }
    }
    if (resizeMode === 'top') {
      const newH = Math.max(240, startH - dy);
      const newTop = startTop + (startH - newH);
      if (newTop >= 35) {
        win.style.height = `${newH}px`;
        win.style.top = `${newTop}px`;
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (resizeMode) {
      resizeMode = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      localStorage.setItem('cd_editor_w', win.offsetWidth);
      localStorage.setItem('cd_editor_h', win.offsetHeight);
      if (win.style.left) localStorage.setItem('cd_editor_x', parseInt(win.style.left, 10));
      if (win.style.top) localStorage.setItem('cd_editor_y', parseInt(win.style.top, 10));
    }
  });
}

// ==========================================================================
// 🧮 FLOATING CALCULATOR & BYTE MATH ENGINE
// ==========================================================================

let calcExpr = '';
let calcCurrentVal = '0';
let calcHasEvaluated = false;
let calcHistory = JSON.parse(localStorage.getItem('cd_calc_history') || '[]');
let calcDragInitialized = false;

function openFloatingCalculator() {
  const win = document.getElementById('floating-calculator-window');
  const pill = document.getElementById('calc-pill');
  if (pill) pill.style.display = 'none';
  if (win) {
    win.style.display = 'flex';
    bringFloatingWindowToFront(win);
  }
  initCalcDrag();
  calcUpdateDisplay();
  renderCalcHistory();
}

function closeFloatingCalculator() {
  const win = document.getElementById('floating-calculator-window');
  if (win) win.style.display = 'none';
  const pill = document.getElementById('calc-pill');
  if (pill) pill.style.display = 'none';
}

function minimizeFloatingCalculator() {
  const win = document.getElementById('floating-calculator-window');
  if (win) win.style.display = 'none';
  const pill = document.getElementById('calc-pill');
  if (pill) pill.style.display = 'flex';
}

function restoreFloatingCalculator() {
  openFloatingCalculator();
}

function initCalcDrag() {
  if (calcDragInitialized) return;
  calcDragInitialized = true;

  const win = document.getElementById('floating-calculator-window');
  const header = document.getElementById('calc-header');
  if (!win || !header) return;

  const savedLeft = localStorage.getItem('cd_calc_x');
  const savedTop = localStorage.getItem('cd_calc_y');

  if (savedLeft && savedTop && window.innerWidth > 768) {
    win.style.left = `${Math.min(window.innerWidth - 300, Math.max(10, parseInt(savedLeft, 10)))}px`;
    win.style.top = `${Math.min(window.innerHeight - 380, Math.max(35, parseInt(savedTop, 10)))}px`;
  } else if (window.innerWidth > 768) {
    win.style.right = '40px';
    win.style.top = '100px';
  }

  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let winStartX = 0, winStartY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    isDragging = true;
    bringFloatingWindowToFront(win);
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = win.getBoundingClientRect();
    winStartX = rect.left;
    winStartY = rect.top;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'move';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const newLeft = Math.max(0, Math.min(window.innerWidth - win.offsetWidth, winStartX + dx));
    const newTop = Math.max(35, Math.min(window.innerHeight - 60, winStartY + dy));
    win.style.left = `${newLeft}px`;
    win.style.top = `${newTop}px`;
    win.style.right = 'auto';
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (win.style.left) localStorage.setItem('cd_calc_x', parseInt(win.style.left, 10));
      if (win.style.top) localStorage.setItem('cd_calc_y', parseInt(win.style.top, 10));
    }
  });

  // Global key listener when calculator is active
  document.addEventListener('keydown', (e) => {
    if (win.style.display !== 'flex') return;
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.target.id !== 'calc-display-input') return;

    if (e.key >= '0' && e.key <= '9') {
      calcAppendNum(e.key);
    } else if (['+', '-', '*', '/'].includes(e.key)) {
      calcAppendOp(e.key);
    } else if (e.key === '.') {
      calcAppendDot();
    } else if (e.key === 'Enter' || e.key === '=') {
      e.preventDefault();
      calcEvaluate();
    } else if (e.key === 'Backspace') {
      calcBackspace();
    } else if (e.key === 'Escape') {
      if (calcExpr || calcCurrentVal !== '0') calcClearAll();
      else closeFloatingCalculator();
    } else if (e.key === '(' || e.key === ')') {
      calcAppendChar(e.key);
    } else if (e.key === '%') {
      calcAppendOp('%');
    }
  });
}

function calcUpdateDisplay() {
  document.querySelectorAll('#calc-expr-display, [id^="docked-calc-expr"]').forEach(el => {
    el.textContent = calcExpr || '\u00A0';
  });
  document.querySelectorAll('#calc-display-input, [id^="docked-calc-display"]').forEach(el => {
    el.value = calcCurrentVal;
  });

  const num = parseFloat(calcCurrentVal) || 0;

  // Format Byte Size
  const sizeStr = formatBytes(Math.abs(num));
  document.querySelectorAll('#calc-conv-size, [id^="docked-calc-conv-size"]').forEach(el => {
    el.textContent = sizeStr;
  });

  // Format Hexadecimal
  let hexStr = '-';
  if (!isNaN(num) && Math.abs(num) < 0x1000000000000) {
    const intVal = Math.floor(Math.abs(num));
    hexStr = (num < 0 ? '-' : '') + '0x' + intVal.toString(16).toUpperCase();
  }
  document.querySelectorAll('#calc-conv-hex, [id^="docked-calc-conv-hex"]').forEach(el => {
    el.textContent = hexStr;
  });

  // Format Octal (useful for chmod!)
  let octStr = '-';
  if (!isNaN(num) && Math.abs(num) < 0x1000000) {
    const intVal = Math.floor(Math.abs(num));
    octStr = (num < 0 ? '-' : '') + '0' + intVal.toString(8);
  }
  document.querySelectorAll('#calc-conv-oct, [id^="docked-calc-conv-oct"]').forEach(el => {
    el.textContent = octStr;
  });

  // Format Binary
  let binStr = '-';
  if (!isNaN(num) && Math.abs(num) <= 0xFFFF) {
    const intVal = Math.floor(Math.abs(num));
    binStr = (num < 0 ? '-' : '') + '0b' + intVal.toString(2);
  }
  document.querySelectorAll('#calc-conv-bin, [id^="docked-calc-conv-bin"]').forEach(el => {
    el.textContent = binStr;
  });
}

function calcAppendNum(digit) {
  if (calcHasEvaluated) {
    calcCurrentVal = digit;
    calcExpr = '';
    calcHasEvaluated = false;
  } else if (calcCurrentVal === '0' || calcCurrentVal === '-0') {
    calcCurrentVal = (calcCurrentVal === '-0' ? '-' : '') + digit;
  } else {
    calcCurrentVal += digit;
  }
  calcUpdateDisplay();
}

function calcAppendDot() {
  if (calcHasEvaluated) {
    calcCurrentVal = '0.';
    calcExpr = '';
    calcHasEvaluated = false;
  } else if (!calcCurrentVal.includes('.')) {
    calcCurrentVal += '.';
  }
  calcUpdateDisplay();
}

function calcAppendOp(op) {
  calcHasEvaluated = false;
  if (calcCurrentVal) {
    calcExpr = calcExpr ? `${calcExpr} ${calcCurrentVal} ${op}` : `${calcCurrentVal} ${op}`;
    calcCurrentVal = '0';
  } else if (calcExpr && /[+\-*/%^]$/.test(calcExpr.trim())) {
    calcExpr = calcExpr.trim().slice(0, -1) + op;
  }
  calcUpdateDisplay();
}

function calcAppendChar(ch) {
  if (ch === '(') {
    calcExpr = calcExpr ? `${calcExpr} (` : '(';
  } else if (ch === ')') {
    if (calcCurrentVal && calcCurrentVal !== '0') {
      calcExpr = `${calcExpr} ${calcCurrentVal} )`;
      calcCurrentVal = '0';
    } else {
      calcExpr = `${calcExpr} )`;
    }
  }
  calcUpdateDisplay();
}

function calcAppendUnit(unit) {
  const multipliers = {
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
  };
  const mult = multipliers[unit] || 1;
  const currentNum = parseFloat(calcCurrentVal) || 1;
  calcCurrentVal = String(currentNum * mult);
  calcUpdateDisplay();
}

function calcAppendFunc(fnStr) {
  calcExpr = calcExpr ? `${calcExpr} ${fnStr}` : fnStr;
  calcUpdateDisplay();
}

function calcAppendPi() {
  calcCurrentVal = String(Math.PI);
  calcUpdateDisplay();
}

function calcToggleSign() {
  if (calcCurrentVal.startsWith('-')) {
    calcCurrentVal = calcCurrentVal.substring(1);
  } else if (calcCurrentVal !== '0') {
    calcCurrentVal = '-' + calcCurrentVal;
  }
  calcUpdateDisplay();
}

function calcBackspace() {
  if (calcCurrentVal.length > 1) {
    calcCurrentVal = calcCurrentVal.slice(0, -1);
  } else {
    calcCurrentVal = '0';
  }
  calcUpdateDisplay();
}

function calcClearEntry() {
  calcCurrentVal = '0';
  calcUpdateDisplay();
}

function calcClearAll() {
  calcExpr = '';
  calcCurrentVal = '0';
  calcHasEvaluated = false;
  calcUpdateDisplay();
}

function calcEvaluate() {
  let fullExpr = (calcExpr ? `${calcExpr} ${calcCurrentVal}` : calcCurrentVal).trim();
  if (!fullExpr) return;

  try {
    let sanitized = fullExpr
      .replace(/÷/g, '/')
      .replace(/×/g, '*')
      .replace(/−/g, '-')
      .replace(/\^/g, '**')
      .replace(/sqrt\(/g, 'Math.sqrt(')
      .replace(/sin\(/g, 'Math.sin(')
      .replace(/cos\(/g, 'Math.cos(')
      .replace(/tan\(/g, 'Math.tan(')
      .replace(/abs\(/g, 'Math.abs(')
      .replace(/π/g, 'Math.PI')
      .replace(/e/g, 'Math.E');

    // Only allow safe math tokens
    if (!/^[0-9+\-*/%().,\sMath.sqrtincoabPIE*]+$/.test(sanitized)) {
      throw new Error('Invalid expression');
    }

    const result = Function(`"use strict"; return (${sanitized});`)();
    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
      throw new Error('Math error');
    }

    const formattedResult = Number.isInteger(result) ? String(result) : parseFloat(result.toFixed(8)).toString();

    // Save to calculation history
    calcHistory.unshift({
      expr: fullExpr,
      result: formattedResult,
      time: Date.now()
    });
    if (calcHistory.length > 30) calcHistory.pop();
    localStorage.setItem('cd_calc_history', JSON.stringify(calcHistory));

    calcExpr = fullExpr + ' =';
    calcCurrentVal = formattedResult;
    calcHasEvaluated = true;
    calcUpdateDisplay();
    renderCalcHistory();
  } catch (err) {
    calcCurrentVal = 'Error';
    calcHasEvaluated = true;
    calcUpdateDisplay();
  }
}

function copyCalcResult() {
  const val = calcCurrentVal;
  if (val && val !== 'Error') {
    navigator.clipboard.writeText(val).then(() => {
      showToast(`📋 Copied "${val}" to clipboard`, 'success');
    }).catch(() => {
      showToast(`Value: ${val}`, 'info');
    });
  }
}

function toggleCalcHistory() {
  const panel = document.getElementById('calc-history-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function calcClearHistory() {
  calcHistory = [];
  localStorage.removeItem('cd_calc_history');
  renderCalcHistory();
}

function renderCalcHistory() {
  const listEl = document.getElementById('calc-history-list');
  if (!listEl) return;

  if (calcHistory.length === 0) {
    listEl.innerHTML = '<div class="calc-history-empty" style="font-size: 10px; color: var(--text-dim); text-align: center; padding: 6px;">No calculations yet</div>';
    return;
  }

  listEl.innerHTML = calcHistory.map(item => `
    <div class="calc-history-item" onclick="calcLoadHistoryItem('${escapeHtml(item.result)}')">
      <span style="color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;">${escapeHtml(item.expr)}</span>
      <span style="font-weight: 700; color: var(--accent);">= ${escapeHtml(item.result)}</span>
    </div>
  `).join('');
}

function calcLoadHistoryItem(resVal) {
  calcCurrentVal = resVal;
  calcExpr = '';
  calcHasEvaluated = false;
  calcUpdateDisplay();
}

function renderEditorTabs() {
  const container = document.getElementById('editor-tabs-container');
  if (!container) return;

  container.innerHTML = editorTabs.map(tab => {
    const isActive = tab.id === activeTabIdLeft;
    const isDirty = tab.isDirty;
    const icon = getFileIconForExtension(tab.path || tab.filename);

    return `
      <div class="editor-tab ${isActive ? 'active' : ''}" onclick="switchActiveEditorTab('${tab.id}', 'left')" onauxclick="if (event.button === 1) closeEditorTab('${tab.id}')" title="${escapeHtml(tab.path || tab.filename)}">
        <i data-lucide="${icon}" style="width: 13px; height: 13px;"></i>
        <span>${escapeHtml(tab.filename)}</span>
        ${isDirty ? '<span class="editor-tab-dirty" title="Unsaved changes"></span>' : ''}
        <span class="editor-tab-close" onclick="event.stopPropagation(); closeEditorTab('${tab.id}')" title="Close Tab (Ctrl+W)"><i data-lucide="x" style="width: 11px; height: 11px;"></i></span>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function getFileIconForExtension(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  if (['rs', 'js', 'ts', 'py', 'c', 'cpp', 'h', 'java', 'go', 'sh', 'sql', 'html', 'css'].includes(ext)) return 'file-code';
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'conf'].includes(ext)) return 'file-json';
  if (['md', 'markdown', 'txt'].includes(ext)) return 'file-text';
  return 'file';
}

// ---------------- SAVE OPERATIONS ----------------

async function saveActiveEditorTab() {
  const tab = getActiveEditorTab('left');
  if (!tab) return;

  const textarea = document.getElementById('editor-text-left');
  if (textarea) tab.content = textarea.value;

  if (tab.isConfdAssembled && tab.confdFiles && tab.confdFiles.length > 0) {
    await saveConfdAssembledTab(tab);
    return;
  }

  if (!tab.path) {
    const defaultName = tab.filename.startsWith('Untitled') ? 'newfile.txt' : tab.filename;
    const userPath = prompt('Enter full file path to save:', `/home/bolt/${defaultName}`);
    if (!userPath) return;
    tab.path = userPath;
    tab.filename = getBasename(userPath);
  }

  try {
    const resp = await fetch('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ path: tab.path, content: tab.content, atomic: true })
    });

    if (resp.ok) {
      tab.origContent = tab.content;
      tab.isDirty = false;
      flashSaveButton();
      showToast(`Saved "${tab.filename}"!`, 'success');
      renderEditorTabs();
      refreshPane(App.activePaneIndex);
    } else {
      showToast('Save failed: ' + await resp.text(), 'error');
    }
  } catch (e) {
    showToast('Save error: ' + e, 'error');
  }
}

async function saveConfdAssembledTab(tab) {
  const text = tab.content;
  let savedCount = 0;
  let errorCount = 0;

  for (const part of tab.confdFiles) {
    const startTag = `[FILE START: ${part.filename}]`;
    const endTag = `[FILE END: ${part.filename}]`;

    const startIdx = text.indexOf(startTag);
    const endIdx = text.indexOf(endTag);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const afterHeader = text.indexOf('\n', startIdx);
      const beforeFooter = text.lastIndexOf('\n', endIdx);

      const segment = text.substring(afterHeader + 1, beforeFooter);
      const cleanContent = segment.replace(/^# =+\n?/, '').replace(/# =+\n?$/, '');

      try {
        const resp = await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
          body: JSON.stringify({ path: part.path, content: cleanContent, atomic: true })
        });
        if (resp.ok) {
          savedCount++;
          part.content = cleanContent;
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
      }
    }
  }

  tab.origContent = tab.content;
  tab.isDirty = false;
  flashSaveButton();
  renderEditorTabs();
  refreshPane(App.activePaneIndex);

  if (errorCount === 0) {
    showToast(`Saved all ${savedCount} modular config files!`, 'success');
  } else {
    showToast(`Saved ${savedCount} files (${errorCount} failed)`, 'error');
  }
}

async function saveAllEditorTabs() {
  let count = 0;
  for (const tab of editorTabs) {
    if (tab.isDirty) {
      if (tab.isConfdAssembled) {
        await saveConfdAssembledTab(tab);
      } else if (tab.path) {
        try {
          const resp = await fetch('/api/fs/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
            body: JSON.stringify({ path: tab.path, content: tab.content, atomic: true })
          });
          if (resp.ok) {
            tab.origContent = tab.content;
            tab.isDirty = false;
            count++;
          }
        } catch (e) {
          console.warn('Save all error:', e);
        }
      }
    }
  }
  renderEditorTabs();
  refreshPane(App.activePaneIndex);
  showToast(`Saved ${count} open file(s)!`, 'success');
}

function flashSaveButton() {
  const btn = document.getElementById('btn-save-editor');
  if (btn) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="check"></i> Saved!';
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
      btn.innerHTML = origHtml;
      if (window.lucide) lucide.createIcons();
    }, 1400);
  }
}

// ---------------- VIEW MODES & LANGUAGE ----------------

function handleEditorViewModeChange(mode) {
  editorViewMode = mode;
  const grid = document.getElementById('editor-grid-container');
  const rightPane = document.getElementById('editor-right-pane');
  const preview = document.getElementById('editor-preview-container');
  const bodyWrapperRight = document.getElementById('editor-body-wrapper-right');
  const rightTitle = document.getElementById('editor-file-title-right');
  const rightTag = document.getElementById('editor-file-tag-right');

  if (!grid || !rightPane) return;

  grid.className = `editor-grid ${mode}`;

  if (mode === 'single-editor') {
    rightPane.style.display = 'none';
  } else if (mode === 'split-markdown') {
    rightPane.style.display = 'flex';
    if (preview) preview.style.display = 'block';
    if (bodyWrapperRight) bodyWrapperRight.style.display = 'none';
    if (rightTitle) rightTitle.textContent = 'Live Markdown & Mermaid Preview';
    if (rightTag) rightTag.textContent = 'PREVIEW';
    updateMarkdownPreview();
  } else if (mode === 'dual-vertical' || mode === 'dual-horizontal') {
    rightPane.style.display = 'flex';
    if (preview) preview.style.display = 'none';
    if (bodyWrapperRight) bodyWrapperRight.style.display = 'flex';
    
    if (!activeTabIdRight || activeTabIdRight === activeTabIdLeft) {
      const otherTab = editorTabs.find(t => t.id !== activeTabIdLeft) || editorTabs[0];
      if (otherTab) activeTabIdRight = otherTab.id;
    }
    const rightTab = getActiveEditorTab('right');
    if (rightTab) {
      if (rightTitle) rightTitle.textContent = rightTab.path ? sanitizeCredentials(rightTab.path) : rightTab.filename;
      if (rightTag) rightTag.textContent = rightTab.lang.toUpperCase();
      const textareaRight = document.getElementById('editor-text-right');
      if (textareaRight) textareaRight.value = rightTab.content;
      updateEditorGutter('right');
    }
  }
}

function handleEditorLanguageChange(lang) {
  const tab = getActiveEditorTab('left');
  if (tab) {
    tab.lang = lang === 'auto' ? (tab.path ? detectLanguageFromPath(tab.path) : 'markup') : lang;
    const tagEl = document.getElementById('editor-file-tag-left');
    if (tagEl) tagEl.textContent = tab.lang.toUpperCase();
    if (editorViewMode === 'split-markdown') updateMarkdownPreview();
  }
}

// ---------------- GUTTER & INPUT HANDLERS ----------------

function handleEditorInput(pane = 'left') {
  const textarea = document.getElementById(`editor-text-${pane}`);
  if (!textarea) return;

  const content = textarea.value;
  const tab = getActiveEditorTab(pane);
  if (tab) {
    tab.content = content;
    tab.isDirty = (tab.content !== tab.origContent);
  }

  updateEditorGutter(pane);
  updateEditorStatusBar(pane);
  renderEditorTabs();

  if (editorViewMode === 'split-markdown' && pane === 'left') {
    updateMarkdownPreview();
  }
}

function handleEditorClick(pane = 'left') {
  updateEditorStatusBar(pane);
}

function updateEditorGutter(pane = 'left') {
  const textarea = document.getElementById(`editor-text-${pane}`);
  const gutter = document.getElementById(`editor-gutter-${pane}`);
  if (!textarea || !gutter) return;

  const lineCount = textarea.value.split('\n').length;
  let gutterText = '';
  for (let i = 1; i <= lineCount; i++) {
    gutterText += i + '\n';
  }
  gutter.textContent = gutterText;
}

function syncGutterScroll(pane = 'left') {
  const textarea = document.getElementById(`editor-text-${pane}`);
  const gutter = document.getElementById(`editor-gutter-${pane}`);
  if (textarea && gutter) {
    gutter.scrollTop = textarea.scrollTop;
  }

  if (pane === 'left' && editorViewMode === 'split-markdown') {
    const preview = document.getElementById('editor-preview-container');
    if (preview && textarea) {
      const scrollRatio = textarea.scrollTop / Math.max(1, (textarea.scrollHeight - textarea.clientHeight));
      preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight);
    }
  }
}

function updateEditorStatusBar(pane = 'left') {
  const textarea = document.getElementById(`editor-text-${pane}`);
  if (!textarea) return;

  const content = textarea.value;
  const pos = textarea.selectionStart || 0;
  const selEnd = textarea.selectionEnd || 0;
  const selLen = Math.abs(selEnd - pos);

  const lines = content.substring(0, pos).split('\n');
  const lineNum = lines.length;
  const colNum = lines[lines.length - 1].length + 1;

  const posEl = document.getElementById('editor-cursor-pos');
  if (posEl) {
    posEl.textContent = `Ln ${lineNum}, Col ${colNum}${selLen > 0 ? ` (${selLen} selected)` : ''}`;
  }

  const totalLines = content.split('\n').length;
  const totalWords = content.split(/\s+/).filter(Boolean).length;
  const statsEl = document.getElementById('editor-doc-stats');
  if (statsEl) {
    statsEl.textContent = `${totalLines} lines | ${content.length} chars | ${totalWords} words`;
  }
}

function cycleEditorTabSize() {
  editorTabSize = editorTabSize === 2 ? 4 : 2;
  const info = document.getElementById('editor-indent-info');
  if (info) info.textContent = `Spaces: ${editorTabSize}`;
  ['left', 'right'].forEach(pane => {
    const ta = document.getElementById(`editor-text-${pane}`);
    if (ta) ta.style.tabSize = editorTabSize;
  });
}

function handleEditorKeyDown(e, pane = 'left') {
  const textarea = e.target;
  const tabSpaces = ' '.repeat(editorTabSize);

  if (e.key === 'Tab') {
    e.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (e.shiftKey) {
      const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
      const lineText = textarea.value.substring(lineStart);
      if (lineText.startsWith('  ')) {
        textarea.value = textarea.value.substring(0, lineStart) + textarea.value.substring(lineStart + 2);
        textarea.selectionStart = Math.max(0, start - 2);
        textarea.selectionEnd = Math.max(0, end - 2);
      }
    } else {
      textarea.value = textarea.value.substring(0, start) + tabSpaces + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + tabSpaces.length;
    }
    handleEditorInput(pane);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (e.shiftKey) saveAllEditorTabs();
    else saveActiveEditorTab();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    const tab = getActiveEditorTab(pane);
    if (tab) closeEditorTab(tab.id);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    createNewEditorTab();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    toggleFindBar(true);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
    e.preventDefault();
    toggleFindBar(true);
    document.getElementById('editor-replace-input')?.focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    toggleLineComment(textarea, pane);
  } else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    textarea.style.whiteSpace = textarea.style.whiteSpace === 'pre-wrap' ? 'pre' : 'pre-wrap';
    showToast(`Word wrap: ${textarea.style.whiteSpace === 'pre-wrap' ? 'ON' : 'OFF'}`, 'info');
  }
}

function toggleLineComment(textarea, pane) {
  const tab = getActiveEditorTab(pane);
  const lang = tab?.lang || 'markup';
  let commentPrefix = '# ';
  if (['javascript', 'rust', 'c', 'cpp', 'clike', 'java', 'go'].includes(lang)) commentPrefix = '// ';
  else if (['sql'].includes(lang)) commentPrefix = '-- ';
  else if (['html', 'xml'].includes(lang)) commentPrefix = '<!-- ';

  const start = textarea.selectionStart;
  const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = textarea.value.indexOf('\n', start);
  const currentLine = textarea.value.substring(lineStart, lineEnd === -1 ? textarea.value.length : lineEnd);

  if (currentLine.startsWith(commentPrefix)) {
    textarea.value = textarea.value.substring(0, lineStart) + currentLine.substring(commentPrefix.length) + textarea.value.substring(lineEnd === -1 ? textarea.value.length : lineEnd);
  } else {
    textarea.value = textarea.value.substring(0, lineStart) + commentPrefix + currentLine + textarea.value.substring(lineEnd === -1 ? textarea.value.length : lineEnd);
  }
  handleEditorInput(pane);
}

function updateMarkdownPreview() {
  const content = document.getElementById('editor-text-left')?.value || '';
  const preview = document.getElementById('editor-preview-container');
  if (!preview) return;

  let html = content
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
    .replace(/\*(.*)\*/gim, '<i>$1</i>')
    .replace(/```mermaid\n([\s\S]*?)\n```/gim, '<div class="mermaid">$1</div>')
    .replace(/```([a-z]*)\n([\s\S]*?)\n```/gim, (match, lang, code) => {
      const prismLang = window.Prism ? (Prism.languages[lang] || Prism.languages.markup) : null;
      const highlighted = (window.Prism && prismLang) ? Prism.highlight(code, prismLang, lang) : escapeHtml(code);
      return `<pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>`;
    })
    .replace(/\n/gim, '<br>');

  preview.innerHTML = html;

  if (window.mermaid) {
    try {
      mermaid.init(undefined, document.querySelectorAll('.mermaid'));
    } catch (err) {
      console.warn('Mermaid rendering error:', err);
    }
  }
}

// ---------------- ADVANCED FIND & REPLACE TOOLBAR ----------------

function toggleFindBar(forceOpen) {
  const bar = document.getElementById('editor-find-bar');
  if (!bar) return;
  const isOpening = forceOpen !== undefined ? forceOpen : bar.style.display === 'none';
  bar.style.display = isOpening ? 'block' : 'none';
  if (isOpening) {
    const findInput = document.getElementById('editor-find-input');
    findInput?.focus();
    findInput?.select();
    executeFind();
  }
}

function toggleFindOption(opt) {
  findOptions[opt] = !findOptions[opt];
  const btnMap = {
    matchCase: 'find-opt-case',
    matchWord: 'find-opt-word',
    useRegex: 'find-opt-regex'
  };
  const btn = document.getElementById(btnMap[opt]);
  if (btn) btn.classList.toggle('active', findOptions[opt]);
  executeFind();
}

function handleFindKeyDown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) findPrevMatch();
    else findNextMatch();
  } else if (e.key === 'Escape') {
    toggleFindBar(false);
  }
}

function executeFind() {
  const query = document.getElementById('editor-find-input')?.value;
  const textarea = document.getElementById('editor-text-left');
  const countEl = document.getElementById('editor-match-count');
  editorFindMatches = [];

  if (!query || !textarea) {
    if (countEl) countEl.textContent = '0 of 0';
    return;
  }

  const text = textarea.value;

  try {
    let pattern = query;
    if (!findOptions.useRegex) {
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (findOptions.matchWord) {
      pattern = `\\b${pattern}\\b`;
    }

    const flags = findOptions.matchCase ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      editorFindMatches.push({ start: match.index, end: match.index + match[0].length });
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }

    if (editorFindMatches.length > 0) {
      if (currentMatchIndex < 0 || currentMatchIndex >= editorFindMatches.length) {
        currentMatchIndex = 0;
      }
      highlightCurrentMatch();
    } else {
      currentMatchIndex = -1;
    }

    if (countEl) {
      countEl.textContent = editorFindMatches.length > 0 ? `${currentMatchIndex + 1} of ${editorFindMatches.length}` : '0 of 0';
    }
  } catch (err) {
    if (countEl) countEl.textContent = 'Regex error';
  }
}

function highlightCurrentMatch() {
  if (currentMatchIndex < 0 || currentMatchIndex >= editorFindMatches.length) return;
  const match = editorFindMatches[currentMatchIndex];
  const textarea = document.getElementById('editor-text-left');
  if (!textarea) return;

  textarea.focus();
  textarea.setSelectionRange(match.start, match.end);

  const countEl = document.getElementById('editor-match-count');
  if (countEl) countEl.textContent = `${currentMatchIndex + 1} of ${editorFindMatches.length}`;
}

function findNextMatch() {
  if (editorFindMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % editorFindMatches.length;
  highlightCurrentMatch();
}

function findPrevMatch() {
  if (editorFindMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex - 1 + editorFindMatches.length) % editorFindMatches.length;
  highlightCurrentMatch();
}

function replaceCurrentMatch() {
  if (currentMatchIndex < 0 || currentMatchIndex >= editorFindMatches.length) return;
  const match = editorFindMatches[currentMatchIndex];
  const replaceWith = document.getElementById('editor-replace-input')?.value || '';
  const textarea = document.getElementById('editor-text-left');
  if (!textarea) return;

  const val = textarea.value;
  textarea.value = val.substring(0, match.start) + replaceWith + val.substring(match.end);
  handleEditorInput('left');
  executeFind();
}

function replaceAllMatches() {
  const query = document.getElementById('editor-find-input')?.value;
  const replaceWith = document.getElementById('editor-replace-input')?.value || '';
  const textarea = document.getElementById('editor-text-left');
  if (!query || !textarea) return;

  try {
    let pattern = query;
    if (!findOptions.useRegex) {
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (findOptions.matchWord) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = findOptions.matchCase ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    textarea.value = textarea.value.replace(regex, replaceWith);
    handleEditorInput('left');
    executeFind();
    showToast('Replaced all matches!', 'success');
  } catch (err) {
    showToast('Replace error: ' + err, 'error');
  }
}

// ---------------- REVISED COMPARISON & DIFF ENGINE ----------------

let currentFolderDiffData = null;
let currentDiffFilter = 'all';

async function triggerDiff(deepHash = false) {
  const paneA = App.panes[0];
  const paneB = App.panes[1] || App.panes[0];

  // Scenario 1: User selected 1 file in Pane 1 and 1 file in Pane 2
  const selA = Array.from(paneA.selected);
  const selB = Array.from(paneB.selected);

  if (selA.length === 1 && selB.length === 1 && selA[0] !== selB[0]) {
    return openFileDiffView(selA[0], selB[0]);
  }

  // Scenario 2: User selected 2 files in the SAME active pane
  const activePane = App.panes[App.activePaneIndex];
  const activeSel = Array.from(activePane.selected);
  if (activeSel.length === 2) {
    return openFileDiffView(activeSel[0], activeSel[1]);
  }

  // Scenario 3: Folder Comparison (Fast Immediate Level by default, Deep SHA-256 on demand)
  const modalBody = document.getElementById('diff-modal-body');
  modalBody.innerHTML = `
    <div style="padding: 24px; text-align: center; color: var(--accent);">
      <div style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">⚖️ Calculating Folder Comparison...</div>
      <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(sanitizeCredentials(paneA.path))} ⟷ ${escapeHtml(sanitizeCredentials(paneB.path))}</div>
      <div style="margin-top: 12px; font-size: 11px; color: var(--text-dim);">${deepHash ? 'Performing deep recursive SHA-256 integrity analysis...' : 'Comparing immediate directory entries (fast mode)...'}</div>
    </div>
  `;
  showModal('diff-modal');

  try {
    const selectedItems = activeSel.length > 0 ? activeSel.map(p => p.split('/').pop()) : null;

    const resp = await fetch('/api/tools/diff/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({
        dir_left: paneA.path,
        dir_right: paneB.path,
        recursive: deepHash,
        deep_hash: deepHash,
        selected_items: selectedItems
      })
    });

    if (resp.ok) {
      currentFolderDiffData = await resp.json();
      currentDiffFilter = 'all';
      renderFolderDiff(currentFolderDiffData, currentDiffFilter);
    } else {
      modalBody.innerHTML = `<div style="color: var(--danger); padding: 20px;">Diff calculation failed: ${await resp.text()}</div>`;
    }
  } catch (e) {
    modalBody.innerHTML = `<div style="color: var(--danger); padding: 20px;">Error: ${e}</div>`;
  }
}

function setDiffFilter(filter) {
  currentDiffFilter = filter;
  if (currentFolderDiffData) renderFolderDiff(currentFolderDiffData, currentDiffFilter);
}

function renderFolderDiff(diff, filter = 'all') {
  const body = document.getElementById('diff-modal-body');
  if (!body) return;
  
  let filteredEntries = diff.entries || [];
  if (filter === 'modified') filteredEntries = filteredEntries.filter(e => e.status === 'modified');
  else if (filter === 'left_only') filteredEntries = filteredEntries.filter(e => e.status === 'left_only');
  else if (filter === 'right_only') filteredEntries = filteredEntries.filter(e => e.status === 'right_only');
  else if (filter === 'identical') filteredEntries = filteredEntries.filter(e => e.status === 'identical');

  body.innerHTML = `
    <div class="diff-paths-card">
      <div class="diff-path-chips">
        <div class="diff-path-chip" title="${escapeHtml(diff.dir_left)}">
          <span style="font-weight: 700; color: var(--info);">L:</span>
          <code>${escapeHtml(diff.dir_left)}</code>
        </div>
        <span style="color: var(--text-dim); font-size: 11px;">⟷</span>
        <div class="diff-path-chip" title="${escapeHtml(diff.dir_right)}">
          <span style="font-weight: 700; color: #c084fc;">R:</span>
          <code>${escapeHtml(diff.dir_right)}</code>
        </div>
      </div>
      <div class="diff-action-buttons">
        <button class="btn btn-sm" onclick="triggerDiff(false)" title="Fast Immediate Compare"><i data-lucide="zap"></i> Fast</button>
        <button class="btn btn-sm btn-accent" onclick="triggerDiff(true)" title="Deep Recursive SHA-256 Compare"><i data-lucide="shield-check"></i> Deep Hash</button>
      </div>
    </div>

    <!-- Filter Buttons Bar -->
    <div class="diff-filter-bar">
      <button class="diff-filter-btn ${filter === 'all' ? 'active' : ''}" onclick="setDiffFilter('all')">
        All (${diff.entries.length})
      </button>
      <button class="diff-filter-btn ${filter === 'modified' ? 'active' : ''}" onclick="setDiffFilter('modified')">
        <span style="color: var(--accent);">⚠️ Modified (${diff.modified_count})</span>
      </button>
      <button class="diff-filter-btn ${filter === 'left_only' ? 'active' : ''}" onclick="setDiffFilter('left_only')">
        <span style="color: var(--info);">⬅ Left Only (${diff.left_only_count})</span>
      </button>
      <button class="diff-filter-btn ${filter === 'right_only' ? 'active' : ''}" onclick="setDiffFilter('right_only')">
        <span style="color: var(--danger);">➡ Right Only (${diff.right_only_count})</span>
      </button>
      <button class="diff-filter-btn ${filter === 'identical' ? 'active' : ''}" onclick="setDiffFilter('identical')">
        <span style="color: var(--success);">✔ Identical (${diff.identical_count})</span>
      </button>
    </div>

    <div class="diff-table-wrapper">
      <table class="diff-table">
        <thead>
          <tr>
            <th style="text-align: left;">Relative Path</th>
            <th style="width: 85px; text-align: center;">Status</th>
            <th style="width: 80px; text-align: right;">Left Size</th>
            <th style="width: 80px; text-align: right;">Right Size</th>
            <th style="width: 60px; text-align: center;">Diff</th>
          </tr>
        </thead>
        <tbody>
          ${filteredEntries.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding: 28px; color: var(--text-dim);">No files match this filter.</td></tr>' : ''}
          ${filteredEntries.map(e => `
            <tr>
              <td style="font-family: var(--font-mono); max-width: 320px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(e.relative_path)}">
                ${escapeHtml(e.relative_path)}
              </td>
              <td style="text-align: center; color: ${e.status === 'identical' ? 'var(--success)' : (e.status === 'modified' ? 'var(--accent)' : (e.status === 'left_only' ? 'var(--info)' : 'var(--danger)'))}; font-weight: 700; font-size: 10px;">
                ${e.status.replace('_', ' ').toUpperCase()}
              </td>
              <td style="text-align: right; font-family: var(--font-mono); color: var(--text-muted);">${e.size_left !== null ? formatBytes(e.size_left) : '-'}</td>
              <td style="text-align: right; font-family: var(--font-mono); color: var(--text-muted);">${e.size_right !== null ? formatBytes(e.size_right) : '-'}</td>
              <td style="text-align: center;">
                ${!e.is_dir && (e.status === 'modified' || e.status === 'identical') ? `
                  <button class="btn btn-icon btn-sm" onclick="openFileDiffView('${escapeHtml(diff.dir_left)}/${escapeHtml(e.relative_path)}', '${escapeHtml(diff.dir_right)}/${escapeHtml(e.relative_path)}')" title="Inspect Side-by-Side Diff">
                    <i data-lucide="eye" style="width:12px;"></i>
                  </button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

async function openFileDiffView(fileL, fileR) {
  showModal('diff-modal');
  const body = document.getElementById('diff-modal-body');
  if (!body) return;
  body.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--accent);"><i data-lucide="loader"></i> Loading side-by-side file comparison...</div>';
  if (window.lucide) lucide.createIcons();

  try {
    const resp = await fetch('/api/tools/diff/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ file_left: fileL, file_right: fileR })
    });

    if (resp.ok) {
      const diffData = await resp.json();
      body.innerHTML = `
        <div class="diff-file-header-card">
          <div class="diff-file-stats">
            <div class="diff-path-chip" title="${escapeHtml(sanitizeCredentials(diffData.file_left))}">
              <span style="font-weight: 700; color: var(--info);">L:</span>
              <code>${escapeHtml(getBasename(diffData.file_left))}</code>
            </div>
            <span style="color: var(--text-dim); font-size: 11px;">⟷</span>
            <div class="diff-path-chip" title="${escapeHtml(sanitizeCredentials(diffData.file_right))}">
              <span style="font-weight: 700; color: #c084fc;">R:</span>
              <code>${escapeHtml(getBasename(diffData.file_right))}</code>
            </div>
            <span style="margin-left: 6px; font-size: 10.5px; font-family: var(--font-mono); background: rgba(245, 158, 11, 0.15); color: var(--accent); padding: 2px 6px; border-radius: 3px; font-weight: 700; white-space: nowrap;">
              +${diffData.additions} / -${diffData.deletions}
            </span>
          </div>
          <button class="btn btn-sm" onclick="triggerDiff(false)"><i data-lucide="arrow-left"></i> Back</button>
        </div>
        <div class="diff-container">
          ${diffData.lines.map(line => `
            <div class="diff-line ${line.tag}">
              <div class="diff-gutter">${line.line_num_left || ''} | ${line.line_num_right || ''}</div>
              <div>${line.tag === 'insert' ? '+ ' : (line.tag === 'delete' ? '- ' : '  ')}${escapeHtml(line.content)}</div>
            </div>
          `).join('')}
        </div>
      `;
      if (window.lucide) lucide.createIcons();
    } else {
      body.innerHTML = `<div style="color: var(--danger); padding: 20px;">Failed to compare files: ${escapeHtml(await resp.text())}</div>`;
    }
  } catch (e) {
    body.innerHTML = `<div style="color: var(--danger); padding: 20px;">Error: ${escapeHtml(String(e))}</div>`;
  }
}

// ---------------- CONVERTX FILE & IMAGE CONVERTER TOOL ----------------

let activeConverterFile = '';

function triggerConvertFile() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (item && !item.is_dir) {
    openConverterModal(item.path);
  } else {
    openConverterModal('');
  }
}

function openConverterModal(filePath) {
  const pane = App.panes[App.activePaneIndex];
  if (!filePath && pane.entries[pane.cursorIndex]) {
    filePath = pane.entries[pane.cursorIndex].path;
  }
  activeConverterFile = filePath || '';

  const fileName = filePath ? filePath.split('/').pop() : 'No file selected';
  const nameEl = document.getElementById('convert-source-filename');
  const pathEl = document.getElementById('convert-source-path');
  const sizeEl = document.getElementById('convert-source-size');

  if (nameEl) nameEl.textContent = fileName;
  if (pathEl) pathEl.textContent = filePath || 'Select a file in the pane to convert';
  if (sizeEl) sizeEl.textContent = '';

  const statusMsg = document.getElementById('convert-status-msg');
  if (statusMsg) statusMsg.style.display = 'none';

  showModal('converter-modal');
}

function handleTargetFormatChange(fmt) {
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'ico'].includes(fmt.toLowerCase());
  const imgOpts = document.getElementById('convert-image-options');
  if (imgOpts) imgOpts.style.display = isImage ? 'block' : 'none';
}

async function executeFileConversion() {
  if (!activeConverterFile) {
    showToast('Please select a valid file to convert', 'warning');
    return;
  }

  const targetFormat = document.getElementById('convert-target-format')?.value || 'webp';
  const quality = parseInt(document.getElementById('convert-quality-slider')?.value || '85', 10);
  const resizeW = parseInt(document.getElementById('convert-resize-w')?.value, 10) || null;
  const resizeH = parseInt(document.getElementById('convert-resize-h')?.value, 10) || null;

  const statusMsg = document.getElementById('convert-status-msg');
  const btn = document.getElementById('btn-run-convert');

  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.style.color = 'var(--accent)';
    statusMsg.innerHTML = '<i data-lucide="loader"></i> Converting file in progress...';
    if (window.lucide) lucide.createIcons();
  }
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch('/api/tools/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({
        source_path: activeConverterFile,
        target_format: targetFormat,
        quality: quality,
        resize_width: resizeW,
        resize_height: resizeH
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      if (statusMsg) {
        statusMsg.style.color = 'var(--success)';
        statusMsg.innerHTML = `✅ ${escapeHtml(data.message)}<br><small style="color:var(--text-muted);">Output: ${escapeHtml(data.output_path)}</small>`;
      }
      refreshPane(App.activePaneIndex);
    } else {
      if (statusMsg) {
        statusMsg.style.color = 'var(--danger)';
        statusMsg.textContent = `Conversion failed: ${await resp.text()}`;
      }
    }
  } catch (e) {
    if (statusMsg) {
      statusMsg.style.color = 'var(--danger)';
      statusMsg.textContent = `Error: ${e}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------- USER PROFILE & DROPDOWNS & FAVORITES ----------------

function renderAvatarElement(el, avatar) {
  if (!el) return;
  const isImage = avatar && (avatar.startsWith('data:image') || avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/'));
  if (isImage) {
    el.innerHTML = `<img src="${escapeHtml(avatar)}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block;">`;
  } else {
    el.textContent = avatar || '👤';
  }
}

function handleAvatarFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (JPEG, PNG, WebP, GIF)', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Create square canvas with high quality resize
      const canvas = document.createElement('canvas');
      const targetSize = 160;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');

      // Crop to center square
      const minDim = Math.min(img.width, img.height);
      const startX = (img.width - minDim) / 2;
      const startY = (img.height - minDim) / 2;

      ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, targetSize, targetSize);

      // Output as compressed WebP
      const dataUri = canvas.toDataURL('image/webp', 0.85);

      const avatarInput = document.getElementById('profile-input-avatar');
      const avatarPreview = document.getElementById('profile-edit-avatar');
      if (avatarInput) avatarInput.value = dataUri;
      if (avatarPreview) renderAvatarElement(avatarPreview, dataUri);
      showToast('Profile photo ready! Click "Save Profile" to apply.', 'info');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function resetAvatarToDefault() {
  const avatarInput = document.getElementById('profile-input-avatar');
  const avatarPreview = document.getElementById('profile-edit-avatar');
  if (avatarInput) avatarInput.value = '👤';
  if (avatarPreview) renderAvatarElement(avatarPreview, '👤');
  showToast('Avatar reset to default', 'info');
}

function updateHeaderProfile(user) {
  if (!user) return;
  const uname = user.nickname || user.username || 'User';
  const roleStr = (user.role || 'USER').toUpperCase();
  const avatar = user.avatar_url || '👤';

  const headerLabel = document.getElementById('header-username-label');
  const headerBadge = document.getElementById('header-role-badge');
  const headerAvatar = document.getElementById('header-avatar-thumb');
  if (headerLabel) headerLabel.textContent = uname;
  if (headerBadge) headerBadge.textContent = roleStr;
  if (headerAvatar) renderAvatarElement(headerAvatar, avatar);

  const menuName = document.getElementById('menu-user-name');
  const menuEmail = document.getElementById('menu-user-email');
  const menuBadge = document.getElementById('menu-role-badge');
  const menuAvatar = document.getElementById('menu-avatar-large');
  if (menuName) menuName.textContent = uname;
  if (menuEmail) menuEmail.textContent = user.email || `${user.username}@localhost`;
  if (menuBadge) menuBadge.textContent = roleStr;
  if (menuAvatar) renderAvatarElement(menuAvatar, avatar);

  // Show/Hide Admin Control Panel item based on role (Admin only)
  const isAdmin = user.role === 'admin';
  const adminItem = document.getElementById('menu-admin-panel-item');
  if (adminItem) {
    adminItem.style.display = isAdmin ? 'flex' : 'none';
  }
  const mobileAdminItem = document.getElementById('mobile-admin-panel-item');
  if (mobileAdminItem) {
    mobileAdminItem.style.display = isAdmin ? 'flex' : 'none';
  }

  // Update Logout vs Exit button for standalone desktop mode
  updateLogoutOrExitButton();
}

function updateLogoutOrExitButton() {
  const isStandalone = App.isStandalone === true || App.config?.server?.standalone === true || window.__TAURI__ !== undefined;
  const logoutBtn = document.getElementById('btn-profile-logout');
  if (logoutBtn) {
    if (isStandalone) {
      logoutBtn.title = 'Exit / Quit CommanderDog';
      logoutBtn.innerHTML = '<i data-lucide="power" style="width: 14px; height: 14px;"></i> <span id="label-profile-logout">Exit</span>';
    } else {
      logoutBtn.title = 'Log Out';
      logoutBtn.innerHTML = '<i data-lucide="log-out" style="width: 14px; height: 14px;"></i> <span id="label-profile-logout">Log Out</span>';
    }
    if (window.lucide) lucide.createIcons();
  }
}

function toggleToolsMenu(e) {
  e?.stopPropagation();
  const menu = document.getElementById('tools-dropdown-menu');
  const profileMenu = document.getElementById('profile-dropdown-menu');
  if (profileMenu) profileMenu.classList.remove('active');
  if (menu) menu.classList.toggle('active');
}

function toggleProfileMenu(e) {
  e?.stopPropagation();
  const menu = document.getElementById('profile-dropdown-menu');
  const toolsMenu = document.getElementById('tools-dropdown-menu');
  if (toolsMenu) toolsMenu.classList.remove('active');
  if (menu) menu.classList.toggle('active');
}

function toggleEditorActionsDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('editor-actions-dropdown-menu');
  if (!menu) return;
  const isShown = menu.style.display === 'block';
  menu.style.display = isShown ? 'none' : 'block';
  if (!isShown && window.lucide) {
    lucide.createIcons({ root: menu });
  }
}

function closeEditorActionsDropdown() {
  const menu = document.getElementById('editor-actions-dropdown-menu');
  if (menu) menu.style.display = 'none';
}

function toggleImgTransformDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('img-transform-dropdown-menu');
  if (!menu) return;
  const isShown = menu.style.display === 'block';
  menu.style.display = isShown ? 'none' : 'block';
}

function closeImgTransformDropdown() {
  const menu = document.getElementById('img-transform-dropdown-menu');
  if (menu) menu.style.display = 'none';
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tools-dropdown-wrapper')) {
    document.getElementById('tools-dropdown-menu')?.classList.remove('active');
  }
  if (!e.target.closest('.profile-dropdown-wrapper')) {
    document.getElementById('profile-dropdown-menu')?.classList.remove('active');
  }
  if (!e.target.closest('#editor-actions-dropdown-container')) {
    const m = document.getElementById('editor-actions-dropdown-menu');
    if (m) m.style.display = 'none';
  }
  if (!e.target.closest('#img-transform-dropdown-container')) {
    const m = document.getElementById('img-transform-dropdown-menu');
    if (m) m.style.display = 'none';
  }
  const favMenu = document.getElementById('pane-favorites-popup');
  if (favMenu && !e.target.closest('.pane-favorites-dropdown') && !e.target.closest('[id^="btn-favorites-"]')) {
    favMenu.remove();
  }
});

function openAboutModal() {
  document.getElementById('profile-dropdown-menu')?.classList.remove('active');
  showModal('about-modal');
}

function openUserProfileModal() {
  document.getElementById('profile-dropdown-menu')?.classList.remove('active');
  const user = App.user || {};

  const editAvatar = document.getElementById('profile-edit-avatar');
  const editUname = document.getElementById('profile-edit-username');
  const editBadge = document.getElementById('profile-edit-role-badge');
  const editAuthType = document.getElementById('profile-edit-auth-type');

  if (editAvatar) renderAvatarElement(editAvatar, user.avatar_url || '👤');
  if (editUname) editUname.textContent = user.username || 'User';
  if (editBadge) editBadge.textContent = (user.role || 'USER').toUpperCase();
  if (editAuthType) editAuthType.textContent = user.is_pam ? 'PAM / Local Linux Account' : 'Internal Database Account';

  const nickInput = document.getElementById('profile-input-nickname');
  const emailInput = document.getElementById('profile-input-email');
  const avatarInput = document.getElementById('profile-input-avatar');
  const passInput = document.getElementById('profile-input-password');

  if (nickInput) nickInput.value = user.nickname || '';
  if (emailInput) emailInput.value = user.email || '';
  if (avatarInput) avatarInput.value = user.avatar_url || '';
  if (passInput) passInput.value = '';

  const statusMsg = document.getElementById('profile-status-msg');
  if (statusMsg) statusMsg.style.display = 'none';

  if (window.lucide) lucide.createIcons();
  showModal('profile-modal');
}

async function saveUserProfile() {
  const nickname = document.getElementById('profile-input-nickname')?.value.trim() || null;
  const email = document.getElementById('profile-input-email')?.value.trim() || null;
  const avatar_url = document.getElementById('profile-input-avatar')?.value.trim() || null;
  const new_password = document.getElementById('profile-input-password')?.value || null;

  const statusMsg = document.getElementById('profile-status-msg');
  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.style.color = 'var(--accent)';
    statusMsg.textContent = 'Saving profile...';
  }

  try {
    const resp = await fetch('/api/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ nickname, email, avatar_url, new_password })
    });

    if (resp.ok) {
      if (statusMsg) {
        statusMsg.style.color = 'var(--success)';
        statusMsg.textContent = 'Profile updated successfully!';
      }
      // Re-fetch me
      const meResp = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (meResp.ok) {
        App.user = await meResp.json();
        updateHeaderProfile(App.user);
      }
      setTimeout(() => closeModal('profile-modal'), 1000);
    } else {
      if (statusMsg) {
        statusMsg.style.color = 'var(--danger)';
        statusMsg.textContent = `Save failed: ${await resp.text()}`;
      }
    }
  } catch (e) {
    if (statusMsg) {
      statusMsg.style.color = 'var(--danger)';
      statusMsg.textContent = `Error: ${e}`;
    }
  }
}

function openAdminPanel() {
  document.getElementById('profile-dropdown-menu')?.classList.remove('active');
  if (App.user?.role !== 'admin') {
    showToast('Access restricted to Administrators.', 'warning');
    return;
  }
  showModal('admin-panel-modal');
  switchAdminTab('admin-tab-users');
}

function openBookmarksManager() {
  openSettingsModal();
  switchSettingsTab('tab-bookmarks');
}

async function openPaneFavoritesMenu(e, paneIndex) {
  e.stopPropagation();
  document.getElementById('pane-favorites-popup')?.remove();

  const localShortcuts = [
    { name: 'Home Directory', path: `/home/${App.user?.username || 'bolt'}`, icon: 'home' },
    { name: 'Root Filesystem', path: '/', icon: 'hard-drive' },
    { name: 'Downloads', path: `/home/${App.user?.username || 'bolt'}/Downloads`, icon: 'download' },
    { name: 'Documents', path: `/home/${App.user?.username || 'bolt'}/Documents`, icon: 'file-text' },
    { name: 'Projects', path: `/home/${App.user?.username || 'bolt'}/projects`, icon: 'folder-git-2' },
    { name: 'Temporary /tmp', path: '/tmp', icon: 'zap' }
  ];

  let globalMounts = [];
  let userBookmarks = [];
  try {
    const [mountsRes, bmRes] = await Promise.all([
      fetch('/api/mounts/accessible', { headers: { 'Authorization': `Bearer ${App.token}` } }),
      fetch('/api/bookmarks', { headers: { 'Authorization': `Bearer ${App.token}` } })
    ]);
    if (mountsRes.ok) globalMounts = await mountsRes.json();
    if (bmRes.ok) userBookmarks = await bmRes.json();
  } catch (err) {
    console.warn('Failed to load favorites/bookmarks:', err);
  }

  const protoIcons = {
    'local': 'folder',
    'web': 'globe',
    'smb': 'share-2',
    'nfs': 'server',
    's3': 'cloud',
    'sftp': 'terminal',
    'webdav': 'globe',
    'hetzner-box': 'box',
    'proton': 'shield'
  };

  const curPanePath = App.panes[paneIndex]?.path || '/';

  const popup = document.createElement('div');
  popup.id = 'pane-favorites-popup';
  popup.className = 'pane-favorites-dropdown active';

  popup.innerHTML = `
    <div style="padding: 8px 12px; font-weight: 700; font-size: 11px; color: var(--accent); background: var(--bg-dark); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
      <span>⭐ Quick Favorites & Bookmarks</span>
      <span style="font-size: 10px; color: var(--text-dim); cursor: pointer;" onclick="openBookmarksManager()">Manage ⚙️</span>
    </div>
    <div style="padding: 4px 0; max-height: 380px; overflow-y: auto;">
      ${userBookmarks.length > 0 ? `
        <div style="padding: 4px 12px; font-size: 10px; color: var(--accent); font-weight: 700; text-transform: uppercase;">Saved Bookmarks</div>
        ${userBookmarks.map(b => `
          <div class="dropdown-item" onclick="navigateToBookmark('${encodeURIComponent(b.path)}', ${b.has_password}, '${b.protocol}'); document.getElementById('pane-favorites-popup')?.remove();">
            <i data-lucide="${protoIcons[b.protocol] || 'bookmark'}" style="color: var(--accent);"></i>
            <div>
              <div style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span>${escapeHtml(b.name)}</span>
                <span class="badge" style="font-size: 8.5px; padding: 1px 4px; text-transform: uppercase;">${escapeHtml(b.protocol)}</span>
              </div>
              <div style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(sanitizeCredentials(b.path))}</div>
            </div>
          </div>
        `).join('')}
        <div class="context-sep" style="margin: 4px 0;"></div>
      ` : ''}
      
      <div style="padding: 4px 12px; font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Local Shortcuts</div>
      ${localShortcuts.map(b => `
        <div class="dropdown-item" onclick="loadPaneDirectory(${paneIndex}, '${b.path}'); document.getElementById('pane-favorites-popup')?.remove();">
          <i data-lucide="${b.icon}"></i>
          <div>
            <div style="font-weight: 600;">${escapeHtml(b.name)}</div>
            <div style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(b.path)}</div>
          </div>
        </div>
      `).join('')}

      ${globalMounts.length > 0 ? `
        <div class="context-sep" style="margin: 4px 0;"></div>
        <div style="padding: 4px 12px; font-size: 10px; color: var(--accent); font-weight: 700; text-transform: uppercase; display: flex; justify-content: space-between;">
          <span>🌐 Network Mounts</span>
          <span style="font-size: 9px; opacity: 0.8;">ADMIN</span>
        </div>
        ${globalMounts.map(m => `
          <div class="dropdown-item" onclick="navigateToBookmark('${encodeURIComponent(m.target_uri)}', false, '${m.protocol}'); document.getElementById('pane-favorites-popup')?.remove();">
            <i data-lucide="${protoIcons[m.protocol] || 'network'}" style="color: var(--accent);"></i>
            <div>
              <div style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span>${escapeHtml(m.name)}</span>
                <span class="badge" style="font-size: 8.5px; padding: 1px 4px; text-transform: uppercase;">${escapeHtml(m.protocol)}</span>
              </div>
              <div style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(sanitizeCredentials(m.target_uri))}</div>
            </div>
          </div>
        `).join('')}
      ` : ''}

      <div class="context-sep" style="margin: 4px 0;"></div>
      <div class="dropdown-item" onclick="document.getElementById('pane-favorites-popup')?.remove(); addNewBookmark('${encodeURIComponent(curPanePath)}');" style="color: var(--accent);">
        <i data-lucide="bookmark-plus"></i>
        <div style="font-weight: 600;">+ Bookmark Current Folder</div>
      </div>
    </div>
  `;

  const btn = document.getElementById(`btn-favorites-${paneIndex}`);
  btn?.parentElement?.appendChild(popup);
  if (window.lucide) lucide.createIcons();
}

function toggleGlobalDotfiles(show) {
  App.panes.forEach(pane => {
    pane.showHidden = show;
  });
  refreshAllPanes();
}

// ---------------- PARANOID DRY RUN ----------------

async function showParanoidConfirm(action, sources, destination, onProceed) {
  const modalBody = document.getElementById('paranoid-modal-body');
  modalBody.innerHTML = '<div>Analyzing filesystem transaction safety & disk availability...</div>';
  showModal('paranoid-modal');

  const resp = await fetch('/api/tools/paranoid/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ action, sources, destination })
  });

  if (resp.ok) {
    const report = await resp.json();
    modalBody.innerHTML = `
      <div style="font-size: 12px; line-height: 1.6;">
        <p><b>Action:</b> <span style="text-transform: uppercase; color: var(--accent);">${report.action}</span></p>
        <p><b>Items:</b> ${report.sources.length} files/directories (${formatBytes(report.estimated_total_bytes)})</p>
        <p><b>Destination:</b> ${report.destination_target || 'N/A'}</p>
        <p><b>Post-Transfer Verification:</b> <span style="color: var(--success);">SHA-256 Checksum Validation</span></p>
        ${report.warnings.length > 0 ? `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); padding: 8px; border-radius: 4px; margin-top: 8px;">
            <b>Warnings:</b>
            <ul style="padding-left: 16px;">
              ${report.warnings.map(w => `<li>${w}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('btn-paranoid-proceed').onclick = () => {
      closeModal('paranoid-modal');
      onProceed();
    };
  }
}

// ---------------- CONTEXT MENU & UI ACTIONS ----------------

function showContextMenu(x, y) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;

  const visibleCount = getVisiblePaneCount();
  const currentIdx = App.activePaneIndex;
  
  let copyPaneItems = '';
  let movePaneItems = '';

  for (let i = 0; i < visibleCount; i++) {
    const p = App.panes[i];
    const isCurrent = (i === currentIdx);
    const shortP = p.path.length > 20 ? '...' + p.path.slice(-17) : p.path;
    const label = `Pane ${i + 1} (${shortP})${isCurrent ? ' • Current' : ''}`;
    
    if (!isCurrent) {
      copyPaneItems += `<div class="context-item" onclick="quickTransferToPane('copy', ${i})"><i data-lucide="layout" style="width:13px;"></i> ${escapeHtml(label)}</div>`;
      movePaneItems += `<div class="context-item" onclick="quickTransferToPane('move', ${i})"><i data-lucide="layout" style="width:13px;"></i> ${escapeHtml(label)}</div>`;
    }
  }

  const favCopyItems = App.quickDestinations.map(d => `
    <div class="context-item" onclick="quickTransferToPath('copy', '${escapeHtml(d.path)}')"><i data-lucide="folder" style="width:13px;"></i> ${escapeHtml(d.name)}</div>
  `).join('');

  const favMoveItems = App.quickDestinations.map(d => `
    <div class="context-item" onclick="quickTransferToPath('move', '${escapeHtml(d.path)}')"><i data-lucide="folder" style="width:13px;"></i> ${escapeHtml(d.name)}</div>
  `).join('');

  const selectedCount = App.panes[App.activePaneIndex]?.selected?.size || 1;
  const headerText = selectedCount > 1 ? `⚡ Actions (${selectedCount} items selected)` : `📄 ${escapeHtml(App.contextItem?.name || 'File Actions')}`;

  menu.innerHTML = `
    <div style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: var(--accent); border-bottom: 1px solid var(--border); font-family: var(--font-mono); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
      ${headerText}
    </div>
    <div class="context-item" onclick="triggerView()"><i data-lucide="eye" style="width: 14px;"></i> Quick View (F3)</div>
    <div class="context-item" onclick="triggerMediaInspector()"><i data-lucide="info" style="width: 14px; color: var(--accent);"></i> Media & EXIF Inspector...</div>
    <div class="context-item" onclick="triggerEditor()"><i data-lucide="file-edit" style="width: 14px;"></i> Edit File (F4)</div>
    <div class="context-item" onclick="triggerDiff()"><i data-lucide="git-compare" style="width: 14px;"></i> Compare / Diff</div>
    <div class="context-sep"></div>

    <!-- Color Label Palette & Tags -->
    <div class="context-item context-color-palette-item" style="display: flex; justify-content: space-between; align-items: center; cursor: default;" onclick="event.stopPropagation()">
      <span style="display: flex; align-items: center; gap: 6px;"><i data-lucide="tag" style="width: 14px; color: var(--accent);"></i> Color Label:</span>
      <div class="context-color-palette">
        <span class="color-dot color-red" onclick="setContextFileColor('red')" title="Red (Urgent)"></span>
        <span class="color-dot color-orange" onclick="setContextFileColor('orange')" title="Orange (Pending)"></span>
        <span class="color-dot color-yellow" onclick="setContextFileColor('yellow')" title="Yellow (Review)"></span>
        <span class="color-dot color-green" onclick="setContextFileColor('green')" title="Green (Approved)"></span>
        <span class="color-dot color-blue" onclick="setContextFileColor('blue')" title="Blue (Important)"></span>
        <span class="color-dot color-purple" onclick="setContextFileColor('purple')" title="Purple (Personal)"></span>
        <span class="color-dot color-none" onclick="setContextFileColor('none')" title="Clear Label">✕</span>
      </div>
    </div>
    <div class="context-item" onclick="triggerEditTagsModal()"><i data-lucide="tags" style="width: 14px; color: var(--accent);"></i> Edit Custom Tags...</div>
    <div class="context-sep"></div>

    <div class="context-item" onclick="triggerCopyClipboard()"><i data-lucide="clipboard-copy" style="width: 14px;"></i> Copy to Clipboard (Ctrl+C)</div>
    <div class="context-item" onclick="triggerCutClipboard()"><i data-lucide="scissors" style="width: 14px;"></i> Cut (Ctrl+X)</div>
    <div class="context-item ${App.clipboard ? '' : 'disabled'}" onclick="triggerPaste(App.activePaneIndex)" style="${App.clipboard ? '' : 'opacity: 0.5; pointer-events: none;'}"><i data-lucide="clipboard-paste" style="width: 14px;"></i> Paste (Ctrl+V)</div>
    <div class="context-sep"></div>
    
    <!-- Dynamic Advanced Copy Submenu -->
    <div class="context-item has-submenu" onclick="toggleContextSubmenu(event, this)">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="copy" style="width: 14px;"></i> Quick Copy to...</div>
      <i data-lucide="chevron-right" class="submenu-chevron" style="width: 12px;"></i>
      <div class="context-submenu">
        ${copyPaneItems ? `<div class="submenu-header">Active Panes</div>${copyPaneItems}<div class="context-sep"></div>` : ''}
        <div class="submenu-header">Favorite Destinations</div>
        ${favCopyItems}
        <div class="context-sep"></div>
        <div class="context-item" onclick="openCustomDestModal('copy')"><i data-lucide="folder-symlink" style="width:13px;"></i> Custom Folder...</div>
        <div class="context-item" onclick="addCurrentPaneToQuickDest()"><i data-lucide="bookmark-plus" style="width:13px;"></i> + Bookmark Current Path</div>
      </div>
    </div>

    <!-- Dynamic Advanced Move Submenu -->
    <div class="context-item has-submenu" onclick="toggleContextSubmenu(event, this)">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="move" style="width: 14px;"></i> Quick Move to...</div>
      <i data-lucide="chevron-right" class="submenu-chevron" style="width: 12px;"></i>
      <div class="context-submenu">
        ${movePaneItems ? `<div class="submenu-header">Active Panes</div>${movePaneItems}<div class="context-sep"></div>` : ''}
        <div class="submenu-header">Favorite Destinations</div>
        ${favMoveItems}
        <div class="context-sep"></div>
        <div class="context-item" onclick="openCustomDestModal('move')"><i data-lucide="folder-symlink" style="width:13px;"></i> Custom Folder...</div>
      </div>
    </div>

    <div class="context-item" onclick="triggerRename()"><i data-lucide="edit-3" style="width: 14px;"></i> Rename (F2)</div>
    <div class="context-item" onclick="triggerBulkRename()"><i data-lucide="tags" style="width: 14px; color: var(--accent);"></i> Advanced Bulk Rename... (Shift+F6)</div>
    <div class="context-item" onclick="triggerDelete()"><i data-lucide="trash-2" style="width: 14px;"></i> Delete / Trash (F8)</div>
    <div class="context-sep"></div>

    <!-- Dynamic Custom Script Actions Submenu -->
    <div class="context-item has-submenu" onclick="toggleContextSubmenu(event, this)">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="terminal-square" style="width: 14px; color: var(--accent);"></i> Custom Script Actions</div>
      <i data-lucide="chevron-right" class="submenu-chevron" style="width: 12px;"></i>
      <div class="context-submenu">
        <div class="submenu-header">Shell Actions (conf.d)</div>
        <div class="context-item" onclick="runPredefinedAction('chmod +x &quot;{file}&quot;', 'Make Executable (chmod +x)')"><i data-lucide="shield" style="width:13px;"></i> Make Executable (chmod +x)</div>
        <div class="context-item" onclick="runPredefinedAction('stat &quot;{file}&quot;', 'File Stat Info')"><i data-lucide="info" style="width:13px;"></i> Inspect Stat (stat)</div>
        <div class="context-item" onclick="runPredefinedAction('du -sh &quot;{file}&quot;', 'Disk Usage')"><i data-lucide="hard-drive" style="width:13px;"></i> Check Disk Usage (du -sh)</div>
        <div class="context-item" onclick="runPredefinedAction('git -C &quot;{dir}&quot; log -n 10 --oneline --graph', 'Git Log')"><i data-lucide="git-branch" style="width:13px;"></i> Git Recent Log (git log)</div>
        <div class="context-item" onclick="runPredefinedAction('md5sum &quot;{file}&quot;', 'MD5 Hash')"><i data-lucide="hash" style="width:13px;"></i> Calculate MD5 Hash</div>
        <div class="context-item" onclick="runPredefinedAction('wc -l &quot;{file}&quot;', 'Line Count')"><i data-lucide="list-ordered" style="width:13px;"></i> Count Lines (wc -l)</div>
      </div>
    </div>
    <div class="context-item" onclick="triggerGitManager()"><i data-lucide="git-branch" style="width: 14px; color: var(--accent);"></i> Git Manager & Diff...</div>
    <div class="context-item" onclick="triggerFileSplit()"><i data-lucide="scissors" style="width: 14px; color: var(--accent);"></i> Split Large File...</div>
    <div class="context-item" onclick="triggerFileCombine()"><i data-lucide="merge" style="width: 14px; color: var(--accent);"></i> Combine Part Files (.001, .002)...</div>
    <div class="context-item" onclick="openSyncModal()"><i data-lucide="refresh-cw" style="width: 14px;"></i> Two-Way Directory Sync...</div>
    <div class="context-item" onclick="openDiskUsageModal()"><i data-lucide="pie-chart" style="width: 14px; color: var(--accent);"></i> Disk Usage & Space Analyzer...</div>
    <div class="context-item" onclick="openSearchModal()"><i data-lucide="search" style="width: 14px;"></i> Deep Search in Directory (Ctrl+F)</div>

    <!-- Dock Tool Panel Submenu -->
    <div class="context-item has-submenu" onclick="toggleContextSubmenu(event, this)">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="panel-left-close" style="width: 14px; color: var(--accent);"></i> Dock Tool in this Pane</div>
      <i data-lucide="chevron-right" class="submenu-chevron" style="width: 12px;"></i>
      <div class="context-submenu">
        <div class="submenu-header">Dockable Panels</div>
        <div class="context-item" onclick="dockToolToPane('editor', App.activePaneIndex)"><i data-lucide="file-code" style="width:13px;"></i> 💻 EditorDog Multi-Tab</div>
        <div class="context-item" onclick="dockToolToPane('terminal', App.activePaneIndex)"><i data-lucide="terminal" style="width:13px;"></i> 📟 Terminal Console</div>
        <div class="context-item" onclick="dockToolToPane('calculator', App.activePaneIndex)"><i data-lucide="calculator" style="width:13px;"></i> 🧮 Byte Calculator</div>
        <div class="context-item" onclick="dockToolToPane('tasks', App.activePaneIndex)"><i data-lucide="activity" style="width:13px;"></i> ⚡ Background Transfers</div>
        <div class="context-item" onclick="dockToolToPane('git', App.activePaneIndex)"><i data-lucide="git-branch" style="width:13px;"></i> 🌲 Git Working Tree</div>
      </div>
    </div>

    <div class="context-sep"></div>
    <div class="context-item" onclick="triggerPermissions()"><i data-lucide="lock" style="width: 14px;"></i> Permissions & Ownership</div>
    <div class="context-item" onclick="triggerChecksum()"><i data-lucide="shield-check" style="width: 14px;"></i> Calculate SHA-256 Hash</div>
    <div class="context-item" onclick="triggerArchiveZip()"><i data-lucide="archive" style="width: 14px;"></i> Compress to .zip</div>
    <div class="context-item" onclick="triggerArchiveTarGz()"><i data-lucide="archive" style="width: 14px;"></i> Compress to .tar.gz</div>
    <div class="context-item" onclick="triggerExtract()"><i data-lucide="folder-archive" style="width: 14px;"></i> Extract Archive Here</div>
  `;

  if (window.lucide) lucide.createIcons();

  menu.style.display = 'block';

  const backdrop = document.getElementById('context-menu-backdrop');
  const actBtn = document.getElementById('mob-btn-actions');

  if (window.innerWidth <= 768) {
    // Mobile Bottom Sheet positioning
    if (backdrop) backdrop.classList.add('active');
    if (actBtn) actBtn.classList.add('active');
    menu.classList.remove('submenu-flip-left');
    menu.style.position = 'fixed';
    menu.style.left = '10px';
    menu.style.right = '10px';
    menu.style.width = 'calc(100vw - 20px)';
    menu.style.maxHeight = '70vh';
    menu.style.overflowY = 'auto';
    menu.style.overflowX = 'hidden';
    menu.style.bottom = '56px';
    menu.style.top = 'auto';
    menu.style.borderRadius = '12px';
  } else {
    if (backdrop) backdrop.classList.remove('active');
    if (x > window.innerWidth - 480) {
      menu.classList.add('submenu-flip-left');
    } else {
      menu.classList.remove('submenu-flip-left');
    }
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 380)}px`;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.maxHeight = 'none';
  }
}

function toggleContextSubmenu(e, itemEl) {
  if (window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches) {
    e.stopPropagation();
    const isOpen = itemEl.classList.contains('expanded');
    const menu = itemEl.closest('.context-menu');
    if (menu) {
      menu.querySelectorAll('.context-item.has-submenu.expanded').forEach(el => {
        if (el !== itemEl) el.classList.remove('expanded');
      });
    }
    itemEl.classList.toggle('expanded', !isOpen);
  }
}

function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu) menu.style.display = 'none';
  const backdrop = document.getElementById('context-menu-backdrop');
  if (backdrop) backdrop.classList.remove('active');
  const actBtn = document.getElementById('mob-btn-actions');
  if (actBtn) actBtn.classList.remove('active');
}

function showTouchActionsMenu(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }

  const menu = document.getElementById('context-menu');
  // ON/OFF toggle: if context menu is currently open, toggle it off
  if (menu && menu.style.display === 'block') {
    hideContextMenu();
    return;
  }

  const pane = App.panes[App.activePaneIndex];
  if (!pane) return;

  if (pane.selected.size === 0) {
    showEmptySpaceContextMenu(window.innerWidth / 2, window.innerHeight - 100, App.activePaneIndex);
    return;
  }

  const firstPath = Array.from(pane.selected)[0];
  const entry = pane.entries.find(it => it.path === firstPath) || { path: firstPath, name: firstPath.split('/').pop() };
  App.contextItem = entry;
  App.contextPaneIndex = App.activePaneIndex;

  showContextMenu(window.innerWidth / 2, window.innerHeight - 100);
}

function showEmptySpaceContextMenu(x, y, paneIndex) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;

  const pane = App.panes[paneIndex];
  const clipInfo = App.clipboard ? `(${App.clipboard.paths.length} item${App.clipboard.paths.length > 1 ? 's' : ''})` : '';

  menu.innerHTML = `
    <div style="padding: 6px 12px; font-size: 11px; font-weight: 700; color: var(--accent); border-bottom: 1px solid var(--border); font-family: var(--font-mono); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; display: flex; align-items: center; gap: 6px;">
      <img src="assets/folder-closed.png" style="width: 14px; height: 14px;">
      <span>${escapeHtml(pane.path.split('/').pop() || pane.path || '/')}</span>
    </div>
    <div class="context-item" onclick="openSpotlightModal()"><i data-lucide="sparkles" style="width: 14px; color: var(--accent);"></i> Spotlight Quick-Switcher (Ctrl+K)...</div>
    <div class="context-item" onclick="toggleBranchView(${paneIndex})"><i data-lucide="git-branch" style="width: 14px; color: var(--accent);"></i> Flat / Branch View (Ctrl+B)</div>
    <div class="context-item" onclick="triggerDeviceUpload(${paneIndex})"><i data-lucide="upload-cloud" style="width: 14px; color: #38bdf8;"></i> Upload Files from Device...</div>
    <div class="context-item" onclick="triggerDeviceFolderUpload(${paneIndex})"><i data-lucide="folder-up" style="width: 14px; color: #38bdf8;"></i> Upload Folder from Device...</div>
    <div class="context-item" onclick="triggerDownloadCurrentDirectory(${paneIndex})"><i data-lucide="download" style="width: 14px;"></i> Download Directory (.zip)</div>
    <div class="context-item" onclick="triggerShareDirectory(${paneIndex})"><i data-lucide="share-2" style="width: 14px; color: var(--accent);"></i> Share Directory / Guest Dropbox...</div>
    <div class="context-sep"></div>
    <div class="context-item" onclick="triggerMkdir()"><i data-lucide="folder-plus" style="width: 14px;"></i> New Folder... (F7)</div>
    <div class="context-item" onclick="triggerNewFile()"><i data-lucide="file-plus" style="width: 14px;"></i> New Text File...</div>
    <div class="context-item ${App.clipboard ? '' : 'disabled'}" onclick="triggerPaste(${paneIndex})" style="${App.clipboard ? '' : 'opacity: 0.5; pointer-events: none;'}">
      <i data-lucide="clipboard-paste" style="width: 14px;"></i> Paste ${clipInfo} (Ctrl+V)
    </div>
    <div class="context-item" onclick="refreshPane(${paneIndex})"><i data-lucide="rotate-cw" style="width: 14px;"></i> Refresh Directory</div>
    <div class="context-sep"></div>
    <div class="context-item" onclick="openTerminalInPath('${escapeHtml(pane.path)}')"><i data-lucide="terminal" style="width: 14px; color: var(--accent);"></i> Open in Terminal (\`)</div>
    <div class="context-item" onclick="openSearchModal()"><i data-lucide="search" style="width: 14px;"></i> Deep Search in Directory (Ctrl+F)</div>
    <div class="context-item" onclick="openSyncModal()"><i data-lucide="refresh-cw" style="width: 14px;"></i> Two-Way Directory Sync...</div>
    <div class="context-item" onclick="openDiskUsageModal('${escapeHtml(pane.path)}')"><i data-lucide="pie-chart" style="width: 14px; color: var(--accent);"></i> Disk Usage & Treemap Analyzer...</div>
    <div class="context-item" onclick="openRemoteModal(${paneIndex})"><i data-lucide="network" style="width: 14px;"></i> Mount Remote Storage Here...</div>
    <div class="context-item" onclick="addCurrentPaneToQuickDest()"><i data-lucide="bookmark-plus" style="width: 14px;"></i> Bookmark Current Path</div>
    <div class="context-sep"></div>
    <div class="context-item" onclick="triggerDirPermissions(${paneIndex})"><i data-lucide="lock" style="width: 14px;"></i> Directory Permissions & Ownership</div>
    <div class="context-item" onclick="runPredefinedAction('du -sh &quot;{dir}&quot;', 'Directory Disk Usage')"><i data-lucide="hard-drive" style="width: 14px;"></i> Check Disk Usage (du -sh)</div>
  `;

  if (window.lucide) lucide.createIcons();

  menu.style.display = 'block';

  const backdrop = document.getElementById('context-menu-backdrop');
  const actBtn = document.getElementById('mob-btn-actions');

  if (window.innerWidth <= 768) {
    if (backdrop) backdrop.classList.add('active');
    if (actBtn) actBtn.classList.add('active');
    menu.style.position = 'fixed';
    menu.style.left = '10px';
    menu.style.right = '10px';
    menu.style.width = 'calc(100vw - 20px)';
    menu.style.maxHeight = '70vh';
    menu.style.overflowY = 'auto';
    menu.style.bottom = '56px';
    menu.style.top = 'auto';
    menu.style.borderRadius = '12px';
  } else {
    if (backdrop) backdrop.classList.remove('active');
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(x, window.innerWidth - 250)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 380)}px`;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.maxHeight = 'none';
  }
}


function triggerCopyClipboard() {
  const paths = getSelectedOrCursorPaths();
  if (paths.length === 0) return;
  App.clipboard = { action: 'copy', paths };
  showToast(`Copied ${paths.length} item(s) to clipboard`, 'info');
}

function triggerCutClipboard() {
  const paths = getSelectedOrCursorPaths();
  if (paths.length === 0) return;
  App.clipboard = { action: 'cut', paths };
  showToast(`Cut ${paths.length} item(s) to clipboard`, 'info');
}

async function triggerPaste(targetPaneIdx = App.activePaneIndex) {
  if (!App.clipboard || !App.clipboard.paths || App.clipboard.paths.length === 0) {
    showToast('Clipboard is empty. Copy or Cut items first (Ctrl+C / Ctrl+X).', 'warning');
    return;
  }

  const targetPane = App.panes[targetPaneIdx];
  const action = App.clipboard.action;
  const paths = App.clipboard.paths;

  await executeTransfer(action, paths, targetPane.path, targetPaneIdx);

  if (action === 'cut') {
    App.clipboard = null;
  }
}

function triggerGitManager() {
  openGitManager(App.activePaneIndex);
}

function triggerFileSplit() {
  const item = getActiveOrFirstSelectedItem();
  if (!item || item.is_dir) {
    showToast('Please select a file to split', 'warning');
    return;
  }
  openFileSplitterModal(item.path, item.size);
}

function triggerFileCombine() {
  const pane = App.panes[App.activePaneIndex];
  if (!pane) return;

  const selPaths = Array.from(pane.selected);
  let parts = [];

  if (selPaths.length > 0) {
    parts = selPaths.filter(p => /\.\d{3}$/.test(p) || /\.part\d+/i.test(p));
  }
  
  if (parts.length === 0 && pane.entries) {
    // Auto-detect part files in current pane
    parts = pane.entries
      .filter(e => !e.is_dir && (/\.\d{3}$/.test(e.name) || /\.part\d+/i.test(e.name)))
      .map(e => e.path);
  }

  if (parts.length === 0) {
    showToast('No multi-part files (.001, .002...) detected in pane', 'info');
    openFileCombinerModal([]);
    return;
  }

  openFileCombinerModal(parts);
}

async function triggerNewFile() {
  const name = await showPromptDialog({
    title: 'Create New File',
    subtitle: 'Text document or script',
    message: 'Enter name for the new file:',
    placeholder: 'notes.txt, script.py, config.yaml...',
    confirmText: 'Create & Edit',
    cancelText: 'Cancel'
  });
  if (!name || !name.trim()) return;
  const pane = App.panes[App.activePaneIndex];
  const newFilePath = `${pane.path.replace(/\/$/, '')}/${name.trim()}`;

  try {
    const resp = await fetch('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ path: newFilePath, content: '' })
    });

    if (resp.ok) {
      showToast(`Created '${name.trim()}'`, 'success');
      refreshPane(App.activePaneIndex);
      openEditorWithFile(newFilePath);
    } else {
      showToast(`Failed to create file: ${await resp.text()}`, 'error');
    }
  } catch (e) {
    showToast(`Error: ${e}`, 'error');
  }
}

function triggerDirPermissions(paneIndex = App.activePaneIndex) {
  const pane = App.panes[paneIndex];
  App.contextItem = {
    name: pane.path.split('/').pop() || pane.path,
    path: pane.path,
    is_dir: true,
    mode_octal: '0755',
    owner: 'root',
    group: 'root'
  };
  App.contextPaneIndex = paneIndex;
  triggerPermissions();
}

function openTerminalInPath(path) {
  toggleTerminal(true);
  if (termWs && termWs.readyState === WebSocket.OPEN && path) {
    termWs.send(`cd "${path.replace(/"/g, '\\"')}" && clear\n`);
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu') && !e.target.closest('#mob-btn-actions')) {
    hideContextMenu();
  }
});

window.addEventListener('popstate', () => {
  hideContextMenu();
});

function getSelectedOrCursorPaths() {
  const pane = App.panes[App.activePaneIndex];
  if (pane.selected.size > 0) return Array.from(pane.selected);
  if (App.contextItem) return [App.contextItem.path];
  if (pane.entries[pane.cursorIndex]) return [pane.entries[pane.cursorIndex].path];
  return [];
}

function quickTransferToPane(action, targetPaneIdx) {
  const paths = getSelectedOrCursorPaths();
  if (paths.length === 0) return;
  const targetPane = App.panes[targetPaneIdx];
  executeTransfer(action, paths, targetPane.path, targetPaneIdx);
}

function quickTransferToPath(action, destPath) {
  const paths = getSelectedOrCursorPaths();
  if (paths.length === 0) return;
  executeTransfer(action, paths, destPath, -1);
}

let customDestAction = 'copy';

function openCustomDestModal(action) {
  customDestAction = action;
  document.getElementById('custom-dest-title').textContent = action === 'move' ? '✂️ Move to Custom Destination' : '📋 Copy to Custom Destination';
  document.getElementById('btn-custom-dest-exec').textContent = action === 'move' ? 'Move Items' : 'Copy Items';
  showModal('custom-dest-modal');
  document.getElementById('custom-dest-input')?.focus();
}

function executeCustomDestTransfer() {
  const dest = document.getElementById('custom-dest-input').value.trim();
  if (!dest) {
    showToast('Please provide a destination directory path', 'warning');
    return;
  }

  const saveFav = document.getElementById('custom-dest-save-fav').checked;
  if (saveFav) {
    addCustomDestination(dest.split('/').pop() || dest, dest);
  }

  closeModal('custom-dest-modal');
  quickTransferToPath(customDestAction, dest);
}

// ---------------- BOOKMARKS & REMOTE AUTHENTICATION ----------------

let pendingRemoteAuth = null;

function promptRemoteCredentials(paneIndex, targetPath) {
  pendingRemoteAuth = { paneIndex, targetPath };
  const desc = document.getElementById('remote-auth-desc');
  const userIn = document.getElementById('remote-auth-user');
  const passIn = document.getElementById('remote-auth-pass');

  const safeUri = sanitizeCredentials(targetPath);
  if (desc) desc.textContent = `Please enter credentials for remote destination: ${safeUri}`;
  if (userIn) userIn.value = App.user?.username || 'root';
  if (passIn) passIn.value = '';

  showModal('remote-auth-modal');
  setTimeout(() => passIn?.focus(), 100);
}

function submitRemoteAuth() {
  if (!pendingRemoteAuth) return;
  const user = document.getElementById('remote-auth-user')?.value || '';
  const pass = document.getElementById('remote-auth-pass')?.value || '';
  const remember = document.getElementById('remote-auth-remember')?.checked;

  const { paneIndex, targetPath } = pendingRemoteAuth;
  closeModal('remote-auth-modal');
  pendingRemoteAuth = null;

  let authUri = targetPath;
  if (targetPath.startsWith('smb://')) {
    const clean = targetPath.slice(6);
    const parts = clean.split('/');
    const host = parts[0].includes('@') ? parts[0].split('@')[1] : parts[0];
    const rest = parts.slice(1).join('/');
    authUri = `smb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${rest}`;
  } else if (targetPath.startsWith('sftp://')) {
    const clean = targetPath.slice(7);
    const parts = clean.split('/');
    const hostPort = parts[0].includes('@') ? parts[0].split('@')[1] : parts[0];
    const rest = parts.slice(1).join('/');
    authUri = `sftp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostPort}/${rest}`;
  }

  if (remember) {
    App.sessionCredentials = App.sessionCredentials || {};
    App.sessionCredentials[targetPath] = { user, pass, authUri };
  }

  loadPaneDirectory(paneIndex, authUri);
}

function navigateToBookmark(encodedPath, hasPassword, protocol) {
  const path = decodeURIComponent(encodedPath);
  const paneIndex = App.activePaneIndex;

  if (protocol === 'web' || path.startsWith('http://') || path.startsWith('https://')) {
    window.open(path, '_blank', 'noopener,noreferrer');
    showToast(`🌐 Opened "${path}" in new browser tab`, 'info');
    return;
  }

  if (protocol === 'local' || protocol === 'nfs' || hasPassword || path.startsWith('/')) {
    loadPaneDirectory(paneIndex, path);
    return;
  }

  if (App.sessionCredentials && App.sessionCredentials[path]) {
    loadPaneDirectory(paneIndex, App.sessionCredentials[path].authUri || path);
    return;
  }

  promptRemoteCredentials(paneIndex, path);
}

async function loadBookmarksList() {
  const tbody = document.getElementById('bookmarks-table-body');
  if (!tbody) return;
  
  try {
    const resp = await fetch('/api/bookmarks', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const list = await resp.json();
      App.bookmarks = list;
      try { localStorage.setItem('cd_bookmarks_cache', JSON.stringify(list)); } catch (e) {}
      
      if (list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align: center; color: var(--text-dim); padding: 16px;">
              No custom bookmarks saved yet. Click "+ Add Bookmark" to bookmark local folders, web URLs, or network shares.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = list.map(b => {
        const isWeb = b.protocol === 'web' || b.path.startsWith('http://') || b.path.startsWith('https://');
        const protoBadge = isWeb 
          ? `<span class="badge" style="font-size: 10px; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); text-transform: uppercase;">WEB URL</span>`
          : `<span class="badge" style="font-size: 10px; text-transform: uppercase;">${escapeHtml(b.protocol)}</span>`;
        const safePath = sanitizeCredentials(b.path);
        const passBadge = b.has_password ? `<span title="Stored with password" style="color: #22c55e; margin-left: 4px;">🔑</span>` : (isWeb ? '' : `<span title="Prompts on session access" style="color: var(--text-dim); margin-left: 4px;">🔒</span>`);
        const jumpLabel = isWeb ? 'Open Tab' : 'Jump';
        const jumpIcon = isWeb ? 'external-link' : 'folder';

        return `
          <tr>
            <td><strong>${escapeHtml(b.name)}</strong> ${passBadge}</td>
            <td>${protoBadge}</td>
            <td><code>${escapeHtml(safePath)}</code></td>
            <td>
              <div style="display: flex; gap: 4px;">
                <button class="btn btn-sm ${isWeb ? 'btn-accent' : ''}" onclick="navigateToBookmark('${encodeURIComponent(b.path)}', ${b.has_password}, '${b.protocol}'); closeModal('settings-modal');" title="${isWeb ? 'Open URL in new tab' : 'Jump to destination'}">
                  <i data-lucide="${jumpIcon}" style="width: 12px; height: 12px;"></i> ${jumpLabel}
                </button>
                <button class="btn btn-sm btn-icon btn-danger" onclick="deleteBookmark(${b.id})" title="Delete Bookmark">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      if (window.lucide) lucide.createIcons();
    }
  } catch (e) {
    console.error('Failed to load bookmarks:', e);
  }
}

function addNewBookmark(prefillPath = null, prefillName = null) {
  const modal = document.getElementById('bookmark-modal');
  if (!modal) return;

  const pathInput = document.getElementById('bm-input-path');
  const nameInput = document.getElementById('bm-input-name');
  const protoSelect = document.getElementById('bm-select-protocol');
  const passInput = document.getElementById('bm-input-password');

  const rawPath = prefillPath ? decodeURIComponent(prefillPath) : (App.panes[App.activePaneIndex]?.path || '/home/bolt');
  if (pathInput) pathInput.value = sanitizeCredentials(rawPath);

  let proto = 'local';
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) proto = 'web';
  else if (rawPath.startsWith('smb://')) proto = 'smb';
  else if (rawPath.startsWith('sftp://')) proto = 'sftp';
  else if (rawPath.startsWith('nfs://')) proto = 'nfs';
  else if (rawPath.startsWith('webdav://')) proto = 'webdav';
  else if (rawPath.startsWith('s3://')) proto = 's3';
  else if (rawPath.startsWith('proton://')) proto = 'proton';

  if (protoSelect) protoSelect.value = proto;

  if (nameInput) {
    if (prefillName) {
      nameInput.value = prefillName;
    } else {
      const parts = rawPath.split('/').filter(Boolean);
      nameInput.value = parts.pop() || (proto === 'local' ? 'Root' : `${proto.toUpperCase()} Share`);
    }
  }

  if (passInput) passInput.value = '';

  onBookmarkProtocolChange();
  showModal('bookmark-modal');
  setTimeout(() => nameInput?.focus(), 100);
}

function onBookmarkProtocolChange() {
  const proto = document.getElementById('bm-select-protocol')?.value;
  const passGroup = document.getElementById('bm-password-group');
  const webGroup = document.getElementById('bm-web-target-group');
  const pathLabel = document.getElementById('bm-label-path');
  const pathInput = document.getElementById('bm-input-path');

  if (passGroup) {
    passGroup.style.display = (proto === 'smb' || proto === 'sftp' || proto === 'webdav' || proto === 's3') ? 'block' : 'none';
  }

  if (webGroup) {
    webGroup.style.display = (proto === 'web') ? 'block' : 'none';
  }

  if (pathLabel && pathInput) {
    if (proto === 'web') {
      pathLabel.textContent = 'Web URL / Link:';
      if (!pathInput.value || pathInput.value.startsWith('/')) pathInput.placeholder = 'https://github.com/Woofson/commanderdog';
    } else if (proto === 'smb') {
      pathLabel.textContent = 'SMB Share URI:';
      if (!pathInput.value.startsWith('smb://')) pathInput.placeholder = 'smb://192.168.1.100/share';
    } else if (proto === 'sftp') {
      pathLabel.textContent = 'SFTP Server URI:';
      if (!pathInput.value.startsWith('sftp://')) pathInput.placeholder = 'sftp://user@host:22/path';
    } else if (proto === 'nfs') {
      pathLabel.textContent = 'NFS Export URI:';
      if (!pathInput.value.startsWith('nfs://')) pathInput.placeholder = 'nfs://host/export_path';
    } else if (proto === 'webdav') {
      pathLabel.textContent = 'WebDAV URL:';
      if (!pathInput.value.startsWith('webdav://')) pathInput.placeholder = 'webdav://host/remote.php/webdav';
    } else if (proto === 's3') {
      pathLabel.textContent = 'S3 Bucket URI:';
      if (!pathInput.value.startsWith('s3://')) pathInput.placeholder = 's3://bucket-name/folder';
    } else if (proto === 'proton') {
      pathLabel.textContent = 'Proton Drive URI:';
      if (!pathInput.value.startsWith('proton://')) pathInput.placeholder = 'proton:///folder';
    } else {
      pathLabel.textContent = 'Local Path:';
      pathInput.placeholder = '/home/bolt/Documents';
    }
  }
}

async function saveBookmarkFromModal() {
  const name = document.getElementById('bm-input-name')?.value?.trim();
  const protocol = document.getElementById('bm-select-protocol')?.value || 'local';
  let path = document.getElementById('bm-input-path')?.value?.trim();
  const password = document.getElementById('bm-input-password')?.value?.trim() || null;

  if (!name || !path) {
    showToast('Please enter both bookmark name and target path', 'warning');
    return;
  }

  try {
    const resp = await fetch('/api/bookmarks', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${App.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, protocol, path, password })
    });

    if (resp.ok) {
      closeModal('bookmark-modal');
      showToast(`Bookmark "${name}" saved!`, 'success');
      loadBookmarksList();
    } else {
      const err = await resp.text();
      showToast(`Failed to save bookmark: ${err}`, 'error');
    }
  } catch (e) {
    showToast('Network error saving bookmark', 'error');
  }
}

async function deleteBookmark(id) {
  try {
    const resp = await fetch(`/api/bookmarks/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      showToast('Bookmark deleted', 'info');
      loadBookmarksList();
    } else {
      showToast('Failed to delete bookmark', 'error');
    }
  } catch (e) {
    showToast('Error deleting bookmark', 'error');
  }
}

async function addCurrentPaneToQuickDest() {
  const currentPath = App.panes[App.activePaneIndex]?.path || '/';
  addNewBookmark(encodeURIComponent(currentPath));
}

// ---------------- SESSION LOCK & INACTIVITY WATCHER ----------------

let lastUserActivityTime = Date.now();

function lockSession() {
  App.isLocked = true;
  localStorage.setItem('cd_is_locked', 'true');
  const lockScreen = document.getElementById('session-lock-screen');
  const userLabel = document.getElementById('lock-username-label');
  const avatarEl = document.getElementById('lock-avatar-thumb');
  const passIn = document.getElementById('unlock-password-input');
  const errMsg = document.getElementById('unlock-error-msg');

  if (userLabel) userLabel.textContent = App.user?.nickname || App.user?.username || 'CommanderDog User';
  if (avatarEl) renderAvatarElement(avatarEl, App.user?.avatar_url || '👤');
  if (passIn) passIn.value = '';
  if (errMsg) errMsg.style.display = 'none';

  if (lockScreen) {
    lockScreen.classList.add('active');
    lockScreen.style.display = 'flex';
  }
  setTimeout(() => passIn?.focus(), 150);
}

async function submitUnlockSession() {
  const passIn = document.getElementById('unlock-password-input');
  const errMsg = document.getElementById('unlock-error-msg');
  const pass = passIn?.value || '';

  if (!pass) return;

  try {
    const resp = await fetch('/api/auth/unlock', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${App.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: pass })
    });

    if (resp.ok) {
      App.isLocked = false;
      localStorage.removeItem('cd_is_locked');
      lastUserActivityTime = Date.now();
      const lockScreen = document.getElementById('session-lock-screen');
      if (lockScreen) {
        lockScreen.classList.remove('active');
        lockScreen.style.display = 'none';
      }
      if (passIn) passIn.value = '';

      // If panes are not yet rendered (e.g. page refreshed while locked), render them now
      const container = document.getElementById('panes-grid');
      if (container && container.children.length === 0) {
        renderAllPanes();
      }

      showToast('Session unlocked. Welcome back!', 'success');
    } else {
      const errText = await resp.text();
      const isTokenExpired = errText.toLowerCase().includes('token') || 
                             errText.toLowerCase().includes('expired') || 
                             errText.toLowerCase().includes('unauthorized') ||
                             (resp.status === 401 && !errText.toLowerCase().includes('password'));

      if (isTokenExpired) {
        if (errMsg) {
          errMsg.innerHTML = `⚠️ <strong>Session has expired.</strong> Please log in again to continue.<br><button type="button" class="btn btn-sm btn-accent" style="margin-top: 8px; width: 100%; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="logout()"><i data-lucide="log-in" style="width: 14px; height: 14px;"></i> Go to Login</button>`;
          errMsg.style.display = 'block';
          if (window.lucide) lucide.createIcons({ root: errMsg });
        }
      } else {
        if (errMsg) {
          errMsg.textContent = 'Invalid password. Please try again.';
          errMsg.style.display = 'block';
        }
        passIn?.select();
      }
    }
  } catch (e) {
    if (errMsg) {
      errMsg.textContent = 'Connection error during unlock.';
      errMsg.style.display = 'block';
    }
  }
}

function initInactivityTracker() {
  const updateActivity = () => {
    if (!App.isLocked) {
      lastUserActivityTime = Date.now();
    }
  };

  window.addEventListener('mousemove', updateActivity, { passive: true });
  window.addEventListener('keydown', updateActivity, { passive: true });
  window.addEventListener('touchstart', updateActivity, { passive: true });
  window.addEventListener('pointerdown', updateActivity, { passive: true });
  window.addEventListener('click', updateActivity, { passive: true });
  window.addEventListener('scroll', updateActivity, { passive: true });

  setInterval(() => {
    if (!App.token) return;
    const settings = App.securitySettings || {
      auto_lock_enabled: true,
      auto_lock_minutes: 15,
      session_timeout_hours: 8,
      lock_prevented_by_tasks: true
    };

    const idleMinutes = (Date.now() - lastUserActivityTime) / (60 * 1000);
    const idleHours = idleMinutes / 60;

    // 1. Auto-Lock when not yet locked
    if (!App.isLocked && settings.auto_lock_enabled && idleMinutes >= settings.auto_lock_minutes) {
      const isTaskRunning = lastKnownTasksList && lastKnownTasksList.some(t => t.status === 'running');
      if (isTaskRunning && settings.lock_prevented_by_tasks) {
        return;
      }
      lockSession();
    }

    // 2. Session Timeout Expiration (even if locked)
    if (idleHours >= settings.session_timeout_hours) {
      const isTaskRunning = lastKnownTasksList && lastKnownTasksList.some(t => t.status === 'running');
      if (!isTaskRunning) {
        if (App.isLocked) {
          const errMsg = document.getElementById('unlock-error-msg');
          const passIn = document.getElementById('unlock-password-input');
          if (errMsg) {
            errMsg.innerHTML = `⚠️ <strong>Session timed out due to inactivity.</strong> Please log in again.<br><button type="button" class="btn btn-sm btn-accent" style="margin-top: 8px; width: 100%; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="logout()"><i data-lucide="log-in" style="width: 14px; height: 14px;"></i> Go to Login</button>`;
            errMsg.style.display = 'block';
            if (window.lucide) lucide.createIcons({ root: errMsg });
          }
          if (passIn) passIn.disabled = true;
        } else {
          logout();
        }
      }
    }
  }, 15000);
}

async function loadAdminSecuritySettings() {
  try {
    const resp = await fetch('/api/auth/security-settings', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const s = await resp.json();
      App.securitySettings = s;
      const elLock = document.getElementById('setting-autolock-enabled');
      const elMins = document.getElementById('setting-autolock-minutes');
      const elHours = document.getElementById('setting-session-hours');
      const elPrevent = document.getElementById('setting-autolock-prevent-tasks');

      if (elLock) elLock.checked = s.auto_lock_enabled;
      if (elMins) elMins.value = String(s.auto_lock_minutes);
      if (elHours) elHours.value = String(s.session_timeout_hours);
      if (elPrevent) elPrevent.checked = s.lock_prevented_by_tasks;
    }
  } catch (e) {
    console.warn('Failed to load security settings:', e);
  }
}

async function saveAdminSecuritySettings() {
  const auto_lock_enabled = document.getElementById('setting-autolock-enabled')?.checked ?? true;
  const auto_lock_minutes = parseInt(document.getElementById('setting-autolock-minutes')?.value || '15', 10);
  const session_timeout_hours = parseInt(document.getElementById('setting-session-hours')?.value || '8', 10);
  const lock_prevented_by_tasks = document.getElementById('setting-autolock-prevent-tasks')?.checked ?? true;

  const payload = {
    auto_lock_enabled,
    auto_lock_minutes,
    session_timeout_hours,
    lock_prevented_by_tasks
  };

  try {
    const resp = await fetch('/api/auth/security-settings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${App.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      App.securitySettings = payload;
      showToast('Security and auto-lock policies saved!', 'success');
    } else {
      showToast('Failed to save security settings', 'error');
    }
  } catch (e) {
    showToast('Network error saving security settings', 'error');
  }
}

function setupEventListeners() {
  document.getElementById('layout-1')?.addEventListener('click', () => switchLayout('layout-single'));
  document.getElementById('layout-2v')?.addEventListener('click', () => switchLayout('layout-dual-vertical'));
  document.getElementById('layout-2h')?.addEventListener('click', () => switchLayout('layout-dual-horizontal'));
  document.getElementById('layout-3')?.addEventListener('click', () => switchLayout('layout-triple'));
  document.getElementById('layout-4')?.addEventListener('click', () => switchLayout('layout-quad'));
  updateActiveLayoutUI(App.layout);

  document.getElementById('paranoid-toggle')?.addEventListener('click', () => {
    App.paranoidMode = !App.paranoidMode;
    updateParanoidBadge();
  });

  document.getElementById('btn-custom-dest-exec')?.addEventListener('click', executeCustomDestTransfer);

  document.getElementById('theme-selector')?.addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  document.getElementById('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLoginSubmit();
  });
  document.getElementById('login-password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLoginSubmit();
    }
  });
  document.getElementById('login-username')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('login-password')?.focus();
    }
  });
  document.getElementById('btn-submit-login')?.addEventListener('click', handleLoginSubmit);
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    localStorage.removeItem('cd_token');
    location.reload();
  });

  setupTouchGestures();
}

function switchLayout(layoutName) {
  App.layout = layoutName;
  localStorage.setItem('cd_layout', layoutName);
  updateActiveLayoutUI(layoutName);
  renderAllPanes();
}

function updateActiveLayoutUI(layoutName) {
  const map = {
    'layout-single': 'layout-1',
    'layout-dual-vertical': 'layout-2v',
    'layout-dual-horizontal': 'layout-2h',
    'layout-triple': 'layout-3',
    'layout-quad': 'layout-4'
  };
  ['layout-1', 'layout-2v', 'layout-2h', 'layout-3', 'layout-4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const activeId = map[layoutName] || 'layout-2v';
  const activeEl = document.getElementById(activeId);
  if (activeEl) activeEl.classList.add('active');
}

function updateParanoidBadge() {
  const badge = document.getElementById('paranoid-toggle');
  if (badge) {
    if (App.paranoidMode) {
      badge.classList.remove('disabled');
      const span = badge.querySelector('span');
      if (span) span.textContent = 'PARANOID MODE: ON';
    } else {
      badge.classList.add('disabled');
      const span = badge.querySelector('span');
      if (span) span.textContent = 'PARANOID MODE: OFF';
    }
  }

  const shieldBtn = document.getElementById('profile-paranoid-shield');
  if (shieldBtn) {
    if (App.paranoidMode) {
      shieldBtn.classList.add('active');
      shieldBtn.title = 'Paranoid Mode: Active (Click for Settings)';
    } else {
      shieldBtn.classList.remove('active');
      shieldBtn.title = 'Paranoid Mode: Disabled (Click for Settings)';
    }
  }
}

function openParanoidSettings() {
  const profileMenu = document.getElementById('profile-dropdown-menu');
  if (profileMenu) profileMenu.classList.remove('active');
  openSettingsModal();
  switchSettingsTab('tab-security');
}

function applyBorderSettings(borderWidth, ringStyle) {
  if (borderWidth !== undefined && borderWidth !== null) {
    localStorage.setItem('cd_border_width', borderWidth);
  } else {
    borderWidth = localStorage.getItem('cd_border_width') || '1px';
  }

  if (ringStyle !== undefined && ringStyle !== null) {
    localStorage.setItem('cd_ring_style', ringStyle);
  } else {
    ringStyle = localStorage.getItem('cd_ring_style') || 'subtle';
  }

  const root = document.documentElement;
  root.style.setProperty('--pane-border-width', borderWidth);

  if (ringStyle === 'none') {
    root.style.setProperty('--pane-active-ring-width', '0px');
  } else if (ringStyle === 'bold') {
    root.style.setProperty('--pane-active-ring-width', '2px');
  } else if (ringStyle === 'glow') {
    root.style.setProperty('--pane-active-ring-width', '1.5px');
  } else { // 'subtle' default
    root.style.setProperty('--pane-active-ring-width', '1px');
  }

  const borderSelect = document.getElementById('setting-border-width');
  if (borderSelect) borderSelect.value = borderWidth;

  const ringSelect = document.getElementById('setting-ring-style');
  if (ringSelect) ringSelect.value = ringStyle;
}

function applyTheme(themeId) {
  localStorage.setItem('cd_theme', themeId);
  const sel = document.getElementById('theme-selector');
  const selSettings = document.getElementById('settings-theme-selector');
  if (sel) sel.value = themeId;
  if (selSettings) selSettings.value = themeId;

  const root = document.documentElement;

  // Update active state on visual swatch cards
  document.querySelectorAll('.theme-swatch-card').forEach(card => {
    if (card.id === `theme-card-${themeId}`) card.classList.add('active');
    else card.classList.remove('active');
  });

  // 1. Check dynamic themes loaded from App.config.themes.themes (built-in + ~/.config/commanderdog/themes/)
  const customTheme = App.config?.themes?.themes?.find(t => t.id === themeId);
  if (customTheme) {
    root.style.setProperty('--bg-dark', customTheme.bg_dark);
    root.style.setProperty('--bg-panel', customTheme.bg_panel);
    root.style.setProperty('--bg-header', customTheme.bg_active || customTheme.bg_panel);
    root.style.setProperty('--bg-active', customTheme.bg_active);
    root.style.setProperty('--border', customTheme.border);
    root.style.setProperty('--accent', customTheme.accent);
    root.style.setProperty('--accent-hover', customTheme.accent_hover || customTheme.accent);
    root.style.setProperty('--text-main', customTheme.text_main);
    root.style.setProperty('--text-muted', customTheme.text_muted);
    return;
  }

  if (themeId === 'gruvbox') {
    root.style.setProperty('--bg-dark', '#1d2021');
    root.style.setProperty('--bg-panel', '#282828');
    root.style.setProperty('--bg-header', '#3c3836');
    root.style.setProperty('--bg-active', '#504945');
    root.style.setProperty('--border', '#504945');
    root.style.setProperty('--accent', '#fabd2f');
    root.style.setProperty('--accent-hover', '#fe8019');
    root.style.setProperty('--text-main', '#ebdbb2');
    root.style.setProperty('--text-muted', '#a89984');
  } else if (themeId === 'catppuccin-mocha') {
    root.style.setProperty('--bg-dark', '#181825');
    root.style.setProperty('--bg-panel', '#1e1e2e');
    root.style.setProperty('--bg-header', '#313244');
    root.style.setProperty('--bg-active', '#45475a');
    root.style.setProperty('--border', '#45475a');
    root.style.setProperty('--accent', '#cba6f7');
    root.style.setProperty('--accent-hover', '#f5c2e7');
    root.style.setProperty('--text-main', '#cdd6f4');
    root.style.setProperty('--text-muted', '#a6adc8');
  } else if (themeId === 'catppuccin-latte') {
    root.style.setProperty('--bg-dark', '#dce0e8');
    root.style.setProperty('--bg-panel', '#eff1f5');
    root.style.setProperty('--bg-header', '#e6e9ef');
    root.style.setProperty('--bg-active', '#ccd0da');
    root.style.setProperty('--border', '#bcc0cc');
    root.style.setProperty('--accent', '#8839ef');
    root.style.setProperty('--accent-hover', '#1e66f5');
    root.style.setProperty('--text-main', '#4c4f69');
    root.style.setProperty('--text-muted', '#6c6f85');
  } else if (themeId === 'tokyo-night') {
    root.style.setProperty('--bg-dark', '#16161e');
    root.style.setProperty('--bg-panel', '#1a1b26');
    root.style.setProperty('--bg-header', '#24283b');
    root.style.setProperty('--bg-active', '#292e42');
    root.style.setProperty('--border', '#3b4261');
    root.style.setProperty('--accent', '#7aa2f7');
    root.style.setProperty('--accent-hover', '#7dcfff');
    root.style.setProperty('--text-main', '#c0caf5');
    root.style.setProperty('--text-muted', '#9aa5ce');
  } else if (themeId === 'monokai') {
    root.style.setProperty('--bg-dark', '#1e1f1c');
    root.style.setProperty('--bg-panel', '#272822');
    root.style.setProperty('--bg-header', '#3e3d32');
    root.style.setProperty('--bg-active', '#49483e');
    root.style.setProperty('--border', '#49483e');
    root.style.setProperty('--accent', '#ffd866');
    root.style.setProperty('--accent-hover', '#a9dc76');
    root.style.setProperty('--text-main', '#f8f8f2');
    root.style.setProperty('--text-muted', '#939293');
  } else if (themeId === 'solarized-dark') {
    root.style.setProperty('--bg-dark', '#00212b');
    root.style.setProperty('--bg-panel', '#002b36');
    root.style.setProperty('--bg-header', '#073642');
    root.style.setProperty('--bg-active', '#0a4250');
    root.style.setProperty('--border', '#586e75');
    root.style.setProperty('--accent', '#268bd2');
    root.style.setProperty('--accent-hover', '#2aa198');
    root.style.setProperty('--text-main', '#839496');
    root.style.setProperty('--text-muted', '#657b83');
  } else if (themeId === 'ayu-dark') {
    root.style.setProperty('--bg-dark', '#0b0e14');
    root.style.setProperty('--bg-panel', '#0f1419');
    root.style.setProperty('--bg-header', '#1f2430');
    root.style.setProperty('--bg-active', '#242b38');
    root.style.setProperty('--border', '#252e37');
    root.style.setProperty('--accent', '#e6b450');
    root.style.setProperty('--accent-hover', '#ffb454');
    root.style.setProperty('--text-main', '#e6e1cf');
    root.style.setProperty('--text-muted', '#707a8c');
  } else if (themeId === 'nord') {
    root.style.setProperty('--bg-dark', '#242933');
    root.style.setProperty('--bg-panel', '#2e3440');
    root.style.setProperty('--bg-header', '#3b4252');
    root.style.setProperty('--bg-active', '#434c5e');
    root.style.setProperty('--border', '#4c566a');
    root.style.setProperty('--accent', '#88c0d0');
    root.style.setProperty('--accent-hover', '#81a1c1');
    root.style.setProperty('--text-main', '#eceff4');
    root.style.setProperty('--text-muted', '#d8dee9');
  } else if (themeId === 'dracula') {
    root.style.setProperty('--bg-dark', '#1e1f29');
    root.style.setProperty('--bg-panel', '#282a36');
    root.style.setProperty('--bg-header', '#44475a');
    root.style.setProperty('--bg-active', '#6272a4');
    root.style.setProperty('--border', '#6272a4');
    root.style.setProperty('--accent', '#bd93f9');
    root.style.setProperty('--accent-hover', '#ff79c6');
    root.style.setProperty('--text-main', '#f8f8f2');
    root.style.setProperty('--text-muted', '#6272a4');
  } else if (themeId === 'midnight-blue') {
    root.style.setProperty('--bg-dark', '#000044');
    root.style.setProperty('--bg-panel', '#000088');
    root.style.setProperty('--bg-header', '#000066');
    root.style.setProperty('--bg-active', '#0000aa');
    root.style.setProperty('--border', '#00aaff');
    root.style.setProperty('--accent', '#00ffff');
    root.style.setProperty('--accent-hover', '#ffffff');
    root.style.setProperty('--text-main', '#ffffff');
    root.style.setProperty('--text-muted', '#a0a0ff');
  } else {
    // Woofson Amber Default
    root.style.setProperty('--bg-dark', '#121214');
    root.style.setProperty('--bg-panel', '#18181b');
    root.style.setProperty('--bg-header', '#202024');
    root.style.setProperty('--bg-active', '#27272a');
    root.style.setProperty('--border', '#3f3f46');
    root.style.setProperty('--accent', '#f59e0b');
    root.style.setProperty('--accent-hover', '#fbbf24');
    root.style.setProperty('--text-main', '#f4f4f5');
    root.style.setProperty('--text-muted', '#a1a1aa');
  }
}

async function handleLoginSubmit() {
  const uInput = document.getElementById('login-username');
  const pInput = document.getElementById('login-password');
  const err = document.getElementById('login-error');

  const u = uInput?.value.trim() || '';
  const p = pInput?.value || '';

  if (!u || !p) {
    if (err) {
      err.style.display = 'block';
      err.textContent = 'Please enter both username and password.';
    }
    if (!u) uInput?.focus();
    else pInput?.focus();
    return;
  }

  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });

  if (resp.ok) {
    const data = await resp.json();
    App.token = data.token;
    App.user = data.user;
    updateHeaderProfile(App.user);
    localStorage.setItem('cd_token', data.token);
    localStorage.removeItem('cd_is_locked');
    App.isLocked = false;
    hideModal('login-modal');
    if (err) err.style.display = 'none';
    if (pInput) pInput.value = '';
    await loadConfig();
    await loadSystemUsersGroups();
    renderAllPanes();
  } else {
    if (err) {
      err.style.display = 'block';
      err.textContent = 'Invalid credentials. Please try again.';
    }
    if (pInput) {
      pInput.value = '';
      pInput.focus();
    }
  }
}

function openHelpModal() {
  showModal('settings-modal');
  switchSettingsTab('tab-keys');
}

function openSettingsModal() {
  const dblclickCheckbox = document.getElementById('setting-dblclick-up');
  if (dblclickCheckbox) {
    dblclickCheckbox.checked = App.dblclickUpDir;
    dblclickCheckbox.onchange = (e) => {
      App.dblclickUpDir = e.target.checked;
      localStorage.setItem('cd_dblclick_up', e.target.checked);
    };
  }

  const parentDirCheckbox = document.getElementById('setting-show-parent-dir');
  if (parentDirCheckbox) {
    parentDirCheckbox.checked = App.showParentDir;
    parentDirCheckbox.onchange = (e) => {
      App.showParentDir = e.target.checked;
      localStorage.setItem('cd_show_parent_dir', e.target.checked);
      renderAllPanes();
    };
  }

  const autoOpenTasksCheckbox = document.getElementById('setting-auto-open-tasks');
  if (autoOpenTasksCheckbox) {
    autoOpenTasksCheckbox.checked = App.autoOpenTasks;
    autoOpenTasksCheckbox.onchange = (e) => {
      App.autoOpenTasks = e.target.checked;
      localStorage.setItem('cd_auto_open_tasks', e.target.checked);
    };
  }

  const dotfilesCheckbox = document.getElementById('setting-show-hidden');
  if (dotfilesCheckbox) {
    dotfilesCheckbox.checked = App.panes[0]?.showHidden || false;
  }

  const themeSel = document.getElementById('settings-theme-selector');
  if (themeSel) {
    themeSel.value = localStorage.getItem('cd_theme') || 'amber-charcoal';
  }

  const borderSel = document.getElementById('setting-border-width');
  if (borderSel) {
    borderSel.value = localStorage.getItem('cd_border_width') || '1px';
  }

  const ringSel = document.getElementById('setting-ring-style');
  if (ringSel) {
    ringSel.value = localStorage.getItem('cd_ring_style') || 'subtle';
  }

  const decCheckbox = document.getElementById('setting-window-decorations');
  if (decCheckbox) {
    const saved = localStorage.getItem('cd_window_decorations');
    decCheckbox.checked = saved !== null ? (saved === 'true') : (App.config?.ui?.window_decorations !== false);
  }

  const decDesktopCheckbox = document.getElementById('setting-desktop-decorations');
  if (decDesktopCheckbox) {
    const saved = localStorage.getItem('cd_window_decorations');
    decDesktopCheckbox.checked = saved !== null ? (saved === 'true') : (App.config?.ui?.window_decorations !== false);
  }

  const minTrayCheckbox = document.getElementById('setting-minimize-tray');
  if (minTrayCheckbox) {
    const saved = localStorage.getItem('cd_minimize_tray');
    minTrayCheckbox.checked = saved !== null ? (saved === 'true') : (App.config?.desktop?.minimize_to_tray !== false);
  }

  const startMinCheckbox = document.getElementById('setting-start-minimized');
  if (startMinCheckbox) {
    const saved = localStorage.getItem('cd_start_minimized');
    startMinCheckbox.checked = saved !== null ? (saved === 'true') : (App.config?.desktop?.start_minimized === true);
  }

  const hotkeyInput = document.getElementById('setting-global-hotkey');
  if (hotkeyInput && App.config?.desktop?.global_summon_hotkey) {
    hotkeyInput.value = App.config.desktop.global_summon_hotkey;
  }

  const globalRefreshCheckbox = document.getElementById('setting-show-global-refresh');
  if (globalRefreshCheckbox) {
    const saved = localStorage.getItem('cd_show_global_refresh');
    globalRefreshCheckbox.checked = saved !== null ? (saved === 'true') : (App.config?.ui?.show_global_refresh === true);
  }

  showModal('settings-modal');
}

function toggleMinimizeToTray(enabled) {
  localStorage.setItem('cd_minimize_tray', enabled);
  showToast(enabled ? 'Minimize to System Tray enabled' : 'Minimize to System Tray disabled', 'info');
}

function toggleStartMinimized(enabled) {
  localStorage.setItem('cd_start_minimized', enabled);
  showToast(enabled ? 'Start minimized in tray enabled' : 'Start minimized disabled', 'info');
}

function triggerView() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  if (item.is_dir || item.is_archive) {
    loadPaneDirectory(App.activePaneIndex, item.path);
    return;
  }
  if (isDocumentExtension(item.name)) {
    openDocumentViewer(item.path);
    return;
  }
  if (isAudioExtension(item.name)) {
    openMediaPlayer(item.path, 'audio');
    return;
  }
  if (isVideoExtension(item.name)) {
    openMediaPlayer(item.path, 'video');
    return;
  }
  if (isComicBookExtension(item.name)) {
    openBookReader(item.path);
    return;
  }
  if (isImageExtension(item.name)) {
    openImageViewer(item.path);
    return;
  }

  openDocumentViewer(item.path);
}

function triggerEditor() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (item) {
    if (item.is_dir) {
      checkAndPromptConfdDirectory(item.path);
    } else {
      openEditorWithFile(item.path);
    }
  } else {
    if (editorTabs.length === 0) createNewEditorTab();
    openFloatingEditor();
  }
}

function triggerMkdir() {
  document.getElementById('mkdir-input').value = '';
  showModal('mkdir-modal');
  document.getElementById('btn-confirm-mkdir').onclick = async () => {
    const name = document.getElementById('mkdir-input').value;
    if (!name) return;
    const pane = App.panes[App.activePaneIndex];
    const newDir = `${pane.path.replace(/\/$/, '')}/${name}`;
    await fetch('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ path: newDir })
    });
    closeModal('mkdir-modal');
    refreshPane(App.activePaneIndex);
  };
}

function triggerRename() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  document.getElementById('rename-input').value = item.name;
  showModal('rename-modal');
  document.getElementById('btn-confirm-rename').onclick = async () => {
    const newName = document.getElementById('rename-input').value;
    if (!newName) return;
    const toPath = `${pane.path.replace(/\/$/, '')}/${newName}`;
    await fetch('/api/fs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ from: item.path, to: toPath })
    });
    closeModal('rename-modal');
    refreshPane(App.activePaneIndex);
  };
}

async function triggerDelete() {
  const pane = App.panes[App.activePaneIndex];
  const paths = pane.selected.size > 0 ? Array.from(pane.selected) : (pane.entries[pane.cursorIndex] ? [pane.entries[pane.cursorIndex].path] : []);
  if (paths.length === 0) return;

  const itemNames = paths.map(p => p.split('/').pop() || p);
  const confirmed = await showConfirmDialog({
    title: 'Delete Confirmation',
    subtitle: `Move ${paths.length} item(s) to Trash`,
    message: `Are you sure you want to delete ${paths.length === 1 ? `'${itemNames[0]}'` : `${paths.length} selected items`}?`,
    items: itemNames,
    icon: 'trash-2',
    type: 'danger',
    confirmText: 'Move to Trash (F8)',
    cancelText: 'Cancel',
  });

  if (confirmed) {
    try {
      const resp = await fetch('/api/fs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
        body: JSON.stringify({ paths, use_trash: true })
      });
      if (resp.ok) {
        showToast(`Moved ${paths.length} item(s) to Trash`, 'success');
        refreshPane(App.activePaneIndex);
      } else {
        showToast(`Delete failed: ${await resp.text()}`, 'error');
      }
    } catch (err) {
      showToast(`Delete error: ${err}`, 'error');
    }
  }
}

let pendingDeltaTransfer = {
  sources: [],
  destination: '',
  targetIdx: 0
};

function triggerCopy() {
  const targetIdx = (App.activePaneIndex + 1) % getVisiblePaneCount();
  const sourcePane = App.panes[App.activePaneIndex];
  const targetPane = App.panes[targetIdx];
  const paths = sourcePane.selected.size > 0 ? Array.from(sourcePane.selected) : (sourcePane.entries[sourcePane.cursorIndex] ? [sourcePane.entries[sourcePane.cursorIndex].path] : []);

  if (paths.length === 0) return;

  pendingDeltaTransfer = {
    sources: paths,
    destination: targetPane.path,
    targetIdx: targetIdx
  };

  const summary = document.getElementById('deltacopy-source-summary');
  if (summary) summary.innerHTML = paths.map(p => `<div style="display: flex; align-items: center; gap: 4px;"><img src="assets/folder-closed.png" style="width: 12px; height: 12px;"> ${escapeHtml(p)}</div>`).join('');
  const destInput = document.getElementById('deltacopy-dest-input');
  if (destInput) destInput.value = targetPane.path;

  showModal('deltacopy-modal');
}

async function executeDeltaCopy() {
  const dest = document.getElementById('deltacopy-dest-input').value;
  const skipIdentical = document.getElementById('delta-skip-identical').checked;
  const verifyCrc = document.getElementById('delta-verify-crc32').checked;
  const autoRetry = document.getElementById('delta-auto-retry').checked;
  const preserveMeta = document.getElementById('delta-preserve-meta').checked;

  closeModal('deltacopy-modal');

  const payload = {
    sources: pendingDeltaTransfer.sources,
    destination: dest,
    options: {
      overwrite_mode: skipIdentical ? 'delta_mtime_size' : 'always',
      verify_checksum: verifyCrc,
      verify_algo: 'crc32',
      retry_count: autoRetry ? 3 : 1,
      retry_delay_ms: 500,
      resume_partial: true,
      preserve_timestamps: preserveMeta,
      preserve_permissions: preserveMeta,
      delete_orphans: false
    }
  };

  const resp = await fetch('/api/fs/deltacopy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify(payload)
  });

  if (resp.ok) {
    pollTasks();
    openFloatingTaskManager();
    setTimeout(() => refreshPane(pendingDeltaTransfer.targetIdx), 1500);
  } else {
    showToast('Failed to start DeltaCopy: ' + await resp.text(), 'error');
  }
}

async function executeStandardCopy() {
  const dest = document.getElementById('deltacopy-dest-input').value;
  closeModal('deltacopy-modal');
  executeTransfer('copy', pendingDeltaTransfer.sources, dest, pendingDeltaTransfer.targetIdx);
}

function triggerMove() {
  const targetIdx = (App.activePaneIndex + 1) % getVisiblePaneCount();
  const sourcePane = App.panes[App.activePaneIndex];
  const targetPane = App.panes[targetIdx];
  const paths = sourcePane.selected.size > 0 ? Array.from(sourcePane.selected) : (sourcePane.entries[sourcePane.cursorIndex] ? [sourcePane.entries[sourcePane.cursorIndex].path] : []);

  if (paths.length === 0) return;
  if (App.paranoidMode) {
    showParanoidConfirm('move', paths, targetPane.path, () => executeTransfer('move', paths, targetPane.path, targetIdx));
  } else {
    executeTransfer('move', paths, targetPane.path, targetIdx);
  }
}

async function triggerChecksum() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  const resp = await fetch('/api/fs/checksum', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ path: item.path, algorithm: 'sha256' })
  });

  if (resp.ok) {
    const data = await resp.json();
    await showAlertDialog({
      title: 'Cryptographic Checksum',
      subtitle: 'SHA-256 Verification',
      message: `<strong>File:</strong> <code>${escapeHtml(data.path)}</code><br><strong>Size:</strong> ${formatBytes(data.file_size)}<br><br><strong>SHA-256 Hash:</strong><br><input type="text" class="input" readonly value="${data.hash}" style="width: 100%; font-family: var(--font-mono); margin-top: 6px; font-size: 11px; box-sizing: border-box;" onclick="this.select(); navigator.clipboard.writeText('${data.hash}'); showToast('Hash copied to clipboard!', 'success');">`,
      icon: 'shield-check',
      type: 'info',
      okText: 'Done',
    });
  } else {
    showToast('Failed to calculate checksum: ' + await resp.text(), 'error');
  }
}

// ---------------- DEVICE UPLOADS & DOWNLOADS (PHONE / TABLET / DESKTOP) ----------------
let targetUploadPaneIndex = null;

function triggerDeviceUpload(paneIndex) {
  targetUploadPaneIndex = paneIndex !== undefined ? paneIndex : App.activePaneIndex;
  const input = document.getElementById('direct-file-uploader');
  if (input) {
    input.value = '';
    input.click();
  }
}

function triggerDeviceFolderUpload(paneIndex) {
  targetUploadPaneIndex = paneIndex !== undefined ? paneIndex : App.activePaneIndex;
  const input = document.getElementById('direct-folder-uploader');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handleDirectFileUpload(files) {
  if (!files || files.length === 0) return;

  const paneIdx = targetUploadPaneIndex !== null ? targetUploadPaneIndex : App.activePaneIndex;
  const pane = App.panes[paneIdx];
  if (!pane) return;

  const destPath = pane.path;
  const fileCount = files.length;
  const formData = new FormData();
  
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  showToast(`Uploading ${fileCount} item(s) from device to ${pane.path}...`, 'info');

  const pill = document.getElementById('tasks-pill');
  const pillText = document.getElementById('tasks-pill-text');
  if (pill && pillText) {
    pill.style.display = 'flex';
    pillText.textContent = `Uploading ${fileCount} file(s)...`;
  }

  try {
    const resp = await fetch(`/api/fs/upload?destination=${encodeURIComponent(destPath)}`, {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      showToast(`Uploaded ${fileCount} file(s) successfully!`, 'success');
      refreshPane(paneIdx);
    } else {
      showToast(`Upload failed: ${await resp.text()}`, 'error');
    }
  } catch (err) {
    showToast(`Upload error: ${err}`, 'error');
  } finally {
    if (pill) pill.style.display = 'none';
  }
}

function triggerDownloadCurrentDirectory(paneIndex) {
  const pane = App.panes[paneIndex !== undefined ? paneIndex : App.activePaneIndex];
  if (!pane) return;
  const url = `/api/fs/download?path=${encodeURIComponent(pane.path)}`;
  window.location.href = url;
}

function triggerShareDirectory(paneIndex) {
  const pane = App.panes[paneIndex !== undefined ? paneIndex : App.activePaneIndex];
  if (!pane) return;
  const dirName = pane.path.split('/').filter(Boolean).pop() || 'root';
  App.contextItem = {
    name: dirName,
    path: pane.path,
    is_dir: true,
  };
  App.contextPaneIndex = paneIndex !== undefined ? paneIndex : App.activePaneIndex;
  triggerShare();
}

// ---------------- LINK SHARING & GUEST DROPBOX ----------------
let pendingShareItem = null;

function triggerShare() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || (pane.entries && pane.entries[pane.cursorIndex]);
  if (!item) {
    showToast('Please select a file or folder to share', 'info');
    return;
  }

  pendingShareItem = item;
  document.getElementById('share-item-name').textContent = item.name;
  document.getElementById('share-item-path').textContent = item.path;
  document.getElementById('share-password-input').value = '';
  document.getElementById('share-max-downloads').value = '0';
  document.getElementById('share-expiry-select').value = '24';
  
  const dropboxToggleGroup = document.getElementById('share-dropbox-toggle-group');
  const allowUploadCheckbox = document.getElementById('share-allow-upload');
  if (item.is_dir) {
    if (dropboxToggleGroup) dropboxToggleGroup.style.display = 'block';
    if (allowUploadCheckbox) allowUploadCheckbox.checked = false;
  } else {
    if (dropboxToggleGroup) dropboxToggleGroup.style.display = 'none';
    if (allowUploadCheckbox) allowUploadCheckbox.checked = false;
  }

  document.getElementById('share-result-box').style.display = 'none';
  showModal('share-create-modal');
}

async function executeCreateShare() {
  if (!pendingShareItem) return;

  const expiryHours = parseInt(document.getElementById('share-expiry-select').value, 10);
  const password = document.getElementById('share-password-input').value.trim();
  const maxDownloads = parseInt(document.getElementById('share-max-downloads').value, 10) || 0;
  const allowUpload = pendingShareItem.is_dir && document.getElementById('share-allow-upload').checked;

  try {
    const resp = await fetch('/api/shares', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token}`
      },
      body: JSON.stringify({
        path: pendingShareItem.path,
        name: pendingShareItem.name,
        is_dir: pendingShareItem.is_dir,
        allow_upload: allowUpload,
        password: password ? password : null,
        expires_in_hours: expiryHours > 0 ? expiryHours : null,
        max_downloads: maxDownloads
      })
    });

    if (!resp.ok) {
      showToast('Failed to create share: ' + await resp.text(), 'error');
      return;
    }

    const share = await resp.json();
    const fullUrl = `${window.location.origin}/share/${share.token}`;
    
    document.getElementById('share-result-url').value = fullUrl;
    document.getElementById('share-result-open-btn').href = fullUrl;
    document.getElementById('share-result-box').style.display = 'block';
    
    showToast('Share link created successfully!', 'success');
  } catch (err) {
    showToast('Error creating share: ' + err, 'error');
  }
}

function copyShareUrl() {
  const input = document.getElementById('share-result-url');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value);
    showToast('Share URL copied to clipboard!', 'success');
  }
}

function openSharesManager() {
  const toolsMenu = document.getElementById('tools-dropdown-menu');
  if (toolsMenu) toolsMenu.classList.remove('active');
  showModal('shares-manager-modal');
  loadActiveShares();
}

async function loadActiveShares() {
  const tbody = document.getElementById('shares-table-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">Loading active shares...</td></tr>';

  try {
    const resp = await fetch('/api/shares', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (!resp.ok) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger); padding:16px;">Failed to load shares: ${await resp.text()}</td></tr>`;
      return;
    }

    const shares = await resp.json();
    if (!shares || shares.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">No active link shares found. Create one from any file/folder right-click menu!</td></tr>';
      return;
    }

    tbody.innerHTML = shares.map(s => {
      const typeIcon = s.is_dir ? (s.allow_upload ? '📥' : '📁') : '📄';
      const expiryStr = s.expires_at ? new Date(s.expires_at).toLocaleString() : 'Permanent';
      const fullUrl = `${window.location.origin}/share/${s.token}`;
      return `
        <tr class="file-row">
          <td style="font-size:16px; text-align:center;">${typeIcon}</td>
          <td>
            <div style="font-weight:600;">${escapeHtml(s.name)}</div>
            <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">${escapeHtml(s.path)}</div>
          </td>
          <td style="font-size:11px; color:var(--text-muted);">${expiryStr}</td>
          <td style="text-align:center; font-weight:700;">${s.download_count}</td>
          <td style="text-align:center;">${s.allow_upload ? '<span style="color:#10b981; font-weight:700;">Yes</span>' : '<span style="color:var(--text-muted);">No</span>'}</td>
          <td style="text-align:right;">
            <button class="btn btn-icon" onclick="navigator.clipboard.writeText('${fullUrl}'); showToast('Share URL copied!', 'success');" title="Copy Public URL"><i data-lucide="copy" style="width:13px;"></i></button>
            <a href="${fullUrl}" target="_blank" class="btn btn-icon" title="Open Link"><i data-lucide="external-link" style="width:13px;"></i></a>
            <button class="btn btn-icon" onclick="revokeShare(${s.id})" title="Revoke Share" style="color:var(--danger);"><i data-lucide="trash-2" style="width:13px;"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger); padding:16px;">Network error loading shares</td></tr>`;
  }
}

async function revokeShare(id) {
  if (!confirm('Are you sure you want to revoke this public share link? Anyone using it will immediately lose access.')) return;

  try {
    const resp = await fetch(`/api/shares/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      showToast('Share link revoked successfully', 'info');
      loadActiveShares();
    } else {
      showToast('Failed to revoke share: ' + await resp.text(), 'error');
    }
  } catch (err) {
    showToast('Error revoking share: ' + err, 'error');
  }
}

// ---------------- ARCHIVE COMPRESSOR & EXTRACTOR ----------------
let pendingCompressSources = [];

function triggerCompressModal() {
  const pane = App.panes[App.activePaneIndex];
  if (!pane) return;

  let paths = [];
  if (pane.selected.size > 0) {
    paths = Array.from(pane.selected);
  } else if (App.contextItem) {
    paths = [App.contextItem.path];
  } else if (pane.entries && pane.entries[pane.cursorIndex]) {
    paths = [pane.entries[pane.cursorIndex].path];
  }

  if (paths.length === 0) {
    showToast('Please select files or folders to compress', 'info');
    return;
  }

  pendingCompressSources = paths;
  const singleName = paths[0].split('/').filter(Boolean).pop() || 'archive';
  const baseName = paths.length === 1 ? singleName : 'archive';
  const defaultArchiveName = `${baseName.replace(/\.[^/.]+$/, '')}.zip`;

  document.getElementById('compress-summary').innerHTML = `Compressing <strong>${paths.length} item(s)</strong>`;
  document.getElementById('compress-name-input').value = defaultArchiveName;
  document.getElementById('compress-format-select').value = 'zip';
  document.getElementById('compress-dest-input').value = pane.path;

  showModal('archive-compress-modal');
}

function setCompressDestToOpposite() {
  const oppIdx = (App.activePaneIndex + 1) % getVisiblePaneCount();
  const oppPane = App.panes[oppIdx];
  if (oppPane) {
    document.getElementById('compress-dest-input').value = oppPane.path;
  }
}

function updateCompressExt(format) {
  const nameInput = document.getElementById('compress-name-input');
  if (!nameInput) return;
  const current = nameInput.value;
  const raw = current.replace(/(\.zip|\.tar\.gz|\.tar|\.tar\.bz2|\.tar\.xz)$/i, '');
  if (format === 'zip') {
    nameInput.value = `${raw}.zip`;
  } else if (format === 'targz') {
    nameInput.value = `${raw}.tar.gz`;
  }
}

async function executeCompressArchive() {
  if (pendingCompressSources.length === 0) return;

  const name = document.getElementById('compress-name-input').value.trim();
  const format = document.getElementById('compress-format-select').value;
  const destDir = document.getElementById('compress-dest-input').value.trim();

  if (!name) {
    showToast('Please specify an archive name', 'error');
    return;
  }

  const targetPath = `${destDir.replace(/\/$/, '')}/${name}`;
  closeModal('archive-compress-modal');

  showToast(`Creating ${format.toUpperCase()} archive in background...`, 'info');

  try {
    const resp = await fetch('/api/fs/archive/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token}`
      },
      body: JSON.stringify({
        sources: pendingCompressSources,
        target_path: targetPath,
        format: format
      })
    });

    if (resp.ok) {
      showToast(`Archive created successfully: ${name}`, 'success');
      refreshPane(App.activePaneIndex);
    } else {
      showToast(`Archive creation failed: ${await resp.text()}`, 'error');
    }
  } catch (err) {
    showToast(`Archive creation error: ${err}`, 'error');
  }
}

let pendingExtractItem = null;

function triggerExtractModal() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || (pane.entries && pane.entries[pane.cursorIndex]);
  if (!item) return;

  pendingExtractItem = item;
  document.getElementById('extract-archive-name').textContent = item.name;
  document.getElementById('extract-archive-path').textContent = item.path;

  const rawSubName = item.name.replace(/(\.zip|\.tar\.gz|\.tgz|\.tar\.bz2|\.tar\.xz|\.7z|\.tar|\.cbz|\.epub)$/i, '');
  const subLabel = document.getElementById('extract-subfolder-label');
  if (subLabel) subLabel.textContent = rawSubName;

  document.getElementById('extract-mode-select').value = 'here';
  document.getElementById('extract-custom-path-group').style.display = 'none';
  document.getElementById('extract-target-dir-input').value = pane.path;

  showModal('archive-extract-modal');
}

function handleExtractModeChange(mode) {
  const customGroup = document.getElementById('extract-custom-path-group');
  if (customGroup) {
    customGroup.style.display = mode === 'custom' ? 'block' : 'none';
  }
}

async function executeExtractArchive() {
  if (!pendingExtractItem) return;

  const pane = App.panes[App.activePaneIndex];
  const mode = document.getElementById('extract-mode-select').value;
  let targetDir = pane.path;

  if (mode === 'subfolder') {
    const rawSubName = pendingExtractItem.name.replace(/(\.zip|\.tar\.gz|\.tgz|\.tar\.bz2|\.tar\.xz|\.7z|\.tar|\.cbz|\.epub)$/i, '');
    targetDir = `${pane.path.replace(/\/$/, '')}/${rawSubName}`;
  } else if (mode === 'opposite') {
    const oppIdx = (App.activePaneIndex + 1) % getVisiblePaneCount();
    targetDir = App.panes[oppIdx].path;
  } else if (mode === 'custom') {
    targetDir = document.getElementById('extract-target-dir-input').value.trim();
  }

  closeModal('archive-extract-modal');
  showToast(`Extracting ${pendingExtractItem.name}...`, 'info');

  try {
    const resp = await fetch('/api/fs/archive/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token}`
      },
      body: JSON.stringify({
        archive_path: pendingExtractItem.path,
        target_dir: targetDir
      })
    });

    if (resp.ok) {
      showToast(`Extracted ${pendingExtractItem.name} successfully!`, 'success');
      refreshPane(App.activePaneIndex);
    } else {
      showToast(`Extraction failed: ${await resp.text()}`, 'error');
    }
  } catch (err) {
    showToast(`Extraction error: ${err}`, 'error');
  }
}

function triggerArchiveZip() {
  triggerCompressModal();
}

function triggerArchiveTarGz() {
  triggerCompressModal();
}

function triggerExtract() {
  triggerExtractModal();
}

// ---------------- MULTI-FILE & BATCH DOWNLOAD ----------------
async function triggerDownload() {
  const pane = App.panes[App.activePaneIndex];
  if (!pane) return;

  let paths = [];
  if (pane.selected.size > 0) {
    paths = Array.from(pane.selected);
  } else if (App.contextItem) {
    paths = [App.contextItem.path];
  } else if (pane.entries && pane.entries[pane.cursorIndex]) {
    paths = [pane.entries[pane.cursorIndex].path];
  }

  if (paths.length === 0) {
    showToast('No files or folders selected for download', 'info');
    return;
  }

  // If exactly 1 file selected and it is NOT a directory
  if (paths.length === 1) {
    const singlePath = paths[0];
    const entry = pane.entries.find(e => e.path === singlePath);
    if (entry && !entry.is_dir) {
      window.open(`/api/fs/download?path=${encodeURIComponent(singlePath)}`, '_blank');
      showToast('Download started', 'success');
      return;
    }
  }

  // Multiple files or folder selected -> batch download as dynamic zip archive
  await downloadBatchArchive(paths);
}

async function downloadBatchArchive(paths) {
  showToast('Creating batch zip archive for download...', 'info');
  try {
    const resp = await fetch('/api/fs/download/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token}`
      },
      body: JSON.stringify({ paths })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || 'Failed to create batch archive');
    }

    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const cd = resp.headers.get('content-disposition');
    let filename = 'commanderdog_download.zip';
    if (cd && cd.includes('filename=')) {
      const match = cd.match(/filename=["']?([^"';]+)["']?/);
      if (match && match[1]) filename = match[1];
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    showToast('Batch download archive ready!', 'success');
  } catch (err) {
    await showAlertDialog({
      title: 'Download Failed',
      message: 'Failed to generate batch zip archive: ' + err.message,
      icon: 'alert-triangle',
      type: 'error',
      okText: 'Close'
    });
  }
}

// ---------------- PANE IDENTIFICATION BORDER COLORS ----------------
const PANE_COLOR_PALETTE = ['default', 'amber', 'emerald', 'sky', 'purple', 'rose', 'indigo', 'teal', 'orange'];

function getPaneColors() {
  try {
    return JSON.parse(localStorage.getItem('cd_pane_colors')) || {};
  } catch (e) {
    return {};
  }
}

function setPaneColorPref(paneIdx, colorName) {
  const colors = getPaneColors();
  if (colorName === 'default' || !colorName) {
    delete colors[paneIdx];
  } else {
    colors[paneIdx] = colorName;
  }
  localStorage.setItem('cd_pane_colors', JSON.stringify(colors));
  applyPaneColors();
}

function cyclePaneColor(paneIdx) {
  const colors = getPaneColors();
  const current = colors[paneIdx] || 'default';
  const curIdx = PANE_COLOR_PALETTE.indexOf(current);
  const nextColor = PANE_COLOR_PALETTE[(curIdx + 1) % PANE_COLOR_PALETTE.length];
  setPaneColorPref(paneIdx, nextColor);
  showToast(`Pane ${paneIdx + 1} color: ${nextColor.toUpperCase()}`, 'info');
}

function openPaneToolsMenu(e, paneIndex) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  document.getElementById('pane-tools-popup')?.remove();
  document.getElementById('pane-color-popup')?.remove();
  document.getElementById('pane-favorites-popup')?.remove();

  const colors = getPaneColors();
  const currentColor = colors[paneIndex] || 'default';
  const colorHexes = {
    'default': 'rgba(255,255,255,0.2)',
    'amber': '#f59e0b',
    'emerald': '#10b981',
    'sky': '#38bdf8',
    'purple': '#c084fc',
    'rose': '#f43f5e',
    'indigo': '#6366f1',
    'teal': '#14b8a6',
    'orange': '#f97316'
  };
  const activeHex = colorHexes[currentColor] || currentColor;

  const popup = document.createElement('div');
  popup.id = 'pane-tools-popup';
  popup.className = 'pane-tools-dropdown active';

  popup.innerHTML = `
    <div style="padding: 8px 12px; font-weight: 700; font-size: 11px; color: var(--accent); background: var(--bg-dark); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
      <span style="display: flex; align-items: center; gap: 6px;">
        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${activeHex};"></span>
        Pane ${paneIndex + 1} Actions
      </span>
      <span style="font-size: 11px; color: var(--text-dim); cursor: pointer;" onclick="document.getElementById('pane-tools-popup')?.remove();">✕</span>
    </div>
    <div style="padding: 4px 0; max-height: 440px; overflow-y: auto;">
      <div class="dropdown-item" onclick="setActivePane(${paneIndex}); triggerCopy(); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="arrow-right-left" style="color: var(--accent);"></i> Transfer / Copy to Other Pane (F5)
      </div>
      <div class="dropdown-item" onclick="triggerDeviceUpload(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="upload-cloud" style="color: #38bdf8;"></i> Upload Files from Device...
      </div>
      <div class="dropdown-item" onclick="triggerDeviceFolderUpload(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="folder-up" style="color: #38bdf8;"></i> Upload Folder from Device...
      </div>
      <div class="dropdown-item" onclick="promptRenamePane(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="edit-3" style="color: var(--accent);"></i> Rename Pane Label...
      </div>
      <div class="dropdown-sep" style="height: 1px; background: var(--border); margin: 4px 0;"></div>
      
      <!-- Border Color Quick Palette -->
      <div style="padding: 6px 12px 4px 12px; font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center;">
        <span>Pane Border Color</span>
        <span style="color: var(--accent); cursor: pointer; text-transform: none; font-weight: 600;" onclick="cyclePaneColor(${paneIndex}); openPaneToolsMenu(null, ${paneIndex});">Cycle ↻</span>
      </div>
      <div style="display: flex; gap: 6px; padding: 0 12px 8px 12px; overflow-x: auto;">
        ${['default', 'amber', 'emerald', 'sky', 'rose', 'purple', 'teal', 'orange'].map(c => `
          <div style="width: 20px; height: 20px; border-radius: 50%; background: ${colorHexes[c]}; cursor: pointer; border: 2px solid ${currentColor === c ? 'var(--text-main)' : 'transparent'}; box-sizing: border-box; flex-shrink: 0;"
               title="${c.toUpperCase()}"
               onclick="setPaneColorPref(${paneIndex}, '${c}'); openPaneToolsMenu(null, ${paneIndex});"></div>
        `).join('')}
      </div>

      <div class="dropdown-sep" style="height: 1px; background: var(--border); margin: 4px 0;"></div>
      <div class="dropdown-item" onclick="openRemoteModal(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="network" style="color: #a855f7;"></i> Connect Remote Storage (SFTP/SMB/WebDAV)...
      </div>
      <div class="dropdown-item" onclick="openPaneFavoritesMenu(event, ${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="star" style="color: var(--accent);"></i> Bookmarks & Favorites...
      </div>
      <div class="dropdown-item" onclick="triggerDownloadCurrentDirectory(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="download"></i> Download Folder (.zip)
      </div>
      <div class="dropdown-item" onclick="triggerShareDirectory(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="share-2" style="color: var(--accent);"></i> Share Folder / Dropbox...
      </div>
      <div class="dropdown-item" onclick="triggerDirPermissions(${paneIndex}); document.getElementById('pane-tools-popup')?.remove();">
        <i data-lucide="lock"></i> Permissions & Ownership
      </div>
    </div>
  `;

  const btn = document.getElementById(`pane-tools-btn-${paneIndex}`);
  if (btn) {
    const rect = btn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;
  }

  document.body.appendChild(popup);
  if (window.lucide) lucide.createIcons();

  const closeHandler = (ev) => {
    if (!popup.contains(ev.target) && !btn?.contains(ev.target)) {
      popup.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

function openPaneColorPicker(e, paneIndex) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  document.getElementById('pane-color-popup')?.remove();
  document.getElementById('pane-favorites-popup')?.remove();

  const colors = getPaneColors();
  const currentColor = colors[paneIndex] || 'default';

  const presets = [
    { id: 'default', name: 'Default', hex: 'rgba(255,255,255,0.2)' },
    { id: 'amber', name: 'Amber', hex: '#f59e0b' },
    { id: 'emerald', name: 'Emerald', hex: '#10b981' },
    { id: 'sky', name: 'Sky Blue', hex: '#38bdf8' },
    { id: 'purple', name: 'Purple', hex: '#c084fc' },
    { id: 'rose', name: 'Rose Red', hex: '#f43f5e' },
    { id: 'indigo', name: 'Indigo', hex: '#6366f1' },
    { id: 'teal', name: 'Teal', hex: '#14b8a6' },
    { id: 'orange', name: 'Orange', hex: '#f97316' }
  ];

  const isCustomHex = currentColor.startsWith('#') || currentColor.startsWith('rgb');
  const currentHexVal = isCustomHex ? currentColor : '#f59e0b';

  const popup = document.createElement('div');
  popup.id = 'pane-color-popup';
  popup.className = 'pane-color-dropdown active';

  popup.innerHTML = `
    <div style="padding: 8px 12px; font-weight: 700; font-size: 11px; color: var(--accent); background: var(--bg-dark); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
      <span style="display: flex; align-items: center; gap: 6px;"><i data-lucide="palette" style="width: 13px; height: 13px;"></i> Pane ${paneIndex + 1} Color Palette</span>
      <span style="font-size: 11px; color: var(--text-dim); cursor: pointer;" onclick="document.getElementById('pane-color-popup')?.remove();">✕</span>
    </div>
    
    <div style="padding: 10px 12px;">
      <div style="font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; margin-bottom: 8px;">Preset Swatches</div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px;">
        ${presets.map(p => {
          const isSelected = currentColor === p.id;
          return `
            <button type="button" class="color-swatch-btn ${isSelected ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 6px; background: var(--bg-panel); border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}; border-radius: 4px; cursor: pointer; color: var(--text-main); font-size: 10px; width: 100%; text-align: left;"
                    onclick="setPaneColorPref(${paneIndex}, '${p.id}'); document.getElementById('pane-color-popup')?.remove();">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${p.hex}; border: 1px solid rgba(255,255,255,0.25); flex-shrink: 0;"></span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${isSelected ? 'font-weight: 700; color: var(--accent);' : ''}">${p.name}</span>
            </button>
          `;
        }).join('')}
      </div>

      <div style="border-top: 1px solid var(--border); padding-top: 10px;">
        <div style="font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; margin-bottom: 6px;">Custom Color Picker</div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input type="color" id="pane-hex-picker-${paneIndex}" value="${currentHexVal}" style="width: 32px; height: 26px; border: 1px solid var(--border); border-radius: 4px; padding: 0; background: transparent; cursor: pointer;" oninput="document.getElementById('pane-hex-text-${paneIndex}').value = this.value; setPaneColorPref(${paneIndex}, this.value);">
          <input type="text" id="pane-hex-text-${paneIndex}" value="${isCustomHex ? currentColor : ''}" placeholder="#RRGGBB" style="flex: 1; height: 26px; padding: 0 6px; font-family: var(--font-mono); font-size: 11px; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 4px; color: var(--text-main);" onchange="if(this.value){ document.getElementById('pane-hex-picker-${paneIndex}').value = this.value; setPaneColorPref(${paneIndex}, this.value); }">
          <button type="button" class="btn btn-sm btn-accent" style="height: 26px; padding: 0 8px; font-size: 10px;" onclick="const val = document.getElementById('pane-hex-text-${paneIndex}').value; if(val){ setPaneColorPref(${paneIndex}, val); document.getElementById('pane-color-popup')?.remove(); }">Apply</button>
        </div>
      </div>
    </div>
  `;

  const wrapper = document.querySelector(`#pane-${paneIndex} .pane-color-wrapper`);
  if (wrapper) {
    wrapper.appendChild(popup);
  } else {
    document.body.appendChild(popup);
    popup.style.position = 'fixed';
    popup.style.left = `${e.clientX}px`;
    popup.style.top = `${e.clientY}px`;
  }

  if (window.lucide) lucide.createIcons();

  const closeHandler = (evt) => {
    if (!popup.contains(evt.target) && !evt.target.closest(`#pane-idx-badge-${paneIndex}`)) {
      popup.remove();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('contextmenu', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
  }, 10);
}

function applyPaneColors() {
  const colors = getPaneColors();
  for (let i = 0; i < 4; i++) {
    const paneEl = document.getElementById(`pane-${i}`);
    const color = colors[i] || 'default';
    const isCustomHex = color.startsWith('#') || color.startsWith('rgb');

    if (paneEl) {
      PANE_COLOR_PALETTE.forEach(c => {
        if (c !== 'default') paneEl.classList.remove(`pane-color-${c}`);
      });
      if (isCustomHex) {
        paneEl.style.setProperty('--pane-custom-border', color);
        paneEl.classList.add('pane-color-custom');
      } else {
        paneEl.style.removeProperty('--pane-custom-border');
        paneEl.classList.remove('pane-color-custom');
        if (color !== 'default') {
          paneEl.classList.add(`pane-color-${color}`);
        }
      }
    }

    const colorBtn = document.getElementById(`pane-idx-badge-${i}`);
    if (colorBtn) {
      colorBtn.title = `Pane ${i + 1} Color: ${color.toUpperCase()} (Left-click: Cycle, Right-click: Palette & Color Picker)`;
      const icon = colorBtn.querySelector('i, svg');
      if (isCustomHex) {
        colorBtn.style.borderColor = color;
        colorBtn.style.background = `${color}25`;
        if (icon) icon.style.color = color;
      } else {
        colorBtn.style.borderColor = '';
        colorBtn.style.background = '';
        if (icon) icon.style.color = '';
      }
    }

    // Dynamically update mobile pane indicator tabs with custom color tints
    document.querySelectorAll(`.mobile-pane-tab[data-pane-idx="${i}"]`).forEach(tab => {
      PANE_COLOR_PALETTE.forEach(c => {
        if (c !== 'default') tab.classList.remove(`pane-tab-color-${c}`);
      });
      if (isCustomHex) {
        tab.style.borderColor = color;
        tab.style.color = color;
        tab.style.setProperty('--pane-custom-border', color);
        tab.classList.add('pane-tab-color-custom');
      } else {
        tab.style.borderColor = '';
        tab.style.color = '';
        tab.style.removeProperty('--pane-custom-border');
        tab.classList.remove('pane-tab-color-custom');
        if (color !== 'default') {
          tab.classList.add(`pane-tab-color-${color}`);
        }
      }
    });

    const selectEl = document.getElementById(`setting-pane-color-${i}`);
    if (selectEl) {
      selectEl.value = PANE_COLOR_PALETTE.includes(color) ? color : 'default';
    }
  }
}

function navPaneUp(index) {
  const pane = App.panes[index];
  if (!pane || pane.path === '/' || pane.path === '') return;

  if (pane.parentPath) {
    loadPaneDirectory(index, pane.parentPath);
    return;
  }

  if (pane.path.startsWith('archive://')) {
    const [arch, sub] = pane.path.replace('archive://', '').split('#');
    if (sub && sub.includes('/')) {
      const subParts = sub.split('/').filter(Boolean);
      subParts.pop();
      loadPaneDirectory(index, `archive://${arch}#${subParts.join('/')}`);
    } else if (sub) {
      loadPaneDirectory(index, `archive://${arch}#`);
    } else {
      const archParts = arch.split('/').filter(Boolean);
      archParts.pop();
      const p = archParts.length === 0 ? '/' : '/' + archParts.join('/');
      loadPaneDirectory(index, p);
    }
    return;
  }

  const protoMatch = pane.path.match(/^([a-zA-Z0-9_-]+):\/\/(.*)$/);
  if (protoMatch) {
    const proto = protoMatch[1].toLowerCase();
    const rest = protoMatch[2];
    const parts = rest.split('/').filter(Boolean);
    const minParts = proto === 'smb' ? 2 : 1;
    if (parts.length > minParts) {
      parts.pop();
      loadPaneDirectory(index, `${proto}://${parts.join('/')}`);
    }
    return;
  }

  const parts = pane.path.split('/').filter(Boolean);
  parts.pop();
  const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
  loadPaneDirectory(index, parent);
}

function refreshPane(index, selectItemName = null) {
  loadPaneDirectory(index, App.panes[index].path, false, selectItemName);
}

function enablePathInput(index) {
  const crumbs = document.getElementById(`pane-crumbs-${index}`);
  const input = document.getElementById(`pane-input-${index}`);
  crumbs.style.display = 'none';
  input.style.display = 'block';
  input.value = sanitizeCredentials(App.panes[index].path);
  input.focus();
}

function disablePathInput(index) {
  const crumbs = document.getElementById(`pane-crumbs-${index}`);
  const input = document.getElementById(`pane-input-${index}`);
  crumbs.style.display = 'flex';
  input.style.display = 'none';
}

function handlePathKey(e, index) {
  if (e.key === 'Enter') {
    let target = e.target.value.trim();
    if (target.includes(':***@')) {
      const current = App.panes[index].path;
      const curAuthMatch = current.match(/:\/\/([^@\s/]+)@/);
      if (curAuthMatch) {
        target = target.replace(/:\/\/[^@\s/]+@/, `://${curAuthMatch[1]}@`);
      }
    }
    loadPaneDirectory(index, target);
    disablePathInput(index);
  } else if (e.key === 'Escape') {
    disablePathInput(index);
  }
}

function handleFilterInput(index, val) {
  App.panes[index].filterText = val;
  renderPaneTable(index);
}

function sortPane(index, sortBy) {
  const pane = App.panes[index];
  if (pane.sortBy === sortBy) pane.sortAsc = !pane.sortAsc;
  else {
    pane.sortBy = sortBy;
    pane.sortAsc = true;
  }
  renderPaneTable(index);
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    if (window.history && history.pushState) {
      history.pushState({ type: 'modal', modalId: id }, '', '');
    }
  }
}

function hideModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

function closeModal(id) {
  if (id) hideModal(id);
  else document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

// ---------------- UNIVERSAL CUSTOM DIALOG & TOAST SYSTEM ----------------
let currentDialogResolver = null;

function showConfirmDialog({
  title = 'Confirmation',
  subtitle = 'Please confirm your action',
  message = 'Are you sure you want to proceed?',
  items = [],
  icon = 'help-circle',
  type = 'warning', // 'warning', 'danger', 'info', 'success'
  confirmText = 'Confirm',
  cancelText = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    currentDialogResolver = resolve;

    const titleEl = document.getElementById('dialog-title');
    const subEl = document.getElementById('dialog-subtitle');
    const msgEl = document.getElementById('dialog-message');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    if (msgEl) msgEl.textContent = message;

    const iconWrap = document.getElementById('dialog-icon-wrapper');
    if (iconWrap) iconWrap.className = `dialog-icon-wrapper ${type}`;
    const iconEl = document.getElementById('dialog-icon');
    if (iconEl) iconEl.setAttribute('data-lucide', icon);

    const itemsBox = document.getElementById('dialog-items-preview');
    if (itemsBox) {
      if (items && items.length > 0) {
        itemsBox.style.display = 'flex';
        itemsBox.innerHTML = items.map(it => `<div>• ${escapeHtml(it)}</div>`).join('');
      } else {
        itemsBox.style.display = 'none';
      }
    }

    const inputGroup = document.getElementById('dialog-input-group');
    if (inputGroup) inputGroup.style.display = 'none';

    const btnCancel = document.getElementById('dialog-btn-cancel');
    if (btnCancel) {
      btnCancel.textContent = cancelText;
      btnCancel.style.display = 'inline-block';
    }

    const btnConfirm = document.getElementById('dialog-btn-confirm');
    if (btnConfirm) {
      btnConfirm.textContent = confirmText;
      btnConfirm.className = `btn ${type === 'danger' ? 'btn-danger' : (type === 'success' ? 'btn-success' : 'btn-accent')}`;
    }

    showModal('app-dialog-modal');
    if (window.lucide) lucide.createIcons();

    setTimeout(() => btnConfirm?.focus(), 50);
  });
}

function showAlertDialog({
  title = 'Notice',
  subtitle = 'Information',
  message = '',
  icon = 'info',
  type = 'info',
  okText = 'OK',
} = {}) {
  return new Promise((resolve) => {
    currentDialogResolver = resolve;

    const titleEl = document.getElementById('dialog-title');
    const subEl = document.getElementById('dialog-subtitle');
    const msgEl = document.getElementById('dialog-message');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    if (msgEl) msgEl.innerHTML = message.replace(/\n/g, '<br>');

    const iconWrap = document.getElementById('dialog-icon-wrapper');
    if (iconWrap) iconWrap.className = `dialog-icon-wrapper ${type}`;
    const iconEl = document.getElementById('dialog-icon');
    if (iconEl) iconEl.setAttribute('data-lucide', icon);

    const itemsBox = document.getElementById('dialog-items-preview');
    if (itemsBox) itemsBox.style.display = 'none';
    const inputGroup = document.getElementById('dialog-input-group');
    if (inputGroup) inputGroup.style.display = 'none';

    const btnCancel = document.getElementById('dialog-btn-cancel');
    if (btnCancel) btnCancel.style.display = 'none';

    const btnConfirm = document.getElementById('dialog-btn-confirm');
    if (btnConfirm) {
      btnConfirm.textContent = okText;
      btnConfirm.className = `btn ${type === 'danger' ? 'btn-danger' : 'btn-accent'}`;
    }

    showModal('app-dialog-modal');
    if (window.lucide) lucide.createIcons();

    setTimeout(() => btnConfirm?.focus(), 50);
  });
}

function showPromptDialog({
  title = 'Input Required',
  subtitle = 'Enter value',
  message = 'Please enter a value:',
  defaultValue = '',
  placeholder = '',
  confirmText = 'OK',
  cancelText = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    currentDialogResolver = resolve;

    const titleEl = document.getElementById('dialog-title');
    const subEl = document.getElementById('dialog-subtitle');
    const msgEl = document.getElementById('dialog-message');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    if (msgEl) msgEl.textContent = message;

    const iconWrap = document.getElementById('dialog-icon-wrapper');
    if (iconWrap) iconWrap.className = 'dialog-icon-wrapper info';
    const iconEl = document.getElementById('dialog-icon');
    if (iconEl) iconEl.setAttribute('data-lucide', 'edit-3');

    const itemsBox = document.getElementById('dialog-items-preview');
    if (itemsBox) itemsBox.style.display = 'none';

    const inputGroup = document.getElementById('dialog-input-group');
    const inputField = document.getElementById('dialog-input-field');
    if (inputGroup) inputGroup.style.display = 'block';
    if (inputField) {
      inputField.value = defaultValue;
      inputField.placeholder = placeholder;
      inputField.onkeydown = (e) => {
        if (e.key === 'Enter') closeAppDialog(inputField.value);
        else if (e.key === 'Escape') closeAppDialog(null);
      };
    }

    const btnCancel = document.getElementById('dialog-btn-cancel');
    if (btnCancel) {
      btnCancel.textContent = cancelText;
      btnCancel.style.display = 'inline-block';
    }

    const btnConfirm = document.getElementById('dialog-btn-confirm');
    if (btnConfirm) {
      btnConfirm.textContent = confirmText;
      btnConfirm.className = 'btn btn-accent';
    }

    showModal('app-dialog-modal');
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
      inputField?.focus();
      inputField?.select();
    }, 50);
  });
}

function closeAppDialog(result) {
  closeModal('app-dialog-modal');
  if (currentDialogResolver) {
    if (document.getElementById('dialog-input-group')?.style.display !== 'none' && result === true) {
      result = document.getElementById('dialog-input-field')?.value;
    }
    const resolver = currentDialogResolver;
    currentDialogResolver = null;
    resolver(result);
  }
}

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const safeMsg = sanitizeCredentials(message);
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.setProperty('--toast-duration', `${duration / 1000}s`);

  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  else if (type === 'error') iconName = 'alert-triangle';
  else if (type === 'warning') iconName = 'alert-circle';

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 16px; height: 16px; flex-shrink: 0;"></i>
    <span>${escapeHtml(safeMsg)}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) lucide.createIcons({ root: toast });

  setTimeout(() => {
    toast.remove();
  }, duration + 300);
}

function setupHistoryNavigation() {
  if (!window.history || !history.pushState) return;

  // Set initial state
  history.replaceState({ type: 'dir', paneIndex: App.activePaneIndex, path: App.panes[App.activePaneIndex]?.path || '/' }, '', '');

  window.addEventListener('popstate', (e) => {
    // 1. If any modal is active, close it!
    const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      if (topModal.id === 'media-player-modal') {
        closeMediaPlayer();
      } else {
        topModal.classList.remove('active');
      }
      history.pushState({ type: 'dir', paneIndex: App.activePaneIndex, path: App.panes[App.activePaneIndex]?.path || '/' }, '', '');
      return;
    }

    // 2. If terminal drawer is open, close it!
    const termDrawer = document.getElementById('terminal-drawer');
    if (termDrawer && termDrawer.classList.contains('active')) {
      toggleTerminal(false);
      history.pushState({ type: 'dir', paneIndex: App.activePaneIndex, path: App.panes[App.activePaneIndex]?.path || '/' }, '', '');
      return;
    }

    // 4. If floating task manager is open, minimize/close it!
    const taskWin = document.getElementById('floating-task-manager');
    if (taskWin && taskWin.classList.contains('active') && !taskWin.classList.contains('minimized')) {
      minimizeFloatingTaskManager();
      history.pushState({ type: 'dir', paneIndex: App.activePaneIndex, path: App.panes[App.activePaneIndex]?.path || '/' }, '', '');
      return;
    }

    // 4. Directory Navigation
    if (e.state && e.state.type === 'dir' && e.state.path) {
      loadPaneDirectory(e.state.paneIndex ?? App.activePaneIndex, e.state.path, false);
    } else {
      const pane = App.panes[App.activePaneIndex];
      if (pane && pane.path !== '/' && pane.path !== '') {
        navPaneUp(App.activePaneIndex);
      }
      history.pushState({ type: 'dir', paneIndex: App.activePaneIndex, path: pane?.path || '/' }, '', '');
    }
  });
}

function formatDate(timestampSec) {
  if (!timestampSec) return '-';
  const d = new Date(timestampSec * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toggleFKeyBar(show) {
  App.showFKeyBar = show;
  localStorage.setItem('cd_show_fkeys', show);
  applyFKeyBarState();
}

function toggleWindowDecorations(show) {
  App.windowDecorations = show;
  localStorage.setItem('cd_window_decorations', show);
  const cb = document.getElementById('setting-window-decorations');
  if (cb) cb.checked = show;
  showToast(show ? 'Window titlebar & frame enabled (restart to apply)' : 'Window decorations disabled (Borderless/Tiling mode for Hyprland)', 'info');
}

function applyFKeyBarState() {
  const bar = document.querySelector('.bottom-fkey-bar');
  if (bar) {
    if (App.showFKeyBar) bar.classList.remove('fkey-hidden');
    else bar.classList.add('fkey-hidden');
  }
  const checkbox = document.getElementById('setting-show-fkeys');
  if (checkbox) checkbox.checked = App.showFKeyBar;
}

function handleFontSizeChange(val) {
  App.fontSize = parseInt(val, 10);
  localStorage.setItem('cd_font_size', App.fontSize);
  applyFontSize(App.fontSize);
}

function setFontSizePreset(val) {
  const slider = document.getElementById('setting-font-size-slider');
  if (slider) slider.value = val;
  handleFontSizeChange(val);
}

function applyFontSize(val) {
  document.documentElement.style.setProperty('--base-font-size', `${val}px`);
  document.body.style.fontSize = `${val}px`;
  const badge = document.getElementById('setting-font-size-val');
  if (badge) badge.textContent = `${val}px`;
  const slider = document.getElementById('setting-font-size-slider');
  if (slider) slider.value = val;
}

// ---------------- REMOTE SFTP / WEBDAV & GLOBAL MOUNTS ----------------
let targetRemotePaneIndex = 0;

async function openRemoteModal(paneIndex, asGlobalAdmin = false) {
  targetRemotePaneIndex = paneIndex;
  document.getElementById('remote-test-status').style.display = 'none';

  const isAdmin = App.user?.role === 'admin';
  const globalSection = document.getElementById('remote-global-mount-section');
  if (globalSection) globalSection.style.display = isAdmin ? 'block' : 'none';

  const globalCheckbox = document.getElementById('remote-is-global-mount');
  if (globalCheckbox) {
    globalCheckbox.checked = asGlobalAdmin;
    toggleRemoteGlobalMountUI(asGlobalAdmin);
  }

  // Populate users list for mount permissions
  if (isAdmin) {
    const userContainer = document.getElementById('remote-mount-users-checkboxes');
    if (userContainer) {
      userContainer.innerHTML = '<div>Loading users...</div>';
      try {
        const resp = await fetch('/api/auth/users', {
          headers: { 'Authorization': `Bearer ${App.token}` }
        });
        if (resp.ok) {
          const users = await resp.json();
          userContainer.innerHTML = users.map(u => `
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: normal;">
              <input type="checkbox" class="mount-user-cb" value="${escapeHtml(u.username)}" checked>
              <span>${escapeHtml(u.username)} ${u.nickname ? `(${escapeHtml(u.nickname)})` : ''}</span>
            </label>
          `).join('');
        }
      } catch (err) {
        userContainer.innerHTML = '<div>Failed to load users</div>';
      }
    }
  }

  showModal('remote-modal');
  updateRemoteProtoUI();
}

function toggleRemoteGlobalMountUI(checked) {
  const opts = document.getElementById('remote-global-mount-options');
  const saveBtn = document.getElementById('btn-save-global-mount');
  const connectBtn = document.getElementById('btn-connect-remote');

  if (opts) opts.style.display = checked ? 'block' : 'none';
  if (saveBtn) saveBtn.style.display = checked ? 'inline-flex' : 'none';
  if (connectBtn) connectBtn.textContent = checked ? 'Connect & Also Mount to Active Pane' : 'Connect to Active Pane';
}

function toggleMountAllUsers(checked) {
  document.querySelectorAll('.mount-user-cb').forEach(cb => {
    cb.checked = checked;
  });
}

async function saveGlobalRemoteMount() {
  const proto = document.getElementById('remote-proto-select').value;
  const host = document.getElementById('remote-host')?.value.trim() || '';
  const port = parseInt(document.getElementById('remote-port')?.value || '22', 10);
  const user = document.getElementById('remote-user')?.value.trim() || '';
  const pass = document.getElementById('remote-pass')?.value || '';
  const path = document.getElementById('remote-path')?.value || '/';
  const mountName = document.getElementById('remote-global-mount-name')?.value.trim() || `${proto.toUpperCase()} - ${host}`;

  let target_uri = '';
  if (proto === 'sftp') {
    if (!host) { showToast('Please specify host', 'warning'); return; }
    target_uri = `sftp://${user ? `${user}@` : ''}${host}:${port}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 'smb') {
    const share = document.getElementById('remote-smb-share')?.value || '';
    const domain = document.getElementById('remote-smb-domain')?.value || '';
    if (!host || !share) { showToast('Please specify Samba host and share name', 'warning'); return; }
    const domPrefix = domain && domain !== 'WORKGROUP' ? `${domain};` : '';
    const userAuth = user ? (pass ? `${domPrefix}${user}:${pass}@` : `${domPrefix}${user}@`) : '';
    const portSuffix = port !== 445 ? `:${port}` : '';
    const sub = path.startsWith('/') ? path : '/' + path;
    target_uri = `smb://${userAuth}${host}${portSuffix}/${share}${sub === '/' ? '' : sub}`;
  } else if (proto === 'nfs') {
    const exportPath = document.getElementById('remote-nfs-export')?.value || '/';
    if (!host) { showToast('Please specify NFS host', 'warning'); return; }
    const portSuffix = port !== 2049 ? `:${port}` : '';
    const cleanExport = exportPath.startsWith('/') ? exportPath : '/' + exportPath;
    const sub = path && path !== '/' ? (path.startsWith('/') ? path : '/' + path) : '';
    target_uri = `nfs://${host}${portSuffix}${cleanExport}${sub}`;
  } else if (proto === 'webdav') {
    if (!host) { showToast('Please specify WebDAV URL', 'warning'); return; }
    target_uri = `webdav://${host.replace(/^https?:\/\//, '')}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 's3') {
    const bucket = document.getElementById('remote-bucket')?.value || '';
    if (!bucket) { showToast('Please specify S3 bucket name', 'warning'); return; }
    target_uri = `s3://${bucket}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 'hetzner-box') {
    const hMode = document.getElementById('hetzner-mode')?.value || 'sftp';
    if (hMode === 'sftp') {
      target_uri = `sftp://${user}@${host}:${port}${path.startsWith('/') ? path : '/' + path}`;
    } else {
      target_uri = `webdav://${host.replace(/^https?:\/\//, '')}${path.startsWith('/') ? path : '/' + path}`;
    }
  } else {
    target_uri = path;
  }

  const allUsers = document.getElementById('remote-mount-all-users')?.checked;
  const allowed_users = [];
  if (allUsers) {
    allowed_users.push('*');
  } else {
    document.querySelectorAll('.mount-user-cb:checked').forEach(cb => {
      allowed_users.push(cb.value);
    });
    if (allowed_users.length === 0) {
      showToast('Please select at least one user or choose All Users (*)', 'warning');
      return;
    }
  }

  try {
    const resp = await fetch('/api/mounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({
        name: mountName,
        protocol: proto,
        target_uri: target_uri,
        options_json: JSON.stringify({ host, port, user, pass, path }),
        allowed_users: allowed_users
      })
    });

    if (resp.ok) {
      showToast(`Global mount '${mountName}' saved! Assigned users will see it in Favorites automatically.`, 'success');
      closeModal('remote-modal');
      loadAdminGlobalMounts();
    } else {
      showToast(`Failed to save global mount: ${await resp.text()}`, 'error');
    }
  } catch (err) {
    showToast(`Save error: ${err}`, 'error');
  }
}

async function loadAdminGlobalMounts() {
  const tbody = document.getElementById('admin-global-mounts-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 16px;">Loading global network mounts...</td></tr>';

  const protoIcons = {
    'smb': 'share-2',
    'nfs': 'server',
    's3': 'cloud',
    'sftp': 'terminal',
    'webdav': 'globe',
    'hetzner-box': 'box',
    'proton': 'shield'
  };

  try {
    const resp = await fetch('/api/mounts/all', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      const mounts = await resp.json();
      if (mounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 16px; color: var(--text-dim);">No global network mounts configured yet. Click "+ Add Global Mount" above to create one.</td></tr>';
        return;
      }

      tbody.innerHTML = mounts.map(m => {
        let allowed = [];
        try {
          allowed = typeof m.allowed_users === 'string' ? JSON.parse(m.allowed_users) : m.allowed_users;
        } catch (_) {
          allowed = ['*'];
        }
        const hasAll = allowed.includes('*');

        return `
          <tr class="admin-user-row">
            <td class="admin-user-cell">
              <div style="font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                <i data-lucide="${protoIcons[m.protocol] || 'network'}" style="width: 16px; color: var(--accent);"></i>
                <span>${escapeHtml(m.name)}</span>
              </div>
            </td>
            <td class="admin-user-cell">
              <span class="badge" style="font-size: 10px; text-transform: uppercase;">${escapeHtml(m.protocol)}</span>
            </td>
            <td class="admin-user-cell file-cell-mono" style="font-size: 11px;">
              ${escapeHtml(m.target_uri)}
            </td>
            <td class="admin-user-cell">
              ${hasAll ? `
                <span class="badge" style="font-size: 10px; background: rgba(34, 197, 94, 0.2); color: var(--success); border: 1px solid rgba(34, 197, 94, 0.35);">ALL USERS (*)</span>
              ` : `
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  ${allowed.map(u => `<span class="badge" style="font-size: 10px; background: rgba(56, 189, 248, 0.15); color: var(--info); border: 1px solid rgba(56, 189, 248, 0.3);">${escapeHtml(u)}</span>`).join('')}
                </div>
              `}
            </td>
            <td class="admin-user-cell" style="text-align: center;">
              <div style="display: flex; gap: 6px; justify-content: center;">
                <button class="btn" style="padding: 5px 10px; font-size: 11px;" onclick="loadPaneDirectory(App.activePaneIndex, '${escapeHtml(m.target_uri)}'); closeModal('admin-panel-modal');" title="Open in active panel">
                  <i data-lucide="folder-open" style="width: 12px;"></i> Open
                </button>
                <button class="btn btn-danger" style="padding: 5px 8px; font-size: 11px;" onclick="deleteGlobalMount(${m.id}, '${escapeHtml(m.name)}')" title="Delete Mount">
                  <i data-lucide="trash-2" style="width: 12px;"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color: var(--danger); padding: 16px;">Failed to load global mounts: ${err}</td></tr>`;
  }
}

async function deleteGlobalMount(id, name) {
  const confirmed = await showConfirmDialog({
    title: 'Remove Global Mount',
    subtitle: 'Remote Storage Management',
    message: `Are you sure you want to remove global network mount '${name}'?`,
    icon: 'network',
    type: 'danger',
    confirmText: 'Remove Mount',
    cancelText: 'Cancel',
  });
  if (!confirmed) return;

  try {
    const resp = await fetch(`/api/mounts/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      showToast(`Global mount '${name}' removed`, 'success');
      loadAdminGlobalMounts();
    } else {
      showToast(`Failed to delete mount: ${await resp.text()}`, 'error');
    }
  } catch (err) {
    showToast(`Delete error: ${err}`, 'error');
  }
}

function syncHetznerFields() {
  const user = document.getElementById('hetzner-user')?.value.trim() || 'u123456';
  const mode = document.getElementById('hetzner-mode')?.value || 'sftp';
  const preview = document.getElementById('hetzner-preview-host');
  const hostInput = document.getElementById('remote-host');
  const portInput = document.getElementById('remote-port');
  const userInput = document.getElementById('remote-user');

  if (mode === 'sftp') {
    if (preview) preview.textContent = `${user}.your-storagebox.de:23 (SFTP)`;
    if (hostInput) hostInput.value = `${user}.your-storagebox.de`;
    if (portInput) portInput.value = '23';
    if (userInput) userInput.value = user;
  } else {
    if (preview) preview.textContent = `https://${user}.your-storagebox.de (WebDAV)`;
    if (hostInput) hostInput.value = `https://${user}.your-storagebox.de`;
    if (portInput) portInput.value = '443';
    if (userInput) userInput.value = user;
  }
}

async function updateRemoteProtoUI() {
  const proto = document.getElementById('remote-proto-select').value;
  const portGroup = document.getElementById('remote-port-group');
  const portInput = document.getElementById('remote-port');
  const s3Group = document.getElementById('remote-s3-group');
  const smbGroup = document.getElementById('remote-smb-group');
  const nfsGroup = document.getElementById('remote-nfs-group');
  const standardGroup = document.getElementById('remote-standard-group');
  const protonGroup = document.getElementById('remote-proton-group');
  const hetznerGroup = document.getElementById('remote-hetzner-group');
  const hostInput = document.getElementById('remote-host');
  const hostLabel = document.getElementById('remote-host-label');
  const userLabel = document.getElementById('remote-user-label');
  const passLabel = document.getElementById('remote-pass-label');

  if (hetznerGroup) hetznerGroup.style.display = proto === 'hetzner-box' ? 'block' : 'none';
  if (smbGroup) smbGroup.style.display = proto === 'smb' ? 'grid' : 'none';
  if (nfsGroup) nfsGroup.style.display = proto === 'nfs' ? 'block' : 'none';

  if (proto === 'sftp') {
    if (standardGroup) standardGroup.style.display = 'block';
    if (protonGroup) protonGroup.style.display = 'none';
    if (portGroup) portGroup.style.display = 'block';
    if (portInput) portInput.value = '22';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'Server Host / IP:';
    if (userLabel) userLabel.textContent = 'SSH Username:';
    if (passLabel) passLabel.textContent = 'SSH Password / Key:';
    if (hostInput) hostInput.placeholder = 'e.g. 192.168.1.100 or sftp.example.com';
  } else if (proto === 'smb') {
    if (standardGroup) standardGroup.style.display = 'block';
    if (protonGroup) protonGroup.style.display = 'none';
    if (portGroup) portGroup.style.display = 'block';
    if (portInput) portInput.value = '445';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'Samba Server / NAS Host:';
    if (userLabel) userLabel.textContent = 'SMB Username (or blank for guest):';
    if (passLabel) passLabel.textContent = 'SMB Password:';
    if (hostInput) hostInput.placeholder = 'e.g. 192.168.1.50 or my-nas.local';
  } else if (proto === 'nfs') {
    if (standardGroup) standardGroup.style.display = 'block';
    if (protonGroup) protonGroup.style.display = 'none';
    if (portGroup) portGroup.style.display = 'block';
    if (portInput) portInput.value = '2049';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'NFS Server Host / IP:';
    if (userLabel) userLabel.textContent = 'NFS User (Optional):';
    if (passLabel) passLabel.textContent = 'Password (Optional):';
    if (hostInput) hostInput.placeholder = 'e.g. 192.168.1.50 or nfs-server.local';
  } else if (proto === 'hetzner-box') {
    if (standardGroup) standardGroup.style.display = 'block';
    if (protonGroup) protonGroup.style.display = 'none';
    if (portGroup) portGroup.style.display = 'block';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'Storage Box Host:';
    if (userLabel) userLabel.textContent = 'Storage Box User:';
    if (passLabel) passLabel.textContent = 'Storage Box Password / Key:';
    syncHetznerFields();
  } else if (proto === 'webdav') {
    if (standardGroup) standardGroup.style.display = 'block';
    if (protonGroup) protonGroup.style.display = 'none';
    if (portGroup) portGroup.style.display = 'none';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'WebDAV URL:';
    if (userLabel) userLabel.textContent = 'WebDAV Username:';
    if (passLabel) passLabel.textContent = 'WebDAV Password / Token:';
    if (hostInput) hostInput.placeholder = 'e.g. http://192.168.1.100:80/remote.php/webdav/';
  } else if (proto === 's3') {
    if (standardGroup) standardGroup.style.display = 'block';
    if (protonGroup) protonGroup.style.display = 'none';
    if (portGroup) portGroup.style.display = 'none';
    if (s3Group) s3Group.style.display = 'grid';
    if (hostLabel) hostLabel.textContent = 'S3 Endpoint URL:';
    if (userLabel) userLabel.textContent = 'Access Key ID:';
    if (passLabel) passLabel.textContent = 'Secret Access Key:';
    if (hostInput) hostInput.placeholder = 'e.g. https://s3.amazonaws.com or https://fsn1.your-objectstorage.com';
  } else if (proto === 'proton') {
    if (standardGroup) standardGroup.style.display = 'none';
    if (protonGroup) protonGroup.style.display = 'block';

    const badge = document.getElementById('proton-cli-status-badge');
    if (badge) badge.innerHTML = '<span style="color: var(--accent);">Checking Proton Drive CLI / daemon status...</span>';

    try {
      const resp = await fetch('/api/remotes/proton/status', {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        const st = await resp.json();
        if (st.installed) {
          badge.innerHTML = `🟢 <b>Detected Backend:</b> ${st.cli_type} (${st.version || 'active'}) &nbsp;|&nbsp; <b>Auth:</b> ${st.authenticated ? '✅ Ready' : '⚠️ Not Logged In'}`;
        } else {
          badge.innerHTML = `⚪ <b>Proton CLI Not Detected:</b> Run <code>proton-drive login</code> or configure an <code>rclone</code> proton remote.`;
        }
      }
    } catch (e) {
      if (badge) badge.textContent = `Status check error: ${e}`;
    }
  }
}

async function testRemoteConnection() {
  let proto = document.getElementById('remote-proto-select').value;
  const host = document.getElementById('remote-host')?.value || '';
  const port = parseInt(document.getElementById('remote-port')?.value || '22', 10);
  const user = document.getElementById('remote-user')?.value || '';
  const pass = document.getElementById('remote-pass')?.value || '';
  let bucket = document.getElementById('remote-bucket')?.value || '';
  let region = document.getElementById('remote-region')?.value || 'us-east-1';

  if (proto === 'hetzner-box') {
    const hMode = document.getElementById('hetzner-mode')?.value || 'sftp';
    proto = hMode;
  } else if (proto === 'smb') {
    bucket = document.getElementById('remote-smb-share')?.value || '';
    region = document.getElementById('remote-smb-domain')?.value || 'WORKGROUP';
  } else if (proto === 'nfs') {
    bucket = document.getElementById('remote-nfs-export')?.value || '/';
  }

  const status = document.getElementById('remote-test-status');
  status.style.display = 'block';
  status.style.color = 'var(--accent)';
  status.textContent = 'Testing connection...';

  try {
    const resp = await fetch('/api/remotes/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ protocol: proto, host, port, user, pass, bucket, region })
    });

    if (resp.ok) {
      const data = await resp.json();
      status.style.color = data.success ? 'var(--success)' : 'var(--warning)';
      status.textContent = `${data.success ? '✓' : '⚠️'} ${data.message}`;
    } else {
      status.style.color = 'var(--danger)';
      status.textContent = `✗ ${await resp.text()}`;
    }
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = `✗ Error: ${e}`;
  }
}

function connectRemoteToActivePane() {
  const proto = document.getElementById('remote-proto-select').value;
  const host = document.getElementById('remote-host')?.value.trim() || '';
  const port = parseInt(document.getElementById('remote-port')?.value || '22', 10);
  const user = document.getElementById('remote-user')?.value.trim() || '';
  const pass = document.getElementById('remote-pass')?.value || '';
  const bucket = document.getElementById('remote-bucket')?.value.trim() || '';
  const path = document.getElementById('remote-path')?.value || '/';

  let remoteUrl = '';
  if (proto === 'sftp') {
    if (!host) { showToast('Please specify a server host / URL', 'warning'); return; }
    remoteUrl = `sftp://${user}@${host}:${port}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 'smb') {
    const share = document.getElementById('remote-smb-share')?.value || '';
    const domain = document.getElementById('remote-smb-domain')?.value || '';
    if (!host) { showToast('Please specify Samba / NAS host', 'warning'); return; }
    if (!share) { showToast('Please specify Share Name (e.g. public or data)', 'warning'); return; }
    const domPrefix = domain && domain !== 'WORKGROUP' ? `${domain};` : '';
    const userAuth = user ? (pass ? `${domPrefix}${user}:${pass}@` : `${domPrefix}${user}@`) : '';
    const portSuffix = port !== 445 ? `:${port}` : '';
    const sub = path.startsWith('/') ? path : '/' + path;
    remoteUrl = `smb://${userAuth}${host}${portSuffix}/${share}${sub === '/' ? '' : sub}`;
  } else if (proto === 'nfs') {
    const exportPath = document.getElementById('remote-nfs-export')?.value || '/';
    if (!host) { showToast('Please specify NFS host', 'warning'); return; }
    const portSuffix = port !== 2049 ? `:${port}` : '';
    const cleanExport = exportPath.startsWith('/') ? exportPath : '/' + exportPath;
    const sub = path && path !== '/' ? (path.startsWith('/') ? path : '/' + path) : '';
    remoteUrl = `nfs://${host}${portSuffix}${cleanExport}${sub}`;
  } else if (proto === 'hetzner-box') {
    const hMode = document.getElementById('hetzner-mode')?.value || 'sftp';
    if (hMode === 'sftp') {
      remoteUrl = `sftp://${user}@${host}:${port}${path.startsWith('/') ? path : '/' + path}`;
    } else {
      remoteUrl = `webdav://${host.replace(/^https?:\/\//, '')}${path.startsWith('/') ? path : '/' + path}`;
    }
  } else if (proto === 'webdav') {
    if (!host) { showToast('Please specify a server host / URL', 'warning'); return; }
    remoteUrl = `webdav://${host.replace(/^https?:\/\//, '')}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 's3') {
    if (!host) { showToast('Please specify S3 endpoint', 'warning'); return; }
    remoteUrl = `s3://${bucket}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 'proton') {
    remoteUrl = `proton://${path.startsWith('/') ? path.substring(1) : path}`;
  }
  closeModal('remote-modal');
  loadPaneDirectory(targetRemotePaneIndex, remoteUrl);
}

// ---------------- INTEGRATED TERMINAL (PTY & WEBSOCKET) ----------------
let termWs = null;
let termOpen = false;
let termInstance = null;
let termFitAddon = null;

function initTerminalUI() {
  const container = document.getElementById('terminal-output');
  if (!container) return;

  if (window.Terminal && !termInstance) {
    container.innerHTML = '';
    termInstance = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#090a0d',
        foreground: '#f4f4f5',
        cursor: '#f59e0b',
        cursorAccent: '#090a0d',
        selectionBackground: 'rgba(245, 158, 11, 0.35)',
        black: '#18181b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#38bdf8',
        magenta: '#bd93f9',
        cyan: '#7dcfff',
        white: '#f4f4f5',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#a5f3fc',
        brightWhite: '#ffffff',
      }
    });

    if (window.FitAddon) {
      termFitAddon = new FitAddon.FitAddon();
      termInstance.loadAddon(termFitAddon);
    }
    if (window.WebLinksAddon) {
      termInstance.loadAddon(new WebLinksAddon.WebLinksAddon());
    }

    termInstance.open(container);
    if (termFitAddon) {
      setTimeout(() => termFitAddon.fit(), 50);
    }

    termInstance.onData((data) => {
      if (termWs && termWs.readyState === WebSocket.OPEN) {
        termWs.send(data);
      }
    });

    termInstance.onResize(({ cols, rows }) => {
      if (termWs && termWs.readyState === WebSocket.OPEN) {
        termWs.send(JSON.stringify({ cols, rows, resize: true }));
      }
    });
  }
}

function toggleTerminal(forceState) {
  if (forceState && typeof forceState === 'object' && forceState.stopPropagation) {
    forceState.stopPropagation();
    forceState = undefined;
  }
  const drawer = document.getElementById('terminal-drawer');
  if (!drawer) return;

  termOpen = typeof forceState === 'boolean' ? forceState : !termOpen;

  if (termOpen) {
    drawer.classList.add('active');
    const activePane = App.panes[App.activePaneIndex];
    const cwd = (activePane && !activePane.path.includes('://')) ? activePane.path : '/';
    document.getElementById('terminal-cwd-indicator').textContent = cwd;

    initTerminalUI();

    setTimeout(() => {
      if (termFitAddon) termFitAddon.fit();
      if (termInstance) termInstance.focus();
    }, 100);

    connectTerminal(cwd);
  } else {
    drawer.classList.remove('active');
    if (termWs) {
      termWs.close();
      termWs = null;
    }
  }
  if (window.lucide) lucide.createIcons();
}

function toggleTerminalFullscreen() {
  const drawer = document.getElementById('terminal-drawer');
  if (!drawer) return;
  drawer.classList.toggle('fullscreen');
  setTimeout(() => {
    if (termFitAddon) {
      termFitAddon.fit();
      if (termWs && termWs.readyState === WebSocket.OPEN && termInstance) {
        termWs.send(JSON.stringify({ cols: termInstance.cols, rows: termInstance.rows, resize: true }));
      }
    }
    if (termInstance) termInstance.focus();
  }, 100);
}

function clearTerminal() {
  if (termInstance) {
    termInstance.clear();
    termInstance.focus();
  } else {
    const out = document.getElementById('terminal-output');
    if (out) out.innerHTML = '';
  }
}

function getAppBasePath() {
  const path = window.location.pathname;
  if (!path || path === '/' || path.endsWith('/index.html')) {
    return '';
  }
  return path.endsWith('/') ? path.slice(0, -1) : path.replace(/\/[^\/]*$/, '');
}

function getWsUrl(endpoint) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = getAppBasePath();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${protocol}//${window.location.host}${basePath}${cleanEndpoint}`;
}

function connectTerminal(cwd) {
  if (termWs) {
    termWs.close();
  }

  const cols = termInstance ? termInstance.cols : 100;
  const rows = termInstance ? termInstance.rows : 24;
  const url = `${getWsUrl('/api/ws/terminal')}?cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;

  termWs = new WebSocket(url);
  termWs.binaryType = 'arraybuffer';

  termWs.onopen = () => {
    if (termInstance) {
      termInstance.writeln('\x1b[38;5;214mCommanderDog PTY Session Connected\x1b[0m [\x1b[38;5;244mcwd:\x1b[0m ' + cwd + ']\r\n');
      termInstance.focus();
    }
  };

  termWs.onmessage = (e) => {
    if (termInstance) {
      if (e.data instanceof ArrayBuffer) {
        termInstance.write(new Uint8Array(e.data));
      } else {
        termInstance.write(e.data);
      }
    } else {
      appendTerminalTextFallback(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
    }
  };

  termWs.onclose = () => {
    if (termInstance) {
      termInstance.writeln('\r\n\x1b[38;5;244m[Terminal Session Disconnected]\x1b[0m');
    }
  };

  termWs.onerror = (err) => {
    if (termInstance) {
      termInstance.writeln('\r\n\x1b[38;5;196m[Terminal Error: ' + err + ']\x1b[0m');
    }
  };
}

function appendTerminalTextFallback(str) {
  const out = document.getElementById('terminal-output');
  if (!out) return;
  out.textContent += str;
  out.scrollTop = out.scrollHeight;
}

// ---------------- TERACOPY-STYLE FLOATING TASK & TRANSFER MANAGER ----------------
let tasksPollTimer = null;
let lastKnownTasksList = [];
let wasAnyRunningLastCheck = false;

function startTasksPolling() {
  if (tasksPollTimer) clearInterval(tasksPollTimer);
  tasksPollTimer = setInterval(pollTasks, 1500);
  initTaskWindowDragResize();
  initMobileDrawerGestures();
}

function toggleFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  if (win && win.classList.contains('active') && !win.classList.contains('minimized')) {
    closeFloatingTaskManager();
  } else {
    openFloatingTaskManager();
  }
}

function openFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  const pill = document.getElementById('tasks-pill');
  const backdrop = document.getElementById('task-drawer-backdrop');

  if (win) {
    win.classList.remove('minimized', 'drawer-dragging');
    win.classList.add('active');
    if (window.innerWidth <= 768) {
      win.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      win.style.transform = 'translateY(0)';
    } else {
      win.style.transform = '';
      win.style.transition = '';
    }
  }
  if (backdrop && window.innerWidth <= 768) {
    backdrop.classList.add('active');
    backdrop.style.transition = 'opacity 0.25s ease';
    backdrop.style.opacity = '1';
  }
  if (pill) pill.classList.remove('active');
  App.taskManagerVisible = true;
  App.taskManagerMinimized = false;

  const sel = document.getElementById('setting-task-verbosity');
  if (sel) sel.value = App.taskVerbosity;
  applyTaskVerbosityUI(App.taskVerbosity);

  initMobileDrawerGestures();
  pollTasks();
}

function closeFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  const backdrop = document.getElementById('task-drawer-backdrop');
  if (win) {
    if (window.innerWidth <= 768) {
      win.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      win.style.transform = 'translateY(100%)';
      if (backdrop) {
        backdrop.style.transition = 'opacity 0.22s ease';
        backdrop.style.opacity = '0';
      }
      setTimeout(() => {
        win.classList.remove('active', 'minimized', 'maximized', 'drawer-dragging');
        win.style.transform = '';
        win.style.transition = '';
        if (backdrop) {
          backdrop.classList.remove('active');
          backdrop.style.opacity = '';
        }
      }, 220);
    } else {
      win.classList.remove('active', 'minimized', 'maximized');
      win.style.transform = '';
      win.style.transition = '';
      if (backdrop) {
        backdrop.classList.remove('active');
        backdrop.style.opacity = '';
      }
    }
  }
  App.taskManagerVisible = false;
  App.taskManagerMinimized = false;
  updateTasksPillState(lastKnownTasksList);
}

function minimizeFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  const backdrop = document.getElementById('task-drawer-backdrop');
  if (win) win.classList.add('minimized');
  if (backdrop) {
    backdrop.classList.remove('active');
    backdrop.style.opacity = '';
  }
  App.taskManagerMinimized = true;
  updateTasksPillState(lastKnownTasksList);
}

function initMobileDrawerGestures() {
  const win = document.getElementById('floating-task-manager');
  const pullBar = win?.querySelector('.drawer-pull-bar');
  const header = document.getElementById('task-win-header');
  const backdrop = document.getElementById('task-drawer-backdrop');
  const peekBar = document.getElementById('mobile-task-peek-bar');

  if (!win || win.dataset.drawerGesturesInit) return;
  win.dataset.drawerGesturesInit = 'true';

  // --- 1. Pull DOWN to close (when drawer is open) ---
  let downStartX = 0, downStartY = 0, downStartTime = 0;
  let isDraggingDown = false;
  let currentDownDy = 0;

  function onDownTouchStart(e) {
    if (window.innerWidth > 768) return;
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;

    downStartX = e.touches[0].clientX;
    downStartY = e.touches[0].clientY;
    downStartTime = Date.now();
    isDraggingDown = false;
    currentDownDy = 0;

    window.addEventListener('touchmove', onDownTouchMove, { passive: false });
    window.addEventListener('touchend', onDownTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onDownTouchEnd, { passive: true });
  }

  function onDownTouchMove(e) {
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = Math.abs(currentX - downStartX);
    const dy = currentY - downStartY;

    if (!isDraggingDown) {
      if (dy > 15 && dy > dx * 1.1) {
        isDraggingDown = true;
        win.classList.add('drawer-dragging');
        win.style.transition = 'none';
      } else {
        return;
      }
    }

    currentDownDy = Math.max(0, dy);
    win.style.transform = `translateY(${currentDownDy}px)`;
    if (backdrop) {
      const opacity = Math.max(0, 1 - currentDownDy / 260);
      backdrop.style.opacity = `${opacity}`;
    }
    if (e.cancelable) e.preventDefault();
  }

  function onDownTouchEnd() {
    window.removeEventListener('touchmove', onDownTouchMove);
    window.removeEventListener('touchend', onDownTouchEnd);
    window.removeEventListener('touchcancel', onDownTouchEnd);

    if (!isDraggingDown) return;
    isDraggingDown = false;
    win.classList.remove('drawer-dragging');

    const duration = Date.now() - downStartTime;
    const velocity = currentDownDy / Math.max(1, duration);

    if (currentDownDy > 70 || velocity > 0.4) {
      closeFloatingTaskManager();
    } else {
      win.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      win.style.transform = 'translateY(0)';
      if (backdrop) {
        backdrop.style.transition = 'opacity 0.22s ease';
        backdrop.style.opacity = '1';
      }
    }
  }

  if (pullBar) pullBar.addEventListener('touchstart', onDownTouchStart, { passive: true });
  if (header) header.addEventListener('touchstart', onDownTouchStart, { passive: true });

  // --- 2. Pull UP to open (from persistent bottom peek tab) ---
  if (peekBar) {
    let upStartX = 0, upStartY = 0, upStartTime = 0;
    let isDraggingUp = false;
    let currentUpDy = 0;
    let drawerH = 0;

    peekBar.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 768) return;
      upStartX = e.touches[0].clientX;
      upStartY = e.touches[0].clientY;
      upStartTime = Date.now();
      isDraggingUp = false;
      currentUpDy = 0;
      drawerH = win.offsetHeight || 520;

      window.addEventListener('touchmove', onUpTouchMove, { passive: false });
      window.addEventListener('touchend', onUpTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onUpTouchEnd, { passive: true });
    }, { passive: false });

    function onUpTouchMove(e) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const dx = Math.abs(currentX - upStartX);
      const dy = upStartY - currentY; // positive when pulling UP

      if (!isDraggingUp) {
        if (dy > 12 && dy > dx * 1.1) {
          isDraggingUp = true;
          drawerH = win.offsetHeight || 520;
          win.classList.remove('minimized');
          win.classList.add('drawer-dragging');
          win.style.transition = 'none';
          win.style.transform = `translateY(${Math.max(0, drawerH - dy)}px)`;
          if (backdrop) {
            backdrop.classList.add('active');
            backdrop.style.opacity = '0';
          }
        } else {
          return;
        }
      }

      currentUpDy = dy;
      const targetTranslate = Math.max(0, drawerH - dy);
      win.style.transform = `translateY(${targetTranslate}px)`;
      if (backdrop) {
        const opacity = Math.min(1, dy / (drawerH * 0.6));
        backdrop.style.opacity = `${opacity}`;
      }
      if (e.cancelable) e.preventDefault();
    }

    function onUpTouchEnd(e) {
      window.removeEventListener('touchmove', onUpTouchMove);
      window.removeEventListener('touchend', onUpTouchEnd);
      window.removeEventListener('touchcancel', onUpTouchEnd);

      if (!isDraggingUp) {
        return;
      }

      isDraggingUp = false;
      win.classList.remove('drawer-dragging');

      const duration = Date.now() - upStartTime;
      const velocity = currentUpDy / Math.max(1, duration);

      if (currentUpDy > 60 || velocity > 0.35) {
        openFloatingTaskManager();
      } else {
        closeFloatingTaskManager();
      }
    }
  }
}

function restoreFloatingTaskManager() {
  openFloatingTaskManager();
}

function maximizeFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  if (win) win.classList.toggle('maximized');
}

function setTaskVerbosity(mode) {
  App.taskVerbosity = mode;
  localStorage.setItem('cd_task_verbosity', mode);
  applyTaskVerbosityUI(mode);
}

function applyTaskVerbosityUI(mode) {
  const queueCont = document.getElementById('task-queue-container');
  const logCont = document.getElementById('task-log-container');
  const activeFileCard = document.getElementById('task-active-file-card');

  if (mode === 'compact') {
    if (queueCont) queueCont.style.display = 'none';
    if (logCont) logCont.style.display = 'none';
    if (activeFileCard) activeFileCard.style.display = 'block';
  } else if (mode === 'log') {
    if (queueCont) queueCont.style.display = 'none';
    if (logCont) logCont.style.display = 'block';
    if (activeFileCard) activeFileCard.style.display = 'block';
  } else { // 'detailed' (TeraCopy standard)
    if (queueCont) queueCont.style.display = 'block';
    if (logCont) logCont.style.display = 'none';
    if (activeFileCard) activeFileCard.style.display = 'block';
  }
}

let knownCompletedTasks = new Set();

async function pollTasks() {
  if (!App.token) return;

  try {
    const res = await fetch('/api/tasks', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (res.ok) {
      const list = await res.json();
      lastKnownTasksList = list;

      const isAnyRunning = list.some(t => t.status === 'running');
      if (isAnyRunning && !wasAnyRunningLastCheck && App.autoOpenTasks && !App.taskManagerVisible) {
        openFloatingTaskManager();
      }
      wasAnyRunningLastCheck = isAnyRunning;

      let shouldRefreshAll = false;
      list.forEach(t => {
        if (t.status === 'completed' && !knownCompletedTasks.has(t.id)) {
          knownCompletedTasks.add(t.id);
          shouldRefreshAll = true;
          if (t.destination) {
            handleNewlyTransferredItem(t.destination, t.name);
          }
        }
      });

      if (shouldRefreshAll) {
        refreshAllPanes();
      }

      updateTasksPillState(list);
      renderFloatingTaskManager(list);
      renderDockedTasksPanes(list);
    }
  } catch (e) {
    // Ignore polling errors
  }
}

function updateTasksPillState(list) {
  const pill = document.getElementById('tasks-pill');
  const headerBtn = document.getElementById('btn-header-tasks');
  const headerCount = document.getElementById('header-task-count');
  const headerSpeed = document.getElementById('header-task-speed');
  const peekBadge = document.getElementById('mobile-peek-badge');
  const peekText = document.getElementById('mobile-peek-text');

  const running = list.filter(t => t.status === 'running');
  const win = document.getElementById('floating-task-manager');
  const isWinOpen = win && win.classList.contains('active') && !win.classList.contains('minimized');
  const totalSpeed = running.reduce((acc, t) => acc + (t.speed_bytes_per_sec || 0), 0);
  const speedStr = totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : '';

  // Update Header Button (Left of Profile)
  if (headerBtn) {
    if (running.length > 0) {
      headerBtn.classList.add('has-running');
      if (headerCount) headerCount.textContent = `${running.length}`;
      if (headerSpeed) {
        headerSpeed.style.display = totalSpeed > 0 ? 'inline-block' : 'none';
        headerSpeed.textContent = speedStr;
      }
    } else {
      headerBtn.classList.remove('has-running');
      if (headerCount) headerCount.textContent = `${list.length}`;
      if (headerSpeed) headerSpeed.style.display = 'none';
    }
  }

  // Update Floating Pill (Desktop)
  if (pill) {
    if (running.length > 0 && !isWinOpen) {
      pill.classList.add('active');
      const hasParanoid = running.some(t => t.paranoid);
      document.getElementById('tasks-pill-text').textContent = `${hasParanoid ? '🛡️ ' : ''}${running.length} Job${running.length > 1 ? 's' : ''}`;
      document.getElementById('tasks-pill-speed').textContent = speedStr || (hasParanoid ? 'Verifying...' : 'Processing');
    } else {
      pill.classList.remove('active');
    }
  }

  // Update Mobile Bottom Peek Tab Badge
  if (peekBadge && peekText) {
    if (running.length > 0) {
      peekBadge.style.display = 'inline-flex';
      const hasParanoid = running.some(t => t.paranoid);
      peekText.textContent = `${hasParanoid ? '🛡️ ' : ''}${running.length} active${speedStr ? ' • ' + speedStr : ''}`;
    } else {
      peekBadge.style.display = 'none';
    }
  }
}

function initTaskWindowDragResize() {
  const win = document.getElementById('floating-task-manager');
  const topHandle = document.getElementById('task-win-resize-handle');
  const leftHandle = document.getElementById('task-win-resize-left');
  const cornerHandle = document.getElementById('task-win-resize-corner');
  const header = document.getElementById('task-win-header');
  if (!win || !topHandle || topHandle.dataset.resizeInitialized) return;
  topHandle.dataset.resizeInitialized = 'true';

  // Restore saved width, height, and coordinates if any
  const savedWidth = localStorage.getItem('cd_task_win_width');
  const savedHeight = localStorage.getItem('cd_task_win_height');
  const savedLeft = localStorage.getItem('cd_task_win_left');
  const savedTop = localStorage.getItem('cd_task_win_top');

  if (savedWidth) applyTaskWindowWidth(parseInt(savedWidth, 10));
  if (savedHeight) applyTaskWindowHeight(parseInt(savedHeight, 10));
  if (savedLeft && savedTop && window.innerWidth > 768) {
    win.style.left = `${Math.min(window.innerWidth - 100, Math.max(0, parseInt(savedLeft, 10)))}px`;
    win.style.top = `${Math.min(window.innerHeight - 60, Math.max(35, parseInt(savedTop, 10)))}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  }

  // Header dragging across desktop
  if (header) {
    let isDraggingHeader = false;
    let dragStartX = 0, dragStartY = 0;
    let winStartX = 0, winStartY = 0;

    header.addEventListener('mousedown', (e) => {
      if (window.innerWidth <= 768) return;
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
      if (win.classList.contains('maximized')) return;
      isDraggingHeader = true;
      bringFloatingWindowToFront(win);
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = win.getBoundingClientRect();
      winStartX = rect.left;
      winStartY = rect.top;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'move';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingHeader) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const newX = Math.max(0, Math.min(window.innerWidth - 100, winStartX + dx));
      const newY = Math.max(35, Math.min(window.innerHeight - 60, winStartY + dy));
      win.style.left = `${newX}px`;
      win.style.top = `${newY}px`;
      win.style.right = 'auto';
      win.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingHeader) {
        isDraggingHeader = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        if (win.style.left) localStorage.setItem('cd_task_win_left', parseInt(win.style.left, 10));
        if (win.style.top) localStorage.setItem('cd_task_win_top', parseInt(win.style.top, 10));
      }
    });
  }

  let startX = 0, startY = 0;
  let startW = 0, startH = 0;
  let dragMode = null; // 'top', 'left', 'corner'

  function onDragStart(e, mode) {
    if (window.innerWidth <= 768) return; // Mobile drawer uses full width
    dragMode = mode;
    startX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    startY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    startW = win.offsetWidth;
    startH = win.offsetHeight;

    document.body.style.userSelect = 'none';
    if (mode === 'top') {
      topHandle.classList.add('dragging');
      document.body.style.cursor = 'ns-resize';
    } else if (mode === 'left') {
      leftHandle?.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
    } else if (mode === 'corner') {
      cornerHandle?.classList.add('dragging');
      document.body.style.cursor = 'nwse-resize';
    }

    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragMode) return;
    const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);

    if (dragMode === 'top' || dragMode === 'corner') {
      const deltaY = startY - clientY;
      const newH = Math.max(220, Math.min(window.innerHeight - 60, startH + deltaY));
      applyTaskWindowHeight(newH);
    }
    if (dragMode === 'left' || dragMode === 'corner') {
      const deltaX = startX - clientX;
      const newW = Math.max(360, Math.min(window.innerWidth - 40, startW + deltaX));
      applyTaskWindowWidth(newW);
    }
    if (e.preventDefault && e.cancelable) e.preventDefault();
  }

  function onDragEnd() {
    if (!dragMode) return;
    dragMode = null;
    topHandle.classList.remove('dragging');
    leftHandle?.classList.remove('dragging');
    cornerHandle?.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    localStorage.setItem('cd_task_win_width', win.offsetWidth);
    localStorage.setItem('cd_task_win_height', win.offsetHeight);

    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    window.removeEventListener('touchmove', onDragMove);
    window.removeEventListener('touchend', onDragEnd);
  }

  topHandle.addEventListener('mousedown', (e) => onDragStart(e, 'top'));
  topHandle.addEventListener('touchstart', (e) => onDragStart(e, 'top'), { passive: false });

  if (leftHandle) {
    leftHandle.addEventListener('mousedown', (e) => onDragStart(e, 'left'));
    leftHandle.addEventListener('touchstart', (e) => onDragStart(e, 'left'), { passive: false });
  }

  if (cornerHandle) {
    cornerHandle.addEventListener('mousedown', (e) => onDragStart(e, 'corner'));
    cornerHandle.addEventListener('touchstart', (e) => onDragStart(e, 'corner'), { passive: false });
  }
}

function applyTaskWindowWidth(w) {
  const win = document.getElementById('floating-task-manager');
  if (!win || window.innerWidth <= 768) return;
  win.style.width = `${w}px`;
}

function applyTaskWindowHeight(h) {
  const win = document.getElementById('floating-task-manager');
  if (!win || window.innerWidth <= 768) return;
  win.style.height = `${h}px`;

  const queueCont = document.getElementById('task-queue-container');
  const logCont = document.getElementById('task-log-container');
  const internalHeight = Math.max(80, h - 220);
  if (queueCont) queueCont.style.maxHeight = `${internalHeight}px`;
  if (logCont) logCont.style.maxHeight = `${internalHeight}px`;
}

function sanitizeCredentials(str) {
  if (!str) return '';
  return String(str).replace(/(:\/\/[^:@\s/]+):([^@\s/]+)@/g, '$1:***@');
}

function copyTextToClipboard(text, successMsg = 'Copied to clipboard!') {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, 'success');
    }).catch(() => {
      fallbackCopyText(text, successMsg);
    });
  } else {
    fallbackCopyText(text, successMsg);
  }
}

function fallbackCopyText(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg, 'success');
  } catch (e) {
    showToast('Failed to copy', 'warning');
  }
  document.body.removeChild(ta);
}

function renderFloatingTaskManager(list) {
  const win = document.getElementById('floating-task-manager');
  if (!win) return;

  const running = list.filter(t => t.status === 'running');
  const totalSpeed = running.reduce((acc, t) => acc + (t.speed_bytes_per_sec || 0), 0);
  const speedStr = totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : '0 B/s';
  const anyParanoid = list.some(t => t.paranoid) || App.paranoidMode;

  // 1. Header State
  const titleEl = document.getElementById('task-header-title');
  const indEl = document.getElementById('task-status-indicator');
  const speedEl = document.getElementById('task-speed-badge');
  const paranoidBadgeEl = document.getElementById('task-paranoid-badge');

  if (titleEl) {
    titleEl.textContent = `⚡ Transfers (${running.length} active${list.length > running.length ? `, ${list.length - running.length} done` : ''})`;
  }
  if (paranoidBadgeEl) {
    paranoidBadgeEl.style.display = anyParanoid ? 'inline-block' : 'none';
  }
  if (indEl) {
    if (running.length > 0) indEl.classList.add('active');
    else indEl.classList.remove('active');
  }
  if (speedEl) {
    speedEl.textContent = speedStr;
    speedEl.style.display = totalSpeed > 0 ? 'inline-block' : 'none';
  }

  // 2. Batch Summary Progress (Total files & bytes across running/all jobs)
  let totalBatchBytes = 0;
  let totalProcessedBytes = 0;
  let totalBatchFiles = 0;
  let totalProcessedFiles = 0;
  let totalVerified = 0;
  let activeCurrentFile = null;
  let activeCurBytes = 0;
  let activeCurTotal = 0;
  let activeSpeed = 0;
  let activeCurHash = null;

  list.forEach(t => {
    totalBatchBytes += t.total_bytes || 0;
    totalProcessedBytes += t.bytes_processed || 0;
    totalBatchFiles += t.total_files || 1;
    totalProcessedFiles += t.files_processed || (t.status === 'completed' ? (t.total_files || 1) : 0);
    totalVerified += t.verified_files || 0;

    if (t.status === 'running' && !activeCurrentFile) {
      activeCurrentFile = sanitizeCredentials(t.current_file || t.name);
      activeCurBytes = t.current_file_bytes || t.bytes_processed;
      activeCurTotal = t.current_file_total_bytes || t.total_bytes;
      activeSpeed = t.speed_bytes_per_sec || 0;
      activeCurHash = t.last_hash;
    }
  });

  const overallPercent = totalBatchBytes > 0 ? Math.min(100, Math.round((totalProcessedBytes / totalBatchBytes) * 100)) : (running.length === 0 && list.length > 0 ? 100 : 0);

  const batchFill = document.getElementById('task-batch-progress-fill');
  const batchPercent = document.getElementById('task-batch-percent-text');
  const batchFiles = document.getElementById('task-batch-files-text');
  const batchBytes = document.getElementById('task-batch-bytes-text');
  const batchEta = document.getElementById('task-batch-eta-text');

  if (batchFill) batchFill.style.width = `${overallPercent}%`;
  if (batchPercent) batchPercent.textContent = `${overallPercent}%`;
  if (batchFiles) {
    batchFiles.textContent = `${totalProcessedFiles} / ${totalBatchFiles} files${totalVerified > 0 ? ` (🛡️ ${totalVerified} SHA-256 verified)` : ''}`;
  }
  if (batchBytes) batchBytes.textContent = `${formatBytes(totalProcessedBytes)} / ${formatBytes(totalBatchBytes)}`;

  if (batchEta) {
    if (running.length > 0 && totalSpeed > 0 && totalBatchBytes > totalProcessedBytes) {
      const etaSec = Math.round((totalBatchBytes - totalProcessedBytes) / totalSpeed);
      const mins = Math.floor(etaSec / 60);
      const secs = etaSec % 60;
      batchEta.textContent = `ETA: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else if (running.length === 0) {
      batchEta.textContent = list.length > 0 ? (totalVerified > 0 ? '✓ Verified Complete' : '✓ Completed') : 'Idle';
    } else {
      batchEta.textContent = 'ETA: calculating...';
    }
  }

  // 3. Current Active File Card (TeraCopy Stream)
  const curNameEl = document.getElementById('task-cur-filename');
  const curSpeedEl = document.getElementById('task-cur-speed');
  const curFillEl = document.getElementById('task-file-progress-fill');
  const curBytesEl = document.getElementById('task-cur-bytes');
  const curPercentEl = document.getElementById('task-cur-percent');

  if (activeCurrentFile) {
    if (curNameEl) {
      curNameEl.innerHTML = `
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(activeCurrentFile)}</div>
        ${activeCurHash ? `<div style="font-size: 9.5px; color: #a3e635; font-family: var(--font-mono); margin-top: 2px;">🔑 ${escapeHtml(activeCurHash)}</div>` : ''}
      `;
    }
    if (curSpeedEl) curSpeedEl.textContent = activeSpeed > 0 ? `${formatBytes(activeSpeed)}/s` : '';
    const filePct = activeCurTotal > 0 ? Math.min(100, Math.round((activeCurBytes / activeCurTotal) * 100)) : 0;
    if (curFillEl) curFillEl.style.width = `${filePct}%`;
    if (curBytesEl) curBytesEl.textContent = `${formatBytes(activeCurBytes)} / ${formatBytes(activeCurTotal)}`;
    if (curPercentEl) curPercentEl.textContent = `${filePct}%`;
  } else {
    if (curNameEl) curNameEl.textContent = running.length === 0 ? 'No active file transfer' : 'Preparing next file...';
    if (curSpeedEl) curSpeedEl.textContent = '';
    if (curFillEl) curFillEl.style.width = '0%';
    if (curBytesEl) curBytesEl.textContent = '0 B / 0 B';
    if (curPercentEl) curPercentEl.textContent = '0%';
  }

  // 4. Job Queue List
  const queueList = document.getElementById('task-queue-list');
  if (queueList) {
    if (list.length === 0) {
      queueList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">No active background jobs</div>';
    } else {
      queueList.innerHTML = list.map(t => {
        const pct = t.total_bytes > 0 ? Math.min(100, Math.round((t.bytes_processed / t.total_bytes) * 100)) : (t.status === 'completed' ? 100 : 0);
        const badgeClass = `task-badge-${t.status || 'running'}`;
        const isRunning = t.status === 'running';
        const isPaused = t.status === 'paused';
        const safeName = sanitizeCredentials(t.name);
        const safeSrc = sanitizeCredentials(t.source);
        const safeDest = sanitizeCredentials(t.destination);
        const safeErr = sanitizeCredentials(t.error_message || '');

        return `
          <div class="task-queue-item">
            <div class="task-queue-details">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                  <span class="task-queue-name" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</span>
                  ${isRunning && t.speed_bytes_per_sec > 0 ? `<span style="font-size: 9.5px; font-family: var(--font-mono); color: var(--accent); font-weight: 700; background: rgba(245, 158, 11, 0.15); padding: 1px 5px; border-radius: 3px; white-space: nowrap;">⚡ ${formatBytes(t.speed_bytes_per_sec)}/s</span>` : ''}
                  ${t.paranoid ? `<span class="task-queue-badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); font-size: 8.5px; padding: 1px 4px; white-space: nowrap;">🛡️ SHA-256 ${t.verified_files ? `(${t.verified_files} OK)` : ''}</span>` : ''}
                </div>
                <span class="task-queue-badge ${badgeClass}">${escapeHtml(t.status)}</span>
              </div>
              <div class="task-queue-sub" title="${escapeHtml(safeSrc)} ➔ ${escapeHtml(safeDest)}">${escapeHtml(safeSrc)} ➔ ${escapeHtml(safeDest)}</div>
              ${t.last_hash ? `<div style="font-size: 9px; color: #a3e635; font-family: var(--font-mono); margin-top: 1px; word-break: break-all;">✓ ${escapeHtml(t.last_hash)}</div>` : ''}
              ${isRunning || isPaused ? `
                <div style="height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; margin-top: 3px; overflow: hidden;">
                  <div style="height: 100%; width: ${pct}%; background: var(--accent);"></div>
                </div>
              ` : ''}
              ${safeErr ? `
                <div class="task-queue-error-box" onclick="copyTextToClipboard(decodeURIComponent('${encodeURIComponent(safeErr)}'), 'Fault message copied to clipboard!')" title="Click to copy full fault message">
                  <i data-lucide="alert-circle" style="width: 12px; height: 12px; flex-shrink: 0; margin-top: 2px; color: var(--danger);"></i>
                  <span style="flex: 1; word-break: break-all; font-family: monospace;">${escapeHtml(safeErr)}</span>
                  <span style="font-size: 9px; opacity: 0.9; text-decoration: underline; white-space: nowrap;">📋 Copy</span>
                </div>
              ` : ''}
            </div>
            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
              ${isRunning ? `
                <button class="btn btn-sm btn-icon" onclick="pauseTask('${t.id}')" title="Pause"><i data-lucide="pause" style="width: 11px; height: 11px;"></i></button>
                <button class="btn btn-sm btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel"><i data-lucide="x" style="width: 11px; height: 11px;"></i></button>
              ` : (isPaused ? `
                <button class="btn btn-sm btn-icon" onclick="resumeTask('${t.id}')" title="Resume"><i data-lucide="play" style="width: 11px; height: 11px;"></i></button>
                <button class="btn btn-sm btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel"><i data-lucide="x" style="width: 11px; height: 11px;"></i></button>
              ` : (t.status === 'failed' ? `
                <button class="btn btn-sm btn-icon btn-danger" onclick="copyTextToClipboard(decodeURIComponent('${encodeURIComponent(safeErr)}'), 'Fault message copied!')" title="Copy Fault Message"><i data-lucide="copy" style="width: 11px; height: 11px;"></i></button>
              ` : '✓'))}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 5. Diagnostic Log Stream
  const logConsole = document.getElementById('task-log-console');
  if (logConsole) {
    const allLogs = [];
    list.forEach(t => {
      if (t.log_entries && t.log_entries.length > 0) {
        allLogs.push(`--- [Job: ${sanitizeCredentials(t.name)}] ---`);
        t.log_entries.forEach(l => allLogs.push(sanitizeCredentials(l)));
      }
    });

    if (allLogs.length === 0) {
      logConsole.textContent = '// CommanderDog Diagnostic Transfer Log...\n// No events logged yet.';
    } else {
      const text = allLogs.join('\n');
      if (logConsole.textContent !== text) {
        logConsole.textContent = text;
        const logContainer = document.getElementById('task-log-container');
        if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
  }

  if (window.lucide) lucide.createIcons();
}

async function pauseTask(id) {
  await fetch(`/api/tasks/${id}/pause`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${App.token}` }
  });
  pollTasks();
}

async function resumeTask(id) {
  await fetch(`/api/tasks/${id}/resume`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${App.token}` }
  });
  pollTasks();
}

async function cancelTask(id) {
  await fetch(`/api/tasks/${id}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${App.token}` }
  });
  pollTasks();
}

async function pauseAllTasks() {
  const running = lastKnownTasksList.filter(t => t.status === 'running');
  for (const t of running) {
    await pauseTask(t.id);
  }
}

async function resumeAllTasks() {
  const paused = lastKnownTasksList.filter(t => t.status === 'paused');
  for (const t of paused) {
    await resumeTask(t.id);
  }
}

async function clearCompletedTasks() {
  await fetch('/api/tasks/clear-completed', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${App.token}` }
  });
  pollTasks();
}

function copyTaskLogs() {
  const consoleEl = document.getElementById('task-log-console');
  if (consoleEl) {
    copyTextToClipboard(consoleEl.textContent, 'Transfer diagnostic log copied to clipboard!');
  }
}

// ---------------- RICH IMAGE VIEWER ----------------
let currentImageIndex = 0;
let currentImageList = [];
let imgZoom = 1;
let imgRotation = 0;
let imgFlipH = 1;
let imgFlipV = 1;

function isImageExtension(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'].includes(ext);
}

function openImageViewer(filePath) {
  const pane = App.panes[App.activePaneIndex];
  currentImageList = pane.entries.filter(e => !e.is_dir && isImageExtension(e.name)).map(e => e.path);

  if (currentImageList.length === 0) {
    currentImageList = [filePath];
  }

  currentImageIndex = currentImageList.indexOf(filePath);
  if (currentImageIndex === -1) currentImageIndex = 0;

  loadImageToViewer(currentImageList[currentImageIndex]);
  showModal('image-viewer-modal');
}

function loadImageToViewer(path) {
  const imgEl = document.getElementById('img-viewer-element');
  const titleEl = document.getElementById('img-viewer-title');
  const metaEl = document.getElementById('img-viewer-meta');
  const counterEl = document.getElementById('img-viewer-counter');

  resetImageTransform();

  const fileName = path.split('/').pop() || path;
  titleEl.textContent = fileName;
  counterEl.textContent = `${currentImageIndex + 1} / ${currentImageList.length}`;

  const imgUrl = `/api/fs/download?path=${encodeURIComponent(path)}`;
  imgEl.src = imgUrl;

  const dlLink = document.getElementById('img-viewer-download-link');
  if (dlLink) dlLink.href = imgUrl;

  imgEl.onload = () => {
    metaEl.textContent = `(${imgEl.naturalWidth} × ${imgEl.naturalHeight} px)`;
  };
  imgEl.onerror = () => {
    metaEl.textContent = '(Preview unavailable)';
  };
}

function navImageViewer(dir) {
  if (currentImageList.length <= 1) return;
  currentImageIndex = (currentImageIndex + dir + currentImageList.length) % currentImageList.length;
  loadImageToViewer(currentImageList[currentImageIndex]);
}

function zoomImage(delta) {
  imgZoom = Math.max(0.2, Math.min(5, imgZoom + delta));
  applyImageTransform();
}

function rotateImage(deg) {
  imgRotation = (imgRotation + deg) % 360;
  applyImageTransform();
}

function flipImage(axis) {
  if (axis === 'h') imgFlipH *= -1;
  if (axis === 'v') imgFlipV *= -1;
  applyImageTransform();
}

function resetImageTransform() {
  imgZoom = 1;
  imgRotation = 0;
  imgFlipH = 1;
  imgFlipV = 1;
  applyImageTransform();
}

function applyImageTransform() {
  const imgEl = document.getElementById('img-viewer-element');
  if (imgEl) {
    imgEl.style.transform = `scale(${imgZoom}) rotate(${imgRotation}deg) scaleX(${imgFlipH}) scaleY(${imgFlipV})`;
  }
}

function downloadCurrentImage() {
  const path = currentImageList[currentImageIndex];
  if (path) {
    window.open(`/api/fs/download?path=${encodeURIComponent(path)}`, '_blank');
  }
}

// ---------------- UNIVERSAL DOCUMENT & PDF READERS ----------------
let currentDocViewerPath = '';
let currentDocViewerRawText = '';
let currentDocViewerMode = 'rendered'; // 'rendered' or 'raw'
let docCsvRows = [];
let docCsvHeaders = [];
let docCsvFiltered = [];
let docPdfZoom = 100;
let docPdfRotation = 0;

function isPdfExtension(filename) {
  if (!filename) return false;
  return filename.split('.').pop().toLowerCase() === 'pdf';
}

function isDocumentExtension(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return ['pdf', 'md', 'markdown', 'rst', 'csv', 'tsv', 'tab', 'json', 'html', 'htm', 'xml', 'svg', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'doc', 'xls', 'ppt', 'log', 'txt', 'rtf'].includes(ext);
}

function isAudioExtension(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext);
}

function isVideoExtension(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return ['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'ogv'].includes(ext);
}

function isComicBookExtension(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  return ['cbz', 'cbr', 'epub'].includes(ext);
}

function openFileByType(entry, paneIndex) {
  if (entry.is_dir || entry.is_archive) {
    loadPaneDirectory(paneIndex, entry.path);
  } else if (isPdfExtension(entry.name) || isDocumentExtension(entry.name)) {
    openDocumentViewer(entry.path);
  } else if (isAudioExtension(entry.name)) {
    openMediaPlayer(entry.path, 'audio');
  } else if (isVideoExtension(entry.name)) {
    openMediaPlayer(entry.path, 'video');
  } else if (isComicBookExtension(entry.name)) {
    openBookReader(entry.path);
  } else if (isImageExtension(entry.name)) {
    openImageViewer(entry.path);
  } else {
    openEditorWithFile(entry.path);
  }
}

// PDF Reader backward compatibility alias
function openPdfViewer(filePath) {
  openDocumentViewer(filePath);
}

async function openDocumentViewer(filePath) {
  currentDocViewerPath = filePath;
  currentDocViewerRawText = '';
  currentDocViewerMode = 'rendered';
  docPdfZoom = 100;
  docPdfRotation = 0;

  const fileName = filePath.split('/').pop() || filePath;
  const ext = fileName.split('.').pop().toLowerCase();

  const titleEl = document.getElementById('doc-viewer-title');
  const metaEl = document.getElementById('doc-viewer-meta');
  const iconEl = document.getElementById('doc-viewer-icon');
  const controlsEl = document.getElementById('doc-viewer-controls');
  const dlEl = document.getElementById('doc-viewer-download');
  const extEl = document.getElementById('doc-viewer-external');

  if (titleEl) titleEl.textContent = fileName;
  const downloadUrl = `/api/fs/download?path=${encodeURIComponent(filePath)}`;
  const streamUrl = `/api/fs/download?path=${encodeURIComponent(filePath)}&inline=true`;

  if (dlEl) {
    dlEl.href = downloadUrl;
    dlEl.download = fileName;
  }
  if (extEl) extEl.href = streamUrl;

  // Hide all panels initially
  ['doc-view-pdf', 'doc-view-md', 'doc-view-csv', 'doc-view-web', 'doc-view-text', 'doc-view-office'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Setup format-specific view and toolbar
  if (ext === 'pdf') {
    if (metaEl) metaEl.textContent = 'PDF Document • In-Browser Reader';
    if (iconEl) iconEl.setAttribute('data-lucide', 'file-text');

    if (controlsEl) {
      controlsEl.innerHTML = `
        <button class="btn btn-icon" onclick="changeDocPdfZoom(-15)" title="Zoom Out (-)"><i data-lucide="zoom-out"></i></button>
        <span id="doc-pdf-zoom-label" style="font-size: 11px; font-weight: 700; color: var(--text-muted); min-width: 42px; text-align: center;">100%</span>
        <button class="btn btn-icon" onclick="changeDocPdfZoom(15)" title="Zoom In (+)"><i data-lucide="zoom-in"></i></button>
        <button class="btn btn-icon" onclick="rotateDocPdf()" title="Rotate Clockwise (90°)"><i data-lucide="rotate-cw"></i></button>
        <button class="btn btn-icon" onclick="printDocViewer()" title="Print Document (Ctrl+P)"><i data-lucide="printer"></i></button>
      `;
    }

    const pdfPanel = document.getElementById('doc-view-pdf');
    const frame = document.getElementById('doc-pdf-frame');
    if (pdfPanel) pdfPanel.style.display = 'block';
    if (frame) frame.src = streamUrl;

  } else if (['md', 'markdown', 'rst'].includes(ext)) {
    if (metaEl) metaEl.textContent = 'Markdown Document • Rich GitHub Preview';
    if (iconEl) iconEl.setAttribute('data-lucide', 'file-code-2');

    if (controlsEl) {
      controlsEl.innerHTML = `
        <button class="btn btn-icon" id="doc-md-toggle-btn" onclick="toggleDocRawRenderMode()" title="Toggle Rendered Preview / Raw Markdown" style="font-size: 11px; font-weight: 600; padding: 0 8px; gap: 4px;">
          <i data-lucide="code"></i> <span id="doc-md-mode-label">Raw Source</span>
        </button>
      `;
    }

    const mdPanel = document.getElementById('doc-view-md');
    if (mdPanel) {
      mdPanel.style.display = 'block';
      mdPanel.innerHTML = '<div style="color: var(--text-muted); padding: 24px; text-align: center;">Loading Markdown...</div>';
    }

    try {
      const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        currentDocViewerRawText = data.content || '';
        if (mdPanel) {
          mdPanel.innerHTML = renderRichMarkdown(currentDocViewerRawText);
          if (window.mermaid) {
            try { mermaid.init(undefined, mdPanel.querySelectorAll('.mermaid')); } catch (e) {}
          }
        }
      }
    } catch (e) {
      if (mdPanel) mdPanel.innerHTML = `<div style="color: var(--danger); padding: 24px;">Failed to load markdown: ${escapeHtml(e.message)}</div>`;
    }

  } else if (['csv', 'tsv', 'tab'].includes(ext)) {
    const delim = ext === 'tsv' || ext === 'tab' ? '\t' : ',';
    if (metaEl) metaEl.textContent = `${ext.toUpperCase()} Data Sheet • Interactive Table`;
    if (iconEl) iconEl.setAttribute('data-lucide', 'table');

    if (controlsEl) {
      controlsEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px;">
          <input type="text" id="doc-csv-filter" placeholder="Filter rows..." style="background: var(--bg-dark); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px; font-size: 11px; color: var(--text-main); width: 140px;" oninput="filterDocCsv(this.value)">
          <span id="doc-csv-stats" style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">0 rows</span>
        </div>
      `;
    }

    const csvPanel = document.getElementById('doc-view-csv');
    if (csvPanel) {
      csvPanel.style.display = 'block';
      csvPanel.innerHTML = '<div style="color: var(--text-muted); padding: 24px; text-align: center;">Parsing CSV table...</div>';
    }

    try {
      const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        currentDocViewerRawText = data.content || '';
        renderCsvData(currentDocViewerRawText, delim);
      }
    } catch (e) {
      if (csvPanel) csvPanel.innerHTML = `<div style="color: var(--danger); padding: 24px;">Failed to read CSV: ${escapeHtml(e.message)}</div>`;
    }

  } else if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext)) {
    if (metaEl) metaEl.textContent = `${ext.toUpperCase()} Document • Web Preview`;
    if (iconEl) iconEl.setAttribute('data-lucide', 'globe');

    if (controlsEl) {
      controlsEl.innerHTML = `
        <button class="btn btn-icon" onclick="toggleDocRawRenderMode()" title="Toggle Web Preview / Source Code" style="font-size: 11px; font-weight: 600; padding: 0 8px; gap: 4px;">
          <i data-lucide="code"></i> <span id="doc-md-mode-label">View Source</span>
        </button>
      `;
    }

    const webPanel = document.getElementById('doc-view-web');
    const frame = document.getElementById('doc-web-frame');
    if (webPanel) webPanel.style.display = 'block';
    if (frame) frame.src = streamUrl;

  } else if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'doc', 'xls', 'ppt'].includes(ext)) {
    if (metaEl) metaEl.textContent = `${ext.toUpperCase()} Office Document`;
    if (iconEl) iconEl.setAttribute('data-lucide', 'file-text');

    if (controlsEl) controlsEl.innerHTML = '';

    const officePanel = document.getElementById('doc-view-office');
    if (officePanel) {
      officePanel.style.display = 'block';
      officePanel.innerHTML = `
        <div style="max-width: 480px; margin: 40px auto; padding: 28px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <div style="font-size: 42px; margin-bottom: 12px;">📄</div>
          <div style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">${escapeHtml(fileName)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 20px;">Binary Office document format (${ext.toUpperCase()}).</div>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <a class="btn btn-accent" href="${downloadUrl}" download style="padding: 8px 16px; font-weight: 600;"><i data-lucide="download"></i> Download File</a>
            <a class="btn" href="${streamUrl}" target="_blank" style="padding: 8px 16px;"><i data-lucide="external-link"></i> Open Externally</a>
          </div>
        </div>
      `;
    }

  } else {
    // Plain text / Code / Logs / Conf
    if (metaEl) metaEl.textContent = `${ext.toUpperCase() || 'TEXT'} Document`;
    if (iconEl) iconEl.setAttribute('data-lucide', 'file-text');
    if (controlsEl) controlsEl.innerHTML = '';

    const textPanel = document.getElementById('doc-view-text');
    const contentEl = document.getElementById('doc-text-content');
    if (textPanel) textPanel.style.display = 'block';
    if (contentEl) contentEl.textContent = 'Loading...';

    try {
      const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        currentDocViewerRawText = data.content || '';
        if (contentEl) contentEl.textContent = currentDocViewerRawText;
      }
    } catch (e) {
      if (contentEl) contentEl.textContent = `Error reading file: ${e.message}`;
    }
  }

  showModal('doc-viewer-modal');
  if (window.lucide) lucide.createIcons();
}

function closeDocViewerModal() {
  closeModal('doc-viewer-modal');
  const pdfFrame = document.getElementById('doc-pdf-frame');
  if (pdfFrame) pdfFrame.src = 'about:blank';
  const webFrame = document.getElementById('doc-web-frame');
  if (webFrame) webFrame.src = 'about:blank';
}

function toggleDocViewerFullscreen() {
  const box = document.getElementById('doc-viewer-box');
  if (!box) return;
  box.classList.toggle('fullscreen');
  const icon = document.getElementById('doc-viewer-fullscreen')?.querySelector('i, svg');
  if (icon) {
    const isFs = box.classList.contains('fullscreen');
    icon.setAttribute('data-lucide', isFs ? 'minimize-2' : 'maximize-2');
    if (window.lucide) lucide.createIcons();
  }
}

function docViewerEditFile() {
  if (currentDocViewerPath) {
    closeDocViewerModal();
    openEditorWithFile(currentDocViewerPath);
  }
}

function toggleDocRawRenderMode() {
  const fileName = currentDocViewerPath.split('/').pop() || '';
  const ext = fileName.split('.').pop().toLowerCase();
  const label = document.getElementById('doc-md-mode-label');

  if (currentDocViewerMode === 'rendered') {
    currentDocViewerMode = 'raw';
    if (label) label.textContent = 'Rendered View';

    if (['md', 'markdown', 'rst'].includes(ext)) {
      document.getElementById('doc-view-md').style.display = 'none';
      const textPanel = document.getElementById('doc-view-text');
      const textEl = document.getElementById('doc-text-content');
      if (textPanel) textPanel.style.display = 'block';
      if (textEl) textEl.textContent = currentDocViewerRawText;
    } else if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext)) {
      document.getElementById('doc-view-web').style.display = 'none';
      const textPanel = document.getElementById('doc-view-text');
      const textEl = document.getElementById('doc-text-content');
      if (textPanel) textPanel.style.display = 'block';
      if (textEl) textEl.textContent = currentDocViewerRawText;
    }
  } else {
    currentDocViewerMode = 'rendered';
    if (label) label.textContent = ext.startsWith('m') ? 'Raw Source' : 'View Source';

    if (['md', 'markdown', 'rst'].includes(ext)) {
      document.getElementById('doc-view-text').style.display = 'none';
      const mdPanel = document.getElementById('doc-view-md');
      if (mdPanel) {
        mdPanel.style.display = 'block';
        mdPanel.innerHTML = renderRichMarkdown(currentDocViewerRawText);
      }
    } else if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext)) {
      document.getElementById('doc-view-text').style.display = 'none';
      document.getElementById('doc-view-web').style.display = 'block';
    }
  }
  if (window.lucide) lucide.createIcons();
}

function renderRichMarkdown(content) {
  if (!content) return '<p style="color: var(--text-muted); font-style: italic;">(Empty markdown document)</p>';
  
  let lines = content.split('\n');
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = [];
  let inTable = false;
  let tableRows = [];
  let outHtml = [];

  const escapeH = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inlineFormat = (txt) => {
    return txt
      .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); font-size: 11px;">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;">$1</a>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; border-radius: 6px; margin: 8px 0;">');
  };

  const flushTable = () => {
    if (!inTable || tableRows.length === 0) return;
    let tbl = '<div style="overflow-x: auto; margin: 16px 0;"><table class="doc-csv-table" style="border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">';
    if (tableRows.length > 0) {
      tbl += '<thead><tr>';
      tableRows[0].forEach(cell => {
        tbl += `<th>${inlineFormat(escapeH(cell.trim()))}</th>`;
      });
      tbl += '</tr></thead>';
    }
    if (tableRows.length > 1) {
      tbl += '<tbody>';
      for (let r = 1; r < tableRows.length; r++) {
        tbl += '<tr>';
        tableRows[r].forEach(cell => {
          tbl += `<td>${inlineFormat(escapeH(cell.trim()))}</td>`;
        });
        tbl += '</tr>';
      }
      tbl += '</tbody>';
    }
    tbl += '</table></div>';
    outHtml.push(tbl);
    inTable = false;
    tableRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        const code = codeBlockContent.join('\n');
        if (codeBlockLang === 'mermaid') {
          outHtml.push(`<div class="mermaid">${escapeH(code)}</div>`);
        } else {
          const prismLang = window.Prism ? (Prism.languages[codeBlockLang] || Prism.languages.markup) : null;
          const highlighted = (window.Prism && prismLang) ? Prism.highlight(code, prismLang, codeBlockLang) : escapeH(code);
          outHtml.push(`<pre class="language-${codeBlockLang}" style="background: var(--bg-dark); border: 1px solid var(--border); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0;"><code class="language-${codeBlockLang}">${highlighted}</code></pre>`);
        }
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockContent = [];
      } else {
        flushTable();
        inCodeBlock = true;
        codeBlockLang = line.trim().replace(/^```/, '').trim();
        codeBlockContent = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1, -1).split('|');
      const isSep = cells.every(c => /^[\s-:]+$/.test(c));
      if (!isSep) {
        inTable = true;
        tableRows.push(cells);
      }
      continue;
    } else {
      flushTable();
    }

    if (line.startsWith('# ')) {
      outHtml.push(`<h1 style="color: var(--text-main); font-size: 20px; font-weight: 800; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin: 18px 0 10px 0;">${inlineFormat(escapeH(line.slice(2)))}</h1>`);
    } else if (line.startsWith('## ')) {
      outHtml.push(`<h2 style="color: var(--text-main); font-size: 17px; font-weight: 700; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin: 16px 0 8px 0;">${inlineFormat(escapeH(line.slice(3)))}</h2>`);
    } else if (line.startsWith('### ')) {
      outHtml.push(`<h3 style="color: var(--accent); font-size: 14px; font-weight: 700; margin: 14px 0 6px 0;">${inlineFormat(escapeH(line.slice(4)))}</h3>`);
    } else if (line.startsWith('#### ')) {
      outHtml.push(`<h4 style="color: var(--text-main); font-size: 13px; font-weight: 600; margin: 12px 0 4px 0;">${inlineFormat(escapeH(line.slice(5)))}</h4>`);
    } else if (line.startsWith('> ')) {
      outHtml.push(`<blockquote style="border-left: 3px solid var(--accent); padding: 6px 12px; margin: 8px 0; background: rgba(245,158,11,0.05); color: var(--text-muted);">${inlineFormat(escapeH(line.slice(2)))}</blockquote>`);
    } else if (line.startsWith('- [x] ') || line.startsWith('* [x] ')) {
      outHtml.push(`<div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;"><input type="checkbox" checked disabled><span style="text-decoration: line-through; color: var(--text-dim);">${inlineFormat(escapeH(line.slice(6)))}</span></div>`);
    } else if (line.startsWith('- [ ] ') || line.startsWith('* [ ] ')) {
      outHtml.push(`<div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;"><input type="checkbox" disabled><span>${inlineFormat(escapeH(line.slice(6)))}</span></div>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      outHtml.push(`<li style="margin: 3px 0; margin-left: 18px;">${inlineFormat(escapeH(line.slice(2)))}</li>`);
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+\.)\s(.*)/);
      outHtml.push(`<li style="margin: 3px 0; margin-left: 18px;" value="${parseInt(match[1])}"><b>${match[1]}</b> ${inlineFormat(escapeH(match[2]))}</li>`);
    } else if (line.trim() === '---' || line.trim() === '***') {
      outHtml.push(`<hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;">`);
    } else if (line.trim() === '') {
      outHtml.push('<div style="height: 8px;"></div>');
    } else {
      outHtml.push(`<p style="margin: 6px 0; line-height: 1.6; color: var(--text-main); font-size: 13px;">${inlineFormat(escapeH(line))}</p>`);
    }
  }

  flushTable();
  return outHtml.join('\n');
}

function renderCsvData(csvText, delimiter = ',') {
  if (!csvText) return;
  const parseLine = (line) => {
    let result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  };

  const rawLines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (rawLines.length === 0) return;

  docCsvHeaders = parseLine(rawLines[0]);
  docCsvRows = [];
  for (let i = 1; i < rawLines.length; i++) {
    docCsvRows.push(parseLine(rawLines[i]));
  }
  docCsvFiltered = [...docCsvRows];
  renderDocCsvTable();
}

function renderDocCsvTable() {
  const panel = document.getElementById('doc-view-csv');
  const stats = document.getElementById('doc-csv-stats');
  if (!panel) return;

  if (stats) {
    stats.textContent = `${docCsvFiltered.length} / ${docCsvRows.length} rows (${docCsvHeaders.length} cols)`;
  }

  let html = `
    <div class="doc-csv-table-wrapper">
      <table class="doc-csv-table">
        <thead>
          <tr>
            <th class="row-num-header">#</th>
            ${docCsvHeaders.map((h, idx) => `
              <th onclick="sortDocCsv(${idx})" title="Click to sort by ${escapeHtml(h)}">
                ${escapeHtml(h || `Col ${idx + 1}`)} ⇕
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${docCsvFiltered.map((row, rIdx) => `
            <tr>
              <td class="row-num">${rIdx + 1}</td>
              ${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  panel.innerHTML = html;
}

function filterDocCsv(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    docCsvFiltered = [...docCsvRows];
  } else {
    docCsvFiltered = docCsvRows.filter(row => {
      return row.some(cell => cell.toLowerCase().includes(q));
    });
  }
  renderDocCsvTable();
}

let docCsvSortOrder = 1;
let docCsvLastSortedCol = -1;

function sortDocCsv(colIdx) {
  if (docCsvLastSortedCol === colIdx) {
    docCsvSortOrder = -docCsvSortOrder;
  } else {
    docCsvSortOrder = 1;
    docCsvLastSortedCol = colIdx;
  }

  docCsvFiltered.sort((a, b) => {
    const valA = (a[colIdx] || '').trim();
    const valB = (b[colIdx] || '').trim();
    const numA = parseFloat(valA);
    const numB = parseFloat(valB);
    if (!isNaN(numA) && !isNaN(numB)) {
      return (numA - numB) * docCsvSortOrder;
    }
    return valA.localeCompare(valB) * docCsvSortOrder;
  });

  renderDocCsvTable();
}

function changeDocPdfZoom(delta) {
  docPdfZoom = Math.max(30, Math.min(300, docPdfZoom + delta));
  const label = document.getElementById('doc-pdf-zoom-label');
  if (label) label.textContent = `${docPdfZoom}%`;
  const frame = document.getElementById('doc-pdf-frame');
  if (frame) {
    frame.style.transform = `scale(${docPdfZoom / 100}) rotate(${docPdfRotation}deg)`;
    frame.style.transformOrigin = 'top center';
  }
}

function rotateDocPdf() {
  docPdfRotation = (docPdfRotation + 90) % 360;
  const frame = document.getElementById('doc-pdf-frame');
  if (frame) {
    frame.style.transform = `scale(${docPdfZoom / 100}) rotate(${docPdfRotation}deg)`;
    frame.style.transformOrigin = 'center center';
  }
}

function printDocViewer() {
  const frame = document.getElementById('doc-pdf-frame') || document.getElementById('doc-web-frame');
  if (frame && frame.contentWindow) {
    try {
      frame.contentWindow.print();
      return;
    } catch (e) {}
  }
  window.print();
}

// Media Player (Audio & Video)
let mediaPlaylist = [];
let mediaPlaylistIndex = 0;
let mediaIsPlaying = false;
let mediaLoop = false;

function openMediaPlayer(filePath, mediaType) {
  const pane = App.panes[App.activePaneIndex];
  mediaPlaylist = pane.entries
    .filter(e => !e.is_dir && (isAudioExtension(e.name) || isVideoExtension(e.name)))
    .map(e => e.path);

  if (mediaPlaylist.length === 0) mediaPlaylist = [filePath];
  mediaPlaylistIndex = mediaPlaylist.indexOf(filePath);
  if (mediaPlaylistIndex === -1) mediaPlaylistIndex = 0;

  loadMediaTrack(mediaPlaylist[mediaPlaylistIndex], mediaType);
  showModal('media-player-modal');
}

function loadMediaTrack(filePath, forcedType) {
  const fileName = filePath.split('/').pop() || filePath;
  const ext = fileName.split('.').pop().toLowerCase();
  const isVideo = forcedType === 'video' || isVideoExtension(fileName);

  const titleEl = document.getElementById('media-player-title');
  const badgeEl = document.getElementById('media-player-badge');
  const iconEl = document.getElementById('media-player-icon');
  const videoEl = document.getElementById('media-video-element');
  const audioEl = document.getElementById('media-audio-element');
  const vizEl = document.getElementById('media-audio-visualizer');
  const artistEl = document.getElementById('media-audio-artist');
  const pathEl = document.getElementById('media-audio-file-path');

  if (titleEl) titleEl.textContent = fileName;
  if (badgeEl) badgeEl.textContent = ext.toUpperCase();
  if (artistEl) artistEl.textContent = fileName.replace(/\.[^/.]+$/, '');
  if (pathEl) pathEl.textContent = sanitizeCredentials(filePath);

  const streamUrl = `/api/fs/download?path=${encodeURIComponent(filePath)}&inline=true`;

  if (isVideo) {
    if (iconEl) iconEl.setAttribute('data-lucide', 'video');
    if (vizEl) vizEl.style.display = 'none';
    if (videoEl) {
      videoEl.style.display = 'block';
      videoEl.src = streamUrl;
      videoEl.currentTime = 0;
      videoEl.play().catch(() => {});
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
  } else {
    if (iconEl) iconEl.setAttribute('data-lucide', 'music');
    if (videoEl) {
      videoEl.pause();
      videoEl.style.display = 'none';
      videoEl.src = '';
    }
    if (vizEl) vizEl.style.display = 'flex';
    if (audioEl) {
      audioEl.src = streamUrl;
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    }
  }

  if (window.lucide) lucide.createIcons();
  attachMediaEvents();
}

function getActiveMediaElement() {
  const videoEl = document.getElementById('media-video-element');
  if (videoEl && videoEl.style.display !== 'none' && videoEl.src) return videoEl;
  return document.getElementById('media-audio-element');
}

function attachMediaEvents() {
  const el = getActiveMediaElement();
  if (!el) return;

  el.ontimeupdate = () => {
    const cur = el.currentTime || 0;
    const dur = el.duration || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;

    const progEl = document.getElementById('media-scrubber-progress');
    if (progEl) progEl.style.width = `${pct}%`;

    const curEl = document.getElementById('media-time-current');
    const totEl = document.getElementById('media-time-total');
    if (curEl) curEl.textContent = formatMediaTime(cur);
    if (totEl) totEl.textContent = formatMediaTime(dur);
  };

  el.onplay = () => updateMediaPlayButton(true);
  el.onpause = () => updateMediaPlayButton(false);
  el.onended = () => {
    if (mediaLoop) {
      el.currentTime = 0;
      el.play();
    } else if (mediaPlaylist.length > 1) {
      navMediaPlaylist(1);
    }
  };
}

function formatMediaTime(secs) {
  if (isNaN(secs) || secs === 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateMediaPlayButton(playing) {
  mediaIsPlaying = playing;
  const btn = document.getElementById('btn-media-play-pause');
  if (btn) {
    btn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}" style="width: 14px;"></i>`;
    if (window.lucide) lucide.createIcons();
  }
}

function toggleMediaPlay() {
  const el = getActiveMediaElement();
  if (!el) return;
  if (el.paused) el.play();
  else el.pause();
}

function seekMedia(e) {
  const el = getActiveMediaElement();
  if (!el || !el.duration) return;
  const track = document.getElementById('media-scrubber-track');
  const rect = track.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  el.currentTime = pct * el.duration;
}

function navMediaPlaylist(dir) {
  if (mediaPlaylist.length <= 1) return;
  mediaPlaylistIndex = (mediaPlaylistIndex + dir + mediaPlaylist.length) % mediaPlaylist.length;
  loadMediaTrack(mediaPlaylist[mediaPlaylistIndex]);
}

function toggleMediaLoop() {
  mediaLoop = !mediaLoop;
  const btn = document.getElementById('btn-media-loop');
  if (btn) {
    btn.style.color = mediaLoop ? 'var(--accent)' : 'var(--text-main)';
    btn.style.borderColor = mediaLoop ? 'var(--accent)' : 'var(--border)';
  }
}

function changeMediaSpeed(val) {
  const el = getActiveMediaElement();
  if (el) el.playbackRate = parseFloat(val);
}

function changeMediaVolume(val) {
  const v = parseFloat(val);
  const videoEl = document.getElementById('media-video-element');
  const audioEl = document.getElementById('media-audio-element');
  if (videoEl) videoEl.volume = v;
  if (audioEl) audioEl.volume = v;
}

function closeMediaPlayer() {
  const videoEl = document.getElementById('media-video-element');
  const audioEl = document.getElementById('media-audio-element');
  if (videoEl) { videoEl.pause(); videoEl.src = ''; }
  if (audioEl) { audioEl.pause(); audioEl.src = ''; }
  closeModal('media-player-modal');
}

// Comic Book (.cbz/.cbr) & EPUB Reader
let bookPages = [];
let bookPageIndex = 0;
let bookZoom = 1;
let currentBookPath = '';

async function openBookReader(filePath) {
  currentBookPath = filePath;
  bookPages = [];
  bookPageIndex = 0;
  bookZoom = 1;

  const fileName = filePath.split('/').pop() || filePath;
  const titleEl = document.getElementById('book-reader-title');
  if (titleEl) titleEl.textContent = fileName;

  showModal('book-reader-modal');

  // Query archive directory listing to get all image pages inside .cbz/.zip/.epub
  try {
    const resp = await fetch(`/api/fs/list?path=${encodeURIComponent('archive://' + filePath + '#')}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      const data = await resp.json();
      bookPages = (data.entries || [])
        .filter(e => !e.is_dir && isImageExtension(e.name))
        .map(e => e.path);

      if (bookPages.length === 0) {
        const textEntries = (data.entries || []).filter(e => !e.is_dir);
        if (textEntries.length > 0) {
          loadBookTextEntry(textEntries[0].path);
          return;
        }
      }
    }
  } catch (err) {
    console.error('Book reader error:', err);
  }

  if (bookPages.length === 0) {
    bookPages = [filePath];
  }

  loadBookPage(0);
}

async function loadBookPage(idx) {
  if (bookPages.length === 0) return;
  bookPageIndex = Math.max(0, Math.min(bookPages.length - 1, idx));

  const counterEl = document.getElementById('book-reader-counter');
  const imgEl = document.getElementById('book-reader-img');
  const textEl = document.getElementById('book-reader-text');

  if (counterEl) counterEl.textContent = `Page ${bookPageIndex + 1} / ${bookPages.length}`;
  if (textEl) textEl.style.display = 'none';
  if (imgEl) {
    imgEl.style.display = 'block';
    imgEl.style.transform = `scale(${bookZoom})`;
    const p = bookPages[bookPageIndex];
    if (p.startsWith('archive://')) {
      try {
        const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(p)}`, {
          headers: { 'Authorization': `Bearer ${App.token}` }
        });
        if (resp.ok) {
          const res = await resp.json();
          if (res.is_binary) {
            imgEl.src = `data:${res.mime_type || 'image/jpeg'};base64,${res.content}`;
          } else {
            imgEl.src = res.content;
          }
        }
      } catch (err) {
        console.error('Failed to load book page data:', err);
      }
    } else {
      imgEl.src = `/api/fs/download?path=${encodeURIComponent(p)}&inline=true`;
    }
  }
}

async function loadBookTextEntry(path) {
  const imgEl = document.getElementById('book-reader-img');
  const textEl = document.getElementById('book-reader-text');
  const counterEl = document.getElementById('book-reader-counter');

  if (imgEl) imgEl.style.display = 'none';
  if (counterEl) counterEl.textContent = 'Text Mode';
  if (textEl) {
    textEl.style.display = 'block';
    try {
      const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(path)}`, {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        const res = await resp.json();
        textEl.textContent = res.content;
      }
    } catch (err) {
      textEl.textContent = `Failed to read text: ${err}`;
    }
  }
}

function navBookPage(dir) {
  if (bookPages.length <= 1) return;
  loadBookPage(bookPageIndex + dir);
}

function zoomBookPage(delta) {
  bookZoom = Math.max(0.4, Math.min(3.0, bookZoom + delta));
  const imgEl = document.getElementById('book-reader-img');
  if (imgEl) imgEl.style.transform = `scale(${bookZoom})`;
}

// ---------------- ADVANCED BULK RENAMER ----------------
let bulkRenameFiles = [];
let bulkRenamePreviewMap = [];

function triggerBulkRename() {
  const pane = App.panes[App.activePaneIndex];
  bulkRenameFiles = pane.selected.size > 0 
    ? Array.from(pane.selected).map(p => pane.entries.find(e => e.path === p)).filter(Boolean)
    : (pane.entries[pane.cursorIndex] ? [pane.entries[pane.cursorIndex]] : []);

  if (bulkRenameFiles.length === 0) {
    showToast('Please select one or more files to rename.', 'warning');
    return;
  }

  updateBulkRenameUI();
  updateBulkRenamePreview();
  showModal('bulk-rename-modal');
}

function updateBulkRenameUI() {
  const mode = document.getElementById('bulk-rename-mode').value;
  ['replace', 'sequence', 'prefix-suffix', 'case', 'extension'].forEach(m => {
    const el = document.getElementById(`rule-mode-${m}`);
    if (el) el.style.display = (m === mode) ? 'flex' : 'none';
  });
  updateBulkRenamePreview();
}

function updateBulkRenamePreview() {
  const mode = document.getElementById('bulk-rename-mode').value;
  bulkRenamePreviewMap = [];

  const seenNewNames = new Set();
  let hasConflict = false;

  bulkRenameFiles.forEach((file, idx) => {
    const origName = file.name;
    const parts = origName.split('.');
    const ext = parts.length > 1 ? parts.pop() : '';
    const base = parts.join('.');
    let newName = origName;

    if (mode === 'replace') {
      const findText = document.getElementById('rename-find').value;
      const replaceText = document.getElementById('rename-replace').value;
      const matchCase = document.getElementById('rename-match-case').checked;
      const useRegex = document.getElementById('rename-use-regex').checked;

      if (findText) {
        try {
          if (useRegex) {
            const re = new RegExp(findText, matchCase ? 'g' : 'gi');
            newName = origName.replace(re, replaceText);
          } else {
            if (matchCase) {
              newName = origName.split(findText).join(replaceText);
            } else {
              const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
              newName = origName.replace(re, replaceText);
            }
          }
        } catch (e) {
          // Invalid regex, keep origName
        }
      }
    } else if (mode === 'sequence') {
      const seqBase = document.getElementById('rename-seq-base').value;
      const start = parseInt(document.getElementById('rename-seq-start').value || '1', 10);
      const step = parseInt(document.getElementById('rename-seq-step').value || '1', 10);
      const pad = parseInt(document.getElementById('rename-seq-pad').value || '3', 10);

      const num = String(start + (idx * step)).padStart(pad, '0');
      newName = ext ? `${seqBase}${num}.${ext}` : `${seqBase}${num}`;
    } else if (mode === 'prefix-suffix') {
      const prefix = document.getElementById('rename-prefix').value || '';
      const suffix = document.getElementById('rename-suffix').value || '';
      newName = ext ? `${prefix}${base}${suffix}.${ext}` : `${prefix}${base}${suffix}`;
    } else if (mode === 'case') {
      const style = document.getElementById('rename-case-style').value;
      if (style === 'lower') {
        newName = origName.toLowerCase();
      } else if (style === 'upper') {
        newName = origName.toUpperCase();
      } else if (style === 'title') {
        newName = origName.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      } else if (style === 'kebab') {
        newName = (base.toLowerCase().replace(/[\s_]+/g, '-') + (ext ? `.${ext.toLowerCase()}` : ''));
      } else if (style === 'snake') {
        newName = (base.toLowerCase().replace(/[\s-]+/g, '_') + (ext ? `.${ext.toLowerCase()}` : ''));
      }
    } else if (mode === 'extension') {
      const newExt = document.getElementById('rename-new-ext').value.trim();
      const lower = document.getElementById('rename-ext-lower').checked;
      if (newExt) {
        newName = `${base}.${lower ? newExt.toLowerCase() : newExt}`;
      } else if (lower && ext) {
        newName = `${base}.${ext.toLowerCase()}`;
      }
    }

    const isDuplicate = seenNewNames.has(newName);
    seenNewNames.add(newName);
    if (isDuplicate) hasConflict = true;

    const parentDir = file.path.substring(0, file.path.lastIndexOf('/'));
    const newPath = `${parentDir}/${newName}`;

    bulkRenamePreviewMap.push({
      origName,
      newName,
      from: file.path,
      to: newPath,
      hasConflict: isDuplicate,
      changed: origName !== newName
    });
  });

  renderBulkRenameTable(hasConflict);
}

function renderBulkRenameTable(hasConflict) {
  const tbody = document.getElementById('bulk-rename-tbody');
  const stats = document.getElementById('bulk-rename-stats');
  const btn = document.getElementById('btn-execute-bulk-rename');

  if (!tbody) return;

  const changedCount = bulkRenamePreviewMap.filter(i => i.changed).length;
  stats.innerHTML = hasConflict 
    ? `<span style="color:var(--danger); font-weight:700;">⚠️ Name Collision / Duplicate Detected</span>` 
    : `<span style="color:var(--success); font-weight:600;">${changedCount} of ${bulkRenamePreviewMap.length} items will be renamed</span>`;

  btn.disabled = hasConflict || changedCount === 0;

  tbody.innerHTML = bulkRenamePreviewMap.map(item => `
    <tr class="file-row">
      <td>
        ${item.hasConflict 
          ? `<span class="diff-tag-conflict">Conflict</span>` 
          : (item.changed ? `<span class="diff-tag-new">✓ Change</span>` : `<span style="color:var(--text-dim); font-size:10px;">Unchanged</span>`)}
      </td>
      <td class="file-cell-mono">${escapeHtml(item.origName)}</td>
      <td class="file-cell-mono ${item.changed ? 'diff-tag-new' : ''}">${escapeHtml(item.newName)}</td>
    </tr>
  `).join('');
}

async function executeBulkRename() {
  const renames = bulkRenamePreviewMap.filter(i => i.changed).map(i => ({
    from: i.from,
    to: i.to
  }));

  if (renames.length === 0) {
    closeModal('bulk-rename-modal');
    return;
  }

  const resp = await fetch('/api/fs/batch-rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ renames })
  });

  if (resp.ok) {
    showToast(`Renamed ${renames.length} file(s)`, 'success');
    closeModal('bulk-rename-modal');
    refreshPane(App.activePaneIndex);
  } else {
    showToast('Batch Rename failed: ' + await resp.text(), 'error');
  }
}

// ---------------- TWO-WAY VISUAL DIRECTORY SYNCHRONIZER ----------------
let syncAnalysisData = null;
let syncCurrentFilter = 'all';

function openSyncModal() {
  const visible = getVisiblePaneCount();
  const srcPane = App.panes[App.activePaneIndex];
  const destPane = App.panes[(App.activePaneIndex + 1) % visible] || srcPane;

  const srcIn = document.getElementById('sync-src-input');
  const destIn = document.getElementById('sync-dest-input');
  if (srcIn) srcIn.value = srcPane.path;
  if (destIn) destIn.value = destPane.path;

  syncAnalysisData = null;
  syncCurrentFilter = 'all';
  updateSyncCounters(0, 0, 0, 0, 0);

  const tbody = document.getElementById('sync-diff-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-dim);">Click <b>Compare & Analyze</b> to inspect differences.</td></tr>`;

  const footerStats = document.getElementById('sync-footer-stats');
  if (footerStats) footerStats.textContent = 'Ready to compare directories.';

  showModal('sync-modal');
  if (srcPane.path && destPane.path && srcPane.path !== destPane.path) {
    analyzeSync();
  }
}

function swapSyncPaths() {
  const srcIn = document.getElementById('sync-src-input');
  const destIn = document.getElementById('sync-dest-input');
  if (srcIn && destIn) {
    const tmp = srcIn.value;
    srcIn.value = destIn.value;
    destIn.value = tmp;
    analyzeSync();
  }
}

function handleSyncModeChange() {
  if (syncAnalysisData) {
    analyzeSync();
  }
}

function updateSyncCounters(all, left, right, mod, eq) {
  const cAll = document.getElementById('sync-cnt-all');
  const cLeft = document.getElementById('sync-cnt-left');
  const cRight = document.getElementById('sync-cnt-right');
  const cMod = document.getElementById('sync-cnt-mod');
  const cEq = document.getElementById('sync-cnt-eq');

  if (cAll) cAll.textContent = all;
  if (cLeft) cLeft.textContent = left;
  if (cRight) cRight.textContent = right;
  if (cMod) cMod.textContent = mod;
  if (cEq) cEq.textContent = eq;
}

function filterSyncGrid(mode) {
  syncCurrentFilter = mode;
  document.querySelectorAll('.sync-filter-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-sync-filter-${mode === 'all' ? 'all' : (mode === 'left' ? 'left' : (mode === 'right' ? 'right' : (mode === 'modified' ? 'mod' : 'eq')))}`);
  if (activeBtn) activeBtn.classList.add('active');
  renderSyncDiffTable();
}

async function analyzeSync() {
  const source = document.getElementById('sync-src-input')?.value.trim();
  const destination = document.getElementById('sync-dest-input')?.value.trim();
  const mode = document.querySelector('input[name="sync-mode"]:checked')?.value || 'mirror_left_to_right';

  if (!source || !destination) {
    showToast('Please specify source and destination directories', 'warning');
    return;
  }

  const tbody = document.getElementById('sync-diff-body');
  const footerStats = document.getElementById('sync-footer-stats');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--accent);"><i data-lucide="loader"></i> Analyzing directory differences...</td></tr>`;
  if (window.lucide) lucide.createIcons();

  try {
    const resp = await fetch('/api/tools/sync/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ source, destination, options: { mode, dry_run: true, verify_checksum: true, delete_orphans: mode.includes('mirror') } })
    });

    if (!resp.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--danger);">Analysis failed: ${escapeHtml(await resp.text())}</td></tr>`;
      return;
    }

    syncAnalysisData = await resp.json();
    const files = syncAnalysisData.files || [];

    const leftCnt = files.filter(f => f.status === 'left_only' || f.status === 'modified_newer_left').length;
    const rightCnt = files.filter(f => f.status === 'right_only' || f.status === 'modified_newer_right').length;
    const modCnt = files.filter(f => f.status.startsWith('modified_') || f.status === 'size_conflict').length;
    const eqCnt = files.filter(f => f.status === 'identical').length;

    updateSyncCounters(files.length, leftCnt, rightCnt, modCnt, eqCnt);

    if (footerStats) {
      footerStats.textContent = `Found ${files.length} total files: ${leftCnt} left-only/newer, ${rightCnt} right-only/newer, ${modCnt} modified, ${eqCnt} identical (${formatFileSize(syncAnalysisData.total_transfer_bytes)} to transfer).`;
    }

    renderSyncDiffTable();
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--danger);">Error: ${escapeHtml(String(e))}</td></tr>`;
  }
}

function toggleFileAction(index) {
  if (!syncAnalysisData || !syncAnalysisData.files[index]) return;
  const item = syncAnalysisData.files[index];
  const cycle = ['copy_right', 'copy_left', 'skip'];
  const curIdx = cycle.indexOf(item.suggested_action);
  item.suggested_action = cycle[(curIdx + 1) % cycle.length];
  renderSyncDiffTable();
}

function renderSyncDiffTable() {
  const tbody = document.getElementById('sync-diff-body');
  if (!tbody || !syncAnalysisData) return;

  const files = syncAnalysisData.files || [];
  let filtered = files;

  if (syncCurrentFilter === 'left') {
    filtered = files.filter(f => f.status === 'left_only' || f.status === 'modified_newer_left');
  } else if (syncCurrentFilter === 'right') {
    filtered = files.filter(f => f.status === 'right_only' || f.status === 'modified_newer_right');
  } else if (syncCurrentFilter === 'modified') {
    filtered = files.filter(f => f.status.startsWith('modified_') || f.status === 'size_conflict');
  } else if (syncCurrentFilter === 'identical') {
    filtered = files.filter(f => f.status === 'identical');
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-dim);">No files match the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(f => {
    let actionBadge = '';
    if (f.suggested_action === 'copy_right') {
      actionBadge = `<span class="sync-action-badge action-copy-right" title="Copy Left ➔ Right (Click to change)" onclick="toggleFileAction(${files.indexOf(f)})">➔</span>`;
    } else if (f.suggested_action === 'copy_left') {
      actionBadge = `<span class="sync-action-badge action-copy-left" title="Copy Right ➔ Left (Click to change)" onclick="toggleFileAction(${files.indexOf(f)})">⬅</span>`;
    } else if (f.suggested_action === 'delete_right') {
      actionBadge = `<span class="sync-action-badge action-delete-right" title="Delete from Target (Mirror mode)" onclick="toggleFileAction(${files.indexOf(f)})">✕</span>`;
    } else if (f.suggested_action === 'identical') {
      actionBadge = `<span class="sync-action-badge action-identical" title="Identical File" onclick="toggleFileAction(${files.indexOf(f)})">✔</span>`;
    } else {
      actionBadge = `<span class="sync-action-badge action-skip" title="Skip File (Click to change)" onclick="toggleFileAction(${files.indexOf(f)})">⊘</span>`;
    }

    const leftFileClass = f.status === 'left_only' ? 'color: var(--info); font-weight: 600;' : (f.status === 'right_only' ? 'color: var(--text-dim);' : 'color: var(--text-main);');
    const rightFileClass = f.status === 'right_only' ? 'color: #c084fc; font-weight: 600;' : (f.status === 'left_only' ? 'color: var(--text-dim);' : 'color: var(--text-main);');

    return `
      <tr>
        <td style="text-align: right; color: var(--text-muted);">${escapeHtml(f.src_size_formatted)}</td>
        <td style="${leftFileClass} text-overflow: ellipsis; overflow: hidden; max-width: 300px;" title="${escapeHtml(f.rel_path)}">
          ${escapeHtml(f.rel_path)}
        </td>
        <td style="text-align: center;">${actionBadge}</td>
        <td style="${rightFileClass} text-overflow: ellipsis; overflow: hidden; max-width: 300px;" title="${escapeHtml(f.rel_path)}">
          ${escapeHtml(f.rel_path)}
        </td>
        <td style="text-align: left; color: var(--text-muted);">${escapeHtml(f.dest_size_formatted)}</td>
      </tr>
    `;
  }).join('');
}

async function executeSync() {
  const source = document.getElementById('sync-src-input')?.value.trim();
  const destination = document.getElementById('sync-dest-input')?.value.trim();
  const mode = document.querySelector('input[name="sync-mode"]:checked')?.value || 'mirror_left_to_right';

  if (!source || !destination) {
    showToast('Please specify source and destination directories', 'warning');
    return;
  }

  closeModal('sync-modal');

  try {
    const resp = await fetch('/api/tools/sync/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ source, destination, options: { mode, dry_run: false, verify_checksum: true, delete_orphans: mode.includes('mirror') } })
    });

    if (resp.ok) {
      showToast('⚡ Synchronization completed successfully', 'success');
      for (let i = 0; i < getVisiblePaneCount(); i++) refreshPane(i);
      openFloatingTaskManager();
    } else {
      showToast('Sync error: ' + await resp.text(), 'error');
    }
  } catch (e) {
    showToast('Sync execution failed: ' + String(e), 'error');
  }
}

// ---------------- VISUAL DISK USAGE TREEMAP & BAR ANALYZER ----------------
function openDiskUsageModal(path) {
  const targetPath = path || App.panes[App.activePaneIndex]?.path || '/';
  const pathIn = document.getElementById('du-path-input');
  if (pathIn) pathIn.value = targetPath;

  showModal('disk-usage-modal');
  runDiskUsageScan(targetPath);
}

async function runDiskUsageScan(path) {
  if (!path) return;
  const pathIn = document.getElementById('du-path-input');
  if (pathIn) pathIn.value = path;

  const totalSpaceEl = document.getElementById('du-total-space');
  const totalFilesEl = document.getElementById('du-total-files');
  const totalDirsEl = document.getElementById('du-total-dirs');
  const itemsList = document.getElementById('du-items-list');
  const largestList = document.getElementById('du-largest-files');

  if (itemsList) itemsList.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--accent);"><i data-lucide="loader"></i> Scanning directory storage consumption...</div>';
  if (largestList) largestList.innerHTML = '';
  if (window.lucide) lucide.createIcons();

  try {
    const resp = await fetch(`/api/tools/disk-usage?path=${encodeURIComponent(path)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (!resp.ok) {
      if (itemsList) itemsList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--danger);">Scan failed: ${escapeHtml(await resp.text())}</div>`;
      return;
    }

    const data = await resp.json();

    if (totalSpaceEl) totalSpaceEl.textContent = data.formatted_total;
    if (totalFilesEl) totalFilesEl.textContent = data.total_files.toLocaleString();
    if (totalDirsEl) totalDirsEl.textContent = data.total_dirs.toLocaleString();

    if (itemsList) {
      if (!data.items || data.items.length === 0) {
        itemsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-dim);">Directory is empty.</div>';
      } else {
        itemsList.innerHTML = data.items.map(it => {
          const icon = it.is_dir ? '📁' : '📄';
          const subInfo = it.is_dir ? `${it.file_count} files • ${it.dir_count} subdirs` : 'Single file';
          const pct = Math.max(1, Math.min(100, Math.round(it.percentage)));
          const clickAction = it.is_dir ? `onclick="runDiskUsageScan('${escapeHtml(it.path)}')"` : '';

          return `
            <div class="du-item-row" ${clickAction} title="${it.is_dir ? 'Click to drill down' : ''}">
              <div style="font-size: 16px;">${icon}</div>
              <div class="du-item-name-col">
                <div class="du-item-name">${escapeHtml(it.name)}</div>
                <div class="du-item-sub">${escapeHtml(subInfo)}</div>
              </div>
              <div class="du-item-bar-wrapper">
                <div class="du-item-bar-fill" style="width: ${pct}%;"></div>
              </div>
              <div class="du-item-size-col">${escapeHtml(it.formatted_size)}</div>
              <div class="du-item-pct-col">${it.percentage.toFixed(1)}%</div>
            </div>
          `;
        }).join('');
      }
    }

    if (largestList) {
      if (!data.largest_files || data.largest_files.length === 0) {
        largestList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-dim);">No files found.</div>';
      } else {
        largestList.innerHTML = data.largest_files.map(it => {
          const pct = Math.max(1, Math.min(100, Math.round(it.percentage)));
          return `
            <div class="du-item-row" style="cursor: default;">
              <div style="font-size: 16px;">📄</div>
              <div class="du-item-name-col">
                <div class="du-item-name">${escapeHtml(it.name)}</div>
                <div class="du-item-sub">${escapeHtml(it.path)}</div>
              </div>
              <div class="du-item-bar-wrapper">
                <div class="du-item-bar-fill" style="width: ${pct}%; background: #38bdf8;"></div>
              </div>
              <div class="du-item-size-col">${escapeHtml(it.formatted_size)}</div>
              <div class="du-item-pct-col">${it.percentage.toFixed(1)}%</div>
            </div>
          `;
        }).join('');
      }
    }

    if (window.lucide) lucide.createIcons();
  } catch (e) {
    if (itemsList) itemsList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--danger);">Error: ${escapeHtml(String(e))}</div>`;
  }
}

// ---------------- GLOBAL SEARCH ENGINE ----------------

let lastSearchResults = [];

function openSearchModal() {
  const activePane = App.panes[App.activePaneIndex];
  document.getElementById('search-root-input').value = activePane.path;
  const feedBtn = document.getElementById('btn-feed-to-pane');
  if (feedBtn) feedBtn.style.display = lastSearchResults.length > 0 ? 'inline-flex' : 'none';
  showModal('search-modal');
  document.getElementById('search-name-pattern')?.focus();
}

async function runGlobalSearch() {
  const path = document.getElementById('search-root-input').value.trim();
  const name_pattern = document.getElementById('search-name-pattern').value.trim() || null;
  const content_query = document.getElementById('search-content-query').value.trim() || null;
  const file_type = document.getElementById('search-file-type').value;
  const case_sensitive = document.getElementById('search-case-sensitive').checked;
  const date_val = document.getElementById('search-date-filter').value;
  const modified_days = date_val !== 'all' ? parseInt(date_val, 10) : null;

  const tbody = document.getElementById('search-results-tbody');
  const stats = document.getElementById('search-results-stats');
  const feedBtn = document.getElementById('btn-feed-to-pane');

  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--accent); padding: 20px;">Searching directories...</td></tr>';
  stats.textContent = 'Searching...';
  if (feedBtn) feedBtn.style.display = 'none';

  const resp = await fetch('/api/tools/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({
      path,
      name_pattern,
      content_query,
      file_type: file_type !== 'any' ? file_type : null,
      case_sensitive,
      modified_days,
      max_results: 300
    })
  });

  if (!resp.ok) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger); padding: 20px;">Search failed: ${await resp.text()}</td></tr>`;
    return;
  }

  const items = await resp.json();
  lastSearchResults = items;
  stats.textContent = `${items.length} items found`;

  if (feedBtn && items.length > 0) {
    feedBtn.style.display = 'inline-flex';
  }

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">No matching files or content found</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr class="file-row">
      <td>
        <div style="font-weight: 600; font-size: 12px; color: var(--text-main);">${escapeHtml(item.name)}</div>
        <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(item.path)}</div>
        ${item.matched_lines && item.matched_lines.length > 0 ? `
          <div style="margin-top: 4px; padding: 4px 6px; background: #090a0d; border-radius: 3px; font-family: var(--font-mono); font-size: 10px; color: var(--accent);">
            ${item.matched_lines.map(l => escapeHtml(l)).join('<br>')}
          </div>
        ` : ''}
      </td>
      <td class="file-cell-mono">${item.is_dir ? '<DIR>' : formatBytes(item.size)}</td>
      <td class="file-cell-mono">${item.modified ? formatDate(item.modified) : '-'}</td>
      <td>
        <button class="btn btn-icon" onclick="jumpToSearchResult('${escapeHtml(item.path)}', ${item.is_dir})" title="Open / Jump"><i data-lucide="external-link" style="width:12px;"></i></button>
      </td>
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function jumpToSearchResult(filePath, isDir) {
  closeModal('search-modal');
  if (isDir) {
    loadPaneDirectory(App.activePaneIndex, filePath);
  } else {
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    loadPaneDirectory(App.activePaneIndex, parentDir, true, filePath);
    if (isImageExtension(filePath)) {
      openImageViewer(filePath);
    } else {
      openEditorWithFile(filePath);
    }
  }
}

// ---------------- 🌲 FLAT / BRANCH VIEW (<kbd>Ctrl+B</kbd>) ----------------

function toggleBranchView(paneIndex) {
  const pIdx = (paneIndex !== undefined) ? paneIndex : App.activePaneIndex;
  const pane = App.panes[pIdx];
  if (!pane) return;

  pane.isBranchView = !pane.isBranchView;
  pane.isVirtual = false;
  showToast(pane.isBranchView ? '🌲 Flat Branch View Enabled' : 'Standard Directory View', 'info');
  loadPaneDirectory(pIdx, pane.path);
}

function feedSearchResultsToActivePane() {
  if (!lastSearchResults || lastSearchResults.length === 0) {
    showToast('No search results to feed', 'warning');
    return;
  }
  const pIdx = App.activePaneIndex;
  const pane = App.panes[pIdx];
  if (!pane) return;

  pane.isVirtual = true;
  pane.isBranchView = false;
  pane.virtualType = 'search';
  pane.virtualTitle = `Search Results (${lastSearchResults.length} items)`;

  pane.entries = lastSearchResults.map(item => ({
    name: item.path.replace(/^\/+/, ''),
    path: item.path,
    is_dir: item.is_dir,
    is_symlink: false,
    is_empty: null,
    size: item.size,
    modified: item.modified,
    permissions: item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--',
    mode_octal: item.is_dir ? '0755' : '0644',
    owner: 'user',
    group: 'user',
    uid: 1000,
    gid: 1000,
    mime_type: null,
    is_archive: isArchiveFile(item.name),
  }));

  pane.selected.clear();
  pane.cursorIndex = 0;

  renderPaneBreadcrumbs(pIdx, 'virtual://search');
  renderPaneTable(pIdx);
  updatePaneFooter(pIdx, {
    total_files: pane.entries.filter(e => !e.is_dir).length,
    total_dirs: pane.entries.filter(e => e.is_dir).length,
    total_size: pane.entries.reduce((sum, e) => sum + (e.size || 0), 0)
  });

  closeModal('search-modal');
  showToast(`📥 Fed ${lastSearchResults.length} search items into active pane`, 'success');
}

function exitVirtualPane(paneIndex) {
  const pIdx = (paneIndex !== undefined) ? paneIndex : App.activePaneIndex;
  const pane = App.panes[pIdx];
  if (!pane) return;

  pane.isVirtual = false;
  pane.isBranchView = false;
  loadPaneDirectory(pIdx, pane.path);
}

// ---------------- 🏷️ COLOR LABELS & CUSTOM TAGS ----------------

let fileTagsMap = new Map();
let selectedModalColor = 'none';
let modalTargetPaths = [];

async function loadAllFileTags() {
  try {
    const resp = await fetch('/api/fs/tags/all', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      fileTagsMap.clear();
      if (data.tags && Array.isArray(data.tags)) {
        data.tags.forEach(t => {
          fileTagsMap.set(t.path, t);
        });
      }
    }
  } catch (e) {
    console.error('Failed to load file tags:', e);
  }
}

async function setContextFileColor(color) {
  hideContextMenu();
  const paths = getSelectedOrCursorPaths();
  if (paths.length === 0) return;

  try {
    const resp = await fetch('/api/fs/tags/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token}`
      },
      body: JSON.stringify({
        paths,
        color_label: color === 'none' ? null : color
      })
    });

    if (resp.ok) {
      paths.forEach(p => {
        const existing = fileTagsMap.get(p) || { path: p, tags: [], updated_at: Date.now() };
        existing.color_label = (color === 'none') ? null : color;
        if (!existing.color_label && (!existing.tags || existing.tags.length === 0)) {
          fileTagsMap.delete(p);
        } else {
          fileTagsMap.set(p, existing);
        }
      });
      renderPaneTable(App.activePaneIndex);
      showToast(color === 'none' ? 'Color label cleared' : `Color label set to ${color}`, 'success');
    } else {
      showToast('Failed to update color label', 'error');
    }
  } catch (e) {
    console.error('Color label set error:', e);
    showToast('Error setting color label', 'error');
  }
}

function triggerEditTagsModal() {
  hideContextMenu();
  const paths = getSelectedOrCursorPaths();
  if (paths.length === 0) {
    showToast('No file selected', 'warning');
    return;
  }
  modalTargetPaths = paths;
  const targetLabel = document.getElementById('tags-modal-targets');
  if (targetLabel) {
    if (paths.length === 1) {
      targetLabel.textContent = paths[0].split('/').pop() || paths[0];
    } else {
      targetLabel.textContent = `${paths.length} items selected`;
    }
  }

  let curColor = 'none';
  let curTags = [];
  if (paths.length === 1 && fileTagsMap.has(paths[0])) {
    const info = fileTagsMap.get(paths[0]);
    curColor = info.color_label || 'none';
    curTags = info.tags || [];
  }

  selectModalColor(curColor);
  const inputEl = document.getElementById('tags-modal-input');
  if (inputEl) inputEl.value = curTags.join(', ');

  showModal('tags-modal');
  inputEl?.focus();
}

function selectModalColor(color) {
  selectedModalColor = color;
  const btns = document.querySelectorAll('#tags-modal-color-picker .tag-color-btn');
  btns.forEach(btn => {
    if (btn.classList.contains(`color-${color}`)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

async function saveModalTags() {
  if (modalTargetPaths.length === 0) return;
  const inputEl = document.getElementById('tags-modal-input');
  const rawText = inputEl ? inputEl.value.trim() : '';
  const tagsList = rawText ? rawText.split(',').map(s => s.trim()).filter(Boolean) : [];

  try {
    const resp = await fetch('/api/fs/tags/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${App.token}`
      },
      body: JSON.stringify({
        paths: modalTargetPaths,
        color_label: selectedModalColor === 'none' ? null : selectedModalColor,
        set_tags: tagsList
      })
    });

    if (resp.ok) {
      modalTargetPaths.forEach(p => {
        const existing = {
          path: p,
          color_label: selectedModalColor === 'none' ? null : selectedModalColor,
          tags: tagsList,
          updated_at: Date.now()
        };
        if (!existing.color_label && existing.tags.length === 0) {
          fileTagsMap.delete(p);
        } else {
          fileTagsMap.set(p, existing);
        }
      });

      renderPaneTable(App.activePaneIndex);
      closeModal('tags-modal');
      showToast('Tags and color labels updated', 'success');
    } else {
      showToast('Failed to save tags', 'error');
    }
  } catch (e) {
    console.error('Save tags error:', e);
    showToast('Error saving tags', 'error');
  }
}

// ---------------- CUSTOM SCRIPT ACTIONS RUNNER ----------------

async function runPredefinedAction(command, label) {
  const activePane = App.panes[App.activePaneIndex];
  const paths = getSelectedOrCursorPaths();

  const req = {
    command,
    working_dir: activePane.path,
    selected_files: paths.length > 0 ? paths : [activePane.path],
    target_dir: activePane.path
  };

  document.getElementById('action-output-title').textContent = `⚡ Action: ${label}`;
  document.getElementById('action-output-cmd').textContent = `$ ${command}`;
  document.getElementById('action-output-status').textContent = 'RUNNING...';
  document.getElementById('action-output-status').style.color = 'var(--accent)';
  document.getElementById('action-output-duration').textContent = '...';
  document.getElementById('action-output-text').textContent = 'Executing command on server...';

  showModal('action-output-modal');

  const resp = await fetch('/api/actions/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify(req)
  });

  if (!resp.ok) {
    document.getElementById('action-output-status').textContent = 'FAILED';
    document.getElementById('action-output-status').style.color = 'var(--danger)';
    document.getElementById('action-output-text').textContent = await resp.text();
    return;
  }

  const res = await resp.json();
  document.getElementById('action-output-status').textContent = res.success ? `SUCCESS (Code ${res.exit_code || 0})` : `FAILED (Code ${res.exit_code || 1})`;
  document.getElementById('action-output-status').style.color = res.success ? 'var(--success)' : 'var(--danger)';
  document.getElementById('action-output-duration').textContent = `${res.duration_ms}ms`;
  document.getElementById('action-output-cmd').textContent = `$ ${res.executed_command}`;
  document.getElementById('action-output-text').textContent = (res.stdout || '') + (res.stderr ? `\n--- STDERR ---\n${res.stderr}` : '') || '(No output produced)';

  refreshPane(App.activePaneIndex);
}

function copyActionOutput() {
  const text = document.getElementById('action-output-text').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Output copied to clipboard!', 'success'));
}

// ---------------- TOUCH & MOBILE GESTURE ENGINE ----------------
let swipeStartX = 0;
let swipeStartY = 0;

function setupTouchGestures() {
  const container = document.getElementById('panes-grid') || document.body;
  if (!container) return;

  container.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length === 0) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (window.innerWidth > 600) return; // In dual-pane mode (>= 600px, e.g. Foldables/Tablets) both panes are already visible side-by-side
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;

    if (Math.abs(dx) > 45 && Math.abs(dy) < 70) {
      const visible = getVisiblePaneCount();
      if (visible <= 1) return;
      if (dx < 0) {
        // Swipe Left -> Next Pane
        const nextPane = (App.activePaneIndex + 1) % visible;
        setActivePane(nextPane);
      } else {
        // Swipe Right -> Prev Pane
        const prevPane = (App.activePaneIndex - 1 + visible) % visible;
        setActivePane(prevPane);
      }
    }
  }, { passive: true });
}

// ---------------- SYNCTHING INTEGRATION ----------------
function openSyncthingModal() {
  showModal('syncthing-modal');
  loadSyncthingDashboard();
}

async function loadSyncthingDashboard() {
  const badge = document.getElementById('syncthing-conn-badge');
  const tbodyFolders = document.getElementById('syncthing-folders-tbody');
  const tbodyPeers = document.getElementById('syncthing-peers-tbody');

  if (badge) {
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = 'var(--accent)';
    badge.textContent = 'Connecting...';
  }

  try {
    const resp = await fetch('/api/tools/syncthing/status', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (!resp.ok) {
      if (badge) {
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = 'var(--danger)';
        badge.textContent = 'Offline / Error';
      }
      if (tbodyFolders) tbodyFolders.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger); padding:16px;">Failed to reach Syncthing API: ${await resp.text()}</td></tr>`;
      if (tbodyPeers) tbodyPeers.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:12px;">No peers available</td></tr>`;
      return;
    }

    const data = await resp.json();

    if (badge) {
      if (data.available) {
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.color = '#34d399';
        badge.textContent = `🟢 Online (${data.peers.filter(p => p.connected).length} Connected)`;
      } else {
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = 'var(--danger)';
        badge.textContent = '⚪ Disconnected / Not Running';
      }
    }

    const downEl = document.getElementById('st-down-speed');
    const upEl = document.getElementById('st-up-speed');
    const fCountEl = document.getElementById('st-folders-count');
    const pCountEl = document.getElementById('st-peers-count');

    if (downEl) downEl.textContent = `${formatBytes(data.total_download_speed)}/s`;
    if (upEl) upEl.textContent = `${formatBytes(data.total_upload_speed)}/s`;
    if (fCountEl) fCountEl.textContent = data.folders.length;
    if (pCountEl) pCountEl.textContent = data.peers.filter(p => p.connected).length;

    const bannerText = document.getElementById('st-daemon-url-text');
    const guiLink = document.getElementById('st-daemon-gui-link');
    if (bannerText) bannerText.textContent = `🌐 Syncthing Daemon: ${data.url} ${data.my_id ? '(' + data.my_id.substring(0, 7) + '...)' : ''}`;
    if (guiLink) guiLink.href = data.url;

    // Render Folders
    if (tbodyFolders) {
      if (data.folders.length === 0) {
        tbodyFolders.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">${data.available ? 'No synchronized folders configured yet' : data.message}</td></tr>`;
      } else {
        tbodyFolders.innerHTML = data.folders.map(f => {
          const isUpToDate = f.in_sync_percent >= 99.9;
          const statusColor = f.paused ? 'var(--text-muted)' : (isUpToDate ? 'var(--success)' : 'var(--accent)');
          return `
            <tr class="file-row">
              <td><b>${escapeHtml(f.label)}</b> <span style="font-size:10px; color:var(--text-muted);">(${escapeHtml(f.id)})</span></td>
              <td><code style="cursor:pointer; color:var(--accent);" onclick="jumpToFolderInPane('${escapeHtml(f.path)}')" title="Click to open in active pane">${escapeHtml(f.path)}</code></td>
              <td><span style="color:${statusColor}; font-weight:600;">${f.state.toUpperCase()}</span></td>
              <td>
                <div style="display:flex; align-items:center; gap:6px;">
                  <div style="flex:1; background:var(--bg-dark); height:6px; border-radius:3px; overflow:hidden; border:1px solid var(--border);">
                    <div style="background:${statusColor}; height:100%; width:${f.in_sync_percent}%;"></div>
                  </div>
                  <span style="font-size:10px; font-family:var(--font-mono);">${f.in_sync_percent.toFixed(0)}%</span>
                </div>
              </td>
              <td style="text-align:right;">
                <button class="btn btn-sm" onclick="triggerSyncthingScan('${f.id}')" title="Scan Folder"><i data-lucide="rotate-cw"></i></button>
                <button class="btn btn-sm" onclick="jumpToFolderInPane('${escapeHtml(f.path)}')" title="Open in Active Pane"><i data-lucide="folder-open"></i></button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Render Peers
    if (tbodyPeers) {
      if (data.peers.length === 0) {
        tbodyPeers.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:12px;">No remote devices paired</td></tr>`;
      } else {
        tbodyPeers.innerHTML = data.peers.map(p => `
          <tr class="file-row">
            <td><b>${escapeHtml(p.name)}</b> <span style="font-size:10px; color:var(--text-muted);">(${p.id.substring(0, 7)}...)</span></td>
            <td><span style="font-family:var(--font-mono); font-size:11px;">${escapeHtml(p.address || 'Dynamic')}</span></td>
            <td><span style="color:${p.connected ? 'var(--success)' : 'var(--text-muted)'}; font-weight:600;">${p.connected ? '● CONNECTED' : '○ DISCONNECTED'}</span></td>
            <td style="font-family:var(--font-mono); color:var(--success);">${formatBytes(p.in_bps)}/s</td>
            <td style="font-family:var(--font-mono); color:var(--accent);">${formatBytes(p.out_bps)}/s</td>
          </tr>
        `).join('');
      }
    }

    if (window.lucide) lucide.createIcons();
  } catch (e) {
    if (badge) {
      badge.style.background = 'rgba(239, 68, 68, 0.15)';
      badge.style.color = 'var(--danger)';
      badge.textContent = 'Error';
    }
    if (tbodyFolders) tbodyFolders.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger); padding:16px;">Error connecting to Syncthing: ${e}</td></tr>`;
  }
}

async function triggerSyncthingScan(folderId) {
  try {
    const resp = await fetch('/api/tools/syncthing/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ folder_id: folderId || null })
    });
    if (resp.ok) {
      showToast('Scan initiated', 'success');
      loadSyncthingDashboard();
    } else {
      showToast(`Scan failed: ${await resp.text()}`, 'error');
    }
  } catch (e) {
    showToast(`Error: ${e}`, 'error');
  }
}

function jumpToFolderInPane(path) {
  closeModal('syncthing-modal');
  loadPaneDirectory(App.activePaneIndex, path);
}

async function testAndSaveSyncthingConfig() {
  const status = document.getElementById('syncthing-settings-status');
  if (status) {
    status.style.display = 'block';
    status.style.color = 'var(--accent)';
    status.textContent = 'Testing connection...';
  }

  try {
    const resp = await fetch('/api/tools/syncthing/status', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const st = await resp.json();
      if (status) {
        status.style.color = st.available ? 'var(--success)' : 'var(--warning)';
        status.textContent = st.available ? `✓ Connected to Syncthing (${st.folders.length} folders, ${st.peers.length} peers)` : `⚠️ ${st.message}`;
      }
    } else {
      if (status) {
        status.style.color = 'var(--danger)';
        status.textContent = `✗ ${await resp.text()}`;
      }
    }
  } catch (e) {
    if (status) {
      status.style.color = 'var(--danger)';
      status.textContent = `✗ Error: ${e}`;
    }
  }
}

function toggleParanoidMode() {
  App.paranoidMode = !App.paranoidMode;
  updateParanoidBadge();
  showToast(`Paranoid Mode: ${App.paranoidMode ? 'ON' : 'OFF'}`, 'info');
}

function refreshAllPanes() {
  for (let i = 0; i < getVisiblePaneCount(); i++) refreshPane(i);
}

function handleLogoutOrExit() {
  const isStandalone = App.config?.server?.standalone || window.__TAURI__ !== undefined;
  if (isStandalone) {
    confirmExitCommanderDog();
  } else {
    logout();
  }
}

async function confirmExitCommanderDog() {
  const confirmed = confirm("Are you sure you want to quit CommanderDog?");
  if (!confirmed) return;

  try {
    showToast("Exiting CommanderDog...", "info");
    await fetch('/api/system/exit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('cd_token') || ''}`
      }
    });
  } catch (e) {}

  if (window.__TAURI__?.process?.exit) {
    try {
      window.__TAURI__.process.exit(0);
    } catch (e) {}
  } else {
    window.close();
    document.body.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-dark, #0b0f14); color: var(--text-main, #e1e7ec); font-family: sans-serif; text-align: center; padding: 20px;">
        <h2 style="color: var(--accent, #f59e0b); margin-bottom: 8px;">🐕 CommanderDog Closed</h2>
        <p style="color: var(--text-muted, #7a889b); font-size: 13px;">The application process has been terminated. You can safely close this window.</p>
      </div>
    `;
  }
}

function logout() {
  localStorage.removeItem('cd_token');
  localStorage.removeItem('cd_is_locked');
  App.token = '';
  App.user = null;
  App.isLocked = false;
  location.reload();
}

function updateMobileBottomBar() {
  const pane = App.panes[App.activePaneIndex];
  const count = pane ? pane.selected.size : 0;
  
  const copyBtn = document.getElementById('mob-btn-copy');
  const moveBtn = document.getElementById('mob-btn-move');
  const delBtn = document.getElementById('mob-btn-delete');
  const actLabel = document.getElementById('mob-actions-label');
  const actBtn = document.getElementById('mob-btn-actions');

  if (copyBtn) {
    const span = copyBtn.querySelector('span');
    if (span) span.textContent = count > 0 ? `Copy (${count})` : 'Copy';
    if (count > 0) copyBtn.classList.add('has-selection');
    else copyBtn.classList.remove('has-selection');
  }
  if (moveBtn) {
    const span = moveBtn.querySelector('span');
    if (span) span.textContent = count > 0 ? `Move (${count})` : 'Move';
    if (count > 0) moveBtn.classList.add('has-selection');
    else moveBtn.classList.remove('has-selection');
  }
  if (delBtn) {
    const span = delBtn.querySelector('span');
    if (span) span.textContent = count > 0 ? `Delete (${count})` : 'Delete';
    if (count > 0) delBtn.classList.add('has-selection');
    else delBtn.classList.remove('has-selection');
  }
  if (actLabel) {
    actLabel.textContent = count > 0 ? `Actions (${count})` : 'Actions';
  }
  if (actBtn) {
    if (count > 0) actBtn.classList.add('has-selection');
    else actBtn.classList.remove('has-selection');
  }
}

function toggleRowSelect(paneIndex, path, idx) {
  const pane = App.panes[paneIndex];
  if (pane.selected.has(path)) {
    pane.selected.delete(path);
  } else {
    pane.selected.add(path);
  }
  pane.cursorIndex = idx;
  renderPaneTable(paneIndex);
  updateMobileBottomBar();
}

function toggleSelectAll(paneIndex) {
  const pane = App.panes[paneIndex];
  if (pane.selected.size === pane.entries.length) {
    pane.selected.clear();
  } else {
    pane.entries.forEach(e => pane.selected.add(e.path));
  }
  renderPaneTable(paneIndex);
  updateMobileBottomBar();
}

function clearActiveSelections() {
  const pane = App.panes[App.activePaneIndex];
  if (pane) {
    pane.selected.clear();
    renderPaneTable(App.activePaneIndex);
  }
  updateMobileBottomBar();
}

// ---------------- DYNAMIC VIEWPORT HEIGHT & BOTTOM ADDRESS BAR SYNC ----------------
function updateDynamicViewportHeight() {
  if (window.visualViewport) {
    const vh = window.visualViewport.height;
    document.documentElement.style.setProperty('--viewport-height', `${vh}px`);
    document.body.style.height = `${vh}px`;

    // Dynamic bottom offset if browser address bar / chrome sits at bottom
    const bottomBarOffset = Math.max(0, window.innerHeight - (window.visualViewport.height + window.visualViewport.offsetTop));
    document.documentElement.style.setProperty('--mobile-bottom-offset', `${bottomBarOffset}px`);
  } else {
    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
    document.documentElement.style.setProperty('--mobile-bottom-offset', '0px');
  }
}
window.addEventListener('resize', updateDynamicViewportHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateDynamicViewportHeight);
  window.visualViewport.addEventListener('scroll', updateDynamicViewportHeight);
}
document.addEventListener('DOMContentLoaded', updateDynamicViewportHeight);

// ---------------- GLOBAL SPOTLIGHT QUICK-SWITCHER ----------------
let spotlightCurrentCat = 'all';
let spotlightQuery = '';
let spotlightSelectedIndex = 0;
let spotlightItems = [];

const SPOTLIGHT_STATIC_ACTIONS = [
  { id: 'calc', title: 'Calculator', sub: 'Interactive floating calculator with storage units & base conversions', icon: 'calculator', cat: 'actions', action: () => openFloatingCalculator() },
  { id: 'branch', title: 'Flat / Branch View', sub: 'Flatten all subdirectories into a single unified list (Ctrl+B)', icon: 'git-branch', cat: 'actions', action: () => toggleBranchView() },
  { id: 'tags', title: 'Color Labels & Custom Tags', sub: 'Assign color labels and custom tags to selected items', icon: 'tag', cat: 'actions', action: () => triggerEditTagsModal() },
  { id: 'term', title: 'Terminal Console', sub: 'Open integrated interactive terminal (` or F4)', icon: 'terminal', cat: 'actions', action: () => toggleTerminal() },
  { id: 'edit', title: 'EditorDog Multi-Tab', sub: 'Open floating EditorDog code & text editor (F4)', icon: 'code', cat: 'actions', action: () => openFloatingEditor() },
  { id: 'diff', title: 'File & Folder Diff', sub: 'Compare files or directories side-by-side (F9)', icon: 'git-compare', cat: 'actions', action: () => triggerDiff() },
  { id: 'search', title: 'Deep File Search', sub: 'Search files and folders recursively (Ctrl+F)', icon: 'search', cat: 'actions', action: () => openSearchModal() },
  { id: 'shares', title: 'Active Shares & Dropboxes', sub: 'Manage public share links and guest upload dropboxes', icon: 'share-2', cat: 'actions', action: () => openSharesManager() },
  { id: 'sync', title: 'Directory Sync & Mirror', sub: 'Compare and sync two directories bidirectionally', icon: 'refresh-cw', cat: 'actions', action: () => openSyncModal() },
  { id: 'du', title: 'Disk Usage & Storage Treemap Analyzer', sub: 'Inspect space consumption, largest folders & files', icon: 'pie-chart', cat: 'actions', action: () => openDiskUsageModal() },
  { id: 'syncthing', title: 'Syncthing Dashboard', sub: 'Continuous peer-to-peer file synchronization', icon: 'repeat', cat: 'actions', action: () => openSyncthingModal() },
  { id: 'convert', title: 'ConvertX File Converter', sub: 'Batch convert images, documents, audio, videos', icon: 'file-output', cat: 'actions', action: () => openConverterModal() },
  { id: 'tasks', title: 'Background Transfers & Queue', sub: 'View active transfers, speeds, and queued jobs', icon: 'list-checks', cat: 'actions', action: () => openFloatingTaskManager() },
  { id: 'settings', title: 'User Settings & Hub', sub: 'Themes, keybindings, and preferences (F10)', icon: 'settings', cat: 'actions', action: () => openSettingsModal() },
  { id: 'admin', title: 'Admin Control Panel', sub: 'User management, RBAC, mounts, audit logs', icon: 'shield-alert', cat: 'actions', action: () => openAdminPanel() },
  { id: 'profile', title: 'User Profile & Password', sub: 'Account credentials, session avatar, and security', icon: 'user', cat: 'actions', action: () => openUserProfileModal() },
  { id: 'lock', title: 'Lock Session', sub: 'Lock CommanderDog immediately (Ctrl+Alt+L)', icon: 'lock', cat: 'actions', action: () => lockSession() },
  { id: 'mkdir', title: 'New Folder', sub: 'Create a new directory in active pane (F7)', icon: 'folder-plus', cat: 'actions', action: () => triggerMkdir() },
  { id: 'newfile', title: 'New Text File', sub: 'Create a new empty text document', icon: 'file-plus', cat: 'actions', action: () => triggerNewFile() },
  { id: 'compress', title: 'Compress to Archive', sub: 'Create .zip or .tar.gz from selected files', icon: 'archive', cat: 'actions', action: () => triggerCompressModal() },
  { id: 'perms', title: 'Permissions & Ownership', sub: 'Visual Unix chmod & chown editor', icon: 'shield', cat: 'actions', action: () => triggerPermissions() },
  { id: 'theme-amber', title: 'Theme: Amber (Classic Woofson)', sub: 'Switch theme to Amber Gold', icon: 'palette', cat: 'actions', action: () => applyTheme('amber') },
  { id: 'theme-emerald', title: 'Theme: Emerald', sub: 'Switch theme to Emerald Green', icon: 'palette', cat: 'actions', action: () => applyTheme('emerald') },
  { id: 'theme-sky', title: 'Theme: Sky Blue', sub: 'Switch theme to Sky Blue', icon: 'palette', cat: 'actions', action: () => applyTheme('sky') },
  { id: 'theme-nord', title: 'Theme: Nord Frost', sub: 'Switch theme to Arctic Nord', icon: 'palette', cat: 'actions', action: () => applyTheme('nord') },
  { id: 'theme-cyberpunk', title: 'Theme: Cyberpunk Neon', sub: 'Switch theme to Neon Cyberpunk', icon: 'palette', cat: 'actions', action: () => applyTheme('cyberpunk') },
  { id: 'theme-dracula', title: 'Theme: Dracula', sub: 'Switch theme to Gothic Dracula Dark', icon: 'palette', cat: 'actions', action: () => applyTheme('dracula') },
  { id: 'theme-monokai', title: 'Theme: Monokai Pro', sub: 'Switch theme to Monokai High Contrast', icon: 'palette', cat: 'actions', action: () => applyTheme('monokai') },
  { id: 'theme-matrix', title: 'Theme: Matrix Terminal', sub: 'Switch theme to Phosphor Green Matrix', icon: 'palette', cat: 'actions', action: () => applyTheme('matrix') }
];

function openSpotlightModal() {
  const modal = document.getElementById('spotlight-modal');
  if (!modal) return;
  
  spotlightQuery = '';
  spotlightCurrentCat = 'all';
  spotlightSelectedIndex = 0;
  
  const input = document.getElementById('spotlight-input');
  if (input) input.value = '';
  
  const clearBtn = document.getElementById('spotlight-clear-btn');
  if (clearBtn) clearBtn.style.display = 'none';

  updateSpotlightCatButtons();
  buildSpotlightItems();
  renderSpotlightResults();
  
  modal.style.display = 'flex';
  setTimeout(() => input?.focus(), 50);
}

function closeSpotlightModal() {
  const modal = document.getElementById('spotlight-modal');
  if (modal) modal.style.display = 'none';
}

function toggleSpotlightModal() {
  const modal = document.getElementById('spotlight-modal');
  if (modal && modal.style.display === 'flex') {
    closeSpotlightModal();
  } else {
    openSpotlightModal();
  }
}

function clearSpotlightInput() {
  const input = document.getElementById('spotlight-input');
  if (input) {
    input.value = '';
    handleSpotlightInput('');
    input.focus();
  }
}

function filterSpotlightCategory(cat) {
  spotlightCurrentCat = cat;
  updateSpotlightCatButtons();
  spotlightSelectedIndex = 0;
  buildSpotlightItems();
  renderSpotlightResults();
}

function updateSpotlightCatButtons() {
  const cats = ['all', 'actions', 'paths', 'bookmarks', 'recent'];
  cats.forEach(c => {
    const btn = document.getElementById(`spotlight-cat-${c}`);
    if (btn) {
      if (c === spotlightCurrentCat) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
}

function handleSpotlightInput(val) {
  spotlightQuery = (val || '').trim();
  const clearBtn = document.getElementById('spotlight-clear-btn');
  if (clearBtn) clearBtn.style.display = spotlightQuery ? 'inline-flex' : 'none';
  spotlightSelectedIndex = 0;
  buildSpotlightItems();
  renderSpotlightResults();
}

function recordRecentHistory(item) {
  if (!item || (!item.path && !item.title)) return;
  try {
    let recents = JSON.parse(localStorage.getItem('cd_spotlight_recents') || '[]');
    recents = recents.filter(r => r.path !== item.path && r.title !== item.title);
    recents.unshift({
      title: item.title,
      sub: item.sub || item.path,
      path: item.path,
      icon: item.icon || (item.is_dir ? 'folder' : 'file-text'),
      cat: 'recent',
      is_dir: item.is_dir !== false,
      timestamp: Date.now()
    });
    if (recents.length > 20) recents = recents.slice(0, 20);
    localStorage.setItem('cd_spotlight_recents', JSON.stringify(recents));
  } catch (e) {}
}

function getRecentHistory() {
  try {
    return JSON.parse(localStorage.getItem('cd_spotlight_recents') || '[]');
  } catch (e) {
    return [];
  }
}

function getBookmarksLocalCache() {
  try {
    return JSON.parse(localStorage.getItem('cd_bookmarks_cache') || '[]');
  } catch (e) {
    return [];
  }
}

function buildSpotlightItems() {
  const q = spotlightQuery.toLowerCase();
  let pool = [];

  // 1. Static Actions & Dynamic Themes
  if (spotlightCurrentCat === 'all' || spotlightCurrentCat === 'actions') {
    pool.push(...SPOTLIGHT_STATIC_ACTIONS.map(a => ({
      title: a.title,
      sub: a.sub,
      icon: a.icon,
      cat: 'action',
      badge: 'Action',
      handler: a.action
    })));

    if (App.config?.themes?.themes && Array.isArray(App.config.themes.themes)) {
      App.config.themes.themes.forEach(t => {
        pool.push({
          title: `Theme: ${t.name}`,
          sub: `Switch visual color palette to ${t.name}`,
          icon: 'palette',
          cat: 'action',
          badge: 'Theme',
          handler: () => applyTheme(t.id)
        });
      });
    }
  }

  // 2. Standard & Open Paths
  if (spotlightCurrentCat === 'all' || spotlightCurrentCat === 'paths') {
    const userHome = `/home/${App.user?.username || 'bolt'}`;
    const standardPaths = [
      { title: 'Home Directory', path: userHome, icon: 'home', sub: userHome },
      { title: 'Root Filesystem', path: '/', icon: 'hard-drive', sub: '/' },
      { title: 'Downloads', path: `${userHome}/Downloads`, icon: 'download', sub: `${userHome}/Downloads` },
      { title: 'Documents', path: `${userHome}/Documents`, icon: 'file-text', sub: `${userHome}/Documents` },
      { title: 'Projects', path: `${userHome}/projects`, icon: 'folder-git-2', sub: `${userHome}/projects` },
      { title: 'Temporary /tmp', path: '/tmp', icon: 'zap', sub: '/tmp' },
      { title: 'System Config /etc', path: '/etc', icon: 'settings', sub: '/etc' },
      { title: 'System Logs /var/log', path: '/var/log', icon: 'file-text', sub: '/var/log' }
    ];

    // Add active open panes
    App.panes.forEach((p, idx) => {
      if (p.path) {
        standardPaths.push({
          title: `Pane ${idx + 1}: ${p.path.split('/').filter(Boolean).pop() || '/'}`,
          path: p.path,
          icon: 'columns-2',
          sub: p.path
        });
      }
    });

    standardPaths.forEach(p => {
      pool.push({
        title: p.title,
        sub: p.sub,
        path: p.path,
        icon: p.icon,
        cat: 'path',
        badge: 'Folder',
        handler: () => {
          recordRecentHistory({ title: p.title, path: p.path, is_dir: true, icon: p.icon });
          navigatePane(App.activePaneIndex, p.path);
        }
      });
    });

    // If query looks like an absolute path or URI, offer to jump directly
    if (spotlightQuery.startsWith('/') || spotlightQuery.startsWith('~') || spotlightQuery.startsWith('smb://') || spotlightQuery.startsWith('sftp://')) {
      const targetP = spotlightQuery.startsWith('~') ? spotlightQuery.replace('~', userHome) : spotlightQuery;
      pool.unshift({
        title: `Jump to path: ${targetP}`,
        sub: `Navigate active pane to ${targetP}`,
        path: targetP,
        icon: 'folder-symlink',
        cat: 'path',
        badge: 'Direct Path',
        handler: () => {
          recordRecentHistory({ title: `Path: ${targetP}`, path: targetP, is_dir: true, icon: 'folder' });
          navigatePane(App.activePaneIndex, targetP);
        }
      });
    }
  }

  // 3. Bookmarks & Mounts
  if (spotlightCurrentCat === 'all' || spotlightCurrentCat === 'bookmarks') {
    const bookmarks = getBookmarksLocalCache();
    bookmarks.forEach(b => {
      pool.push({
        title: b.name || b.path,
        sub: `${b.protocol ? b.protocol.toUpperCase() + ' • ' : ''}${b.path}`,
        path: b.path,
        icon: 'star',
        cat: 'bookmark',
        badge: b.protocol || 'Bookmark',
        handler: () => {
          recordRecentHistory({ title: b.name || b.path, path: b.path, is_dir: true, icon: 'star' });
          if (b.has_password) {
            openRemoteAuthModal(b.path, b.protocol);
          } else {
            navigatePane(App.activePaneIndex, b.path);
          }
        }
      });
    });
  }

  // 4. Recent History
  if (spotlightCurrentCat === 'all' || spotlightCurrentCat === 'recent') {
    const recents = getRecentHistory();
    recents.forEach(r => {
      pool.push({
        title: r.title,
        sub: r.sub || r.path,
        path: r.path,
        icon: r.icon || 'history',
        cat: 'recent',
        badge: 'Recent',
        handler: () => {
          if (r.path) {
            navigatePane(App.activePaneIndex, r.path);
          }
        }
      });
    });
  }

  // Filter pool by query with score matching
  if (q) {
    spotlightItems = pool.filter(it => {
      const matchTitle = it.title && it.title.toLowerCase().includes(q);
      const matchSub = it.sub && it.sub.toLowerCase().includes(q);
      return matchTitle || matchSub;
    }).sort((a, b) => {
      const aStarts = a.title && a.title.toLowerCase().startsWith(q);
      const bStarts = b.title && b.title.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return 0;
    });
  } else {
    // Show top curated items
    spotlightItems = pool.slice(0, 30);
  }
}

function renderSpotlightResults() {
  const container = document.getElementById('spotlight-results');
  if (!container) return;

  if (spotlightItems.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--text-muted);">
        <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
        <div style="font-size: 13px; font-weight: 600; color: var(--text-main);">No matching results found</div>
        <div style="font-size: 11px; margin-top: 4px;">Try typing a path (e.g. <code>/etc</code>, <code>/var/log</code>) or a command name.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = spotlightItems.map((it, idx) => {
    const isSelected = idx === spotlightSelectedIndex;
    return `
      <div class="spotlight-item ${isSelected ? 'selected' : ''}" data-index="${idx}" onclick="executeSpotlightIndex(${idx})">
        <div class="spotlight-item-icon">
          <i data-lucide="${it.icon || 'file'}"></i>
        </div>
        <div class="spotlight-item-content">
          <div class="spotlight-item-title">${escapeHtml(it.title)}</div>
          ${it.sub ? `<div class="spotlight-item-sub">${escapeHtml(it.sub)}</div>` : ''}
        </div>
        ${it.badge ? `<span class="spotlight-item-badge">${escapeHtml(it.badge)}</span>` : ''}
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();

  const selectedEl = container.querySelector('.spotlight-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function handleSpotlightKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (spotlightItems.length > 0) {
      spotlightSelectedIndex = (spotlightSelectedIndex + 1) % spotlightItems.length;
      renderSpotlightResults();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (spotlightItems.length > 0) {
      spotlightSelectedIndex = (spotlightSelectedIndex - 1 + spotlightItems.length) % spotlightItems.length;
      renderSpotlightResults();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (spotlightItems.length > 0 && spotlightItems[spotlightSelectedIndex]) {
      executeSpotlightIndex(spotlightSelectedIndex);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSpotlightModal();
  }
}

function executeSpotlightIndex(idx) {
  const item = spotlightItems[idx];
  if (!item) return;

  closeSpotlightModal();
  if (typeof item.handler === 'function') {
    item.handler();
  }
}

// ---------------- RICH MEDIA & EXIF GPS INSPECTOR ----------------
let inspectorMapInstance = null;
let currentInspectorCoords = null;

function inspectCurrentImage() {
  if (currentImageList && currentImageList[currentImageIndex]) {
    openMediaInspector(currentImageList[currentImageIndex]);
  }
}

function triggerMediaInspector() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (item) {
    openMediaInspector(item.path);
  }
}

function copyToClipboardText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied: ${text}`, 'info');
    }).catch(() => {});
  } else {
    showToast(`Copied: ${text}`, 'info');
  }
}

function extractDominantColors(imgEl) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 40, 40);
    const data = ctx.getImageData(0, 0, 40, 40).data;
    
    const colors = {};
    for (let i = 0; i < data.length; i += 16) {
      const r = Math.round(data[i] / 32) * 32;
      const g = Math.round(data[i + 1] / 32) * 32;
      const b = Math.round(data[i + 2] / 32) * 32;
      const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      colors[hex] = (colors[hex] || 0) + 1;
    }
    
    const sorted = Object.entries(colors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(entry => entry[0]);
    return sorted;
  } catch (e) {
    return [];
  }
}

async function openMediaInspector(filePath) {
  const fileName = filePath.split('/').pop() || filePath;
  const ext = fileName.split('.').pop().toLowerCase();

  const titleEl = document.getElementById('inspector-file-title');
  const mainName = document.getElementById('inspector-main-name');
  const mainSub = document.getElementById('inspector-main-sub');
  const dlBtn = document.getElementById('inspector-file-download');
  const thumbImg = document.getElementById('inspector-preview-img');
  const thumbIcon = document.getElementById('inspector-preview-icon');
  const paletteRow = document.getElementById('inspector-palette-row');

  const secCamera = document.getElementById('inspector-section-camera');
  const gridCamera = document.getElementById('inspector-camera-grid');
  const secGps = document.getElementById('inspector-section-gps');
  const secStream = document.getElementById('inspector-section-stream');
  const gridStream = document.getElementById('inspector-stream-grid');
  const gridFs = document.getElementById('inspector-fs-grid');

  if (titleEl) titleEl.textContent = `Media Inspector: ${fileName}`;
  if (mainName) mainName.textContent = fileName;
  if (mainSub) mainSub.textContent = `Analyzing ${ext.toUpperCase()} media...`;
  if (paletteRow) paletteRow.innerHTML = '';

  const downloadUrl = `/api/fs/download?path=${encodeURIComponent(filePath)}`;
  const streamUrl = `/api/fs/download?path=${encodeURIComponent(filePath)}&inline=true`;

  if (dlBtn) {
    dlBtn.href = downloadUrl;
    dlBtn.download = fileName;
  }

  if (secCamera) secCamera.style.display = 'none';
  if (secGps) secGps.style.display = 'none';
  if (secStream) secStream.style.display = 'none';

  // Populate FS Info
  if (gridFs) {
    gridFs.innerHTML = `
      <div class="inspector-grid-item">
        <span class="inspector-grid-label">Full Path</span>
        <span class="inspector-grid-value" style="font-size: 11px;">${escapeHtml(filePath)}</span>
      </div>
      <div class="inspector-grid-item">
        <span class="inspector-grid-label">File Type</span>
        <span class="inspector-grid-value">${escapeHtml(ext.toUpperCase())}</span>
      </div>
    `;
  }

  const isImg = isImageExtension(fileName);
  const isAud = isAudioExtension(fileName);
  const isVid = isVideoExtension(fileName);

  if (isImg) {
    if (thumbIcon) thumbIcon.style.display = 'none';
    if (thumbImg) {
      thumbImg.style.display = 'block';
      thumbImg.src = streamUrl;
      thumbImg.onload = () => {
        const colors = extractDominantColors(thumbImg);
        if (paletteRow && colors.length > 0) {
          paletteRow.innerHTML = colors.map(hex => `
            <div class="inspector-color-swatch" style="background: ${hex};" title="Click to copy ${hex}" onclick="copyToClipboardText('${hex}')"></div>
          `).join('');
        }
      };
    }
  } else {
    if (thumbImg) thumbImg.style.display = 'none';
    if (thumbIcon) {
      thumbIcon.style.display = 'block';
      thumbIcon.textContent = isVid ? '🎬' : (isAud ? '🎵' : '📄');
    }
  }

  showModal('media-inspector-modal');
  if (window.lucide) lucide.createIcons();

  // Load and Parse
  try {
    const resp = await fetch(`/api/fs/download?path=${encodeURIComponent(filePath)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (resp.ok) {
      const buffer = await resp.arrayBuffer();
      const fileSize = formatFileSize(buffer.byteLength);

      if (isImg) {
        // Parse EXIF
        const exif = parseExifFromBuffer(buffer);
        const imgWidth = exif.PixelXDimension || exif.ImageWidth;
        const imgHeight = exif.PixelYDimension || exif.ImageHeight;
        const mp = (imgWidth && imgHeight) ? ((imgWidth * imgHeight) / 1000000).toFixed(1) + ' MP' : '';

        if (mainSub) {
          mainSub.textContent = `${ext.toUpperCase()} Image • ${imgWidth ? `${imgWidth} × ${imgHeight} (${mp}) • ` : ''}${fileSize}`;
        }

        // Camera Details
        const cameraItems = [];
        if (exif.Make || exif.Model) cameraItems.push({ label: 'Camera Body', val: `${exif.Make || ''} ${exif.Model || ''}`.trim() });
        if (exif.LensModel) cameraItems.push({ label: 'Lens Model', val: exif.LensModel });
        if (exif.FNumber) cameraItems.push({ label: 'Aperture', val: `ƒ/${exif.FNumber}` });
        if (exif.ExposureTime) cameraItems.push({ label: 'Shutter Speed', val: formatShutterSpeed(exif.ExposureTime) });
        if (exif.ISOSpeedRatings) cameraItems.push({ label: 'ISO Sensitivity', val: `ISO ${exif.ISOSpeedRatings}` });
        if (exif.FocalLength) cameraItems.push({ label: 'Focal Length', val: `${exif.FocalLength}mm${exif.FocalLengthIn35mmFilm ? ` (${exif.FocalLengthIn35mmFilm}mm in 35mm)` : ''}` });
        if (exif.ExposureBiasValue !== undefined) cameraItems.push({ label: 'Exposure Bias', val: `${exif.ExposureBiasValue > 0 ? '+' : ''}${exif.ExposureBiasValue} EV` });
        if (exif.DateTimeOriginal) cameraItems.push({ label: 'Date Taken', val: exif.DateTimeOriginal });
        if (exif.Software) cameraItems.push({ label: 'Software / OS', val: exif.Software });

        if (cameraItems.length > 0) {
          if (secCamera) secCamera.style.display = 'block';
          if (gridCamera) {
            gridCamera.innerHTML = cameraItems.map(it => `
              <div class="inspector-grid-item">
                <span class="inspector-grid-label">${escapeHtml(it.label)}</span>
                <span class="inspector-grid-value">${escapeHtml(it.val)}</span>
              </div>
            `).join('');
          }
        }

        // GPS Location & Map
        if (exif.gps && exif.gps.lat !== undefined && exif.gps.lon !== undefined) {
          currentInspectorCoords = exif.gps;
          const lat = exif.gps.lat;
          const lon = exif.gps.lon;
          const alt = exif.gps.altitude ? ` • Alt: ${exif.gps.altitude.toFixed(1)}m` : '';

          if (secGps) secGps.style.display = 'block';
          const coordsEl = document.getElementById('inspector-gps-coords');
          if (coordsEl) coordsEl.textContent = `📍 ${lat.toFixed(6)}°, ${lon.toFixed(6)}°${alt}`;

          const linkOsm = document.getElementById('inspector-link-osm');
          if (linkOsm) linkOsm.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
          const linkGmaps = document.getElementById('inspector-link-gmaps');
          if (linkGmaps) linkGmaps.href = `https://www.google.com/maps?q=${lat},${lon}`;
          const linkApple = document.getElementById('inspector-link-apple');
          if (linkApple) linkApple.href = `https://maps.apple.com/?q=${lat},${lon}`;

          setTimeout(() => {
            if (window.L) {
              const mapEl = document.getElementById('inspector-leaflet-map');
              if (mapEl) {
                if (inspectorMapInstance) {
                  inspectorMapInstance.remove();
                  inspectorMapInstance = null;
                }
                inspectorMapInstance = L.map('inspector-leaflet-map').setView([lat, lon], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                  attribution: '© OpenStreetMap contributors'
                }).addTo(inspectorMapInstance);
                L.marker([lat, lon]).addTo(inspectorMapInstance)
                  .bindPopup(`<b>${escapeHtml(fileName)}</b><br>${lat.toFixed(5)}, ${lon.toFixed(5)}`)
                  .openPopup();
              }
            }
          }, 200);
        }

      } else if (isVid || isAud) {
        // Video / Audio Stream Inspection
        if (secStream) secStream.style.display = 'block';
        if (gridStream) gridStream.innerHTML = '<div style="color: var(--text-dim);">Analyzing stream...</div>';

        const tempEl = document.createElement(isVid ? 'video' : 'audio');
        tempEl.src = streamUrl;
        tempEl.onloadedmetadata = () => {
          const durationStr = formatMediaDuration(tempEl.duration);
          if (mainSub) {
            mainSub.textContent = `${ext.toUpperCase()} ${isVid ? 'Video' : 'Audio'} • ${durationStr} • ${fileSize}`;
          }
          const streamItems = [
            { label: 'Container Format', val: ext.toUpperCase() },
            { label: 'Total Duration', val: durationStr },
            { label: 'File Size', val: fileSize }
          ];

          if (isVid && tempEl.videoWidth) {
            const resLabel = getResolutionLabel(tempEl.videoWidth, tempEl.videoHeight);
            streamItems.push({ label: 'Video Dimensions', val: `${tempEl.videoWidth} × ${tempEl.videoHeight} (${resLabel})` });
            const gcd = (a, b) => b ? gcd(b, a % b) : a;
            const d = gcd(tempEl.videoWidth, tempEl.videoHeight);
            streamItems.push({ label: 'Aspect Ratio', val: `${tempEl.videoWidth / d}:${tempEl.videoHeight / d}` });
          }

          if (gridStream) {
            gridStream.innerHTML = streamItems.map(it => `
              <div class="inspector-grid-item">
                <span class="inspector-grid-label">${escapeHtml(it.label)}</span>
                <span class="inspector-grid-value">${escapeHtml(it.val)}</span>
              </div>
            `).join('');
          }
        };
      }
    }
  } catch (e) {
    console.error('Media inspection error:', e);
  }
  if (window.lucide) lucide.createIcons();
}

function copyInspectorCoordinates() {
  if (currentInspectorCoords) {
    const str = `${currentInspectorCoords.lat.toFixed(6)}, ${currentInspectorCoords.lon.toFixed(6)}`;
    copyToClipboardText(str);
  }
}

function formatShutterSpeed(val) {
  if (!val) return '';
  if (val < 1) {
    return `1/${Math.round(1 / val)}s`;
  }
  return `${val}s`;
}

function formatMediaDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${(m % 60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getResolutionLabel(w, h) {
  const maxDim = Math.max(w, h);
  if (maxDim >= 3800) return '4K UHD';
  if (maxDim >= 2500) return '2K QHD';
  if (maxDim >= 1900) return '1080p FHD';
  if (maxDim >= 1200) return '720p HD';
  if (maxDim >= 800) return '480p SD';
  return 'Standard';
}

function parseExifFromBuffer(buffer) {
  const view = new DataView(buffer);
  const result = {};

  if (view.getUint16(0, false) !== 0xFFD8) {
    return result;
  }

  let offset = 2;
  const length = view.byteLength;

  while (offset < length) {
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset + 1);

    if (marker === 0xE1) {
      const exifHeader = view.getUint32(offset + 4, false);
      if (exifHeader === 0x45786966 && view.getUint16(offset + 8, false) === 0x0000) {
        const tiffOffset = offset + 10;
        parseTiffHeader(view, tiffOffset, result);
      }
      break;
    } else {
      offset += 2 + view.getUint16(offset + 2, false);
    }
  }

  return result;
}

function parseTiffHeader(view, tiffOffset, result) {
  if (tiffOffset + 8 > view.byteLength) return;
  const byteOrder = view.getUint16(tiffOffset, false);
  const littleEndian = byteOrder === 0x4949;

  if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002A) {
    return;
  }

  const ifd0Offset = view.getUint32(tiffOffset + 4, littleEndian);
  parseIFD(view, tiffOffset, tiffOffset + ifd0Offset, littleEndian, result);
}

function parseIFD(view, tiffOffset, ifdOffset, littleEndian, result) {
  if (ifdOffset + 2 > view.byteLength) return;
  const numEntries = view.getUint16(ifdOffset, littleEndian);
  let offset = ifdOffset + 2;

  const TAGS = {
    0x010F: 'Make',
    0x0110: 'Model',
    0x0112: 'Orientation',
    0x011A: 'XResolution',
    0x011B: 'YResolution',
    0x0131: 'Software',
    0x0132: 'DateTime',
    0x8769: 'ExifIFDPointer',
    0x8825: 'GPSInfoIFDPointer',
    0xA002: 'PixelXDimension',
    0xA003: 'PixelYDimension',
    0x0100: 'ImageWidth',
    0x0101: 'ImageHeight'
  };

  const EXIF_TAGS = {
    0x829A: 'ExposureTime',
    0x829D: 'FNumber',
    0x8827: 'ISOSpeedRatings',
    0x9003: 'DateTimeOriginal',
    0x9004: 'CreateDate',
    0x9204: 'ExposureBiasValue',
    0x9207: 'MeteringMode',
    0x9209: 'Flash',
    0x920A: 'FocalLength',
    0xA405: 'FocalLengthIn35mmFilm',
    0xA434: 'LensModel'
  };

  for (let i = 0; i < numEntries; i++) {
    if (offset + 12 > view.byteLength) break;
    const tag = view.getUint16(offset, littleEndian);
    const type = view.getUint16(offset + 2, littleEndian);
    const count = view.getUint32(offset + 4, littleEndian);
    const valueOffset = view.getUint32(offset + 8, littleEndian);

    const tagName = TAGS[tag] || EXIF_TAGS[tag];
    if (tagName) {
      result[tagName] = readTagValue(view, tiffOffset, offset + 8, type, count, littleEndian);
    }

    if (tag === 0x8769) {
      parseIFD(view, tiffOffset, tiffOffset + valueOffset, littleEndian, result);
    } else if (tag === 0x8825) {
      parseGPSIFD(view, tiffOffset, tiffOffset + valueOffset, littleEndian, result);
    }

    offset += 12;
  }
}

function parseGPSIFD(view, tiffOffset, ifdOffset, littleEndian, result) {
  if (ifdOffset + 2 > view.byteLength) return;
  const numEntries = view.getUint16(ifdOffset, littleEndian);
  let offset = ifdOffset + 2;
  const gps = {};

  for (let i = 0; i < numEntries; i++) {
    if (offset + 12 > view.byteLength) break;
    const tag = view.getUint16(offset, littleEndian);
    const type = view.getUint16(offset + 2, littleEndian);
    const count = view.getUint32(offset + 4, littleEndian);

    if (tag === 0x0001) gps.latRef = readTagValue(view, tiffOffset, offset + 8, type, count, littleEndian);
    else if (tag === 0x0002) gps.latRaw = readTagValue(view, tiffOffset, offset + 8, type, count, littleEndian);
    else if (tag === 0x0003) gps.lonRef = readTagValue(view, tiffOffset, offset + 8, type, count, littleEndian);
    else if (tag === 0x0004) gps.lonRaw = readTagValue(view, tiffOffset, offset + 8, type, count, littleEndian);
    else if (tag === 0x0006) gps.altitude = readTagValue(view, tiffOffset, offset + 8, type, count, littleEndian);

    offset += 12;
  }

  if (Array.isArray(gps.latRaw) && gps.latRaw.length === 3 && Array.isArray(gps.lonRaw) && gps.lonRaw.length === 3) {
    let lat = gps.latRaw[0] + gps.latRaw[1] / 60 + gps.latRaw[2] / 3600;
    if (gps.latRef === 'S') lat = -lat;
    let lon = gps.lonRaw[0] + gps.lonRaw[1] / 60 + gps.lonRaw[2] / 3600;
    if (gps.lonRef === 'W') lon = -lon;
    result.gps = { lat, lon, altitude: gps.altitude };
  }
}

function readTagValue(view, tiffOffset, valOffset, type, count, littleEndian) {
  if (type === 2) {
    const ptr = count > 4 ? tiffOffset + view.getUint32(valOffset, littleEndian) : valOffset;
    let str = '';
    for (let i = 0; i < count - 1; i++) {
      if (ptr + i < view.byteLength) {
        const c = view.getUint8(ptr + i);
        if (c === 0) break;
        str += String.fromCharCode(c);
      }
    }
    return str.trim();
  } else if (type === 3) {
    return view.getUint16(valOffset, littleEndian);
  } else if (type === 4) {
    return view.getUint32(valOffset, littleEndian);
  } else if (type === 5 || type === 10) {
    const ptr = tiffOffset + view.getUint32(valOffset, littleEndian);
    if (count === 1) {
      const num = type === 10 ? view.getInt32(ptr, littleEndian) : view.getUint32(ptr, littleEndian);
      const den = type === 10 ? view.getInt32(ptr + 4, littleEndian) : view.getUint32(ptr + 4, littleEndian);
      return den !== 0 ? num / den : 0;
    } else {
      const arr = [];
      for (let i = 0; i < count; i++) {
        const num = type === 10 ? view.getInt32(ptr + i * 8, littleEndian) : view.getUint32(ptr + i * 8, littleEndian);
        const den = type === 10 ? view.getInt32(ptr + i * 8 + 4, littleEndian) : view.getUint32(ptr + i * 8 + 4, littleEndian);
        arr.push(den !== 0 ? num / den : 0);
      }
      return arr;
    }
  }
  return null;
}

// =========================================================================
// 🪟 IN-PANE TOOL DOCKING ENGINE (Editor, Terminal, Calc, Git)
// =========================================================================

function dockEditorToActivePane() {
  dockToolToPane('editor', App.activePaneIndex);
}

function dockTerminalToActivePane() {
  dockToolToPane('terminal', App.activePaneIndex);
}

function dockCalculatorToActivePane() {
  dockToolToPane('calculator', App.activePaneIndex);
}

function dockTasksToActivePane() {
  dockToolToPane('tasks', App.activePaneIndex);
}

function dockGitToActivePane() {
  dockToolToPane('git', App.activePaneIndex);
}

function rebuildPaneDOM(paneIndex) {
  const oldPaneEl = document.getElementById(`pane-${paneIndex}`);
  const pane = App.panes[paneIndex];
  if (!pane) return;

  const newPaneEl = createPaneElement(pane, paneIndex);
  if (oldPaneEl && oldPaneEl.parentNode) {
    oldPaneEl.replaceWith(newPaneEl);
  } else {
    renderAllPanes();
    return;
  }

  if (pane.dockedTool) {
    mountDockedTool(paneIndex);
  } else {
    loadPaneDirectory(paneIndex, pane.path);
  }

  applyPaneColors();
  if (window.lucide) lucide.createIcons();
}

function dockToolToPane(toolName, paneIndex) {
  const pane = App.panes[paneIndex];
  if (!pane) return;

  pane.dockedTool = toolName;

  // 1. Editor: hide floating editor window & pill
  if (toolName === 'editor') {
    const win = document.getElementById('floating-editor-window');
    if (win) win.style.display = 'none';
    const pill = document.getElementById('editor-pill');
    if (pill) pill.style.display = 'none';
    if (editorTabs.length === 0) {
      createNewEditorTab('', 'Untitled-1', null, false, []);
    }
  }
  // 2. Terminal: close the bottom slide-up drawer completely!
  else if (toolName === 'terminal') {
    const drawer = document.getElementById('terminal-drawer');
    if (drawer) {
      drawer.classList.remove('active');
      drawer.classList.remove('fullscreen');
    }
    termOpen = false;
  }
  // 3. Calculator: hide floating calculator & pill
  else if (toolName === 'calculator') {
    const win = document.getElementById('floating-calculator-window');
    if (win) win.style.display = 'none';
    const pill = document.getElementById('calc-pill');
    if (pill) pill.style.display = 'none';
  }
  // 4. Tasks: hide floating task manager & backdrop
  else if (toolName === 'tasks') {
    closeFloatingTaskManager();
  }
  // 5. Git: close git modal
  else if (toolName === 'git') {
    closeModal('git-modal');
  }

  rebuildPaneDOM(paneIndex);
  showToast(`Docked ${toolName.toUpperCase()} into Pane ${paneIndex + 1}`, 'info');
}

function undockToolFromPane(paneIndex) {
  const pane = App.panes[paneIndex];
  if (!pane || !pane.dockedTool) return;

  const tool = pane.dockedTool;
  pane.dockedTool = null;

  // If terminal was docked, return #terminal-output back to the bottom drawer!
  if (tool === 'terminal') {
    const drawer = document.getElementById('terminal-drawer');
    const termOutput = document.getElementById('terminal-output');
    if (drawer && termOutput && !drawer.contains(termOutput)) {
      drawer.appendChild(termOutput);
    }
  }

  // Cleanly restore the full file browser in this pane!
  rebuildPaneDOM(paneIndex);

  // Pop open the floating tool!
  if (tool === 'editor') {
    openFloatingEditor();
    renderEditorTabs();
    const activeTab = getActiveEditorTab('left');
    if (activeTab) {
      const textarea = document.getElementById('editor-text-left');
      if (textarea) textarea.value = activeTab.content || '';
      handleEditorInput('left');
    }
  } else if (tool === 'terminal') {
    toggleTerminal(true);
  } else if (tool === 'calculator') {
    openFloatingCalculator();
  } else if (tool === 'tasks') {
    openFloatingTaskManager();
  } else if (tool === 'git') {
    openGitManager(paneIndex, pane.path);
  }
}

function closeDockedTool(paneIndex) {
  const pane = App.panes[paneIndex];
  if (!pane) return;
  const tool = pane.dockedTool;
  pane.dockedTool = null;

  if (tool === 'terminal') {
    const drawer = document.getElementById('terminal-drawer');
    const termOutput = document.getElementById('terminal-output');
    if (drawer && termOutput && !drawer.contains(termOutput)) {
      drawer.appendChild(termOutput);
    }
  }

  rebuildPaneDOM(paneIndex);
}

function mountDockedTool(paneIndex) {
  const pane = App.panes[paneIndex];
  if (!pane || !pane.dockedTool) return;

  const tool = pane.dockedTool;
  const mount = document.getElementById(`docked-tool-mount-${paneIndex}`);
  if (!mount) return;

  // 1. DOCKED CODE EDITOR
  if (tool === 'editor') {
    const activeTab = getActiveEditorTab('left');
    mount.innerHTML = `
      <div style="padding: 6px 10px; background: var(--bg-dark); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
        <div style="display: flex; gap: 4px; align-items: center;">
          <button class="btn btn-xs btn-accent" onclick="saveDockedEditorTab(${paneIndex})"><i data-lucide="save" style="width:11px; height:11px;"></i> Save</button>
          <button class="btn btn-xs" onclick="createNewDockedEditorTab(${paneIndex})"><i data-lucide="plus" style="width:11px; height:11px;"></i> New</button>
        </div>
        <div style="font-size: 11px; color: var(--text-dim); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="docked-editor-file-label-${paneIndex}">
          ${escapeHtml(activeTab ? activeTab.filename : 'Untitled')}
        </div>
      </div>
      <div class="editor-tab-strip" style="background: var(--bg-panel); border-bottom: 1px solid var(--border); overflow-x: auto; display: flex; align-items: center; padding: 2px 6px;">
        <div class="editor-tabs-scroll" id="docked-editor-tabs-${paneIndex}" style="display: flex; gap: 4px; padding: 2px 0;"></div>
      </div>
      <div style="flex: 1; position: relative; display: flex; overflow: hidden; height: 100%;">
        <textarea id="docked-editor-textarea-${paneIndex}" class="editor-textarea" style="width: 100%; height: 100%; resize: none; background: #181a1f; color: #f8fafc; font-family: var(--font-mono); font-size: 12px; line-height: 1.4; padding: 10px; border: none; outline: none; white-space: pre;" oninput="syncDockedEditorInput(${paneIndex}, this.value)"></textarea>
      </div>
    `;

    renderDockedEditorTabs(paneIndex);
    const textarea = document.getElementById(`docked-editor-textarea-${paneIndex}`);
    if (textarea && activeTab) {
      textarea.value = activeTab.content || '';
    }
  }
  // 2. DOCKED TERMINAL CONSOLE (REAL XTERM.JS PTY)
  else if (tool === 'terminal') {
    mount.innerHTML = `
      <div id="docked-term-host-${paneIndex}" style="flex: 1; width: 100%; height: 100%; position: relative; overflow: hidden; background: #090a0d;"></div>
    `;

    const host = document.getElementById(`docked-term-host-${paneIndex}`);
    const termOutput = document.getElementById('terminal-output');
    if (host && termOutput) {
      host.appendChild(termOutput);
      termOutput.style.width = '100%';
      termOutput.style.height = '100%';
      termOutput.style.display = 'block';
    }

    initTerminalUI();

    const cwd = (pane && !pane.path.includes('://')) ? pane.path : '/';
    if (!termWs || termWs.readyState !== WebSocket.OPEN) {
      connectTerminal(cwd);
    }

    setTimeout(() => {
      if (termFitAddon) termFitAddon.fit();
      if (termInstance) {
        termInstance.focus();
        if (termWs && termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ cols: termInstance.cols, rows: termInstance.rows, resize: true }));
        }
      }
    }, 100);
  }
  // 3. DOCKED CALCULATOR (COMPLETE WITH CONVERTERS, STORAGE UNITS & HISTORY)
  else if (tool === 'calculator') {
    mount.innerHTML = `
      <div class="docked-calc-box" style="padding: 12px 16px; display: flex; flex-direction: column; width: 100%; max-width: 340px; height: 100%; gap: 8px; background: var(--bg-panel); overflow-y: auto;">
        <!-- Screen / Display -->
        <div class="calc-display-panel">
          <div class="calc-expression-line" id="calc-expr-display">&nbsp;</div>
          <div class="calc-result-row">
            <input type="text" class="calc-result-input" id="calc-display-input" value="0" autocomplete="off" spellcheck="false" readonly />
            <button class="btn btn-icon btn-xs calc-copy-btn" onclick="copyCalcResult()" title="Copy Result to Clipboard"><i data-lucide="copy" style="width: 13px;"></i></button>
          </div>
        </div>

        <!-- Live Byte & Base Converter Bar -->
        <div class="calc-converters-bar" id="calc-converters-bar">
          <div class="calc-conv-item" title="Human-readable File Size"><span class="calc-conv-lbl">SIZE:</span> <span class="calc-conv-val" id="calc-conv-size">0 B</span></div>
          <div class="calc-conv-item" title="Hexadecimal"><span class="calc-conv-lbl">HEX:</span> <span class="calc-conv-val" id="calc-conv-hex">0x0</span></div>
          <div class="calc-conv-item" title="Octal (chmod mode)"><span class="calc-conv-lbl">OCT:</span> <span class="calc-conv-val" id="calc-conv-oct">0</span></div>
          <div class="calc-conv-item" title="Binary"><span class="calc-conv-lbl">BIN:</span> <span class="calc-conv-val" id="calc-conv-bin">0b0</span></div>
        </div>

        <!-- Mode & Quick Byte Multipliers Row -->
        <div class="calc-units-row">
          <button class="btn btn-xs calc-unit-btn" onclick="calcAppendUnit('KB')" title="Multiply by 1024 (KB)">KB</button>
          <button class="btn btn-xs calc-unit-btn" onclick="calcAppendUnit('MB')" title="Multiply by 1024² (MB)">MB</button>
          <button class="btn btn-xs calc-unit-btn" onclick="calcAppendUnit('GB')" title="Multiply by 1024³ (GB)">GB</button>
          <button class="btn btn-xs calc-unit-btn" onclick="calcAppendUnit('TB')" title="Multiply by 1024⁴ (TB)">TB</button>
          <button class="btn btn-xs calc-unit-btn" onclick="calcAppendFunc('sqrt(')" title="Square Root">√</button>
          <button class="btn btn-xs calc-unit-btn" onclick="calcAppendOp('^')" title="Exponent / Power">xʸ</button>
        </div>

        <!-- Main Keypad Grid -->
        <div class="calc-keypad-grid">
          <button class="btn calc-btn calc-btn-fn" onclick="calcClearAll()">C</button>
          <button class="btn calc-btn calc-btn-fn" onclick="calcClearEntry()">CE</button>
          <button class="btn calc-btn calc-btn-fn" onclick="calcBackspace()" title="Backspace"><i data-lucide="delete" style="width: 14px;"></i></button>
          <button class="btn calc-btn calc-btn-op" onclick="calcAppendOp('/')">÷</button>

          <button class="btn calc-btn calc-btn-fn" onclick="calcAppendChar('(')">(</button>
          <button class="btn calc-btn calc-btn-fn" onclick="calcAppendChar(')')">)</button>
          <button class="btn calc-btn calc-btn-fn" onclick="calcAppendOp('%')">%</button>
          <button class="btn calc-btn calc-btn-op" onclick="calcAppendOp('*')">×</button>

          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('7')">7</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('8')">8</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('9')">9</button>
          <button class="btn calc-btn calc-btn-op" onclick="calcAppendOp('-')">−</button>

          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('4')">4</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('5')">5</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('6')">6</button>
          <button class="btn calc-btn calc-btn-op" onclick="calcAppendOp('+')">+</button>

          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('1')">1</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('2')">2</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('3')">3</button>
          <button class="btn calc-btn calc-btn-equals" onclick="calcEvaluate()">=</button>

          <button class="btn calc-btn calc-btn-fn" onclick="calcToggleSign()">±</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendNum('0')">0</button>
          <button class="btn calc-btn calc-btn-num" onclick="calcAppendDot()">.</button>
          <button class="btn calc-btn calc-btn-fn" onclick="calcAppendPi()" title="Pi (3.14159...)">π</button>
        </div>

        <!-- History Tape Drawer Toggle -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px; border-top: 1px solid var(--border);">
          <button class="btn btn-xs btn-outline" onclick="toggleCalcHistory()" style="font-size: 10px;"><i data-lucide="history" style="width: 11px; height: 11px;"></i> History</button>
          <span style="font-size: 10px; color: var(--text-dim);">Keyboard Active</span>
        </div>
      </div>
    `;
    calcUpdateDisplay();
  }
  // 4. DOCKED TASKS & BACKGROUND TRANSFERS
  else if (tool === 'tasks') {
    mount.innerHTML = `
      <div style="padding: 12px; display: flex; flex-direction: column; height: 100%; gap: 10px; background: var(--bg-panel); overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-dark); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="task-status-indicator" id="docked-task-indicator-${paneIndex}"></span>
            <span style="font-weight: 700; font-size: 12px;" id="docked-task-title-${paneIndex}">⚡ Transfers (0 active)</span>
            <span class="task-speed-badge" id="docked-task-speed-${paneIndex}">0 B/s</span>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-xs btn-outline" onclick="pollTasks()" title="Refresh Status"><i data-lucide="rotate-cw" style="width:11px; height:11px;"></i></button>
          </div>
        </div>

        <!-- Batch Progress Summary -->
        <div class="task-batch-summary" style="margin: 0;">
          <div class="task-progress-meta">
            <span id="docked-task-batch-files-${paneIndex}">0 / 0 files</span>
            <span id="docked-task-batch-percent-${paneIndex}">0%</span>
            <span id="docked-task-batch-bytes-${paneIndex}">0 B / 0 B</span>
            <span id="docked-task-batch-eta-${paneIndex}" style="color: var(--accent); font-weight: 700;">ETA: --:--</span>
          </div>
          <div class="task-progress-bar-track">
            <div class="task-progress-bar-fill" id="docked-task-batch-fill-${paneIndex}" style="width: 0%;"></div>
          </div>
        </div>

        <!-- Active File Card -->
        <div class="task-active-file-card" style="margin: 0;">
          <div class="task-file-info">
            <span style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
              <i data-lucide="file-text" style="width: 14px; height: 14px; color: var(--accent);"></i>
              <span class="task-cur-filename" id="docked-task-filename-${paneIndex}">Idle (No active file)</span>
            </span>
            <span class="task-cur-speed" id="docked-task-cur-speed-${paneIndex}">0 B/s</span>
          </div>
          <div class="task-progress-bar-track task-file-track">
            <div class="task-progress-bar-fill task-file-fill" id="docked-task-file-fill-${paneIndex}" style="width: 0%;"></div>
          </div>
          <div class="task-file-stats">
            <span id="docked-task-file-bytes-${paneIndex}">0 B / 0 B</span>
            <span id="docked-task-file-percent-${paneIndex}">0%</span>
          </div>
        </div>

        <!-- Queue List -->
        <div style="font-weight: 700; font-size: 11px; color: var(--text-dim); margin-top: 4px;">Transfer Queue & History:</div>
        <div id="docked-task-queue-${paneIndex}" class="task-queue-list" style="flex: 1; min-height: 120px; max-height: none; background: var(--bg-dark); border-radius: 6px; border: 1px solid var(--border); padding: 6px; overflow-y: auto;"></div>
      </div>
    `;
    if (lastKnownTasksList) {
      renderDockedTasksForPane(paneIndex, lastKnownTasksList);
    } else {
      pollTasks();
    }
  }
  // 5. DOCKED GIT MANAGER
  else if (tool === 'git') {
    mount.innerHTML = `
      <div style="padding: 10px; display: flex; flex-direction: column; height: 100%; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; font-size: 11px;">Git Working Tree: <span id="docked-git-branch" class="badge">main</span></span>
          <button class="btn btn-xs btn-accent" onclick="openGitManager(${paneIndex})">Open Full Git Manager</button>
        </div>
        <div id="docked-git-file-list" style="flex: 1; overflow-y: auto; background: var(--bg-dark); border-radius: 4px; border: 1px solid var(--border); padding: 4px;">Loading repository status...</div>
      </div>
    `;
    loadGitStatusForDocked(paneIndex, pane.path);
  }

  if (window.lucide) lucide.createIcons({ root: mount });
}

function renderDockedTasksPanes(list) {
  App.panes.forEach((p, idx) => {
    if (p.dockedTool === 'tasks') {
      renderDockedTasksForPane(idx, list);
    }
  });
}

function renderDockedTasksForPane(paneIndex, list) {
  const mount = document.getElementById(`docked-tool-mount-${paneIndex}`);
  if (!mount) return;

  const running = list.filter(t => t.status === 'running');
  const totalSpeed = running.reduce((acc, t) => acc + (t.speed_bytes_per_sec || 0), 0);
  const speedStr = totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : '0 B/s';

  const titleEl = document.getElementById(`docked-task-title-${paneIndex}`);
  const indEl = document.getElementById(`docked-task-indicator-${paneIndex}`);
  const speedEl = document.getElementById(`docked-task-speed-${paneIndex}`);

  if (titleEl) titleEl.textContent = `⚡ Transfers (${running.length} active${list.length > running.length ? `, ${list.length - running.length} done` : ''})`;
  if (indEl) {
    if (running.length > 0) indEl.classList.add('active');
    else indEl.classList.remove('active');
  }
  if (speedEl) {
    speedEl.textContent = speedStr;
    speedEl.style.display = totalSpeed > 0 ? 'inline-block' : 'none';
  }

  let totalBatchBytes = 0;
  let totalProcessedBytes = 0;
  let totalBatchFiles = 0;
  let totalProcessedFiles = 0;
  let activeCurrentFile = null;
  let activeCurBytes = 0;
  let activeCurTotal = 0;
  let activeSpeed = 0;

  list.forEach(t => {
    totalBatchBytes += t.total_bytes || 0;
    totalProcessedBytes += t.bytes_processed || 0;
    totalBatchFiles += t.total_files || 1;
    totalProcessedFiles += t.files_processed || (t.status === 'completed' ? (t.total_files || 1) : 0);

    if (t.status === 'running' && !activeCurrentFile) {
      activeCurrentFile = sanitizeCredentials(t.current_file || t.name);
      activeCurBytes = t.current_file_bytes || t.bytes_processed;
      activeCurTotal = t.current_file_total_bytes || t.total_bytes;
      activeSpeed = t.speed_bytes_per_sec || 0;
    }
  });

  const overallPercent = totalBatchBytes > 0 ? Math.min(100, Math.round((totalProcessedBytes / totalBatchBytes) * 100)) : (running.length === 0 && list.length > 0 ? 100 : 0);

  const batchFill = document.getElementById(`docked-task-batch-fill-${paneIndex}`);
  const batchPercent = document.getElementById(`docked-task-batch-percent-${paneIndex}`);
  const batchFiles = document.getElementById(`docked-task-batch-files-${paneIndex}`);
  const batchBytes = document.getElementById(`docked-task-batch-bytes-${paneIndex}`);
  const batchEta = document.getElementById(`docked-task-batch-eta-${paneIndex}`);

  if (batchFill) batchFill.style.width = `${overallPercent}%`;
  if (batchPercent) batchPercent.textContent = `${overallPercent}%`;
  if (batchFiles) batchFiles.textContent = `${totalProcessedFiles} / ${totalBatchFiles} files`;
  if (batchBytes) batchBytes.textContent = `${formatBytes(totalProcessedBytes)} / ${formatBytes(totalBatchBytes)}`;

  if (batchEta) {
    if (running.length > 0 && totalSpeed > 0 && totalBatchBytes > totalProcessedBytes) {
      const etaSec = Math.round((totalBatchBytes - totalProcessedBytes) / totalSpeed);
      const mins = Math.floor(etaSec / 60);
      const secs = etaSec % 60;
      batchEta.textContent = `ETA: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else if (running.length === 0) {
      batchEta.textContent = list.length > 0 ? '✓ Complete' : 'Idle';
    } else {
      batchEta.textContent = 'ETA: --:--';
    }
  }

  const curNameEl = document.getElementById(`docked-task-filename-${paneIndex}`);
  const curSpeedEl = document.getElementById(`docked-task-cur-speed-${paneIndex}`);
  const curFillEl = document.getElementById(`docked-task-file-fill-${paneIndex}`);
  const curBytesEl = document.getElementById(`docked-task-file-bytes-${paneIndex}`);
  const curPercentEl = document.getElementById(`docked-task-file-percent-${paneIndex}`);

  if (activeCurrentFile) {
    if (curNameEl) curNameEl.textContent = activeCurrentFile;
    if (curSpeedEl) curSpeedEl.textContent = activeSpeed > 0 ? `${formatBytes(activeSpeed)}/s` : '';
    const filePct = activeCurTotal > 0 ? Math.min(100, Math.round((activeCurBytes / activeCurTotal) * 100)) : 0;
    if (curFillEl) curFillEl.style.width = `${filePct}%`;
    if (curBytesEl) curBytesEl.textContent = `${formatBytes(activeCurBytes)} / ${formatBytes(activeCurTotal)}`;
    if (curPercentEl) curPercentEl.textContent = `${filePct}%`;
  } else {
    if (curNameEl) curNameEl.textContent = running.length === 0 ? 'No active file transfer' : 'Preparing next file...';
    if (curSpeedEl) curSpeedEl.textContent = '';
    if (curFillEl) curFillEl.style.width = '0%';
    if (curBytesEl) curBytesEl.textContent = '0 B / 0 B';
    if (curPercentEl) curPercentEl.textContent = '0%';
  }

  const queueList = document.getElementById(`docked-task-queue-${paneIndex}`);
  if (queueList) {
    if (list.length === 0) {
      queueList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 11px;">No active background jobs</div>';
    } else {
      queueList.innerHTML = list.map(t => {
        const pct = t.total_bytes > 0 ? Math.min(100, Math.round((t.bytes_processed / t.total_bytes) * 100)) : (t.status === 'completed' ? 100 : 0);
        const badgeClass = `task-badge-${t.status || 'running'}`;
        const isRunning = t.status === 'running';
        const isPaused = t.status === 'paused';
        const safeName = sanitizeCredentials(t.name);
        const safeSrc = sanitizeCredentials(t.source);
        const safeDest = sanitizeCredentials(t.destination);

        return `
          <div class="task-queue-item" style="margin-bottom: 6px;">
            <div class="task-queue-details">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                  <span class="task-queue-name" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</span>
                  ${isRunning && t.speed_bytes_per_sec > 0 ? `<span style="font-size: 9px; font-family: var(--font-mono); color: var(--accent); font-weight: 700;">⚡ ${formatBytes(t.speed_bytes_per_sec)}/s</span>` : ''}
                </div>
                <span class="task-queue-badge ${badgeClass}">${escapeHtml(t.status)}</span>
              </div>
              <div class="task-queue-sub" title="${escapeHtml(safeSrc)} ➔ ${escapeHtml(safeDest)}">${escapeHtml(safeSrc)} ➔ ${escapeHtml(safeDest)}</div>
              ${isRunning || isPaused ? `
                <div style="height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; margin-top: 3px; overflow: hidden;">
                  <div style="height: 100%; width: ${pct}%; background: var(--accent);"></div>
                </div>
              ` : ''}
            </div>
            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
              ${isRunning ? `
                <button class="btn btn-xs btn-icon" onclick="pauseTask('${t.id}')" title="Pause"><i data-lucide="pause" style="width: 10px; height: 10px;"></i></button>
                <button class="btn btn-xs btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel"><i data-lucide="x" style="width: 10px; height: 10px;"></i></button>
              ` : (isPaused ? `
                <button class="btn btn-xs btn-icon" onclick="resumeTask('${t.id}')" title="Resume"><i data-lucide="play" style="width: 10px; height: 10px;"></i></button>
                <button class="btn btn-xs btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel"><i data-lucide="x" style="width: 10px; height: 10px;"></i></button>
              ` : '')}
            </div>
          </div>
        `;
      }).join('');
      if (window.lucide) lucide.createIcons({ root: queueList });
    }
  }
}

function renderDockedEditorTabs(paneIndex) {
  const container = document.getElementById(`docked-editor-tabs-${paneIndex}`);
  if (!container) return;

  container.innerHTML = editorTabs.map(tab => {
    const isActive = tab.id === activeTabIdLeft;
    const isDirty = tab.isDirty;
    const icon = getFileIconForExtension(tab.path || tab.filename);

    return `
      <div class="editor-tab ${isActive ? 'active' : ''}" style="padding: 3px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px; cursor: pointer;" onclick="switchDockedEditorTab('${tab.id}', ${paneIndex})">
        <i data-lucide="${icon}" style="width: 12px; height: 12px;"></i>
        <span style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(tab.filename)}</span>
        ${isDirty ? '<span style="color:var(--accent); font-weight:bold;">●</span>' : ''}
        <span style="cursor: pointer; opacity: 0.7; margin-left: 2px;" onclick="event.stopPropagation(); closeDockedEditorTab('${tab.id}', ${paneIndex})"><i data-lucide="x" style="width: 10px; height: 10px;"></i></span>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: container });
}

function switchDockedEditorTab(tabId, paneIndex) {
  const tab = getEditorTabById(tabId);
  if (!tab) return;

  const prevTab = getActiveEditorTab('left');
  const textarea = document.getElementById(`docked-editor-textarea-${paneIndex}`);
  if (prevTab && textarea) {
    prevTab.content = textarea.value;
  }

  activeTabIdLeft = tabId;
  if (textarea) {
    textarea.value = tab.content || '';
  }

  const lbl = document.getElementById(`docked-editor-file-label-${paneIndex}`);
  if (lbl) lbl.textContent = tab.filename;

  renderDockedEditorTabs(paneIndex);
}

function createNewDockedEditorTab(paneIndex) {
  const newTab = createNewEditorTab('', null, null, false, []);
  switchDockedEditorTab(newTab.id, paneIndex);
}

function closeDockedEditorTab(tabId, paneIndex) {
  closeEditorTab(tabId);
  if (editorTabs.length === 0) {
    createNewEditorTab('', 'Untitled-1', null, false, []);
  }
  const currentTab = getActiveEditorTab('left');
  if (currentTab) {
    switchDockedEditorTab(currentTab.id, paneIndex);
  }
}

function saveDockedEditorTab(paneIndex) {
  const tab = getActiveEditorTab('left');
  const textarea = document.getElementById(`docked-editor-textarea-${paneIndex}`);
  if (tab && textarea) {
    tab.content = textarea.value;
  }
  saveActiveEditorTab();
  renderDockedEditorTabs(paneIndex);
}

function syncDockedEditorInput(paneIndex, val) {
  const tab = getActiveEditorTab('left');
  if (tab) {
    tab.content = val;
    tab.isDirty = true;
    renderDockedEditorTabs(paneIndex);
  }
}

// =========================================================================
// 🌲 GIT CLIENT & VERSION CONTROL ENGINE
// =========================================================================

let currentGitRepoPath = '';
let currentGitStatusData = null;
let currentGitDiffFile = null;

async function fetchGitStatusForPane(paneIndex, path) {
  if (!path || path.startsWith('smb://') || path.startsWith('sftp://')) return;
  try {
    const resp = await fetch(`/api/git/status?path=${encodeURIComponent(path)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.is_repo) {
        const container = document.getElementById(`pane-crumbs-${paneIndex}`);
        if (container) {
          const badge = document.createElement('span');
          badge.className = 'pane-git-badge';
          badge.title = `Git Branch: ${data.branch} | ${data.files.length} changed files`;
          badge.onclick = (e) => { e.stopPropagation(); openGitManager(paneIndex, data.root_path || path); };
          badge.innerHTML = `
            <i data-lucide="git-branch" style="width:11px; height:11px;"></i>
            <span>${escapeHtml(data.branch)}</span>
            ${data.ahead > 0 ? `<span style="color:#22c55e;">⇡${data.ahead}</span>` : ''}
            ${data.behind > 0 ? `<span style="color:#ef4444;">⇣${data.behind}</span>` : ''}
            ${!data.is_clean ? `<span style="color:#ef4444; font-size:12px; line-height:1;">●</span>` : ''}
          `;
          container.appendChild(badge);
          if (window.lucide) lucide.createIcons({ root: badge });
        }
      }
    }
  } catch (e) {}
}

async function openGitManager(paneIndex = 0, prefillPath = null) {
  const path = prefillPath || App.panes[paneIndex]?.path || '/';
  currentGitRepoPath = path;
  showModal('git-modal');
  switchGitTab('status');
  await loadGitStatus(path);
}

async function loadGitStatus(repoPath) {
  const branchBadge = document.getElementById('git-modal-branch-badge');
  const countEl = document.getElementById('git-changes-count');
  const filesList = document.getElementById('git-files-list');
  const diffViewer = document.getElementById('git-diff-viewer');
  const diffHdr = document.getElementById('git-diff-filename');

  if (filesList) filesList.innerHTML = '<div style="padding: 12px; color: var(--text-dim); text-align: center;">Loading git changes...</div>';

  try {
    const resp = await fetch(`/api/git/status?path=${encodeURIComponent(repoPath)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (!resp.ok) {
      if (filesList) filesList.innerHTML = '<div style="padding: 12px; color: var(--danger); text-align: center;">Not a git repository.</div>';
      return;
    }

    const data = await resp.json();
    currentGitStatusData = data;
    currentGitRepoPath = data.root_path || repoPath;

    if (branchBadge) {
      branchBadge.textContent = data.branch || 'HEAD';
      branchBadge.title = `${data.ahead} ahead, ${data.behind} behind`;
    }

    if (countEl) {
      countEl.textContent = `${data.files.length} Changes (${data.staged_count} staged)`;
    }

    renderGitFiles(data.files);

    if (data.files.length > 0 && !currentGitDiffFile) {
      selectGitFileDiff(data.files[0].path, data.files[0].is_staged);
    } else if (data.files.length === 0) {
      if (diffViewer) diffViewer.innerHTML = '<div style="color: var(--text-dim); padding: 20px; text-align: center;">✔ Working tree clean — no uncommitted changes.</div>';
      if (diffHdr) diffHdr.textContent = 'Working Tree Clean';
    }
  } catch (e) {
    if (filesList) filesList.innerHTML = `<div style="padding: 12px; color: var(--danger);">Error: ${e}</div>`;
  }
}

function renderGitFiles(files) {
  const filesList = document.getElementById('git-files-list');
  if (!filesList) return;

  if (files.length === 0) {
    filesList.innerHTML = '<div style="padding: 16px; color: var(--text-dim); text-align: center; font-size: 11px;">No modified or untracked files.</div>';
    return;
  }

  filesList.innerHTML = files.map(f => {
    let statusClass = f.is_untracked ? 'untracked' : (f.is_staged ? 'staged' : (f.is_deleted ? 'deleted' : 'modified'));
    let statusChar = f.is_untracked ? '?' : (f.is_deleted ? 'D' : (f.is_staged ? '+' : 'M'));
    let actionBtn = f.is_staged
      ? `<button class="btn btn-xs" onclick="event.stopPropagation(); gitUnstageFile('${escapeHtml(f.path)}')" title="Unstage file">−</button>`
      : `<button class="btn btn-xs btn-accent" onclick="event.stopPropagation(); gitStageFile('${escapeHtml(f.path)}')" title="Stage file">+</button>`;

    return `
      <div class="git-file-row ${currentGitDiffFile === f.path ? 'active' : ''}" onclick="selectGitFileDiff('${escapeHtml(f.path)}', ${f.is_staged})">
        <span style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
          <span class="git-status-char ${statusClass}">${statusChar}</span>
          <span style="font-family: var(--font-mono); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(f.path)}</span>
        </span>
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');
}

async function selectGitFileDiff(filePath, isStaged) {
  currentGitDiffFile = filePath;
  const diffViewer = document.getElementById('git-diff-viewer');
  const diffHdr = document.getElementById('git-diff-filename');
  const badge = document.getElementById('git-diff-status-badge');

  if (diffHdr) diffHdr.textContent = filePath;
  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = isStaged ? 'STAGED' : 'UNSTAGED';
    badge.className = `badge ${isStaged ? 'badge-success' : 'badge-warning'}`;
  }
  if (diffViewer) diffViewer.innerHTML = '<div style="color: var(--text-dim);">Loading diff...</div>';

  try {
    const url = `/api/git/diff?path=${encodeURIComponent(currentGitRepoPath)}&file=${encodeURIComponent(filePath)}&staged=${isStaged}`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${App.token}` } });
    if (resp.ok) {
      const data = await resp.json();
      renderGitDiffOutput(data.diff || 'No diff output.');
    }
  } catch (e) {
    if (diffViewer) diffViewer.textContent = `Error loading diff: ${e}`;
  }
}

function renderGitDiffOutput(rawDiff) {
  const viewer = document.getElementById('git-diff-viewer');
  if (!viewer) return;

  const lines = rawDiff.split('\n');
  viewer.innerHTML = lines.map(line => {
    const escaped = escapeHtml(line);
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<span class="diff-line-add">${escaped}</span>`;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return `<span class="diff-line-del">${escaped}</span>`;
    } else if (line.startsWith('@@') || line.startsWith('diff --git')) {
      return `<span class="diff-line-hdr">${escaped}</span>`;
    }
    return `<span>${escaped}</span>`;
  }).join('');
}

async function gitStageFile(filePath) {
  try {
    await fetch('/api/git/stage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath, files: [filePath] })
    });
    loadGitStatus(currentGitRepoPath);
  } catch (e) {}
}

async function gitUnstageFile(filePath) {
  try {
    await fetch('/api/git/unstage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath, files: [filePath] })
    });
    loadGitStatus(currentGitRepoPath);
  } catch (e) {}
}

async function gitStageAll() {
  try {
    await fetch('/api/git/stage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath, files: ['.'] })
    });
    showToast('Staged all changes (+)', 'success');
    loadGitStatus(currentGitRepoPath);
  } catch (e) {}
}

async function gitUnstageAll() {
  try {
    await fetch('/api/git/unstage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath, files: ['.'] })
    });
    showToast('Unstaged all changes', 'info');
    loadGitStatus(currentGitRepoPath);
  } catch (e) {}
}

async function gitCommitStaged() {
  const msgInput = document.getElementById('git-commit-msg-input');
  const msg = msgInput?.value?.trim();
  if (!msg) {
    showToast('Please enter a commit message', 'warning');
    return;
  }

  try {
    const resp = await fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath, message: msg })
    });

    if (resp.ok) {
      if (msgInput) msgInput.value = '';
      showToast(`Committed: "${msg}"`, 'success');
      loadGitStatus(currentGitRepoPath);
    } else {
      const err = await resp.text();
      showToast(`Commit failed: ${err}`, 'error');
    }
  } catch (e) {
    showToast('Failed to commit', 'error');
  }
}

async function gitPushCurrentRepo() {
  showToast('Pushing commits to remote repository...', 'info');
  try {
    const resp = await fetch('/api/git/push', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath })
    });
    if (resp.ok) {
      showToast('Pushed commits successfully! 🚀', 'success');
      loadGitStatus(currentGitRepoPath);
    } else {
      const err = await resp.text();
      showToast(`Push failed: ${err}`, 'error');
    }
  } catch (e) {
    showToast('Push failed', 'error');
  }
}

async function gitPullCurrentRepo() {
  showToast('Pulling latest changes from remote...', 'info');
  try {
    const resp = await fetch('/api/git/pull', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentGitRepoPath })
    });
    if (resp.ok) {
      showToast('Pull complete! 📥', 'success');
      loadGitStatus(currentGitRepoPath);
      renderAllPanes();
    } else {
      const err = await resp.text();
      showToast(`Pull failed: ${err}`, 'error');
    }
  } catch (e) {
    showToast('Pull failed', 'error');
  }
}

function switchGitTab(tabName) {
  const statusTab = document.getElementById('git-status-tab-body');
  const logTab = document.getElementById('git-log-tab-body');
  const statusBtn = document.getElementById('git-tab-status-btn');
  const logBtn = document.getElementById('git-tab-log-btn');

  if (tabName === 'status') {
    if (statusTab) statusTab.style.display = 'flex';
    if (logTab) logTab.style.display = 'none';
    if (statusBtn) statusBtn.classList.add('active');
    if (logBtn) logBtn.classList.remove('active');
  } else {
    if (statusTab) statusTab.style.display = 'none';
    if (logTab) logTab.style.display = 'block';
    if (statusBtn) statusBtn.classList.remove('active');
    if (logBtn) logBtn.classList.add('active');
    loadGitLog(currentGitRepoPath);
  }
}

async function loadGitLog(repoPath) {
  const tbody = document.getElementById('git-log-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">Loading commit history...</td></tr>';

  try {
    const resp = await fetch(`/api/git/log?path=${encodeURIComponent(repoPath)}&count=40`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const commits = await resp.json();
      if (commits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">No commits found in repository.</td></tr>';
        return;
      }
      tbody.innerHTML = commits.map(c => `
        <tr>
          <td><code style="color:var(--accent); font-weight:700;">${escapeHtml(c.short_hash)}</code></td>
          <td style="font-weight:600;">${escapeHtml(c.message)}</td>
          <td><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(c.author_name)}</span></td>
          <td><span style="font-size:10.5px; color:var(--text-dim);">${escapeHtml(c.date)}</span></td>
        </tr>
      `).join('');
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger); padding:16px;">Error: ${e}</td></tr>`;
  }
}

async function loadGitStatusForDocked(paneIndex, repoPath) {
  const branchEl = document.getElementById('docked-git-branch');
  const fileList = document.getElementById('docked-git-file-list');
  try {
    const resp = await fetch(`/api/git/status?path=${encodeURIComponent(repoPath)}`, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (branchEl) branchEl.textContent = data.branch || 'HEAD';
      if (fileList) {
        if (data.files.length === 0) {
          fileList.innerHTML = '<div style="padding:10px; color:#22c55e; text-align:center;">✔ Clean working directory</div>';
        } else {
          fileList.innerHTML = data.files.map(f => `
            <div style="display:flex; justify-content:space-between; padding:3px 6px; font-size:11px; font-family:var(--font-mono);">
              <span>${escapeHtml(f.path)}</span>
              <span style="color:var(--accent); font-weight:700;">${f.is_staged ? '+' : 'M'}</span>
            </div>
          `).join('');
        }
      }
    }
  } catch (e) {}
}

// =========================================================================
// 🧩 MULTI-PART FILE SPLITTER & COMBINER ENGINE
// =========================================================================

function openFileSplitterModal(filePath, sizeBytes) {
  const modal = document.getElementById('file-splitter-modal');
  if (!modal) return;

  const srcInput = document.getElementById('split-source-path');
  const sizeLbl = document.getElementById('split-source-size-label');
  const destInput = document.getElementById('split-dest-dir');

  if (srcInput) srcInput.value = filePath;
  if (sizeLbl) sizeLbl.textContent = `Total Size: ${formatBytes(sizeBytes || 0)}`;
  if (destInput) destInput.value = filePath.substring(0, filePath.lastIndexOf('/')) || '/';

  showModal('file-splitter-modal');
}

function handleSplitPresetChange(val) {
  const custom = document.getElementById('split-size-custom');
  if (custom) {
    custom.style.display = val === 'custom' ? 'block' : 'none';
  }
}

async function executeFileSplit() {
  const srcPath = document.getElementById('split-source-path')?.value;
  const preset = document.getElementById('split-size-preset')?.value;
  const custom = document.getElementById('split-size-custom')?.value;
  const destDir = document.getElementById('split-dest-dir')?.value;
  const genChk = document.getElementById('split-generate-checksum')?.checked ?? true;
  const progBox = document.getElementById('split-progress-box');
  const statusTxt = document.getElementById('split-status-text');
  const btn = document.getElementById('btn-run-split');

  const chunkMb = preset === 'custom' ? parseInt(custom, 10) : parseInt(preset, 10);
  if (!chunkMb || chunkMb < 1) {
    showToast('Please enter a valid chunk size', 'warning');
    return;
  }

  if (progBox) progBox.style.display = 'block';
  if (statusTxt) statusTxt.textContent = `Splitting file into ${chunkMb} MB chunks...`;
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch('/api/tools/split', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_path: srcPath,
        chunk_size_mb: chunkMb,
        dest_dir: destDir || null,
        generate_checksum: genChk
      })
    });

    if (resp.ok) {
      const res = await resp.json();
      closeModal('file-splitter-modal');
      showToast(`Successfully split into ${res.chunk_count} parts! SHA-256: ${res.sha256.substring(0, 10)}...`, 'success');
      renderAllPanes();
    } else {
      const err = await resp.text();
      showToast(`Split failed: ${err}`, 'error');
    }
  } catch (e) {
    showToast(`Error splitting file: ${e}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openFileCombinerModal(partsList) {
  const modal = document.getElementById('file-combiner-modal');
  if (!modal) return;

  const partsBox = document.getElementById('combine-parts-list');
  const destInput = document.getElementById('combine-dest-path');
  const expSha = document.getElementById('combine-expected-sha');

  if (partsBox) {
    partsBox.innerHTML = partsList.map(p => `<div>📦 ${escapeHtml(p)}</div>`).join('');
  }

  if (partsList.length > 0 && destInput) {
    const firstPart = partsList[0];
    const cleanedDest = firstPart.replace(/\.\d{3}$/, '').replace(/\.part\d+.*$/, '');
    destInput.value = cleanedDest;
  }

  showModal('file-combiner-modal');
}

async function executeFileCombine() {
  const partsBox = document.getElementById('combine-parts-list');
  const destInput = document.getElementById('combine-dest-path');
  const expSha = document.getElementById('combine-expected-sha');
  const btn = document.getElementById('btn-run-combine');

  const destPath = destInput?.value?.trim();
  if (!destPath) {
    showToast('Please enter output destination path', 'warning');
    return;
  }

  const parts = Array.from(partsBox.querySelectorAll('div')).map(d => d.textContent.replace('📦 ', '').trim());
  if (parts.length === 0) {
    showToast('No part files selected', 'warning');
    return;
  }

  if (btn) btn.disabled = true;
  showToast('Combining and verifying file parts...', 'info');

  try {
    const resp = await fetch('/api/tools/combine', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${App.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts,
        dest_path: destPath,
        expected_sha256: expSha?.value?.trim() || null
      })
    });

    if (resp.ok) {
      const res = await resp.json();
      closeModal('file-combiner-modal');
      const verifyMsg = res.is_verified ? '✔ Verified matching checksum!' : '⚠️ Checksum mismatch';
      showToast(`Successfully combined ${res.parts_joined} parts (${formatBytes(res.total_bytes_written)})! ${verifyMsg}`, 'success');
      renderAllPanes();
    } else {
      const err = await resp.text();
      showToast(`Combine failed: ${err}`, 'error');
    }
  } catch (e) {
    showToast(`Error combining files: ${e}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}



