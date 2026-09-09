// Hospital Equipment Tracker - Client Interface
const socket = io();

// Application State
let appState = {
  folders: [],
  items: {},
  uhf_modules: [],
  uhf_history: [],
  pending_tag: null
};

let currentFolderId = null;
let currentView = 'home';
let simEditMode = true;
let deleteModuleMode = false;
let selectedTrackedUid = null;
let tagPosition = { x: 120, y: 120 };
let pingInterval = null;
let floorplanDataUrl = null;
let floorplanScale = 100;

// DOM Elements
const views = {
  home: document.getElementById('homeView'),
  folder: document.getElementById('folderView'),
  sim: document.getElementById('simulatorView')
};

const folderGrid = document.getElementById('folderGrid');
const folderTitle = document.getElementById('folderTitle');
const folderItemList = document.getElementById('folderItemList');
const nfcStatus = document.getElementById('nfcStatus');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const trackedItemSelect = document.getElementById('trackedItemSelect');

const simCanvas = document.getElementById('simCanvas');
const simCanvasWrap = document.getElementById('simCanvasWrap');
const simBackgroundImage = document.getElementById('simBackgroundImage');
const tagCursor = document.getElementById('tagCursor');
const cursorModeLabel = document.getElementById('cursorModeLabel');

const bgImageInput = document.getElementById('bgImageInput');
const bgScaleInput = document.getElementById('bgScaleInput');
const bgScaleLabel = document.getElementById('bgScaleLabel');
const clearBgBtn = document.getElementById('clearBgBtn');
const toggleDeleteModeBtn = document.getElementById('toggleDeleteModeBtn');
const toggleEditBtn = document.getElementById('toggleEditBtn');

const registrationModal = document.getElementById('registrationModal');
const registrationUidText = document.getElementById('registrationUidText');
const itemNameInput = document.getElementById('itemNameInput');
const folderSelect = document.getElementById('folderSelect');

// Utility helpers
function switchView(name) {
  currentView = name;
  Object.values(views).forEach(v => v.classList.remove('active'));
  if (views[name]) views[name].classList.add('active');
  renderTagCursor();
}

function getItemsInFolder(folderId) {
  return Object.values(appState.items).filter(item => item.folder_id === folderId);
}

function getFolderName(folderId) {
  const folder = appState.folders.find(f => f.id === folderId);
  return folder ? folder.name : 'General Inventory';
}

function formatTime(isoOrTimestamp) {
  if (!isoOrTimestamp) return 'Never';
  const date = typeof isoOrTimestamp === 'number' ? new Date(isoOrTimestamp * 1000) : new Date(isoOrTimestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

async function apiRequest(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (data) options.body = JSON.stringify(data);

  const res = await fetch(endpoint, options);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// UI Rendering
function renderFolders() {
  folderGrid.innerHTML = '';

  appState.folders.forEach(folder => {
    const count = getItemsInFolder(folder.id).length;
    const tile = document.createElement('div');
    tile.className = 'folder-tile';
    tile.innerHTML = `
      <div class="folder-icon"></div>
      <div class="folder-name">${folder.name}</div>
      <div class="folder-count">${count} item${count === 1 ? '' : 's'}</div>
    `;
    tile.onclick = () => {
      currentFolderId = folder.id;
      renderFolderContents();
      switchView('folder');
    };
    folderGrid.appendChild(tile);
  });

  // Simulator shortcut tile
  const simTile = document.createElement('div');
  simTile.className = 'folder-tile';
  simTile.innerHTML = `
    <div class="sim-launch-icon"></div>
    <div class="folder-name">Floorplan Simulation</div>
    <div class="folder-count">Active UHF Grid</div>
  `;
  simTile.onclick = () => switchView('sim');
  folderGrid.appendChild(simTile);
}

function renderFolderSelectOptions() {
  folderSelect.innerHTML = '';
  appState.folders.forEach(folder => {
    const opt = document.createElement('option');
    opt.value = folder.id;
    opt.textContent = folder.name;
    folderSelect.appendChild(opt);
  });
}

function renderFolderContents() {
  const folder = appState.folders.find(f => f.id === currentFolderId);
  if (!folder) return;

  folderTitle.textContent = folder.name;
  const items = getItemsInFolder(folder.id);
  folderItemList.innerHTML = '';

  if (!items.length) {
    folderItemList.innerHTML = '<div class="hero-card"><p>No equipment assigned to this department yet.</p></div>';
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-meta">
        <strong>${item.name}</strong>
        <div class="mono">${item.uid}</div>
      </div>
      <div>
        <div class="status-pill in">Active</div>
      </div>
      <div class="location-box">
        <div><strong>Last Location:</strong> ${item.last_seen_location || 'NFC Registration'}</div>
        <div class="mono" style="font-size: 0.8rem;">${formatTime(item.last_seen_time)}</div>
      </div>
    `;
    folderItemList.appendChild(card);
  });
}

function renderTrackedItemSelector() {
  const items = Object.values(appState.items);
  trackedItemSelect.innerHTML = '';

  if (!items.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No tagged equipment found';
    trackedItemSelect.appendChild(opt);
    selectedTrackedUid = null;
    return;
  }

  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.uid;
    opt.textContent = `${item.name} (${getFolderName(item.folder_id)})`;
    trackedItemSelect.appendChild(opt);
  });

  if (!selectedTrackedUid || !items.some(i => i.uid === selectedTrackedUid)) {
    selectedTrackedUid = items[0].uid;
  }
  trackedItemSelect.value = selectedTrackedUid;
}

function renderHistoryLog() {
  historyList.innerHTML = '';
  appState.uhf_history.slice(0, 50).forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-entry';
    div.textContent = `${formatTime(entry.timestamp)} — Tag ${entry.item_uid} pinged at ${entry.location}`;
    historyList.appendChild(div);
  });
}

function renderCanvas() {
  // Background map
  if (!floorplanDataUrl) {
    simBackgroundImage.classList.add('hidden');
    simBackgroundImage.removeAttribute('src');
  } else {
    simBackgroundImage.src = floorplanDataUrl;
    simBackgroundImage.classList.remove('hidden');
    simBackgroundImage.style.width = `${floorplanScale}%`;
  }

  // Gateway modules
  simCanvas.querySelectorAll('.sim-module').forEach(el => el.remove());
  appState.uhf_modules.forEach(mod => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sim-module';
    btn.style.left = `${mod.x}px`;
    btn.style.top = `${mod.y}px`;
    btn.innerHTML = `<span>${mod.name}</span>`;

    if (simEditMode && deleteModuleMode) {
      btn.classList.add('delete-ready');
    }

    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!simEditMode || !deleteModuleMode) return;
      try {
        await apiRequest(`/api/uhf/modules/${mod.id}`, 'DELETE');
      } catch (err) {
        console.error('Delete module error:', err);
      }
    };

    simCanvas.appendChild(btn);
  });
}

function renderTagCursor() {
  if (simEditMode || currentView !== 'sim') {
    tagCursor.classList.add('hidden');
    simCanvasWrap.classList.add('editor-mode');
    simCanvasWrap.classList.remove('tracker-mode');
    cursorModeLabel.textContent = deleteModuleMode ? 'Editor (Delete Active)' : 'Editor';
    return;
  }

  tagCursor.classList.remove('hidden');
  tagCursor.style.left = `${tagPosition.x}px`;
  tagCursor.style.top = `${tagPosition.y}px`;
  simCanvasWrap.classList.remove('editor-mode');
  simCanvasWrap.classList.add('tracker-mode');
  cursorModeLabel.textContent = 'Active Tag';
}

function renderControls() {
  bgScaleInput.value = String(floorplanScale);
  bgScaleLabel.textContent = `${floorplanScale}%`;
  toggleDeleteModeBtn.classList.toggle('active', deleteModuleMode);
  toggleDeleteModeBtn.textContent = deleteModuleMode ? 'Done Deleting' : 'Remove Gateways';
  toggleDeleteModeBtn.disabled = !simEditMode;
  bgImageInput.disabled = !simEditMode;
  bgScaleInput.disabled = !simEditMode || !floorplanDataUrl;
  clearBgBtn.disabled = !simEditMode || !floorplanDataUrl;
}

function renderAll() {
  renderFolders();
  renderFolderSelectOptions();
  renderFolderContents();
  renderTrackedItemSelector();
  renderHistoryLog();
  renderCanvas();
  renderControls();
  renderTagCursor();

  if (appState.pending_tag) {
    openRegistration(appState.pending_tag);
  }
}

// Registration Modal
function openRegistration(uid) {
  registrationUidText.textContent = uid;
  itemNameInput.value = '';
  registrationModal.classList.remove('hidden');
}

function closeRegistration() {
  registrationModal.classList.add('hidden');
}

// UHF Distance & Ping Logic
function findNearestModule() {
  if (!appState.uhf_modules.length) return null;

  let nearest = null;
  let minDistance = Infinity;

  appState.uhf_modules.forEach(mod => {
    const dist = Math.hypot(tagPosition.x - mod.x, tagPosition.y - mod.y);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = mod;
    }
  });

  return nearest ? nearest.id : null;
}

async function sendPositionPing() {
  if (!selectedTrackedUid || simEditMode || currentView !== 'sim') return;

  const moduleId = findNearestModule();
  if (!moduleId) return;

  try {
    await apiRequest('/api/uhf/ping', 'POST', {
      item_uid: selectedTrackedUid,
      module_id: moduleId
    });
  } catch (err) {
    console.warn('Ping failed:', err);
  }
}

// Event Listeners
document.getElementById('backHomeBtn').onclick = () => switchView('home');
document.getElementById('openSimulatorBtn').onclick = () => switchView('sim');
document.getElementById('backFromSimBtn').onclick = () => switchView('home');

document.getElementById('toggleHistoryBtn').onclick = () => {
  historyPanel.classList.toggle('hidden');
};

toggleEditBtn.onclick = () => {
  simEditMode = !simEditMode;
  if (!simEditMode) deleteModuleMode = false;
  toggleEditBtn.textContent = simEditMode ? 'Exit Editor' : 'Edit Gateways';
  toggleEditBtn.classList.toggle('active', simEditMode);
  renderAll();
};

toggleDeleteModeBtn.onclick = () => {
  if (!simEditMode) return;
  deleteModuleMode = !deleteModuleMode;
  renderAll();
};

trackedItemSelect.onchange = (e) => {
  selectedTrackedUid = e.target.value || null;
};

bgImageInput.onchange = (e) => {
  if (!simEditMode) return;
  const [file] = e.target.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    floorplanDataUrl = reader.result;
    renderAll();
  };
  reader.readAsDataURL(file);
};

bgScaleInput.oninput = () => {
  floorplanScale = clamp(Number(bgScaleInput.value) || 100, 25, 250);
  renderCanvas();
  renderControls();
};

clearBgBtn.onclick = () => {
  floorplanDataUrl = null;
  floorplanScale = 100;
  bgImageInput.value = '';
  renderAll();
};

simCanvas.onclick = async (e) => {
  if (!simEditMode || deleteModuleMode) return;

  const rect = simCanvas.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);

  const name = prompt('Gateway label:', `UHF Node ${appState.uhf_modules.length + 1}`);
  if (!name) return;

  const location = prompt('Location description (e.g. Hallway 3B):', name) || name;

  try {
    await apiRequest('/api/uhf/modules', 'POST', { name, location, x, y });
  } catch (err) {
    alert(`Could not create module: ${err.message}`);
  }
};

simCanvas.onmousemove = (e) => {
  if (simEditMode) return;
  const rect = simCanvas.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);

  if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
    tagPosition = { x, y };
    renderTagCursor();
  }
};

simCanvas.onmouseleave = () => {
  if (!simEditMode) tagCursor.classList.add('hidden');
};

simCanvas.onmouseenter = () => {
  if (!simEditMode) renderTagCursor();
};

document.getElementById('cancelRegisterBtn').onclick = closeRegistration;

document.getElementById('saveRegisterBtn').onclick = async () => {
  const uid = registrationUidText.textContent.trim();
  const name = itemNameInput.value.trim();
  const folder_id = folderSelect.value;

  if (!uid || !name) return;

  try {
    await apiRequest('/api/items', 'POST', { uid, name, folder_id });
    nfcStatus.textContent = `Registered: ${name}`;
    nfcStatus.className = 'status-box ready';
    closeRegistration();
  } catch (err) {
    alert(`Registration failed: ${err.message}`);
  }
};

// WebSockets
socket.on('connect', () => {
  console.log('[Socket] Connected to backend');
});

socket.on('state_update', (latestState) => {
  appState = latestState;
  renderAll();
});

socket.on('tag_scanned', ({ uid }) => {
  const existing = appState.items[uid];
  nfcStatus.textContent = existing ? `Scanned: ${existing.name}` : `New tag detected: ${uid}`;
  nfcStatus.className = 'status-box ready';
  openRegistration(uid);
});

// Init
async function startup() {
  try {
    appState = await apiRequest('/api/state');
    renderAll();
    switchView('home');
    pingInterval = setInterval(sendPositionPing, 4000);
  } catch (err) {
    console.error('Failed to initialize app state:', err);
  }
}

startup();
