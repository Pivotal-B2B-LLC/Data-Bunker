'use strict';
/* Data Banker Popup v7.0 — Premium unified panel */

const $ = id => document.getElementById(id);
const serverPill = $('serverPill'), serverLabel = $('serverLabel');
const siteBar = $('siteBar'), siteIcon = $('siteIcon'), siteHost = $('siteHost'), siteBadge = $('siteBadge');
const idlePanel = $('idlePanel');
const mainPanel = $('mainPanel');
const settingsPanel = $('settingsPanel');
const queuePanel = $('queuePanel');

const ICONS = {
  linkedin:'💼', apollo:'🚀', maps:'🗺️', opencorporates:'🏛️',
  yelp:'⭐', yellowpages:'📒', crunchbase:'📈', zoominfo:'🔬',
  hunter:'🎯', generic:'🌐'
};

const STRATEGY_TO_TAB = {
  linkedin:'linkedin', apollo:'apollo', opencorporates:'opencorporates',
  maps:'other', yelp:'other', yellowpages:'other',
  crunchbase:'other', zoominfo:'other', hunter:'other', generic:'other',
};

let currentTab = 'linkedin';
let currentStrategy = 'generic';
function fmt(n) { return Number(n || 0).toLocaleString(); }

// API URL
let API_BASE = 'http://localhost:5000';
let DASH_BASE = 'http://localhost:3000';

function applyServerUrl(url) {
  API_BASE = url || 'http://localhost:5000';
  try {
    const u = new URL(API_BASE);
    DASH_BASE = u.hostname === 'localhost' ? 'http://localhost:3000' : u.protocol + '//' + u.hostname;
  } catch(e) { DASH_BASE = 'http://localhost:3000'; }
  const link = DASH_BASE + '/contacts';
  ['dashLinkLinkedIn','dashLinkApollo','dashLinkOC','dashLinkOther'].forEach(id => {
    if ($(id)) $(id).href = link;
  });
}

chrome.storage.sync.get(['serverUrl'], ({ serverUrl }) => {
  applyServerUrl(serverUrl || 'http://localhost:5000');
  if ($('serverUrlInput')) $('serverUrlInput').value = API_BASE;
});

// Settings
$('btnSettings').addEventListener('click', () => {
  const open = !settingsPanel.classList.contains('hidden');
  if (open) { settingsPanel.classList.add('hidden'); }
  else { $('serverUrlInput').value = API_BASE; $('settingsSaved').classList.add('hidden'); settingsPanel.classList.remove('hidden'); }
});
$('btnCancelSettings').addEventListener('click', () => settingsPanel.classList.add('hidden'));
$('btnSaveServer').addEventListener('click', async () => {
  const url = $('serverUrlInput').value.trim().replace(/\/$/, '');
  if (!url) return;
  await chrome.storage.sync.set({ serverUrl: url });
  applyServerUrl(url);
  const saved = $('settingsSaved');
  saved.className = 'toast ok'; saved.textContent = '\u2713 Saved';
  saved.classList.remove('hidden');
  setTimeout(() => settingsPanel.classList.add('hidden'), 1500);
});

// Tab Switcher
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-bar .tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.mode-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === 'tab-' + tab);
  });
}

document.querySelectorAll('.tab-bar .tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function showMain(tab) {
  idlePanel.classList.add('hidden');
  mainPanel.classList.remove('hidden');
  switchTab(tab);
}

function showIdle() {
  mainPanel.classList.add('hidden');
  idlePanel.classList.remove('hidden');
}

// Auto-detect
async function detect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://')) { showIdle(); return; }
    const state = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_STATE' }).catch(() => null);
    if (!state) { showIdle(); return; }
    currentStrategy = state.strategy || 'generic';
    try {
      const u = new URL(tab.url);
      siteHost.textContent = u.hostname.replace('www.', '');
      siteBadge.textContent = state.siteLabel || 'Page';
      siteIcon.textContent = ICONS[state.strategy] || '\U0001f310';
      siteBar.classList.remove('hidden');
    } catch(e) {}
    const tabToShow = STRATEGY_TO_TAB[state.strategy] || 'other';
    showMain(tabToShow);
    if (tabToShow === 'linkedin') {
      renderFilters(state.filters || {});
      if (state.totalResults > 0) $('statTotal').textContent = fmt(state.totalResults);
      chrome.tabs.sendMessage(tab.id, { action: 'SCAN' }).then(r => {
        if (r?.count > 0) {
          $('detectedBar').classList.remove('hidden');
          $('detectedLabel').textContent = r.count + ' leads detected on this page';
        }
      }).catch(() => {});
      await syncLinkedIn();
    } else if (tabToShow === 'apollo') {
      await syncApollo();
    } else if (tabToShow === 'opencorporates') {
      await syncOC();
    }
  } catch(e) { showIdle(); }
}

// ===== LINKEDIN TAB =====
const btnStart = $('btnStart'), btnStop = $('btnStop');
const btnLiScan = $('btnLiScan'), liSaveResult = $('liSaveResult');
const filtersRow = $('filtersRow');
const progressFill = $('progressFill'), progressPct = $('progressPct'), progressSub = $('progressSub');
const statSaved = $('statSaved'), statPages = $('statPages'), statErrors = $('statErrors'), statTotal = $('statTotal');
const detectedBar = $('detectedBar'), detectedLabel = $('detectedLabel');
const statusMsg = $('statusMsg');

btnStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.storage.local.set({ scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
  await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTO' }).catch(() => {});
  await syncLinkedIn();
});

btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { action: 'STOP' }).catch(() => {});
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (scraperStats) { scraperStats.status = 'idle'; await chrome.storage.local.set({ scraperStats }); }
  await syncLinkedIn();
});

btnLiScan.addEventListener('click', async () => {
  btnLiScan.disabled = true; btnLiScan.textContent = '\u27F3 Scanning & saving\u2026';
  liSaveResult.classList.add('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { liDone('err', 'No active tab'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) liDone('ok', '\u2713 Saved ' + (r.saved || 0) + ' leads' + (r.skipped ? ' \u00b7 ' + r.skipped + ' dupes' : ''));
  else liDone('err', '\u2717 ' + (r?.error || 'Unknown error'));
  function liDone(cls, text) {
    btnLiScan.disabled = false; btnLiScan.textContent = '\U0001f50d Scan & Save This Page Only';
    liSaveResult.className = 'toast ' + cls; liSaveResult.textContent = text; liSaveResult.classList.remove('hidden');
  }
});

async function syncLinkedIn() {
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (!scraperStats) return;
  const { status, pagesProcessed = 0, totalSaved = 0, totalErrors = 0, totalResults = 0, pageNum = 0, detectedThisPage } = scraperStats;
  statSaved.textContent = fmt(totalSaved);
  statPages.textContent = fmt(pagesProcessed);
  statErrors.textContent = fmt(totalErrors);
  if (totalResults) statTotal.textContent = fmt(totalResults);
  const totalPages = totalResults ? Math.ceil(totalResults / 10) : 0;
  const pct = totalPages ? Math.min(Math.round(pageNum / totalPages * 100), 100) : 0;
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  progressSub.textContent = pagesProcessed ? 'Page ' + pageNum + ' \u00b7 ' + fmt(totalSaved) + ' leads saved' : 'Waiting\u2026';
  if (detectedThisPage != null) { detectedBar.classList.remove('hidden'); detectedLabel.textContent = detectedThisPage + ' leads on current page'; }
  statusMsg.className = 'status-badge';
  if (status === 'running') { statusMsg.className += ' running'; statusMsg.textContent = '\u26A1 Scraping\u2026 ' + fmt(totalSaved) + ' saved'; }
  else if (status === 'done') { statusMsg.className += ' done'; statusMsg.textContent = '\u2705 Done! ' + fmt(totalSaved) + ' leads saved'; }
  else if (status === 'error') { statusMsg.className += ' error'; statusMsg.textContent = '\u274C Error \u2014 check console'; }
  else { statusMsg.textContent = 'Ready \u2014 press Start to begin'; }
  btnStart.disabled = status === 'running';
  btnStop.disabled = status !== 'running';
}

function renderFilters(f) {
  const pills = [];
  if (f.keywords) pills.push(['\U0001f50d', f.keywords]);
  if (f.activeFilters) f.activeFilters.forEach(x => pills.push(['\u25CF', x]));
  if (f.connectionDegree) pills.push(['\U0001f517', f.connectionDegree + ' degree']);
  filtersRow.innerHTML = pills.length
    ? pills.map(([i, l]) => '<span class="filter-pill">' + i + ' ' + l.replace(/</g, '&lt;') + '</span>').join('')
    : '<span class="no-filters">No filters detected</span>';
}

setInterval(() => { if (currentTab === 'linkedin') syncLinkedIn(); }, 800);

// ===== APOLLO TAB =====
const btnApStart = $('btnApStart'), btnApStop = $('btnApStop'), btnApScan = $('btnApScan');
const apStatus = $('apStatus'), apSaveResult = $('apSaveResult');
const apSaved = $('apSaved'), apPages = $('apPages'), apTotal = $('apTotal');

btnApStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.storage.local.set({ scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
  await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTO' }).catch(() => {});
  btnApStart.disabled = true; btnApStop.disabled = false;
  apStatus.className = 'status-badge running'; apStatus.textContent = '\u26A1 Scraping Apollo\u2026';
  await syncApollo();
});

btnApStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { action: 'STOP' }).catch(() => {});
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (scraperStats) { scraperStats.status = 'idle'; await chrome.storage.local.set({ scraperStats }); }
  btnApStart.disabled = false; btnApStop.disabled = true;
  apStatus.className = 'status-badge'; apStatus.textContent = 'Stopped';
});

btnApScan.addEventListener('click', async () => {
  btnApScan.disabled = true; btnApScan.textContent = '\u27F3 Scanning\u2026';
  apSaveResult.classList.add('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { apDone('err', 'No active tab'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) apDone('ok', '\u2713 Saved ' + (r.saved || 0) + ' leads');
  else apDone('err', '\u2717 ' + (r?.error || 'Unknown error'));
  function apDone(cls, text) {
    btnApScan.disabled = false; btnApScan.textContent = '\U0001f50d Scan & Save This Page Only';
    apSaveResult.className = 'toast ' + cls; apSaveResult.textContent = text; apSaveResult.classList.remove('hidden');
  }
});

async function syncApollo() {
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (!scraperStats) return;
  apSaved.textContent = fmt(scraperStats.totalSaved || 0);
  apPages.textContent = fmt(scraperStats.pagesProcessed || 0);
  if (scraperStats.totalResults) apTotal.textContent = fmt(scraperStats.totalResults);
  if (scraperStats.status === 'done') {
    apStatus.className = 'status-badge done'; apStatus.textContent = '\u2705 Done! ' + fmt(scraperStats.totalSaved) + ' leads saved';
    btnApStart.disabled = false; btnApStop.disabled = true;
  } else if (scraperStats.status === 'running') {
    apStatus.className = 'status-badge running'; apStatus.textContent = '\u26A1 Scraping\u2026 ' + fmt(scraperStats.totalSaved || 0) + ' saved';
    btnApStart.disabled = true; btnApStop.disabled = false;
  }
}
setInterval(() => { if (currentTab === 'apollo') syncApollo(); }, 800);

// ===== OPENCORPORATES TAB =====
const btnOcToggle = $('btnOcToggle'), btnOcScan = $('btnOcScan');
const btnOcSearch = $('btnOcSearch');
const ocSearchInput = $('ocSearchInput'), ocJurisdiction = $('ocJurisdiction');
const ocStatus = $('ocStatus'), ocSaveResult = $('ocSaveResult');
const ocSaved = $('ocSaved'), ocPages = $('ocPages'), ocTotal = $('ocTotal');
let ocRunning = false;

btnOcSearch.addEventListener('click', () => ocDoSearch());
ocSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ocDoSearch(); } });

async function ocDoSearch() {
  const q = ocSearchInput.value.trim();
  if (!q) return;
  const jur = ocJurisdiction.value;
  let url = 'https://opencorporates.com/companies';
  if (jur) url += '/' + jur;
  url += '?q=' + encodeURIComponent(q);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, { url });
  window.close();
}

function setOcToggle(running) {
  ocRunning = running;
  if (running) {
    btnOcToggle.textContent = '\u23F9  STOP SCRAPING';
    btnOcToggle.className = 'btn btn-danger';
    btnOcToggle.style.flex = '1';
  } else {
    btnOcToggle.textContent = '\u25B6  START SCRAPING';
    btnOcToggle.className = 'btn btn-accent';
    btnOcToggle.style.flex = '1';
  }
}

btnOcToggle.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (ocRunning) {
    // STOP
    await chrome.tabs.sendMessage(tab.id, { action: 'STOP' }).catch(() => {});
    await chrome.storage.local.remove(['pendingAutoStart', 'pendingTabId']).catch(() => {});
    const { scraperStats } = await chrome.storage.local.get('scraperStats');
    if (scraperStats) { scraperStats.status = 'idle'; await chrome.storage.local.set({ scraperStats }); }
    setOcToggle(false);
    ocStatus.className = 'status-badge'; ocStatus.textContent = 'Stopped';
  } else {
    // START
    await chrome.storage.local.set({ scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
    await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTO' }).catch(() => {});
    setOcToggle(true);
    ocStatus.className = 'status-badge running'; ocStatus.textContent = '\u26A1 Scraping OpenCorporates\u2026';
    await syncOC();
  }
});

btnOcScan.addEventListener('click', async () => {
  btnOcScan.disabled = true; btnOcScan.textContent = '\u27F3 Scanning\u2026';
  ocSaveResult.classList.add('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { ocDone('err', 'No active tab'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) ocDone('ok', '\u2713 Saved ' + (r.saved || 0) + ' records' + (r.skipped ? ' \u00b7 ' + r.skipped + ' dupes' : ''));
  else ocDone('err', '\u2717 ' + (r?.error || 'Unknown error'));
  function ocDone(cls, text) {
    btnOcScan.disabled = false; btnOcScan.textContent = '\uD83D\uDD0D Scan Page';
    ocSaveResult.className = 'toast ' + cls; ocSaveResult.textContent = text; ocSaveResult.classList.remove('hidden');
  }
});

async function syncOC() {
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (!scraperStats) return;
  ocSaved.textContent = fmt(scraperStats.totalSaved || 0);
  ocPages.textContent = fmt(scraperStats.pagesProcessed || 0);
  if (scraperStats.totalResults) ocTotal.textContent = fmt(scraperStats.totalResults);
  if (scraperStats.status === 'done') {
    ocStatus.className = 'status-badge done'; ocStatus.textContent = '\u2705 Done! ' + fmt(scraperStats.totalSaved) + ' records saved';
    setOcToggle(false);
  } else if (scraperStats.status === 'running') {
    ocStatus.className = 'status-badge running';
    ocStatus.textContent = '\u26A1 Page ' + (scraperStats.pageNum || 1) + ' \u00b7 ' + fmt(scraperStats.totalSaved || 0) + ' saved';
    setOcToggle(true);
  } else {
    setOcToggle(false);
  }
}
setInterval(() => { if (currentTab === 'opencorporates') syncOC(); }, 800);

// ===== OTHER TAB =====
const btnOtherScan = $('btnOtherScan');
const otherScanResult = $('otherScanResult');
const otherExtractSection = $('otherExtractSection');
const btnOtherExtract = $('btnOtherExtract');
const otherSaveResult = $('otherSaveResult');
const btnOtherStart = $('btnOtherStart'), btnOtherStop = $('btnOtherStop');
const otherAutoStatus = $('otherAutoStatus');

btnOtherScan.addEventListener('click', async () => {
  btnOtherScan.disabled = true; btnOtherScan.textContent = '\u27F3 Scanning\u2026';
  otherScanResult.className = 'toast'; otherScanResult.classList.remove('hidden');
  otherScanResult.textContent = 'Analysing page\u2026';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { scanFail('No active tab'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN' }).catch(() => null);
  btnOtherScan.disabled = false; btnOtherScan.textContent = '\U0001f50d Scan This Page for Leads';
  if (!r?.ok || !r.count) {
    otherScanResult.className = 'toast err';
    otherScanResult.textContent = '\u2717 No leads found. Scroll down, then try again.';
    otherExtractSection.classList.add('hidden'); return;
  }
  otherScanResult.className = 'toast ok';
  otherScanResult.textContent = '\u2713 Found ' + r.count + ' potential leads';
  otherExtractSection.classList.remove('hidden');
  function scanFail(msg) {
    btnOtherScan.disabled = false; btnOtherScan.textContent = '\U0001f50d Scan This Page for Leads';
    otherScanResult.className = 'toast err'; otherScanResult.textContent = '\u2717 ' + msg;
  }
});

btnOtherExtract.addEventListener('click', async () => {
  btnOtherExtract.disabled = true; btnOtherExtract.textContent = '\u27F3 Extracting\u2026';
  otherSaveResult.classList.add('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { extDone('err', 'No active tab'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) extDone('ok', '\u2713 Saved ' + (r.saved || 0) + ' leads' + (r.skipped ? ' \u00b7 ' + r.skipped + ' dupes' : ''));
  else extDone('err', '\u2717 ' + (r?.error || 'Unknown error'));
  function extDone(cls, text) {
    btnOtherExtract.disabled = false; btnOtherExtract.textContent = '\u26A1 Extract & Save All Leads';
    otherSaveResult.className = 'toast ' + cls; otherSaveResult.textContent = text; otherSaveResult.classList.remove('hidden');
  }
});

btnOtherStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.storage.local.set({ scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
  await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTO' }).catch(() => {});
  btnOtherStart.disabled = true; btnOtherStop.disabled = false;
  otherAutoStatus.className = 'status-badge running'; otherAutoStatus.textContent = '\u26A1 Auto-scraping\u2026';
});

btnOtherStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { action: 'STOP' }).catch(() => {});
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (scraperStats) { scraperStats.status = 'idle'; await chrome.storage.local.set({ scraperStats }); }
  btnOtherStart.disabled = false; btnOtherStop.disabled = true;
  otherAutoStatus.className = 'status-badge'; otherAutoStatus.textContent = 'Stopped';
});

setInterval(async () => {
  if (currentTab !== 'other') return;
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (!scraperStats) return;
  if (scraperStats.status === 'done') {
    otherAutoStatus.className = 'status-badge done';
    otherAutoStatus.textContent = '\u2705 Done! ' + fmt(scraperStats.totalSaved) + ' leads saved';
    btnOtherStart.disabled = false; btnOtherStop.disabled = true;
  } else if (scraperStats.status === 'running') {
    otherAutoStatus.className = 'status-badge running';
    otherAutoStatus.textContent = '\u26A1 Page ' + (scraperStats.pagesProcessed || 1) + ' \u00b7 ' + fmt(scraperStats.totalSaved || 0) + ' saved';
    btnOtherStart.disabled = true; btnOtherStop.disabled = false;
  }
}, 800);

// ===== Server health =====
async function checkServer() {
  try {
    const r = await fetch(API_BASE + '/health', { signal: AbortSignal.timeout(3000) });
    serverPill.className = 'status-chip ' + (r.ok ? 'online' : 'offline');
    serverLabel.textContent = r.ok ? 'connected' : 'no server';
  } catch(e) {
    serverPill.className = 'status-chip offline'; serverLabel.textContent = 'offline';
  }
}

// ===== Init =====
(async function init() {
  await checkServer();
  await detect();
  setInterval(checkServer, 8000);
  await loadQueue();
})();

// ===== GO TO URL =====
const goUrlInput = $('goUrlInput'), btnGoUrl = $('btnGoUrl'), btnAddQueue = $('btnAddQueue');

async function goToUrl(url) {
  if (!url) return;
  try { new URL(url); } catch(e) { return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.storage.local.set({ pendingAutoStart: true, pendingTabId: tab.id });
  await chrome.tabs.update(tab.id, { url });
  window.close();
}

btnGoUrl.addEventListener('click', () => goToUrl(goUrlInput.value.trim()));
goUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goToUrl(goUrlInput.value.trim()); } });

// ===== QUEUE =====
const queueUrlInput = $('queueUrlInput'), btnQueueAdd = $('btnQueueAdd'), btnQueueClear = $('btnQueueClear');
const queueListEl = $('queueList'), queueStatusEl = $('queueStatus');
let queue = [];

async function loadQueue() {
  const { scrapeQueue } = await chrome.storage.local.get('scrapeQueue');
  if (scrapeQueue) queue = scrapeQueue;
  renderQueue();
}

async function saveQueue() {
  await chrome.storage.local.set({ scrapeQueue: queue });
  renderQueue();
}

function renderQueue() {
  if (queue.length === 0) { queuePanel.classList.add('hidden'); queueStatusEl.classList.add('hidden'); return; }
  queuePanel.classList.remove('hidden');
  queueListEl.innerHTML = queue.map((q, i) => {
    const icon = q.status === 'done' ? '\u2705' : q.status === 'active' ? '\u26A1' : q.status === 'failed' ? '\u274C' : '\u23F3';
    const cls = q.status === 'active' ? 'active' : q.status === 'done' ? 'done' : q.status === 'failed' ? 'failed' : '';
    let label = '';
    try { const u = new URL(q.url); label = u.hostname.replace('www.','') + u.pathname.slice(0,30); } catch(e) { label = q.url.slice(0,40); }
    if (q.saved) label += ' (' + q.saved + ' saved)';
    return '<div class="q-item ' + cls + '"><span class="q-icon">' + icon + '</span><span class="q-url ' + cls + '" title="' + q.url.replace(/"/g,'&quot;') + '">' + label + '</span>' + (q.status === 'pending' ? '<button class="q-remove" data-idx="' + i + '">\u00d7</button>' : '') + '</div>';
  }).join('');
  queueListEl.querySelectorAll('.q-remove').forEach(btn => {
    btn.addEventListener('click', async () => { queue.splice(parseInt(btn.dataset.idx), 1); await saveQueue(); });
  });
  const active = queue.filter(q => q.status === 'active').length;
  const pending = queue.filter(q => q.status === 'pending').length;
  const done = queue.filter(q => q.status === 'done').length;
  queueStatusEl.classList.remove('hidden');
  if (active > 0) { queueStatusEl.className = 'status-badge running'; queueStatusEl.textContent = '\u26A1 Scraping \u2014 ' + pending + ' waiting\u2026'; }
  else if (pending > 0) { queueStatusEl.className = 'status-badge'; queueStatusEl.textContent = '\u23F3 ' + pending + ' queued'; }
  else { queueStatusEl.className = 'status-badge done'; queueStatusEl.textContent = '\u2705 All done \u2014 ' + done + ' scraped'; }
}

async function addToQueue(url) {
  if (!url) return;
  try { new URL(url); } catch(e) { return; }
  if (queue.some(q => q.url === url && q.status === 'pending')) return;
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  const isRunning = scraperStats?.status === 'running';
  if (!isRunning) {
    queue.push({ url, status: 'active', saved: 0 });
    await saveQueue();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.storage.local.set({ pendingAutoStart: true, pendingTabId: tab.id, scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
      await chrome.tabs.update(tab.id, { url });
      window.close();
    }
  } else {
    queue.push({ url, status: 'pending', saved: 0 });
    await saveQueue();
  }
}

btnQueueAdd.addEventListener('click', () => { addToQueue(queueUrlInput.value.trim()); queueUrlInput.value = ''; });
queueUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addToQueue(queueUrlInput.value.trim()); queueUrlInput.value = ''; } });
btnAddQueue.addEventListener('click', () => { addToQueue(goUrlInput.value.trim()); goUrlInput.value = ''; });
btnQueueClear.addEventListener('click', async () => { queue = []; await saveQueue(); });
