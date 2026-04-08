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

function fmt(n) { return Number(n || 0).toLocaleString(); }
function showPanel(name) {
  currentPanel = name;
  [idlePanel, universalPanel, linkedinPanel].forEach(p => p.classList.add('hidden'));
  ({ idle: idlePanel, universal: universalPanel, linkedin: linkedinPanel })[name]?.classList.remove('hidden');
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
    const r = await fetch('http://localhost:5000/health', { signal: AbortSignal.timeout(3000) });
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
})();