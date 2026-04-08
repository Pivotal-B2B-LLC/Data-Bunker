'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * DATA BUNKER — Popup v5.0
 * Clean single-page UI. Auto-detects site → shows LinkedIn or Universal panel.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const serverPill   = $('serverPill'), serverLabel = $('serverLabel');
const siteBar      = $('siteBar'), siteIcon = $('siteIcon'), siteHost = $('siteHost'), siteBadge = $('siteBadge');
const idlePanel    = $('idlePanel'), universalPanel = $('universalPanel'), linkedinPanel = $('linkedinPanel');
const settingsPanel = $('settingsPanel');
const btnScan      = $('btnScan'), scanResult = $('scanResult');
const extractSection = $('extractSection'), btnExtract = $('btnExtract'), saveResult = $('saveResult');
const filtersRow   = $('filtersRow');
const progressFill = $('progressFill'), progressPct = $('progressPct'), progressSub = $('progressSub');
const statSaved    = $('statSaved'), statPages = $('statPages'), statErrors = $('statErrors'), statTotal = $('statTotal');
const detectedBar  = $('detectedBar'), detectedLabel = $('detectedLabel');
const statusMsg    = $('statusMsg');
const btnStart     = $('btnStart'), btnStop = $('btnStop');
const btnLiScan    = $('btnLiScan'), liSaveResult = $('liSaveResult');

const ICONS = { linkedin:'💼', apollo:'🚀', maps:'🗺️', yelp:'⭐', yellowpages:'📒', crunchbase:'📈', zoominfo:'🔬', hunter:'🎯', generic:'🌐' };
let currentPanel = 'idle';

// ── API URL (loaded from storage, falls back to localhost) ────────────────────
let API_BASE = 'http://localhost:5000';
let DASH_BASE = 'http://localhost:3000';

function applyServerUrl(url) {
  API_BASE = url || 'http://localhost:5000';
  // Derive dashboard URL: same host, no port (or port 3000 for localhost)
  try {
    const u = new URL(API_BASE);
    DASH_BASE = u.hostname === 'localhost' ? 'http://localhost:3000' : `${u.protocol}//${u.hostname}`;
  } catch { DASH_BASE = 'http://localhost:3000'; }
  // Update dashboard links
  const link = `${DASH_BASE}/contacts`;
  if ($('dashLinkUniversal')) $('dashLinkUniversal').href = link;
  if ($('dashLinkLinkedIn')) $('dashLinkLinkedIn').href = link;
}

chrome.storage.sync.get(['serverUrl'], ({ serverUrl }) => {
  applyServerUrl(serverUrl || 'http://localhost:5000');
  if ($('serverUrlInput')) $('serverUrlInput').value = API_BASE;
});

// ── Settings panel ────────────────────────────────────────────────────────────
$('btnSettings').addEventListener('click', () => {
  const open = !settingsPanel.classList.contains('hidden');
  if (open) {
    settingsPanel.classList.add('hidden');
  } else {
    $('serverUrlInput').value = API_BASE;
    $('settingsSaved').classList.add('hidden');
    settingsPanel.classList.remove('hidden');
  }
});

$('btnCancelSettings').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

$('btnSaveServer').addEventListener('click', async () => {
  const url = $('serverUrlInput').value.trim().replace(/\/$/, '');
  if (!url) return;
  await chrome.storage.sync.set({ serverUrl: url });
  applyServerUrl(url);
  const saved = $('settingsSaved');
  saved.className = 'save-result ok';
  saved.textContent = '✓ Saved — reload any open tabs to apply';
  saved.classList.remove('hidden');
  setTimeout(() => settingsPanel.classList.add('hidden'), 2000);
});

function fmt(n) { return Number(n || 0).toLocaleString(); }

const settingsPanelEl = $('settingsPanel');
const apolloPanel = $('apolloPanel');
const queuePanel = $('queuePanel');

function showPanel(name) {
  currentPanel = name;
  [idlePanel, universalPanel, linkedinPanel, apolloPanel].forEach(p => p.classList.add('hidden'));
  ({ idle: idlePanel, universal: universalPanel, linkedin: linkedinPanel, apollo: apolloPanel })[name]?.classList.remove('hidden');
}

// ── Auto-detect ───────────────────────────────────────────────────────────────
async function detect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://')) { showPanel('idle'); return; }

    // Ask content script for page state
    const state = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_STATE' }).catch(() => null);
    if (!state) { showPanel('idle'); return; }

    // Show site bar
    try {
      const u = new URL(tab.url);
      siteHost.textContent = u.hostname.replace('www.', '');
      siteBadge.textContent = state.siteLabel;
      siteIcon.textContent = ICONS[state.strategy] || '🌐';
      siteBar.classList.remove('hidden');
    } catch {}

    if (state.isLinkedIn) {
      showPanel('linkedin');
      renderFilters(state.filters || {});
      if (state.totalResults > 0) statTotal.textContent = fmt(state.totalResults);
      // Quick scan to show detected count
      chrome.tabs.sendMessage(tab.id, { action: 'SCAN' }).then(r => {
        if (r?.count > 0) { detectedBar.classList.remove('hidden'); detectedLabel.textContent = r.count + ' leads detected on this page'; }
      }).catch(() => {});
    } else if (state.strategy === 'apollo') {
      showPanel('apollo');
    } else {
      showPanel('universal');
    }
  } catch { showPanel('idle'); }
}

// ── Universal: Scan ───────────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  btnScan.disabled = true; btnScan.textContent = '⟳ Scanning…';
  scanResult.className = 'scan-result'; scanResult.classList.remove('hidden');
  scanResult.textContent = 'Analysing page…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { fail('No active tab'); return; }

  const r = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN' }).catch(() => null);
  btnScan.disabled = false; btnScan.textContent = '🔍 Scan for Leads';

  if (!r?.ok || !r.count) {
    scanResult.className = 'scan-result err';
    scanResult.textContent = '✗ No leads found. Try scrolling down to load content, then scan again.';
    extractSection.classList.add('hidden');
    return;
  }

  scanResult.className = 'scan-result ok';
  scanResult.textContent = '✓ Found ' + r.count + ' potential leads';
  extractSection.classList.remove('hidden');

  function fail(msg) { btnScan.disabled = false; btnScan.textContent = '🔍 Scan for Leads'; scanResult.className = 'scan-result err'; scanResult.textContent = '✗ ' + msg; }
});

// ── Universal: Extract & Save ─────────────────────────────────────────────────
btnExtract.addEventListener('click', async () => {
  btnExtract.disabled = true; btnExtract.textContent = '⟳ Extracting & saving…';
  saveResult.classList.add('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { done('err', 'No active tab'); return; }

  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) {
    done('ok', '✓ Saved ' + (r.saved || 0) + ' leads' + (r.skipped ? ' · ' + r.skipped + ' duplicates' : '') + (r.enriched ? ' · ' + r.enriched + ' AI-enriched' : ''));
  } else {
    done('err', '✗ ' + (r?.error || 'Unknown error'));
  }

  function done(cls, text) {
    btnExtract.disabled = false; btnExtract.textContent = '⚡ Extract & Save to Database';
    saveResult.className = 'save-result ' + cls; saveResult.textContent = text; saveResult.classList.remove('hidden');
  }
});

// ── LinkedIn: Start Auto ──────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.storage.local.set({ scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
  await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTO' }).catch(() => {});
  syncStorage();
});

btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { action: 'STOP' }).catch(() => {});
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (scraperStats) { scraperStats.status = 'idle'; await chrome.storage.local.set({ scraperStats }); }
  syncStorage();
});

// ── LinkedIn: Scan & Save This Page ───────────────────────────────────────────
btnLiScan.addEventListener('click', async () => {
  btnLiScan.disabled = true; btnLiScan.textContent = '⟳ Scanning & saving…';
  liSaveResult.classList.add('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { liDone('err', 'No active tab'); return; }

  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) {
    liDone('ok', '✓ Saved ' + (r.saved || 0) + ' leads' + (r.skipped ? ' · ' + r.skipped + ' dupes' : ''));
  } else {
    liDone('err', '✗ ' + (r?.error || 'Unknown error'));
  }

  function liDone(cls, text) {
    btnLiScan.disabled = false; btnLiScan.textContent = '🔍 Scan & Save This Page Only';
    liSaveResult.className = 'save-result ' + cls; liSaveResult.textContent = text; liSaveResult.classList.remove('hidden');
  }
});

// ── LinkedIn storage sync ─────────────────────────────────────────────────────
async function syncStorage() {
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
  progressSub.textContent = pagesProcessed ? 'Page ' + pageNum + ' · ' + fmt(totalSaved) + ' leads saved' : 'Waiting…';

  if (detectedThisPage != null) { detectedBar.classList.remove('hidden'); detectedLabel.textContent = detectedThisPage + ' leads on current page'; }

  statusMsg.className = 'status-msg';
  if (status === 'running') { statusMsg.className += ' running'; statusMsg.textContent = '⚡ Scraping… ' + fmt(totalSaved) + ' saved across ' + pagesProcessed + ' pages'; }
  else if (status === 'done') { statusMsg.className += ' done'; statusMsg.textContent = '✅ Done! ' + fmt(totalSaved) + ' leads saved'; }
  else if (status === 'error') { statusMsg.className += ' error'; statusMsg.textContent = '❌ Error — check console'; }
  else { statusMsg.textContent = 'Ready — press Start to begin'; }

  btnStart.disabled = status === 'running';
  btnStop.disabled = status !== 'running';
}

function renderFilters(f) {
  const pills = [];
  if (f.keywords) pills.push(['🔍', f.keywords]);
  if (f.activeFilters) f.activeFilters.forEach(x => pills.push(['●', x]));
  if (f.connectionDegree) pills.push(['🔗', f.connectionDegree + ' degree']);
  filtersRow.innerHTML = pills.length
    ? pills.map(([i, l]) => '<span class="filter-pill">' + i + ' ' + l.replace(/</g, '&lt;') + '</span>').join('')
    : '<span class="no-filters">No filters detected</span>';
}

// ── Server health ─────────────────────────────────────────────────────────────
async function checkServer() {
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    serverPill.className = 'server-pill ' + (r.ok ? 'online' : 'offline');
    serverLabel.textContent = r.ok ? 'connected' : 'no server';
  } catch {
    serverPill.className = 'server-pill offline'; serverLabel.textContent = 'no server';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  await checkServer();
  await detect();
  await syncStorage();
  setInterval(syncStorage, 800);
  setInterval(checkServer, 8000);
  await loadQueue();
})();

// ══════════════════════════════════════════════════════════════════════════════
// GO TO URL — paste a URL, navigate to it, auto-start scraping
// ══════════════════════════════════════════════════════════════════════════════
const goUrlInput = $('goUrlInput');
const btnGoUrl = $('btnGoUrl');
const btnAddQueue = $('btnAddQueue');

async function goToUrl(url) {
  if (!url) return;
  try { new URL(url); } catch { return; } // validate
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // Set pending auto-start so background.js restarts scraping after navigation
  await chrome.storage.local.set({ pendingAutoStart: true, pendingTabId: tab.id });
  await chrome.tabs.update(tab.id, { url });
  window.close(); // close popup — scraping will start automatically
}

btnGoUrl.addEventListener('click', () => goToUrl(goUrlInput.value.trim()));
goUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    goToUrl(goUrlInput.value.trim());
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// QUEUE SYSTEM — add URLs, they process automatically one after another
// ══════════════════════════════════════════════════════════════════════════════
const queueUrlInput = $('queueUrlInput');
const btnQueueAdd = $('btnQueueAdd');
const btnQueueClear = $('btnQueueClear');
const queueListEl = $('queueList');
const queueStatusEl = $('queueStatus');

let queue = []; // [{url, status:'pending'|'active'|'done'|'failed', saved:0}]

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
  if (queue.length === 0) {
    queuePanel.classList.add('hidden');
    queueStatusEl.classList.add('hidden');
    return;
  }
  queuePanel.classList.remove('hidden');

  queueListEl.innerHTML = queue.map((q, i) => {
    const icon = q.status === 'done' ? '✅' : q.status === 'active' ? '⚡' : q.status === 'failed' ? '❌' : '⏳';
    const cls = q.status === 'active' ? 'active' : q.status === 'done' ? 'done' : q.status === 'failed' ? 'failed' : '';
    let label = '';
    try { const u = new URL(q.url); label = u.hostname.replace('www.','') + u.pathname.slice(0,30); } catch { label = q.url.slice(0,40); }
    if (q.saved) label += ` (${q.saved} saved)`;
    return `<div class="q-item ${cls}"><span class="q-icon">${icon}</span><span class="q-url ${cls}" title="${q.url.replace(/"/g,'&quot;')}">${label}</span>${q.status === 'pending' ? `<button class="q-remove" data-idx="${i}">×</button>` : ''}</div>`;
  }).join('');

  queueListEl.querySelectorAll('.q-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      queue.splice(parseInt(btn.dataset.idx), 1);
      await saveQueue();
    });
  });

  // Status line — no Start button; queue runs automatically
  const active  = queue.filter(q => q.status === 'active').length;
  const pending = queue.filter(q => q.status === 'pending').length;
  const done    = queue.filter(q => q.status === 'done').length;
  queueStatusEl.classList.remove('hidden');
  if (active > 0) {
    queueStatusEl.className = 'status-msg running';
    queueStatusEl.textContent = '⚡ Scraping in progress — ' + pending + ' waiting…';
  } else if (pending > 0) {
    queueStatusEl.className = 'status-msg';
    queueStatusEl.textContent = `⏳ ${pending} URL${pending > 1 ? 's' : ''} queued — will start after current scrape`;
  } else {
    queueStatusEl.className = 'status-msg done';
    queueStatusEl.textContent = `✅ All done — ${done} URL${done > 1 ? 's' : ''} scraped`;
  }
}

async function addToQueue(url) {
  if (!url) return;
  try { new URL(url); } catch { return; }
  if (queue.some(q => q.url === url && q.status === 'pending')) return;

  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  const isRunning = scraperStats?.status === 'running';

  if (!isRunning) {
    // Nothing is currently scraping — navigate immediately and start
    queue.push({ url, status: 'active', saved: 0 });
    await saveQueue();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.storage.local.set({
        pendingAutoStart: true, pendingTabId: tab.id,
        scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 }
      });
      await chrome.tabs.update(tab.id, { url });
      window.close(); // close popup — scraping will start automatically
    }
  } else {
    // Something is scraping — add as pending; background.js auto-advances when done
    queue.push({ url, status: 'pending', saved: 0 });
    await saveQueue();
  }
}

btnQueueAdd.addEventListener('click', () => { addToQueue(queueUrlInput.value.trim()); queueUrlInput.value = ''; });
queueUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addToQueue(queueUrlInput.value.trim()); queueUrlInput.value = ''; }
});
btnAddQueue.addEventListener('click', () => { addToQueue(goUrlInput.value.trim()); goUrlInput.value = ''; });
btnQueueClear.addEventListener('click', async () => { queue = []; await saveQueue(); });

// ══════════════════════════════════════════════════════════════════════════════
// APOLLO PANEL — Start/Stop/Scan for Apollo.io
// ══════════════════════════════════════════════════════════════════════════════
const btnApStart  = $('btnApStart');
const btnApStop   = $('btnApStop');
const btnApScan   = $('btnApScan');
const apStatus    = $('apStatus');
const apSaveResult = $('apSaveResult');
const apSaved     = $('apSaved');
const apPages     = $('apPages');
const apTotal     = $('apTotal');

btnApStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.storage.local.set({ scraperStats: { status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 } });
  await chrome.tabs.sendMessage(tab.id, { action: 'START_AUTO' }).catch(() => {});
  btnApStart.disabled = true; btnApStop.disabled = false;
  apStatus.className = 'status-msg running'; apStatus.textContent = '⚡ Scraping Apollo…';
  syncApollo();
});

btnApStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { action: 'STOP' }).catch(() => {});
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (scraperStats) { scraperStats.status = 'idle'; await chrome.storage.local.set({ scraperStats }); }
  btnApStart.disabled = false; btnApStop.disabled = true;
  apStatus.className = 'status-msg'; apStatus.textContent = 'Stopped';
});

btnApScan.addEventListener('click', async () => {
  btnApScan.disabled = true; btnApScan.textContent = '⟳ Scanning…';
  apSaveResult.classList.add('hidden');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { apDone('err', 'No active tab'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_AND_SAVE' }).catch(e => ({ ok: false, error: e.message }));
  if (r?.ok) { apDone('ok', '✓ Saved ' + (r.saved || 0) + ' leads'); }
  else { apDone('err', '✗ ' + (r?.error || 'Unknown error')); }
  function apDone(cls, text) {
    btnApScan.disabled = false; btnApScan.textContent = '🔍 Scan & Save This Page Only';
    apSaveResult.className = 'save-result ' + cls; apSaveResult.textContent = text; apSaveResult.classList.remove('hidden');
  }
});

async function syncApollo() {
  const { scraperStats } = await chrome.storage.local.get('scraperStats');
  if (!scraperStats) return;
  apSaved.textContent = fmt(scraperStats.totalSaved || 0);
  apPages.textContent = fmt(scraperStats.pagesProcessed || 0);
  if (scraperStats.totalResults) apTotal.textContent = fmt(scraperStats.totalResults);
  if (scraperStats.status === 'done') {
    apStatus.className = 'status-msg done'; apStatus.textContent = '✅ Done! ' + fmt(scraperStats.totalSaved) + ' leads saved';
    btnApStart.disabled = false; btnApStop.disabled = true;
  } else if (scraperStats.status === 'running') {
    apStatus.className = 'status-msg running'; apStatus.textContent = '⚡ Scraping… ' + fmt(scraperStats.totalSaved || 0) + ' saved';
    btnApStart.disabled = true; btnApStop.disabled = false;
  }
}
// Sync Apollo stats with same interval as LinkedIn
setInterval(() => { if (currentPanel === 'apollo') syncApollo(); }, 800);