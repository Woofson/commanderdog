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
  clipboard: null,
  dblclickUpDir: localStorage.getItem('cd_dblclick_up') !== 'false',
  showParentDir: localStorage.getItem('cd_show_parent_dir') !== 'false',
  autoOpenTasks: localStorage.getItem('cd_auto_open_tasks') !== 'false',
  taskVerbosity: localStorage.getItem('cd_task_verbosity') || 'detailed',
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
  setupHistoryNavigation();
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
        updateHeaderProfile(App.user);
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
          const colorClass = color !== 'default' ? `pane-tab-color-${color}` : '';
          return `
            <button class="mobile-pane-tab ${colorClass} ${pIdx === index ? 'active' : ''}" data-pane-idx="${pIdx}" onclick="event.stopPropagation(); setActivePane(${pIdx})">
              <img src="assets/folder-closed.png" style="width:13px; height:13px; vertical-align:middle; margin-right:4px;"> Pane ${pIdx + 1}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  el.innerHTML = `
    ${mobileTabs}
    <div class="pane-header">
      <div class="pane-nav-btns">
        <span class="pane-idx-badge" id="pane-idx-badge-${index}" title="Pane ${index + 1} (Click to cycle border color)" onclick="event.stopPropagation(); cyclePaneColor(${index})">${index + 1}</span>
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

      <!-- Favorites & Quick Bookmarks -->
      <div class="pane-favorites-wrapper">
        <button class="btn btn-icon" id="btn-favorites-${index}" onclick="openPaneFavoritesMenu(event, ${index})" oncontextmenu="event.preventDefault(); openBookmarksManager();" title="Favorites & Bookmarks (Left-click: Quick Jump, Right-click: Manage)">
          <i data-lucide="star" style="width: 13px; height: 13px; color: var(--accent);"></i>
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
      if (e.target.closest('tr.file-row')) return;
      e.preventDefault();
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

async function loadPaneDirectory(paneIndex, targetPath, pushHistory = true) {
  const pane = App.panes[paneIndex];
  pane.path = targetPath;
  pane.selected.clear();
  localStorage.setItem(`cd_pane_path_${paneIndex}`, targetPath);

  if (pushHistory && window.history && history.pushState) {
    history.pushState({ type: 'dir', paneIndex, path: targetPath }, '', '');
  }

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

  // Parent directory ".." row when not at root (and enabled in settings)
  if (App.showParentDir && pane.path !== '/' && pane.path !== '' && !pane.filterText) {
    const parentTr = document.createElement('tr');
    parentTr.className = 'file-row parent-dir-row';
    parentTr.draggable = true;

    parentTr.onclick = (e) => {
      e.stopPropagation();
      setActivePane(paneIndex);
      navPaneUp(paneIndex);
    };

    parentTr.ondblclick = (e) => {
      e.stopPropagation();
      navPaneUp(paneIndex);
    };

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
    const isSelected = pane.selected.has(entry.path);
    const tr = document.createElement('tr');
    tr.className = `file-row ${isSelected ? 'selected' : ''} ${idx === pane.cursorIndex ? 'cursor-focus' : ''}`;
    tr.draggable = true;

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

    tr.ondragleave = (e) => {
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
        <span class="file-name-text">${escapeHtml(entry.name)}</span>
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
  if (tabId === 'admin-tab-confd') loadConfdInspector();
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
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (e.key === 'Escape') closeModal();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
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

let activeEditorPathLeft = '';
let activeEditorLanguage = 'auto';
let editorFindMatches = [];
let currentMatchIndex = -1;

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

async function openEditorWithFile(filePath) {
  activeEditorPathLeft = filePath;
  document.getElementById('editor-file-title-left').textContent = filePath;

  const detectedLang = detectLanguageFromPath(filePath);
  const langSelect = document.getElementById('editor-language-select');
  if (langSelect) langSelect.value = detectedLang;
  activeEditorLanguage = detectedLang;

  const resp = await fetch(`/api/fs/read?path=${encodeURIComponent(filePath)}`, {
    headers: { 'Authorization': `Bearer ${App.token}` }
  });

  if (resp.ok) {
    const data = await resp.json();
    const textarea = document.getElementById('editor-text-left');
    textarea.value = data.content;
    handleEditorInput();
    
    // Default to markdown preview for .md, single-editor for code
    const isMd = filePath.endsWith('.md') || filePath.endsWith('.markdown');
    const viewModeSelect = document.getElementById('editor-view-mode');
    if (viewModeSelect) {
      viewModeSelect.value = isMd ? 'split-markdown' : 'single-editor';
      handleEditorViewModeChange(viewModeSelect.value);
    }

    showModal('editor-modal');
  } else {
    showToast('Failed to read file: ' + await resp.text(), 'error');
  }
}

function handleEditorViewModeChange(mode) {
  const rightPane = document.getElementById('editor-right-pane');
  const preview = document.getElementById('editor-preview-container');
  const rightText = document.getElementById('editor-text-right');

  if (mode === 'single-editor') {
    rightPane.style.display = 'none';
  } else if (mode === 'split-markdown') {
    rightPane.style.display = 'flex';
    preview.style.display = 'block';
    rightText.style.display = 'none';
    updateMarkdownPreview();
  } else if (mode === 'dual-files') {
    rightPane.style.display = 'flex';
    preview.style.display = 'none';
    rightText.style.display = 'block';
  }
}

function handleEditorLanguageChange(lang) {
  activeEditorLanguage = lang === 'auto' ? detectLanguageFromPath(activeEditorPathLeft) : lang;
  updateMarkdownPreview();
}

function handleEditorInput() {
  const textarea = document.getElementById('editor-text-left');
  const content = textarea.value;

  // Update status bar stats
  const pos = textarea.selectionStart || 0;
  const lines = content.substring(0, pos).split('\n');
  const lineNum = lines.length;
  const colNum = lines[lines.length - 1].length + 1;

  const posEl = document.getElementById('editor-cursor-pos');
  if (posEl) posEl.textContent = `Ln ${lineNum}, Col ${colNum}`;

  const statsEl = document.getElementById('editor-doc-stats');
  if (statsEl) statsEl.textContent = `${content.length} characters | ${content.split(/\s+/).filter(Boolean).length} words | UTF-8`;

  const mode = document.getElementById('editor-view-mode')?.value;
  if (mode === 'split-markdown') {
    updateMarkdownPreview();
  }
}

function handleEditorKeyDown(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 2;
    handleEditorInput();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveEditorContent();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    toggleFindBar(true);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
    e.preventDefault();
    toggleFindBar(true);
    document.getElementById('editor-replace-input')?.focus();
  }
}

function updateMarkdownPreview() {
  const content = document.getElementById('editor-text-left').value;
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
      const prismLang = Prism.languages[lang] || Prism.languages.markup;
      const highlighted = window.Prism ? Prism.highlight(code, prismLang, lang) : escapeHtml(code);
      return `<pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>`;
    })
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

async function saveEditorContent() {
  const content = document.getElementById('editor-text-left').value;
  if (!activeEditorPathLeft) return;

  try {
    const resp = await fetch('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ path: activeEditorPathLeft, content, atomic: true })
    });

    if (resp.ok) {
      const btn = document.getElementById('btn-save-editor');
      if (btn) {
        const origText = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="check"></i> Saved!';
        if (window.lucide) lucide.createIcons();
        setTimeout(() => { btn.innerHTML = origText; if (window.lucide) lucide.createIcons(); }, 1500);
      }
      showToast('File saved successfully!', 'success');
      refreshPane(App.activePaneIndex);
    } else {
      showToast('Failed to save file: ' + await resp.text(), 'error');
    }
  } catch (e) {
    showToast('Save error: ' + e, 'error');
  }
}

// ---------------- EDITOR FIND & REPLACE ----------------

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

function handleFindKeyDown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) findPrevMatch();
    else findNextMatch();
  } else if (e.key === 'Escape') {
    toggleFindBar(false);
  } else {
    setTimeout(executeFind, 50);
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
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  let pos = 0;

  while ((pos = textLower.indexOf(queryLower, pos)) !== -1) {
    editorFindMatches.push({ start: pos, end: pos + query.length });
    pos += query.length;
  }

  if (editorFindMatches.length > 0) {
    currentMatchIndex = 0;
    highlightCurrentMatch();
  } else {
    currentMatchIndex = -1;
  }

  if (countEl) {
    countEl.textContent = editorFindMatches.length > 0 ? `${currentMatchIndex + 1} of ${editorFindMatches.length}` : '0 of 0';
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
  executeFind();
}

function replaceAllMatches() {
  const query = document.getElementById('editor-find-input')?.value;
  const replaceWith = document.getElementById('editor-replace-input')?.value || '';
  const textarea = document.getElementById('editor-text-left');
  if (!query || !textarea) return;

  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  textarea.value = textarea.value.replace(regex, replaceWith);
  executeFind();
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
      <div style="font-size: 12px; color: var(--text-muted);">${paneA.path} ⟷ ${paneB.path}</div>
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
  
  let filteredEntries = diff.entries;
  if (filter === 'modified') filteredEntries = diff.entries.filter(e => e.status === 'modified');
  else if (filter === 'left_only') filteredEntries = diff.entries.filter(e => e.status === 'left_only');
  else if (filter === 'right_only') filteredEntries = diff.entries.filter(e => e.status === 'right_only');
  else if (filter === 'identical') filteredEntries = diff.entries.filter(e => e.status === 'identical');

  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; background: var(--bg-header); padding: 10px 14px; border-radius: var(--radius); border: 1px solid var(--border);">
      <div style="display: flex; gap: 20px; font-size: 12px;">
        <div><b>Left:</b> <code style="color: var(--accent);">${diff.dir_left}</code></div>
        <div><b>Right:</b> <code style="color: var(--accent);">${diff.dir_right}</code></div>
      </div>
      <div style="display: flex; gap: 6px;">
        <button class="btn btn-accent" onclick="triggerDiff(false)" title="Fast Immediate Compare"><i data-lucide="zap"></i> Fast Compare</button>
        <button class="btn" onclick="triggerDiff(true)" title="Deep Recursive SHA-256 Compare"><i data-lucide="shield-check"></i> Deep Hash Scan</button>
      </div>
    </div>

    <!-- Filter Buttons -->
    <div class="diff-filter-bar">
      <button class="diff-filter-btn ${filter === 'all' ? 'active' : ''}" onclick="setDiffFilter('all')">
        All Items (${diff.entries.length})
      </button>
      <button class="diff-filter-btn ${filter === 'modified' ? 'active' : ''}" onclick="setDiffFilter('modified')">
        <span style="color: var(--accent);">⚠️ Modified (${diff.modified_count})</span>
      </button>
      <button class="diff-filter-btn ${filter === 'left_only' ? 'active' : ''}" onclick="setDiffFilter('left_only')">
        <span style="color: var(--info);">⬅️ Left Only (${diff.left_only_count})</span>
      </button>
      <button class="diff-filter-btn ${filter === 'right_only' ? 'active' : ''}" onclick="setDiffFilter('right_only')">
        <span style="color: var(--danger);">➡️ Right Only (${diff.right_only_count})</span>
      </button>
      <button class="diff-filter-btn ${filter === 'identical' ? 'active' : ''}" onclick="setDiffFilter('identical')">
        <span style="color: var(--success);">✅ Identical (${diff.identical_count})</span>
      </button>
    </div>

    <div style="max-height: 58vh; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius);">
      <table class="file-table">
        <thead>
          <tr>
            <th>Relative Path</th>
            <th>Status</th>
            <th>Left Size</th>
            <th>Right Size</th>
            <th style="width: 100px; text-align: center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filteredEntries.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--text-dim);">No files match this filter.</td></tr>' : ''}
          ${filteredEntries.map(e => `
            <tr class="file-row">
              <td class="file-cell"><span style="font-family: var(--font-mono);">${e.relative_path}</span></td>
              <td class="file-cell" style="color: ${e.status === 'identical' ? 'var(--success)' : (e.status === 'modified' ? 'var(--accent)' : (e.status === 'left_only' ? 'var(--info)' : 'var(--danger)'))}; font-weight: 700; font-size: 11px;">
                ${e.status.replace('_', ' ').toUpperCase()}
              </td>
              <td class="file-cell file-cell-mono">${e.size_left !== null ? formatBytes(e.size_left) : '-'}</td>
              <td class="file-cell file-cell-mono">${e.size_right !== null ? formatBytes(e.size_right) : '-'}</td>
              <td class="file-cell" style="text-align: center;">
                ${!e.is_dir && (e.status === 'modified' || e.status === 'identical') ? `
                  <button class="btn btn-icon" onclick="openFileDiffView('${diff.dir_left}/${e.relative_path}', '${diff.dir_right}/${e.relative_path}')" title="Inspect Side-by-Side Diff">
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
  body.innerHTML = '<div style="padding: 20px; color: var(--accent);">Loading side-by-side file comparison...</div>';

  try {
    const resp = await fetch('/api/tools/diff/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
      body: JSON.stringify({ file_left: fileL, file_right: fileR })
    });

    if (resp.ok) {
      const diffData = await resp.json();
      body.innerHTML = `
        <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-header); padding: 8px 12px; border-radius: var(--radius);">
          <div style="font-size: 12px;">
            <span style="color: var(--accent); font-weight: 700;">Left:</span> ${escapeHtml(diffData.file_left)} 
            <span style="margin: 0 8px; color: var(--text-dim);">⟷</span>
            <span style="color: var(--accent); font-weight: 700;">Right:</span> ${escapeHtml(diffData.file_right)}
            <span class="badge" style="margin-left: 12px; font-size: 11px; background: rgba(245, 158, 11, 0.2); color: var(--accent); padding: 2px 6px;">
              +${diffData.additions} / -${diffData.deletions}
            </span>
          </div>
          <button class="btn" onclick="triggerDiff(false)"><i data-lucide="arrow-left"></i> Back to Folder Diff</button>
        </div>
        <div class="diff-container" style="max-height: 68vh; overflow: auto;">
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
      body.innerHTML = `<div style="color: var(--danger); padding: 20px;">Failed to compare files: ${await resp.text()}</div>`;
    }
  } catch (e) {
    body.innerHTML = `<div style="color: var(--danger); padding: 20px;">Error: ${e}</div>`;
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
    el.innerHTML = `<img src="${escapeHtml(avatar)}" alt="Avatar">`;
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

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tools-dropdown-wrapper')) {
    document.getElementById('tools-dropdown-menu')?.classList.remove('active');
  }
  if (!e.target.closest('.profile-dropdown-wrapper')) {
    document.getElementById('profile-dropdown-menu')?.classList.remove('active');
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
  try {
    const resp = await fetch('/api/mounts/accessible', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      globalMounts = await resp.json();
    }
  } catch (err) {
    console.warn('Failed to load accessible mounts for favorites:', err);
  }

  const protoIcons = {
    'smb': 'share-2',
    'nfs': 'server',
    's3': 'cloud',
    'sftp': 'terminal',
    'webdav': 'globe',
    'hetzner-box': 'box',
    'proton': 'shield'
  };

  const popup = document.createElement('div');
  popup.id = 'pane-favorites-popup';
  popup.className = 'pane-favorites-dropdown active';

  popup.innerHTML = `
    <div style="padding: 8px 12px; font-weight: 700; font-size: 11px; color: var(--accent); background: var(--bg-dark); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
      <span>⭐ Quick Favorites & Bookmarks</span>
      <span style="font-size: 10px; color: var(--text-dim); cursor: pointer;" onclick="openBookmarksManager()">Manage ⚙️</span>
    </div>
    <div style="padding: 4px 0;">
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
    </div>
    ${globalMounts.length > 0 ? `
      <div style="border-top: 1px solid var(--border); padding: 4px 0; background: rgba(245, 158, 11, 0.03);">
        <div style="padding: 4px 12px; font-size: 10px; color: var(--accent); font-weight: 700; text-transform: uppercase; display: flex; justify-content: space-between;">
          <span>🌐 Network & Global Mounts</span>
          <span style="font-size: 9px; background: rgba(245, 158, 11, 0.15); padding: 1px 4px; border-radius: 3px;">ASSIGNED BY ADMIN</span>
        </div>
        ${globalMounts.map(m => `
          <div class="dropdown-item" onclick="loadPaneDirectory(${paneIndex}, '${escapeHtml(m.target_uri)}'); document.getElementById('pane-favorites-popup')?.remove();">
            <i data-lucide="${protoIcons[m.protocol] || 'network'}" style="color: var(--accent);"></i>
            <div>
              <div style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span>${escapeHtml(m.name)}</span>
                <span class="badge" style="font-size: 9px; padding: 1px 4px; text-transform: uppercase;">${escapeHtml(m.protocol)}</span>
              </div>
              <div style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(m.target_uri)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
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
    <div class="context-item" onclick="triggerEditor()"><i data-lucide="file-edit" style="width: 14px;"></i> Edit File (F4)</div>
    <div class="context-item" onclick="triggerDiff()"><i data-lucide="git-compare" style="width: 14px;"></i> Compare / Diff</div>
    <div class="context-sep"></div>

    <div class="context-item" onclick="triggerCopyClipboard()"><i data-lucide="clipboard-copy" style="width: 14px;"></i> Copy to Clipboard (Ctrl+C)</div>
    <div class="context-item" onclick="triggerCutClipboard()"><i data-lucide="scissors" style="width: 14px;"></i> Cut (Ctrl+X)</div>
    <div class="context-item ${App.clipboard ? '' : 'disabled'}" onclick="triggerPaste(App.activePaneIndex)" style="${App.clipboard ? '' : 'opacity: 0.5; pointer-events: none;'}"><i data-lucide="clipboard-paste" style="width: 14px;"></i> Paste (Ctrl+V)</div>
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

  if (window.innerWidth <= 768) {
    // Mobile Bottom Sheet positioning
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
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 380)}px`;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.width = 'auto';
    menu.style.maxHeight = 'none';
  }
}

function showTouchActionsMenu(e) {
  if (e) e.stopPropagation();
  const pane = App.panes[App.activePaneIndex];
  if (!pane || pane.selected.size === 0) return;

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
    <div class="context-item" onclick="triggerMkdir()"><i data-lucide="folder-plus" style="width: 14px;"></i> New Folder... (F7)</div>
    <div class="context-item" onclick="triggerNewFile()"><i data-lucide="file-plus" style="width: 14px;"></i> New Text File...</div>
    <div class="context-item ${App.clipboard ? '' : 'disabled'}" onclick="triggerPaste(${paneIndex})" style="${App.clipboard ? '' : 'opacity: 0.5; pointer-events: none;'}">
      <i data-lucide="clipboard-paste" style="width: 14px;"></i> Paste ${clipInfo} (Ctrl+V)
    </div>
    <div class="context-item" onclick="refreshPane(${paneIndex})"><i data-lucide="rotate-cw" style="width: 14px;"></i> Refresh Directory</div>
    <div class="context-sep"></div>
    <div class="context-item" onclick="openTerminalInPath('${escapeHtml(pane.path)}')"><i data-lucide="terminal" style="width: 14px; color: var(--accent);"></i> Open in Terminal (\`)</div>
    <div class="context-item" onclick="openSearchModal()"><i data-lucide="search" style="width: 14px;"></i> Deep Search in Directory (Ctrl+F)</div>
    <div class="context-item" onclick="openSyncModal()"><i data-lucide="refresh-cw" style="width: 14px;"></i> Sync with Opposite Pane...</div>
    <div class="context-item" onclick="openRemoteModal(${paneIndex})"><i data-lucide="network" style="width: 14px;"></i> Mount Remote Storage Here...</div>
    <div class="context-item" onclick="addCurrentPaneToQuickDest()"><i data-lucide="bookmark-plus" style="width: 14px;"></i> Bookmark Current Path</div>
    <div class="context-sep"></div>
    <div class="context-item" onclick="triggerDirPermissions(${paneIndex})"><i data-lucide="lock" style="width: 14px;"></i> Directory Permissions & Ownership</div>
    <div class="context-item" onclick="runPredefinedAction('du -sh &quot;{dir}&quot;', 'Directory Disk Usage')"><i data-lucide="hard-drive" style="width: 14px;"></i> Check Disk Usage (du -sh)</div>
  `;

  if (window.lucide) lucide.createIcons();

  menu.style.display = 'block';
  menu.style.left = `${Math.min(x, window.innerWidth - 250)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 380)}px`;
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

async function addCurrentPaneToQuickDest() {
  const currentPath = App.panes[App.activePaneIndex].path;
  const defaultLabel = currentPath.split('/').pop() || currentPath;
  const name = await showPromptDialog({
    title: 'Add Quick Destination',
    subtitle: 'Favorites & Bookmarks',
    message: `Enter label for directory: <code>${escapeHtml(currentPath)}</code>`,
    defaultValue: defaultLabel,
    placeholder: 'My Downloads, Projects, Backups...',
    confirmText: 'Add Destination',
    cancelText: 'Cancel'
  });
  if (name && name.trim()) {
    addCustomDestination(name.trim(), currentPath);
    showToast(`Added '${name.trim()}' to Quick Destinations`, 'success');
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

  showModal('settings-modal');
}

function triggerView() {
  const pane = App.panes[App.activePaneIndex];
  const item = App.contextItem || pane.entries[pane.cursorIndex];
  if (!item) return;

  if (item.is_dir || item.is_archive) {
    loadPaneDirectory(App.activePaneIndex, item.path);
    return;
  }
  if (isPdfExtension(item.name)) {
    openPdfViewer(item.path);
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

function applyPaneColors() {
  const colors = getPaneColors();
  for (let i = 0; i < 4; i++) {
    const paneEl = document.getElementById(`pane-${i}`);
    const color = colors[i] || 'default';
    if (paneEl) {
      PANE_COLOR_PALETTE.forEach(c => {
        if (c !== 'default') paneEl.classList.remove(`pane-color-${c}`);
      });
      if (color !== 'default') {
        paneEl.classList.add(`pane-color-${color}`);
      }
    }

    // Dynamically update mobile pane indicator tabs with custom color tints
    document.querySelectorAll(`.mobile-pane-tab[data-pane-idx="${i}"]`).forEach(tab => {
      PANE_COLOR_PALETTE.forEach(c => {
        if (c !== 'default') tab.classList.remove(`pane-tab-color-${c}`);
      });
      if (color !== 'default') {
        tab.classList.add(`pane-tab-color-${color}`);
      }
    });

    const selectEl = document.getElementById(`setting-pane-color-${i}`);
    if (selectEl) {
      selectEl.value = color;
    }
  }
}

function navPaneUp(index) {
  const pane = App.panes[index];
  if (!pane || pane.path === '/' || pane.path === '') return;

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

  const parts = pane.path.split('/').filter(Boolean);
  parts.pop();
  const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
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

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.setProperty('--toast-duration', `${duration / 1000}s`);

  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  else if (type === 'error') iconName = 'alert-triangle';
  else if (type === 'warning') iconName = 'alert-circle';

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 16px; height: 16px; flex-shrink: 0;"></i>
    <span>${escapeHtml(message)}</span>
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
      termInstance.writeln('\x1b[38;5;214m🐕 CommanderDog PTY Session Connected\x1b[0m [\x1b[38;5;244mcwd:\x1b[0m ' + cwd + ']\r\n');
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
  if (win) {
    win.classList.remove('minimized');
    win.classList.add('active');
  }
  if (pill) pill.classList.remove('active');
  App.taskManagerVisible = true;
  App.taskManagerMinimized = false;

  const sel = document.getElementById('task-verbosity-selector');
  if (sel) sel.value = App.taskVerbosity;
  applyTaskVerbosityUI(App.taskVerbosity);

  pollTasks();
}

function closeFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  if (win) win.classList.remove('active', 'minimized');
  App.taskManagerVisible = false;
  App.taskManagerMinimized = false;
  updateTasksPillState(lastKnownTasksList);
}

function minimizeFloatingTaskManager() {
  const win = document.getElementById('floating-task-manager');
  if (win) win.classList.add('minimized');
  App.taskManagerMinimized = true;
  updateTasksPillState(lastKnownTasksList);
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

async function pollTasks() {
  try {
    const resp = await fetch('/api/tasks', {
      headers: { 'Authorization': `Bearer ${App.token}` }
    });
    if (resp.ok) {
      const list = await resp.json();
      lastKnownTasksList = list;
      const running = list.filter(t => t.status === 'running');

      // Auto-open on new active transfers if enabled in settings
      if (running.length > 0 && !wasAnyRunningLastCheck && App.autoOpenTasks && !App.taskManagerMinimized) {
        openFloatingTaskManager();
      }
      wasAnyRunningLastCheck = running.length > 0;

      updateTasksPillState(list);
      renderFloatingTaskManager(list);
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

  // Update Floating Pill
  if (pill) {
    if (running.length > 0 && !isWinOpen) {
      pill.classList.add('active');
      document.getElementById('tasks-pill-text').textContent = `${running.length} Job${running.length > 1 ? 's' : ''}`;
      document.getElementById('tasks-pill-speed').textContent = speedStr || 'Processing';
    } else {
      pill.classList.remove('active');
    }
  }
}

function initTaskWindowDragResize() {
  const win = document.getElementById('floating-task-manager');
  const handle = document.getElementById('task-win-resize-handle');
  if (!win || !handle || handle.dataset.resizeInitialized) return;
  handle.dataset.resizeInitialized = 'true';

  // Restore saved height if any
  const savedHeight = localStorage.getItem('cd_task_win_height');
  if (savedHeight) {
    applyTaskWindowHeight(parseInt(savedHeight, 10));
  }

  let startY = 0;
  let startHeight = 0;
  let isDragging = false;

  function onMouseDown(e) {
    isDragging = true;
    startY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    startHeight = win.offsetHeight;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onMouseMove, { passive: false });
    window.addEventListener('touchend', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    const deltaY = startY - clientY; // dragging up increases height
    const newHeight = Math.max(180, Math.min(window.innerHeight - 80, startHeight + deltaY));
    applyTaskWindowHeight(newHeight);
    if (e.preventDefault && e.cancelable) e.preventDefault();
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    localStorage.setItem('cd_task_win_height', win.offsetHeight);

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('touchmove', onMouseMove);
    window.removeEventListener('touchend', onMouseUp);
  }

  handle.addEventListener('mousedown', onMouseDown);
  handle.addEventListener('touchstart', onMouseDown, { passive: false });
}

function applyTaskWindowHeight(h) {
  const win = document.getElementById('floating-task-manager');
  if (!win) return;
  win.style.height = `${h}px`;

  const queueCont = document.getElementById('task-queue-container');
  const logCont = document.getElementById('task-log-container');
  const internalHeight = Math.max(80, h - 220);
  if (queueCont) queueCont.style.maxHeight = `${internalHeight}px`;
  if (logCont) logCont.style.maxHeight = `${internalHeight}px`;
}

function renderFloatingTaskManager(list) {
  const win = document.getElementById('floating-task-manager');
  if (!win) return;

  const running = list.filter(t => t.status === 'running');
  const totalSpeed = running.reduce((acc, t) => acc + (t.speed_bytes_per_sec || 0), 0);
  const speedStr = totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : '0 B/s';

  // 1. Header State
  const titleEl = document.getElementById('task-header-title');
  const indEl = document.getElementById('task-status-indicator');
  const speedEl = document.getElementById('task-speed-badge');

  if (titleEl) titleEl.textContent = `⚡ Transfers (${running.length} active${list.length > running.length ? `, ${list.length - running.length} done` : ''})`;
  if (indEl) {
    if (running.length > 0) indEl.classList.add('active');
    else indEl.classList.remove('active');
  }
  if (speedEl) speedEl.textContent = speedStr;

  // 2. Batch Summary Progress (Total files & bytes across running/all jobs)
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
      activeCurrentFile = t.current_file || t.name;
      activeCurBytes = t.current_file_bytes || t.bytes_processed;
      activeCurTotal = t.current_file_total_bytes || t.total_bytes;
      activeSpeed = t.speed_bytes_per_sec || 0;
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
  if (batchFiles) batchFiles.textContent = `${totalProcessedFiles} / ${totalBatchFiles} files`;
  if (batchBytes) batchBytes.textContent = `${formatBytes(totalProcessedBytes)} / ${formatBytes(totalBatchBytes)}`;

  if (batchEta) {
    if (running.length > 0 && totalSpeed > 0 && totalBatchBytes > totalProcessedBytes) {
      const etaSec = Math.round((totalBatchBytes - totalProcessedBytes) / totalSpeed);
      const mins = Math.floor(etaSec / 60);
      const secs = etaSec % 60;
      batchEta.textContent = `ETA: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else if (running.length === 0) {
      batchEta.textContent = list.length > 0 ? '✓ Completed' : 'Idle';
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

        return `
          <div class="task-queue-item">
            <div class="task-queue-details">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="task-queue-name">${escapeHtml(t.name)}</span>
                <span class="task-queue-badge ${badgeClass}">${escapeHtml(t.status)}</span>
              </div>
              <div class="task-queue-sub">${escapeHtml(t.source)} ➔ ${escapeHtml(t.destination)}</div>
              ${isRunning || isPaused ? `
                <div style="height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; margin-top: 3px; overflow: hidden;">
                  <div style="height: 100%; width: ${pct}%; background: var(--accent);"></div>
                </div>
              ` : ''}
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
              ${isRunning ? `
                <button class="btn btn-sm btn-icon" onclick="pauseTask('${t.id}')" title="Pause"><i data-lucide="pause" style="width: 11px; height: 11px;"></i></button>
                <button class="btn btn-sm btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel"><i data-lucide="x" style="width: 11px; height: 11px;"></i></button>
              ` : (isPaused ? `
                <button class="btn btn-sm btn-icon" onclick="resumeTask('${t.id}')" title="Resume"><i data-lucide="play" style="width: 11px; height: 11px;"></i></button>
                <button class="btn btn-sm btn-icon btn-danger" onclick="cancelTask('${t.id}')" title="Cancel"><i data-lucide="x" style="width: 11px; height: 11px;"></i></button>
              ` : '✓')}
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
        allLogs.push(`--- [Job: ${t.name}] ---`);
        t.log_entries.forEach(l => allLogs.push(l));
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
  if (consoleEl && navigator.clipboard) {
    navigator.clipboard.writeText(consoleEl.textContent);
    showToast('Transfer diagnostic log copied to clipboard!', 'success');
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

// ---------------- DOCUMENT & MEDIA READERS ----------------
function isPdfExtension(filename) {
  if (!filename) return false;
  return filename.split('.').pop().toLowerCase() === 'pdf';
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
  } else if (isPdfExtension(entry.name)) {
    openPdfViewer(entry.path);
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

// PDF Reader
function openPdfViewer(filePath) {
  const titleEl = document.getElementById('pdf-viewer-title');
  const frameEl = document.getElementById('pdf-viewer-frame');
  const dlEl = document.getElementById('pdf-viewer-download');
  const extEl = document.getElementById('pdf-viewer-external');

  const fileName = filePath.split('/').pop() || filePath;
  if (titleEl) titleEl.textContent = fileName;

  const url = `/api/fs/download?path=${encodeURIComponent(filePath)}&inline=true`;
  if (frameEl) frameEl.src = url;
  if (dlEl) {
    dlEl.href = `/api/fs/download?path=${encodeURIComponent(filePath)}`;
    dlEl.download = fileName;
  }
  if (extEl) extEl.href = url;

  showModal('pdf-viewer-modal');
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
  if (pathEl) pathEl.textContent = filePath;

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
    showToast('Please specify source and destination directories', 'warning');
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
    showToast('Please specify source and destination directories', 'warning');
    return;
  }

  closeModal('sync-modal');

  const resp = await fetch('/api/tools/sync/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.token}` },
    body: JSON.stringify({ source, destination, options: { mode, dry_run, verify_checksum, delete_orphans: mode === 'mirror' } })
  });

  if (resp.ok) {
    showToast('Sync initiated successfully', 'success');
    if (!dry_run) {
      for (let i = 0; i < getVisiblePaneCount(); i++) refreshPane(i);
      openFloatingTaskManager();
    }
  } else {
    showToast('Sync error: ' + await resp.text(), 'error');
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
    if (window.innerWidth > 768) return; // Only trigger pane swipe on mobile
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

function logout() {
  localStorage.removeItem('cd_token');
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

// ---------------- DYNAMIC VIEWPORT HEIGHT SYNC (FOR BOTTOM ADDRESS BARS) ----------------
function updateDynamicViewportHeight() {
  if (window.visualViewport) {
    document.body.style.height = `${window.visualViewport.height}px`;
  }
}
window.addEventListener('resize', updateDynamicViewportHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateDynamicViewportHeight);
}
document.addEventListener('DOMContentLoaded', updateDynamicViewportHeight);



