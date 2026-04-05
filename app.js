// ============================================================
//  app.js
//  Hospital Tracker — Frontend logic
// ============================================================

// ============================================================
//  SECTION: GLOBAL STATE
// ============================================================
const socket = io();
let appState = { folders: [], items: {}, uhf_modules: [], uhf_history: [], pending_tag: null };
let currentFolderId = null;
let currentView = 'home';
let simEditMode = true;
let deleteModuleMode = false;
let selectedTrackedUid = null;
let tagPosition = { x: 120, y: 120 };
let pingIntervalId = null;
let backgroundImageDataUrl = null;
let backgroundScalePercent = 100;

// ============================================================
//  SECTION: DOM REFERENCES
// ============================================================
const homeView = document.getElementById('homeView');
const folderView = document.getElementById('folderView');
const simulatorView = document.getElementById('simulatorView');
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

// ============================================================
//  SECTION: BASIC HELPERS
// ============================================================
function showView(name) {
  currentView = name;
  [homeView, folderView, simulatorView].forEach(v => v.classList.remove('active'));
  if (name === 'home') homeView.classList.add('active');
  if (name === 'folder') folderView.classList.add('active');
  if (name === 'sim') simulatorView.classList.add('active');
  renderTagCursor();
}

function folderItems(folderId) {
  return Object.values(appState.items).filter(item => item.folder_id === folderId);
}

function getFolderName(folderId) {
  const folder = appState.folders.find(f => f.id === folderId);
  return folder ? folder.name : 'Unassigned';
}

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ============================================================
//  SECTION: RENDER — SIDEBAR + FOLDERS
// ============================================================
function renderFolders() {
  folderGrid.innerHTML = '';

  appState.folders.forEach(folder => {
    const count = folderItems(folder.id).length;
    const tile = document.createElement('div');
    tile.className = 'folder-tile';
    tile.innerHTML = `
      <div class="folder-icon"></div>
      <div class="folder-name">${folder.name}</div>
      <div class="folder-count">${count} item${count === 1 ? '' : 's'}</div>
    `;
    tile.addEventListener('click', () => {
      currentFolderId = folder.id;
      renderFolderView();
      showView('folder');
    });
    folderGrid.appendChild(tile);
  });

  const simTile = document.createElement('div');
  simTile.className = 'folder-tile';
  simTile.innerHTML = `
    <div class="sim-launch-icon"></div>
    <div class="folder-name">Simulated UHF</div>
    <div class="folder-count">Open UHF demo area</div>
  `;
  simTile.addEventListener('click', () => showView('sim'));
  folderGrid.appendChild(simTile);
}

function renderFolderOptions() {
  folderSelect.innerHTML = '';
  appState.folders.forEach(folder => {
    const opt = document.createElement('option');
    opt.value = folder.id;
    opt.textContent = folder.name;
    folderSelect.appendChild(opt);
  });
}

function renderFolderView() {
  const folder = appState.folders.find(f => f.id === currentFolderId);
  if (!folder) return;

  folderTitle.textContent = folder.name;
  const items = folderItems(folder.id);
  folderItemList.innerHTML = '';

  if (!items.length) {
    folderItemList.innerHTML = '<div class="hero-card"><p>No equipment in this folder yet.</p></div>';
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
        <div class="status-pill ${item.status === 'IN' ? 'in' : 'out'}">${item.status === 'IN' ? 'In use' : 'Out of use'}</div>
      </div>
      <div class="location-box">
        <div><strong>Last confirmed location</strong></div>
        <div>${item.last_confirmed_location || 'Unknown'}</div>
      </div>
    `;
    folderItemList.appendChild(card);
  });
}

// ============================================================
//  SECTION: RENDER — UHF SIMULATION
// ============================================================
function renderTrackedItemOptions() {
  const items = Object.values(appState.items);
  trackedItemSelect.innerHTML = '';

  if (!items.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No registered equipment';
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

  if (!selectedTrackedUid || !items.some(item => item.uid === selectedTrackedUid)) {
    selectedTrackedUid = items[0].uid;
  }
  trackedItemSelect.value = selectedTrackedUid;
}

function renderHistory() {
  historyList.innerHTML = '';
  const entries = [...appState.uhf_history].slice().reverse();
  entries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-entry';
    div.textContent = `${formatTime(entry.timestamp)} — ${entry.item_name} pinged ${entry.module_name}`;
    historyList.appendChild(div);
  });
}

function renderBackgroundImage() {
  if (!backgroundImageDataUrl) {
    simBackgroundImage.classList.add('hidden');
    simBackgroundImage.removeAttribute('src');
    return;
  }

  simBackgroundImage.src = backgroundImageDataUrl;
  simBackgroundImage.classList.remove('hidden');
  simBackgroundImage.style.width = `${backgroundScalePercent}%`;
}

function renderModules() {
  [...simCanvas.querySelectorAll('.sim-module')].forEach(el => el.remove());

  appState.uhf_modules.forEach(module => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sim-module';
    el.style.left = `${module.x}px`;
    el.style.top = `${module.y}px`;
    el.innerHTML = `<span>${module.name}</span>`;

    if (simEditMode && deleteModuleMode) {
      el.classList.add('delete-ready');
    }

    el.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!(simEditMode && deleteModuleMode)) return;
      await api(`/api/uhf/modules/${module.id}`, { method: 'DELETE' });
    });

    simCanvas.appendChild(el);
  });
}

function renderTagCursor() {
  if (simEditMode || currentView !== 'sim') {
    tagCursor.classList.add('hidden');
    simCanvasWrap.classList.add('editor-mode');
    simCanvasWrap.classList.remove('tracker-mode');
    cursorModeLabel.textContent = deleteModuleMode ? 'Editor — delete modules' : 'Editor';
    return;
  }

  tagCursor.classList.remove('hidden');
  tagCursor.style.left = `${tagPosition.x}px`;
  tagCursor.style.top = `${tagPosition.y}px`;
  simCanvasWrap.classList.remove('editor-mode');
  simCanvasWrap.classList.add('tracker-mode');
  cursorModeLabel.textContent = 'RFID tag';
}

function renderEditorControls() {
  bgScaleInput.value = String(backgroundScalePercent);
  bgScaleLabel.textContent = `${backgroundScalePercent}%`;
  toggleDeleteModeBtn.classList.toggle('active', deleteModuleMode);
  toggleDeleteModeBtn.textContent = deleteModuleMode ? 'Exit delete mode' : 'Delete modules';
  toggleDeleteModeBtn.disabled = !simEditMode;
  bgImageInput.disabled = !simEditMode;
  bgScaleInput.disabled = !simEditMode || !backgroundImageDataUrl;
  clearBgBtn.disabled = !simEditMode || !backgroundImageDataUrl;
}

function renderAll() {
  renderFolders();
  renderFolderOptions();
  renderFolderView();
  renderTrackedItemOptions();
  renderHistory();
  renderBackgroundImage();
  renderModules();
  renderEditorControls();
  renderTagCursor();

  if (appState.pending_tag) {
    openRegistrationModal(appState.pending_tag.uid);
  }
}

// ============================================================
//  SECTION: NFC REGISTRATION FLOW
// ============================================================
function openRegistrationModal(uid) {
  registrationUidText.textContent = uid;
  itemNameInput.value = '';
  registrationModal.classList.remove('hidden');
}

function closeRegistrationModal() {
  registrationModal.classList.add('hidden');
}

// ============================================================
//  SECTION: UHF PING CALCULATION
// ============================================================
function strongestModuleId() {
  if (!appState.uhf_modules.length) return null;

  let bestModule = null;
  let bestScore = -Infinity;

  appState.uhf_modules.forEach(module => {
    const dx = tagPosition.x - module.x;
    const dy = tagPosition.y - module.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const score = -distance;
    if (score > bestScore) {
      bestScore = score;
      bestModule = module;
    }
  });

  return bestModule ? bestModule.id : null;
}

async function sendUhfPing() {
  if (!selectedTrackedUid || simEditMode || currentView !== 'sim') return;
  const moduleId = strongestModuleId();
  await api('/api/uhf/ping', {
    method: 'POST',
    body: JSON.stringify({ uid: selectedTrackedUid, strongest_module_id: moduleId })
  });
}

function startPingLoop() {
  if (pingIntervalId) clearInterval(pingIntervalId);
  pingIntervalId = setInterval(() => {
    sendUhfPing().catch(console.error);
  }, 5000);
}

// ============================================================
//  SECTION: EVENTS
// ============================================================
document.getElementById('addFolderBtn').addEventListener('click', async () => {
  const name = prompt('Enter folder name');
  if (!name) return;
  await api('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
});

document.getElementById('backHomeBtn').addEventListener('click', () => showView('home'));
document.getElementById('openSimulatorBtn').addEventListener('click', () => showView('sim'));
document.getElementById('backFromSimBtn').addEventListener('click', () => showView('home'));

document.getElementById('toggleHistoryBtn').addEventListener('click', () => {
  historyPanel.classList.toggle('hidden');
});

toggleEditBtn.addEventListener('click', () => {
  simEditMode = !simEditMode;
  if (!simEditMode) deleteModuleMode = false;
  toggleEditBtn.textContent = simEditMode ? 'Exit editor' : 'Open editor';
  toggleEditBtn.classList.toggle('active', simEditMode);
  renderAll();
});

toggleDeleteModeBtn.addEventListener('click', () => {
  if (!simEditMode) return;
  deleteModuleMode = !deleteModuleMode;
  renderAll();
});

trackedItemSelect.addEventListener('change', (e) => {
  selectedTrackedUid = e.target.value || null;
});

bgImageInput.addEventListener('change', (event) => {
  if (!simEditMode) return;
  const [file] = event.target.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    backgroundImageDataUrl = reader.result;
    renderAll();
  };
  reader.readAsDataURL(file);
});

bgScaleInput.addEventListener('input', () => {
  backgroundScalePercent = clamp(Number(bgScaleInput.value) || 100, 25, 250);
  renderBackgroundImage();
  renderEditorControls();
});

clearBgBtn.addEventListener('click', () => {
  backgroundImageDataUrl = null;
  backgroundScalePercent = 100;
  bgImageInput.value = '';
  renderAll();
});

simCanvas.addEventListener('click', async (e) => {
  if (!simEditMode || deleteModuleMode) return;

  const rect = simCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const name = prompt('Module name', `UHF Module ${appState.uhf_modules.length + 1}`);
  if (!name) return;

  await api('/api/uhf/modules', {
    method: 'POST',
    body: JSON.stringify({ name, x, y })
  });
});

simCanvas.addEventListener('mousemove', (e) => {
  if (simEditMode) return;
  const rect = simCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
  tagPosition = { x, y };
  renderTagCursor();
});

simCanvas.addEventListener('mouseleave', () => {
  if (simEditMode) return;
  tagCursor.classList.add('hidden');
});

simCanvas.addEventListener('mouseenter', () => {
  renderTagCursor();
});

document.getElementById('cancelRegisterBtn').addEventListener('click', closeRegistrationModal);
document.getElementById('saveRegisterBtn').addEventListener('click', async () => {
  const uid = registrationUidText.textContent.trim();
  const name = itemNameInput.value.trim();
  const folder_id = folderSelect.value;
  if (!uid || !name || !folder_id) return;

  await api('/api/items/register', {
    method: 'POST',
    body: JSON.stringify({ uid, name, folder_id })
  });
  nfcStatus.textContent = `Registered ${name}`;
  nfcStatus.className = 'status-box ready';
  closeRegistrationModal();
});

// ============================================================
//  SECTION: SOCKET EVENTS
// ============================================================
socket.on('connect', () => {
  console.log('Connected to backend');
});

socket.on('state_update', (nextState) => {
  appState = nextState;
  renderAll();
});

socket.on('nfc_tag_detected', ({ uid }) => {
  const known = !!appState.items[uid];
  nfcStatus.textContent = known
    ? `NFC read: ${uid} — status toggled`
    : `New NFC tag detected: ${uid}`;
  nfcStatus.className = 'status-box ready';
});

// ============================================================
//  SECTION: INITIAL LOAD
// ============================================================
async function init() {
  appState = await api('/api/state');
  renderAll();
  showView('home');
  startPingLoop();
}

init().catch(console.error);
