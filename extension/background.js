/* ═══════════════════════════════════════════════════════════════════════════
 * DATA BUNKER — Background Service Worker v5.0
 *
 * Responsibilities:
 *   1. Keepalive — prevent Chrome from killing the worker during scrapes
 *   2. API bridge — relay save requests from content → backend
 *   3. Tab watcher — restart scraper after SPA navigation
 *   4. Stats storage — persist scraping progress in chrome.storage
 * ═══════════════════════════════════════════════════════════════════════════ */

const API_BASE = 'http://localhost:5000';

// ── Keepalive ─────────────────────────────────────────────────────────────────
let keepaliveId = null;
function startKeepalive() {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
}
function stopKeepalive() {
  chrome.alarms.clear('keepalive');
}
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'keepalive') { /* just wakes the worker */ }
});

// ── Tab Navigation Watcher — auto-restart scraper on LinkedIn SPA nav ─────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const { pendingAutoStart, pendingTabId } = await chrome.storage.local.get(['pendingAutoStart', 'pendingTabId']);
  if (!pendingAutoStart) return;
  // Accept either exact tab match, or any LinkedIn search tab when pendingTabId is missing
  // (pendingTabId may be missing if content.js set pendingAutoStart directly as a safety net)
  if (pendingTabId && pendingTabId !== tabId) return;
  if (!pendingTabId && !(tab.url || '').match(/linkedin\.com\/(search\/results|sales\/search)/)) return;

  console.log('[bg] Tab', tabId, 'loaded — restarting auto-scraper');
  await chrome.storage.local.remove(['pendingAutoStart', 'pendingTabId']);

  // Wait for content script to be ready, then restart
  for (let i = 0; i < 30; i++) {
    try {
      const state = await chrome.tabs.sendMessage(tabId, { action: 'GET_PAGE_STATE' });
      if (state?.isSupported) {
        await sleep(1200 + Math.random() * 800);
        await chrome.tabs.sendMessage(tabId, { action: 'START_AUTO' });
        console.log('[bg] Restarted auto-scraper on tab', tabId);
        return;
      }
    } catch {
      // Content script not ready yet — try re-injecting
      if (i === 10 || i === 20) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          console.log('[bg] Re-injected content.js into tab', tabId);
        } catch {}
      }
    }
    await sleep(500);
  }
  console.warn('[bg] Failed to restart auto-scraper: content script never became ready');
});

// ── Message Router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'SCRAPING_STARTED':
      startKeepalive();
      if (sender.tab?.id) chrome.storage.local.set({ activeScraperTabId: sender.tab.id });
      // Only reset stats if not already running (preserve counters across page navs)
      chrome.storage.local.get('scraperStats', ({ scraperStats = {} }) => {
        if (scraperStats.status !== 'running') {
          updateStats({ status: 'running', pagesProcessed: 0, totalSaved: 0, totalErrors: 0 });
        }
      });
      break;

    case 'PROGRESS_UPDATE':
      chrome.storage.local.get('scraperStats', ({ scraperStats = {} }) => {
        updateStats({ ...scraperStats, ...msg.data, lastUpdate: Date.now() });
      });
      break;

    case 'SCRAPING_DONE':
      stopKeepalive();
      chrome.storage.local.remove('activeScraperTabId');
      chrome.storage.local.get('scraperStats', ({ scraperStats = {} }) => {
        updateStats({ ...scraperStats, status: 'done', ...msg.data, lastUpdate: Date.now() });
      });
      break;

    case 'ERROR':
      stopKeepalive();
      chrome.storage.local.remove('activeScraperTabId');
      chrome.storage.local.get('scraperStats', ({ scraperStats = {} }) => {
        updateStats({
          ...scraperStats, status: 'error', lastError: msg.message,
          totalErrors: (scraperStats.totalErrors || 0) + 1, lastUpdate: Date.now()
        });
      });
      break;

    case 'PAGE_STATE':
      chrome.storage.local.set({ pageState: msg.data });
      break;

    case 'NAV_TO_URL':
      if (sender.tab?.id) {
        console.log('[bg] NAV_TO_URL → navigating tab', sender.tab.id, 'to', msg.url?.slice(0, 80));
        // Merge current stats so they persist across the page reload
        chrome.storage.local.get('scraperStats', ({ scraperStats = {} }) => {
          chrome.storage.local.set({
            pendingAutoStart: true,
            pendingTabId: sender.tab.id,
            scraperStats: { ...scraperStats, status: 'running', lastUpdate: Date.now() }
          });
          chrome.tabs.update(sender.tab.id, { url: msg.url }).catch(err => {
            console.error('[bg] Failed to navigate:', err);
          });
        });
      }
      break;
  }
});

function updateStats(stats) {
  chrome.storage.local.set({ scraperStats: stats });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
