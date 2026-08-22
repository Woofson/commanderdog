// 🐕 CommanderDog Quad-Pane State & Engine
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
};

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
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  initPanes();
  setupEventListeners();
  setupKeyboardNavigation();
  applyFKeyBarState();
  applyFontSize(App.fontSize);
  startTasksPolling();
  checkAuthAndLoad();
});

function initPanes() {
  const defaultCount = 4;
  for (let i = 0; i < defaultCount; i++) {
    App.panes.push(new PaneState(i, '/'));
  }
}

async function checkAuthAndLoad() {
  if (App.token) {
    try {
      const resp = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${App.token}` }
      });
      if (resp.ok) {
        App.user = await resp.json();
        hideModal('login-modal');
        await loadConfig();
        await loadSystemUsersGroups();
        renderAllPanes();
        return;
      }
    } catch (e) {
      console.warn('Auth check failed:', e);
    }
  }

  showModal('login-modal');
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      App.config = await res.json();
      App.paranoidMode = App.config.paranoid.enabled;
      updateParanoidBadge();
    }
  } catch (e) {
    console.error('Config fetch failed:', e);
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

  el.innerHTML = `
    <div class="pane-header">
      <div class="pane-nav-btns">
        <button onclick="navPaneHistory(${index}, -1)" title="Back"><i data-lucide="arrow-left" style="width:14px;"></i></button>
        <button onclick="navPaneHistory(${index}, 1)" title="Forward"><i data-lucide="arrow-right" style="width:14px;"></i></button>
        <button onclick="navPaneUp(${index})" title="Parent Directory (Backspace)"><i data-lucide="arrow-up" style="width:14px;"></i></button>
        <button onclick="refreshPane(${index})" title="Refresh"><i data-lucide="rotate-cw" style="width:14px;"></i></button>
        <button onclick="openRemoteModal(${index})" title="Connect Remote SFTP / WebDAV Server"><i data-lucide="network" style="width:14px;"></i></button>
      </div>

      <!-- Path bar & Breadcrumbs -->
      <div class="pane-path-bar" onclick="enablePathInput(${index})">
        <div class="pane-breadcrumbs" id="pane-crumbs-${index}"></div>
        <input type="text" class="pane-path-input" id="pane-input-${index}" onkeydown="handlePathKey(event, ${index})" onblur="disablePathInput(${index})">
      </div>

      <!-- Quick Toggles -->
      <button class="btn btn-icon ${pane.showHidden ? 'active' : ''}" id="btn-dotfiles-${index}" onclick="togglePaneDotfiles(${index})" title="Toggle Dotfiles & Hidden Files">
        <i data-lucide="eye" style="width: 13px; height: 13px;"></i>
      </button>

      <input type="text" class="pane-quick-filter" placeholder="Filter (/)..." id="pane-filter-${index}" oninput="handleFilterInput(${index}, this.value)">
    </div>

    <div class="pane-content" id="pane-content-${index}">
      <table class="file-table">
        <thead>
          <tr>
            <th style="width: 24px;"></th>
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

  return el;
}

function setActivePane(index) {
  App.activePaneIndex = index;
  document.querySelectorAll('.pane').forEach((p, idx) => {
    if (idx === index) p.classList.add('active');
    else p.classList.remove('active');
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

async function loadPaneDirectory(paneIndex, targetPath) {
  const pane = App.panes[paneIndex];
  pane.path = targetPath;
  pane.selected.clear();
  localStorage.setItem(`cd_pane_path_${paneIndex}`, targetPath);

  try {
    const url = `/api/fs/list?path=${encodeURIComponent(targetPath)}&show_hidden=${pane.showHidden}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });

    if (!resp.ok) {
      console.error(`Failed to load ${targetPath}`);
      return;
    }

    const data = await resp.json();
    pane.path = data.current_path;
    pane.entries = data.entries;
    pane.totalSize = data.total_size;

    renderPaneBreadcrumbs(paneIndex, pane.path);
    renderPaneTable(paneIndex);
    updatePaneFooter(paneIndex, data);
  } catch (e) {
    console.error('Directory load error:', e);
  }
}

function renderPaneBreadcrumbs(paneIndex, pathStr) {
  const container = document.getElementById(`pane-crumbs-${paneIndex}`);
  if (!container) return;

  container.innerHTML = '';
  const parts = pathStr.split('/').filter(Boolean);

  const rootCrumb = document.createElement('span');
  rootCrumb.className = 'crumb';
  rootCrumb.textContent = '/';
  rootCrumb.onclick = (e) => { e.stopPropagation(); loadPaneDirectory(paneIndex, '/'); };
  container.appendChild(rootCrumb);

  let currentBuild = '';
  parts.forEach((part, idx) => {
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

  filtered.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    tr.className = `file-row ${pane.selected.has(entry.path) ? 'selected' : ''} ${idx === pane.cursorIndex ? 'cursor-focus' : ''}`;
    tr.draggable = true;

    tr.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        sourcePane: paneIndex,
        paths: pane.selected.size > 0 ? Array.from(pane.selected) : [entry.path]
      }));
    };

    tr.onclick = (e) => {
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
    };

    tr.ondblclick = () => {
      if (entry.is_dir || entry.is_archive) {
        loadPaneDirectory(paneIndex, entry.path);
      } else if (isImageExtension(entry.name)) {
        openImageViewer(entry.path);
      } else {
        openEditorWithFile(entry.path);
      }
    };

    tr.oncontextmenu = (e) => {
      e.preventDefault();
      App.contextItem = entry;
      App.contextPaneIndex = paneIndex;
      showContextMenu(e.clientX, e.clientY);
    };

    let touchTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;

    tr.ontouchstart = (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchTimer = setTimeout(() => {
        App.contextItem = entry;
        App.contextPaneIndex = paneIndex;
        showContextMenu(touchStartX, touchStartY);
        if (navigator.vibrate) navigator.vibrate(40);
      }, 450);
    };

    tr.ontouchend = () => {
      if (touchTimer) clearTimeout(touchTimer);
    };

    tr.ontouchmove = (e) => {
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > 12 || dy > 12) {
        if (touchTimer) clearTimeout(touchTimer);
      }
    };

    const iconType = entry.is_dir ? 'dir' : (entry.is_archive ? 'archive' : 'text');
    const iconName = entry.is_dir ? 'folder' : (entry.is_archive ? 'file-archive' : 'file-text');

    tr.innerHTML = `
      <td class="file-cell" style="text-align: center;">
        <i data-lucide="${iconName}" class="file-icon ${iconType}" style="width: 14px; height: 14px;"></i>
      </td>
      <td class="file-cell file-cell-name">
        <span>${entry.name}</span>
      </td>
      <td class="file-cell file-cell-mono">${entry.is_dir ? '<DIR>' : formatBytes(entry.size)}</td>
      <td class="file-cell file-cell-mono">${formatDate(entry.modified)}</td>
      <td class="file-cell file-cell-mono" title="${entry.permissions}">${entry.mode_octal || entry.permissions}</td>
      <td class="file-cell file-cell-mono">${entry.owner}:${entry.group}</td>
    `;

    tbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
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
  document.querySelectorAll('.settings-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));

  event.currentTarget.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');

  if (tabId === 'tab-users') loadUsersTable();
  if (tabId === 'tab-confd') loadConfdInspector();
}

async function loadUsersTable() {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '<tr><td colspan="5">Loading users...</td></tr>';

  try {
    const resp = await fetch('/api/auth/users', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const users = await resp.json();
      tbody.innerHTML = users.map(u => `
        <tr class="file-row">
          <td>${u.id}</td>
          <td><b>${u.username}</b></td>
          <td><span style="color:var(--accent); font-weight:600;">${u.role.toUpperCase()}</span></td>
          <td><code>${u.home_dir}</code></td>
          <td>${u.is_pam ? 'Linux Native PAM' : 'Built-in SQLite DB'}</td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadConfdInspector() {
  const container = document.getElementById('confd-files-list');
  container.innerHTML = '<div>Scanning conf.d directory files...</div>';

  try {
    const resp = await fetch('/api/system/confd-files', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const files = await resp.json();
      container.innerHTML = files.map(f => `
        <div style="background: var(--bg-dark); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 12px; overflow: hidden;">
          <div style="background: var(--bg-header); padding: 6px 12px; font-family: var(--font-mono); font-size: 11px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between;">
            <span>📄 ${f.filename}</span>
            <span style="color: var(--text-dim);">${f.path}</span>
          </div>
          <pre style="padding: 10px; font-size: 11px; font-family: var(--font-mono); color: var(--text-main); margin: 0;">${escapeHtml(f.content)}</pre>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error(e);
  }
}

function showAddUserPrompt() {
  const u = prompt('Enter new username:');
  if (!u) return;
  const p = prompt('Enter password for ' + u + ':');
  if (!p) return;
  const role = prompt('Role (admin, user, readonly):', 'user') || 'user';
  const home = prompt('Home directory:', '/home/' + u) || '/';

  fetch('/api/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ username: u, password: p, role, home_dir: home })
  }).then(() => loadUsersTable());
}

// ---------------- TRANSFERS & DRAG-AND-DROP ----------------

async function handlePaneDrop(e, targetPaneIndex) {
  e.preventDefault();
  const targetPane = App.panes[targetPaneIndex];
  document.getElementById(`pane-${targetPaneIndex}`).classList.remove('drag-over');

  // OS Desktop Drag & Drop Upload
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const formData = new FormData();
    for (let f of e.dataTransfer.files) {
      formData.append('files', f);
    }
    await fetch(`/api/fs/upload?destination=${encodeURIComponent(targetPane.path)}`, {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    refreshPane(targetPaneIndex);
    return;
  }

  // Inter-Pane Transfer
  const rawData = e.dataTransfer.getData('text/plain');
  if (rawData) {
    try {
      const { sourcePane, paths } = JSON.parse(rawData);
      if (sourcePane === targetPaneIndex) return;

      if (App.paranoidMode) {
        showParanoidConfirm('copy', paths, targetPane.path, () => {
          executeTransfer('copy', paths, targetPane.path, targetPaneIndex);
        });
      } else {
        executeTransfer('copy', paths, targetPane.path, targetPaneIndex);
      }
    } catch (err) {
      console.error(err);
    }
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
    refreshPane(refreshTargetPaneIdx);
    refreshPane(App.activePaneIndex);
  } else {
    alert(`Transfer failed: ${await resp.text()}`);
  }
}

// ---------------- KEYBOARD NAVIGATION & SHORTCUTS ----------------

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (e.key === 'Escape') closeModal();
      return;
    }

    const pane = App.panes[App.activePaneIndex];

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

// ---------------- DUAL-PANE EDITOR & MARKDOWN MERMAID ----------------

let activeEditorPathLeft = '';

async function openEditorWithFile(filePath) {
  activeEditorPathLeft = filePath;
  document.getElementById('editor-file-title-left').textContent = filePath;

  const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`, {
    headers: { 'Authorization': `Bearer ${App.token}` }
  });

  if (resp.ok) {
    const data = await resp.json();
    document.getElementById('editor-text-left').value = data.content;
    updateMarkdownPreview();
    showModal('editor-modal');
  }
}

function updateMarkdownPreview() {
  const content = document.getElementById('editor-text-left').value;
  const preview = document.getElementById('editor-preview-container');

  let html = content
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
    .replace(/\*(.*)\*/gim, '<i>$1</i>')
    .replace(/```mermaid\n([\s\S]*?)\n```/gim, '<div class="mermaid">$1</div>')
    .replace(/```([a-z]*)\n([\s\S]*?)\n```/gim, '<pre><code>$2</code></pre>')
    .replace(/\n/gim, '<br>');

  preview.innerHTML = html;

  if (window.mermaid) {
    try {
      mermaid.init(undefined, document.querySelectorAll('.mermaid'));
    } catch (err) {
      console.warn('Mermaid rendering:', err);
    }
  }
}

document.getElementById('editor-text-left')?.addEventListener('input', () => {
  if (document.getElementById('editor-view-mode').value === 'split-markdown') {
    updateMarkdownPreview();
  }
});

document.getElementById('btn-save-editor')?.addEventListener('click', async () => {
  const content = document.getElementById('editor-text-left').value;
  const resp = await fetch('/api/fs/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ path: activeEditorPathLeft, content, atomic: true })
  });

  if (resp.ok) {
    alert('File saved successfully!');
    refreshPane(App.activePaneIndex);
  } else {
    alert('Failed to save file: ' + await resp.text());
  }
});

// ---------------- COMPARISON & DIFF ENGINE ----------------

async function triggerDiff() {
  const paneA = App.panes[0];
  const paneB = App.panes[1] || App.panes[0];

  const modalBody = document.getElementById('diff-modal-body');
  modalBody.innerHTML = '<div style="padding: 20px; color: var(--accent);">Calculating comparison between Pane 1 and Pane 2...</div>';
  showModal('diff-modal');

  try {
    const resp = await fetch('/api/tools/diff/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ dir_left: paneA.path, dir_right: paneB.path, deep_hash: true })
    });

    if (resp.ok) {
      const data = await resp.json();
      renderFolderDiff(data);
    } else {
      modalBody.innerHTML = `<div style="color: var(--danger);">Diff calculation failed: ${await resp.text()}</div>`;
    }
  } catch (e) {
    modalBody.innerHTML = `<div style="color: var(--danger);">Error: ${e}</div>`;
  }
}

function renderFolderDiff(diff) {
  const body = document.getElementById('diff-modal-body');
  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; background: var(--bg-header); padding: 8px 12px; border-radius: var(--radius);">
      <div><b>Left:</b> ${diff.dir_left}</div>
      <div><b>Right:</b> ${diff.dir_right}</div>
      <div><b>Stats:</b> <span style="color: var(--success);">${diff.identical_count} identical</span>, <span style="color: var(--accent);">${diff.modified_count} modified</span>, <span style="color: var(--info);">${diff.left_only_count} left-only</span>, <span style="color: var(--danger);">${diff.right_only_count} right-only</span></div>
    </div>
    <table class="file-table">
      <thead>
        <tr><th>Relative Path</th><th>Status</th><th>Left Size</th><th>Right Size</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${diff.entries.map(e => `
          <tr class="file-row">
            <td class="file-cell">${e.relative_path}</td>
            <td class="file-cell" style="color: ${e.status === 'identical' ? 'var(--success)' : (e.status === 'modified' ? 'var(--accent)' : 'var(--info)')}; font-weight: 600;">${e.status.toUpperCase()}</td>
            <td class="file-cell file-cell-mono">${e.size_left !== null ? formatBytes(e.size_left) : '-'}</td>
            <td class="file-cell file-cell-mono">${e.size_right !== null ? formatBytes(e.size_right) : '-'}</td>
            <td class="file-cell"><button class="btn btn-icon" onclick="openFileDiffView('${diff.dir_left}/${e.relative_path}', '${diff.dir_right}/${e.relative_path}')" title="Inspect Diff"><i data-lucide="eye" style="width:12px;"></i></button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  if (window.lucide) lucide.createIcons();
}

async function openFileDiffView(fileL, fileR) {
  const resp = await fetch('/api/tools/diff/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ file_left: fileL, file_right: fileR })
  });

  if (resp.ok) {
    const diffData = await resp.json();
    const body = document.getElementById('diff-modal-body');
    body.innerHTML = `
      <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
        <span><b>${diffData.file_left}</b> ⟷ <b>${diffData.file_right}</b></span>
        <button class="btn" onclick="triggerDiff()">Back to Folder Diff</button>
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
  }
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

  menu.innerHTML = `
    <div class="context-item" onclick="triggerView()"><i data-lucide="eye" style="width: 14px;"></i> Quick View (F3)</div>
    <div class="context-item" onclick="triggerEditor()"><i data-lucide="file-edit" style="width: 14px;"></i> Edit File (F4)</div>
    <div class="context-item" onclick="triggerDiff()"><i data-lucide="git-compare" style="width: 14px;"></i> Compare / Diff</div>
    <div class="context-sep"></div>
    
    <!-- Dynamic Advanced Copy Submenu -->
    <div class="context-item has-submenu">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="copy" style="width: 14px;"></i> Quick Copy to...</div>
      <i data-lucide="chevron-right" style="width: 12px;"></i>
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
    <div class="context-item has-submenu">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="move" style="width: 14px;"></i> Quick Move to...</div>
      <i data-lucide="chevron-right" style="width: 12px;"></i>
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
    <div class="context-item has-submenu">
      <div style="display:flex; align-items:center; gap:8px;"><i data-lucide="terminal-square" style="width: 14px; color: var(--accent);"></i> Custom Script Actions</div>
      <i data-lucide="chevron-right" style="width: 12px;"></i>
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
    <div class="context-item" onclick="openSyncModal()"><i data-lucide="refresh-cw" style="width: 14px;"></i> Sync with Opposite Pane...</div>
    <div class="context-item" onclick="openSearchModal()"><i data-lucide="search" style="width: 14px;"></i> Deep Search in Directory (Ctrl+F)</div>

    <div class="context-sep"></div>
    <div class="context-item" onclick="triggerPermissions()"><i data-lucide="lock" style="width: 14px;"></i> Permissions & Ownership</div>
    <div class="context-item" onclick="triggerChecksum()"><i data-lucide="shield-check" style="width: 14px;"></i> Calculate SHA-256 Hash</div>
    <div class="context-item" onclick="triggerArchiveZip()"><i data-lucide="archive" style="width: 14px;"></i> Compress to .zip</div>
    <div class="context-item" onclick="triggerArchiveTarGz()"><i data-lucide="archive" style="width: 14px;"></i> Compress to .tar.gz</div>
    <div class="context-item" onclick="triggerExtract()"><i data-lucide="folder-archive" style="width: 14px;"></i> Extract Archive Here</div>
  `;

  if (window.lucide) lucide.createIcons();

  menu.style.display = 'block';
  menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 380)}px`;
}

document.addEventListener('click', () => {
  const menu = document.getElementById('context-menu');
  if (menu) menu.style.display = 'none';
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
    alert('Please provide a destination directory path');
    return;
  }

  const saveFav = document.getElementById('custom-dest-save-fav').checked;
  if (saveFav) {
    addCustomDestination(dest.split('/').pop() || dest, dest);
  }

  closeModal('custom-dest-modal');
  quickTransferToPath(customDestAction, dest);
}

function addCurrentPaneToQuickDest() {
  const currentPath = App.panes[App.activePaneIndex].path;
  const name = prompt('Enter a label for this quick destination:', currentPath.split('/').pop() || currentPath);
  if (name) {
    addCustomDestination(name, currentPath);
  }
}

function addCustomDestination(name, path) {
  if (!App.quickDestinations.some(d => d.path === path)) {
    App.quickDestinations.push({ name, path });
    localStorage.setItem('cd_quick_destinations', JSON.stringify(App.quickDestinations));
  }
}

function setupEventListeners() {
  document.getElementById('layout-1')?.addEventListener('click', () => switchLayout('layout-single'));
  document.getElementById('layout-2v')?.addEventListener('click', () => switchLayout('layout-dual-vertical'));
  document.getElementById('layout-2h')?.addEventListener('click', () => switchLayout('layout-dual-horizontal'));
  document.getElementById('layout-3')?.addEventListener('click', () => switchLayout('layout-triple'));
  document.getElementById('layout-4')?.addEventListener('click', () => switchLayout('layout-quad'));

  document.getElementById('paranoid-toggle')?.addEventListener('click', () => {
    App.paranoidMode = !App.paranoidMode;
    updateParanoidBadge();
  });

  document.getElementById('btn-open-editor')?.addEventListener('click', () => showModal('editor-modal'));
  document.getElementById('btn-open-diff')?.addEventListener('click', () => triggerDiff());
  document.getElementById('btn-open-sync')?.addEventListener('click', () => openSyncModal());
  document.getElementById('btn-open-search')?.addEventListener('click', () => openSearchModal());
  document.getElementById('btn-toggle-terminal')?.addEventListener('click', () => toggleTerminal());
  document.getElementById('btn-open-tasks')?.addEventListener('click', () => { showModal('tasks-modal'); loadTasksTable(); });
  document.getElementById('btn-custom-dest-exec')?.addEventListener('click', executeCustomDestTransfer);
  document.getElementById('btn-refresh-all')?.addEventListener('click', () => {
    for (let i = 0; i < getVisiblePaneCount(); i++) refreshPane(i);
  });
  document.getElementById('btn-open-settings')?.addEventListener('click', () => openSettingsModal());

  document.getElementById('theme-selector')?.addEventListener('change', (e) => {
    applyTheme(e.target.value);
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
  renderAllPanes();
}

function updateParanoidBadge() {
  const badge = document.getElementById('paranoid-toggle');
  if (App.paranoidMode) {
    badge.classList.remove('disabled');
    badge.querySelector('span').textContent = 'PARANOID MODE: ON';
  } else {
    badge.classList.add('disabled');
    badge.querySelector('span').textContent = 'PARANOID MODE: OFF';
  }
}

function applyTheme(themeId) {
  localStorage.setItem('cd_theme', themeId);
  const sel = document.getElementById('theme-selector');
  if (sel) sel.value = themeId;

  const root = document.documentElement;

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
  const u = document.getElementById('login-username').value;
  const p = document.getElementById('login-password').value;

  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });

  if (resp.ok) {
    const data = await resp.json();
    App.token = data.token;
    App.user = data.user;
    localStorage.setItem('cd_token', data.token);
    hideModal('login-modal');
    await loadConfig();
    await loadSystemUsersGroups();
    renderAllPanes();
  } else {
    const err = document.getElementById('login-error');
    err.style.display = 'block';
    err.textContent = 'Invalid credentials. Please try again.';
  }
}

function openHelpModal() { showModal('settings-modal'); }
function openSettingsModal() { showModal('settings-modal'); }

function triggerView() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  if (isImageExtension(item.name)) {
    openImageViewer(item.path);
    return;
  }

  fetch(`/api/fs/read?path=${encodeURIComponent(item.path)}`, {
    headers: { 'Authorization': `Bearer ${App.token}` }
  }).then(r => r.json()).then(data => {
    document.getElementById('preview-title').textContent = item.name;
    document.getElementById('preview-body').textContent = data.content;
    showModal('preview-modal');
  });
}

function triggerEditor() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (item && !item.is_dir) openEditorWithFile(item.path);
  else showModal('editor-modal');
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

function triggerDelete() {
  const pane = App.panes[App.activePaneIndex];
  const paths = pane.selected.size > 0 ? Array.from(pane.selected) : (pane.entries[pane.cursorIndex] ? [pane.entries[pane.cursorIndex].path] : []);
  if (paths.length === 0) return;

  if (confirm(`Move ${paths.length} item(s) to trash?`)) {
    fetch('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ paths, use_trash: true })
    }).then(() => refreshPane(App.activePaneIndex));
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
  if (summary) summary.innerHTML = paths.map(p => `<div>📁 ${escapeHtml(p)}</div>`).join('');
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
    showModal('tasks-modal');
    setTimeout(() => refreshPane(pendingDeltaTransfer.targetIdx), 1500);
  } else {
    alert('Failed to start DeltaCopy: ' + await resp.text());
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
    alert(`File: ${data.path}\nSHA-256: ${data.hash}\nSize: ${formatBytes(data.file_size)}`);
  }
}

function triggerArchiveZip() {
  const pane = App.panes[App.activePaneIndex];
  const paths = pane.selected.size > 0 ? Array.from(pane.selected) : [pane.entries[pane.cursorIndex].path];
  const target = `${pane.path.replace(/\/$/, '')}/archive_${Date.now()}.zip`;

  fetch('/api/fs/archive/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ sources: paths, target_path: target, format: 'zip' })
  }).then(() => refreshPane(App.activePaneIndex));
}

function triggerArchiveTarGz() {
  const pane = App.panes[App.activePaneIndex];
  const paths = pane.selected.size > 0 ? Array.from(pane.selected) : [pane.entries[pane.cursorIndex].path];
  const target = `${pane.path.replace(/\/$/, '')}/archive_${Date.now()}.tar.gz`;

  fetch('/api/fs/archive/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ sources: paths, target_path: target, format: 'targz' })
  }).then(() => refreshPane(App.activePaneIndex));
}

function triggerExtract() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  fetch('/api/fs/archive/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ archive_path: item.path, target_dir: pane.path })
  }).then(() => refreshPane(App.activePaneIndex));
}

function navPaneUp(index) {
  const pane = App.panes[index];
  const parts = pane.path.split('/').filter(Boolean);
  parts.pop();
  const parent = '/' + parts.join('/');
  loadPaneDirectory(index, parent);
}

function refreshPane(index) {
  loadPaneDirectory(index, App.panes[index].path);
}

function enablePathInput(index) {
  const crumbs = document.getElementById(`pane-crumbs-${index}`);
  const input = document.getElementById(`pane-input-${index}`);
  crumbs.style.display = 'none';
  input.style.display = 'block';
  input.value = App.panes[index].path;
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
    loadPaneDirectory(index, e.target.value);
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

function showModal(id) { document.getElementById(id)?.classList.add('active'); }
function hideModal(id) { document.getElementById(id)?.classList.remove('active'); }
function closeModal(id) {
  if (id) hideModal(id);
  else document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

// ---------------- REMOTE SFTP / WEBDAV CONNECTION ----------------
let targetRemotePaneIndex = 0;

function openRemoteModal(paneIndex) {
  targetRemotePaneIndex = paneIndex;
  document.getElementById('remote-test-status').style.display = 'none';
  showModal('remote-modal');
}

function updateRemoteProtoUI() {
  const proto = document.getElementById('remote-proto-select').value;
  const portGroup = document.getElementById('remote-port-group');
  const s3Group = document.getElementById('remote-s3-group');
  const hostInput = document.getElementById('remote-host');
  const hostLabel = document.getElementById('remote-host-label');
  const userLabel = document.getElementById('remote-user-label');
  const passLabel = document.getElementById('remote-pass-label');

  if (proto === 'sftp') {
    portGroup.style.display = 'block';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'Server Host / IP:';
    if (userLabel) userLabel.textContent = 'SSH Username:';
    if (passLabel) passLabel.textContent = 'SSH Password / Key:';
    hostInput.placeholder = 'e.g. 192.168.1.100 or sftp.example.com';
  } else if (proto === 'webdav') {
    portGroup.style.display = 'none';
    if (s3Group) s3Group.style.display = 'none';
    if (hostLabel) hostLabel.textContent = 'WebDAV URL:';
    if (userLabel) userLabel.textContent = 'WebDAV Username:';
    if (passLabel) passLabel.textContent = 'WebDAV Password / Token:';
    hostInput.placeholder = 'e.g. http://192.168.1.100:80/remote.php/webdav/';
  } else if (proto === 's3') {
    portGroup.style.display = 'none';
    if (s3Group) s3Group.style.display = 'grid';
    if (hostLabel) hostLabel.textContent = 'S3 Endpoint URL:';
    if (userLabel) userLabel.textContent = 'Access Key ID:';
    if (passLabel) passLabel.textContent = 'Secret Access Key:';
    hostInput.placeholder = 'e.g. https://s3.amazonaws.com or https://<account_id>.r2.cloudflarestorage.com';
  }
}

async function testRemoteConnection() {
  const proto = document.getElementById('remote-proto-select').value;
  const host = document.getElementById('remote-host').value;
  const port = parseInt(document.getElementById('remote-port').value, 10);
  const user = document.getElementById('remote-user').value;
  const pass = document.getElementById('remote-pass').value;
  const bucket = document.getElementById('remote-bucket')?.value || '';
  const region = document.getElementById('remote-region')?.value || 'us-east-1';

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
      status.style.color = 'var(--success)';
      status.textContent = `✓ ${data.message}`;
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
  const host = document.getElementById('remote-host').value;
  const port = parseInt(document.getElementById('remote-port').value, 10);
  const user = document.getElementById('remote-user').value;
  const bucket = document.getElementById('remote-bucket')?.value || '';
  const path = document.getElementById('remote-path').value || '/';

  if (!host) {
    alert('Please specify a server host / URL');
    return;
  }

  let remoteUrl = '';
  if (proto === 'sftp') {
    remoteUrl = `sftp://${user}@${host}:${port}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 'webdav') {
    remoteUrl = `webdav://${host.replace(/^https?:\/\//, '')}${path.startsWith('/') ? path : '/' + path}`;
  } else if (proto === 's3') {
    remoteUrl = `s3://${bucket}${path.startsWith('/') ? path : '/' + path}`;
  }

  closeModal('remote-modal');
  loadPaneDirectory(targetRemotePaneIndex, remoteUrl);
}

// ---------------- INTEGRATED TERMINAL (PTY & WEBSOCKET) ----------------
let termWs = null;
let termOpen = false;

function toggleTerminal(forceState) {
  const drawer = document.getElementById('terminal-drawer');
  if (!drawer) return;

  termOpen = typeof forceState === 'boolean' ? forceState : !termOpen;

  if (termOpen) {
    drawer.classList.add('active');
    const activePane = App.panes[App.activePaneIndex];
    const cwd = (activePane && !activePane.path.includes('://')) ? activePane.path : '/';
    document.getElementById('terminal-cwd-indicator').textContent = cwd;
    connectTerminal(cwd);
    document.getElementById('terminal-output')?.focus();
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
  document.getElementById('terminal-drawer')?.classList.toggle('fullscreen');
}

function clearTerminal() {
  const out = document.getElementById('terminal-output');
  if (out) out.innerHTML = '';
}

function connectTerminal(cwd) {
  if (termWs) {
    termWs.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/ws/terminal?cwd=${encodeURIComponent(cwd)}`;

  termWs = new WebSocket(url);
  const out = document.getElementById('terminal-output');

  termWs.binaryType = 'arraybuffer';

  termWs.onopen = () => {
    out.innerHTML = `<span style="color:var(--accent);">🐕 CommanderDog PTY Session Connected [cwd: ${cwd}]</span>\n\n`;
  };

  termWs.onmessage = (e) => {
    let text = '';
    if (e.data instanceof ArrayBuffer) {
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(e.data);
    } else {
      text = e.data;
    }
    appendTerminalText(text);
  };

  termWs.onclose = () => {
    appendTerminalText('\n[Terminal Session Disconnected]');
  };

  termWs.onerror = (err) => {
    appendTerminalText(`\n[Terminal Error: ${err}]`);
  };

  out.onkeydown = (e) => {
    if (!termWs || termWs.readyState !== WebSocket.OPEN) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      termWs.send('\t');
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      termWs.send('\x7f');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      termWs.send('\r');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      termWs.send('\x1b[A');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      termWs.send('\x1b[B');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      termWs.send('\x1b[C');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      termWs.send('\x1b[D');
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      termWs.send('\x03');
    } else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      termWs.send('\x04');
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      termWs.send(e.key);
    }
  };
}

function appendTerminalText(str) {
  const out = document.getElementById('terminal-output');
  if (!out) return;

  let formatted = str
    .replace(/\x1b\[0m/g, '</span>')
    .replace(/\x1b\[1m/g, '<span style="font-weight:bold;">')
    .replace(/\x1b\[31m/g, '<span style="color:#ef4444;">')
    .replace(/\x1b\[32m/g, '<span style="color:#10b981;">')
    .replace(/\x1b\[33m/g, '<span style="color:#f59e0b;">')
    .replace(/\x1b\[34m/g, '<span style="color:#38bdf8;">')
    .replace(/\x1b\[35m/g, '<span style="color:#bd93f9;">')
    .replace(/\x1b\[36m/g, '<span style="color:#7dcfff;">')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  out.innerHTML += formatted;
  out.scrollTop = out.scrollHeight;
}

// ---------------- BACKGROUND TASKS MONITOR ----------------
let tasksPollTimer = null;

function startTasksPolling() {
  if (tasksPollTimer) clearInterval(tasksPollTimer);
  tasksPollTimer = setInterval(pollTasks, 3000);
}

async function pollTasks() {
  try {
    const resp = await fetch('/api/tasks', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const list = await resp.json();
      const running = list.filter(t => t.status === 'running');
      const pill = document.getElementById('tasks-pill');

      if (running.length > 0) {
        pill.classList.add('active');
        document.getElementById('tasks-pill-text').textContent = `${running.length} Active Transfer${running.length > 1 ? 's' : ''}...`;
      } else {
        pill.classList.remove('active');
      }

      if (document.getElementById('tasks-modal')?.classList.contains('active')) {
        renderTasksTable(list);
      }
    }
  } catch (e) {
    // Ignore polling errors
  }
}

async function loadTasksTable() {
  const resp = await fetch('/api/tasks', {
    headers: { 'Authorization': `Bearer ${App.token}` }
  });
  if (resp.ok) {
    const list = await resp.json();
    renderTasksTable(list);
  }
}

function renderTasksTable(list) {
  const tbody = document.getElementById('tasks-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No background tasks recorded</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => {
    const percent = t.total_bytes > 0 ? Math.min(100, Math.round((t.bytes_processed / t.total_bytes) * 100)) : (t.status === 'completed' ? 100 : 0);
    const speedStr = t.speed_bytes_per_sec > 0 ? `${formatBytes(t.speed_bytes_per_sec)}/s` : '';

    return `
      <tr class="file-row">
        <td>
          <div style="font-weight: 600;">${escapeHtml(t.name)}</div>
          ${t.status === 'running' ? `
            <div style="background: rgba(255,255,255,0.08); height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden;">
              <div style="background: var(--accent); width: ${percent}%; height: 100%; transition: width 0.3s ease;"></div>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px; display: flex; justify-content: space-between;">
              <span>${percent}% (${formatBytes(t.bytes_processed)} / ${formatBytes(t.total_bytes)})</span>
              <span>${speedStr}</span>
            </div>
          ` : ''}
        </td>
        <td><span style="color:var(--accent); text-transform:uppercase; font-size:10px; font-weight:700;">${escapeHtml(t.action)}</span></td>
        <td style="font-family:var(--font-mono); font-size:11px;" title="${escapeHtml(t.source)} ➔ ${escapeHtml(t.destination)}">
          ${escapeHtml(t.source.slice(0, 18))} ➔ ${escapeHtml(t.destination.slice(0, 18))}
        </td>
        <td>
          <span style="color:${t.status === 'completed' ? 'var(--success)' : (t.status === 'running' ? 'var(--accent)' : 'var(--danger)')}; font-weight:600; font-size:11px;">
            ${t.status.toUpperCase()}
          </span>
        </td>
        <td>
          ${t.status === 'running' ? `<button class="btn btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel Task"><i data-lucide="x" style="width:12px;"></i></button>` : '✓'}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function cancelTask(id) {
  await fetch(`/api/tasks/${id}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${App.token}` }
  });
  loadTasksTable();
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

// ---------------- ADVANCED BULK RENAMER ----------------
let bulkRenameFiles = [];
let bulkRenamePreviewMap = [];

function triggerBulkRename() {
  const pane = App.panes[App.activePaneIndex];
  bulkRenameFiles = pane.selected.size > 0 
    ? Array.from(pane.selected).map(p => pane.entries.find(e => e.path === p)).filter(Boolean)
    : (pane.entries[pane.cursorIndex] ? [pane.entries[pane.cursorIndex]] : []);

  if (bulkRenameFiles.length === 0) {
    alert('Please select one or more files to rename.');
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
    closeModal('bulk-rename-modal');
    refreshPane(App.activePaneIndex);
  } else {
    alert('Batch Rename failed: ' + await resp.text());
  }
}

// ---------------- DIRECTORY SYNCHRONIZATION ENGINE ----------------

function openSyncModal() {
  const visible = getVisiblePaneCount();
  const srcPane = App.panes[App.activePaneIndex];
  const destPane = App.panes[(App.activePaneIndex + 1) % visible] || srcPane;

  document.getElementById('sync-src-input').value = srcPane.path;
  document.getElementById('sync-dest-input').value = destPane.path;
  document.getElementById('sync-analysis-card').style.display = 'none';

  showModal('sync-modal');
}

async function analyzeSync() {
  const source = document.getElementById('sync-src-input').value.trim();
  const destination = document.getElementById('sync-dest-input').value.trim();
  const mode = document.querySelector('input[name="sync-mode"]:checked').value;
  const verify_checksum = document.getElementById('sync-verify-crc32').checked;

  if (!source || !destination) {
    alert('Please specify source and destination directories');
    return;
  }

  const card = document.getElementById('sync-analysis-card');
  const stats = document.getElementById('sync-analysis-stats');

  stats.innerHTML = '<div style="grid-column: span 4; color: var(--accent);">Analyzing directory differences...</div>';
  card.style.display = 'block';

  const resp = await fetch('/api/tools/sync/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ source, destination, options: { mode, dry_run: true, verify_checksum, delete_orphans: mode === 'mirror' } })
  });

  if (!resp.ok) {
    stats.innerHTML = `<div style="grid-column: span 4; color: var(--danger);">Analysis failed: ${await resp.text()}</div>`;
    return;
  }

  const data = await resp.json();
  stats.innerHTML = `
    <div style="background:var(--bg-header); padding:6px; border-radius:4px;"><b style="color:var(--success);">+ ${data.to_copy.length}</b> To Copy</div>
    <div style="background:var(--bg-header); padding:6px; border-radius:4px;"><b style="color:var(--accent);">⚡ ${data.to_update.length}</b> To Update</div>
    <div style="background:var(--bg-header); padding:6px; border-radius:4px;"><b style="color:var(--danger);">✕ ${data.to_delete.length}</b> To Delete</div>
    <div style="background:var(--bg-header); padding:6px; border-radius:4px;"><b style="color:var(--text-dim);">= ${data.identical_count}</b> Identical</div>
  `;
}

async function executeSync() {
  const source = document.getElementById('sync-src-input').value.trim();
  const destination = document.getElementById('sync-dest-input').value.trim();
  const mode = document.querySelector('input[name="sync-mode"]:checked').value;
  const verify_checksum = document.getElementById('sync-verify-crc32').checked;
  const dry_run = document.getElementById('sync-dry-run').checked;

  if (!source || !destination) {
    alert('Please specify source and destination directories');
    return;
  }

  closeModal('sync-modal');

  const resp = await fetch('/api/tools/sync/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ source, destination, options: { mode, dry_run, verify_checksum, delete_orphans: mode === 'mirror' } })
  });

  if (resp.ok) {
    if (!dry_run) {
      for (let i = 0; i < getVisiblePaneCount(); i++) refreshPane(i);
      showModal('tasks-modal');
      loadTasksTable();
    }
  } else {
    alert('Sync error: ' + await resp.text());
  }
}

// ---------------- GLOBAL SEARCH ENGINE ----------------

function openSearchModal() {
  const activePane = App.panes[App.activePaneIndex];
  document.getElementById('search-root-input').value = activePane.path;
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

  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--accent); padding: 20px;">Searching directories...</td></tr>';
  stats.textContent = 'Searching...';

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
  stats.textContent = `${items.length} items found`;

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
    loadPaneDirectory(App.activePaneIndex, parentDir);
    if (isImageExtension(filePath)) {
      openImageViewer(filePath);
    } else {
      openEditorWithFile(filePath);
    }
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
  navigator.clipboard.writeText(text).then(() => alert('Output copied to clipboard!'));
}

// ---------------- TOUCH & MOBILE GESTURE ENGINE ----------------
let swipeStartX = 0;
let swipeStartY = 0;

function setupTouchGestures() {
  const container = document.getElementById('pane-container');
  if (!container) return;

  container.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length === 0) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (window.innerWidth > 768) return; // Only trigger pane swipe on mobile
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;

    if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
      const visible = getVisiblePaneCount();
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



