/* ═══════════════════════════════════════════════════════════════════════════
 * DATA BUNKER — Universal B2B Lead Extraction v5.0
 *
 * Zero-selector strategy: extracts raw text from any page, sends to backend
 * AI for structured field extraction. Site-specific handlers optimize for
 * LinkedIn, Apollo, Google Maps, and generic directories.
 *
 * Pillars:
 *   1. Strategy Switcher — picks extraction method based on hostname
 *   2. Semantic text gathering — grabs meaningful card/row text, not DOM selectors
 *   3. Backend AI bridge — raw text → structured Lead JSON via Qwen
 *   4. Human-mimicry scrolling — variable speed, pauses, jitter
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

let isActive  = false;
let stopFlag  = false;
let pageLeads = [];

const API = 'http://localhost:5000';

// ── SPA Navigation Patch ──────────────────────────────────────────────────────
(function() {
  const orig = history.pushState.bind(history);
  history.pushState = function(...a) { orig(...a); setTimeout(broadcastState, 800); };
  window.addEventListener('popstate', () => setTimeout(broadcastState, 800));
})();
setTimeout(broadcastState, 1200);

// ── Strategy Switcher ─────────────────────────────────────────────────────────
function getStrategy() {
  const h = location.hostname.toLowerCase();
  const u = location.href.toLowerCase();
  if (h.includes('linkedin.com'))   return 'linkedin';
  if (h.includes('apollo.io'))      return 'apollo';
  if (h.includes('google.com') && u.includes('/maps')) return 'maps';
  if (h.includes('yelp.com'))       return 'yelp';
  if (h.includes('yellowpages'))    return 'yellowpages';
  if (h.includes('crunchbase.com')) return 'crunchbase';
  if (h.includes('zoominfo.com'))   return 'zoominfo';
  if (h.includes('hunter.io'))      return 'hunter';
  return 'generic';
}

const LABELS = {
  linkedin:'LinkedIn', apollo:'Apollo.io', maps:'Google Maps',
  yelp:'Yelp', yellowpages:'YellowPages', crunchbase:'Crunchbase',
  zoominfo:'ZoomInfo', hunter:'Hunter.io', generic:'Directory'
};

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'GET_PAGE_STATE') {
    sendResponse(buildState());
    return true;
  }

  if (msg.action === 'SCAN') {
    (async () => {
      try {
        const blocks = await gatherBlocks();
        pageLeads = blocks;
        sendResponse({ ok: true, count: blocks.length, strategy: getStrategy() });
      } catch (e) { sendResponse({ ok: false, error: e.message, count: 0 }); }
    })();
    return true;
  }

  if (msg.action === 'EXTRACT_AND_SAVE') {
    (async () => {
      try {
        if (!pageLeads.length) pageLeads = await gatherBlocks();
        if (!pageLeads.length) { sendResponse({ ok: false, error: 'No leads found', saved: 0 }); return; }
        const resp = await fetch(API + '/api/scraper/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: pageLeads, url: location.href, strategy: getStrategy(), source: getStrategy() + '_scrape' }),
          signal: AbortSignal.timeout(60000)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
        sendResponse({ ok: true, ...data });
      } catch (e) { sendResponse({ ok: false, error: e.message, saved: 0 }); }
    })();
    return true;
  }

  if (msg.action === 'START_AUTO') {
    if (!isActive) runAuto().catch(e => reportError(e.message));
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'STOP') {
    stopFlag = true;
    sendResponse({ ok: true });
    return true;
  }
});

// ── State ─────────────────────────────────────────────────────────────────────
function buildState() {
  const s = getStrategy();
  return {
    strategy: s, siteLabel: LABELS[s] || 'Page', url: location.href,
    isLinkedIn: s === 'linkedin', isSupported: true, isActive,
    leadsOnPage: pageLeads.length,
    totalResults: s === 'linkedin' ? liTotalResults() : 0,
    currentPage: s === 'linkedin' ? liCurrentPage() : 0,
    filters: s === 'linkedin' ? liFilters() : {},
  };
}
function broadcastState() { chrome.runtime.sendMessage({ type: 'PAGE_STATE', data: buildState() }).catch(() => {}); }
function reportError(m)   { chrome.runtime.sendMessage({ type: 'ERROR', message: m }).catch(() => {}); }

// ══════════════════════════════════════════════════════════════════════════════
// BLOCK GATHERING — raw text extraction per lead
// ══════════════════════════════════════════════════════════════════════════════
async function gatherBlocks() {
  const s = getStrategy();
  switch (s) {
    case 'linkedin':    return gatherLinkedIn();
    case 'apollo':      return gatherCards('[class*="zp_"], tr[class*="zp_"]');
    case 'maps':        return gatherMaps();
    case 'yelp':        return gatherCards('[class*="businessName"], [class*="container__09f24"]');
    case 'yellowpages': return gatherCards('.result, .listing, .info');
    case 'crunchbase':  return gatherCards('[class*="component--field-formatter"]');
    case 'zoominfo':    return gatherCards('[class*="tableRow"], [class*="listItem"]');
    case 'hunter':      return gatherCards('[class*="result-item"], [class*="domain-result"]');
    default:            return gatherGeneric();
  }
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────
function gatherLinkedIn() {
  const blocks = [], seen = new Set();
  const containers = document.querySelectorAll(
    'li.reusable-search__result-container, li[class*="result-container"], ' +
    'li[class*="entity-result"], li[class*="search-result"]'
  );
  for (const li of containers) {
    const b = liCard(li);
    if (b && !seen.has(b.profileUrl || b.rawText.slice(0, 60))) { seen.add(b.profileUrl || b.rawText.slice(0, 60)); blocks.push(b); }
  }
  document.querySelectorAll('a[href*="/in/"]').forEach(a => {
    const href = liUrl(a.href);
    if (!href || seen.has(href)) return;
    const card = walkUp(a);
    const b = liCard(card);
    if (b) { seen.add(href); blocks.push(b); }
  });
  return blocks;
}

function liCard(el) {
  if (!el) return null;
  const anchors = el.querySelectorAll('a[href*="/in/"]');
  let profileUrl = '';
  for (const a of anchors) { const h = liUrl(a.href); if (h) { profileUrl = h; break; } }

  let name = '';
  for (const a of el.querySelectorAll('a[href*="/in/"]')) {
    const lbl = a.getAttribute('aria-label') || '';
    const m = lbl.match(/View\s+(.+?)[\u2019\u2018\u0027\u2032']s(?:\s+full)?\s+profile/i);
    if (m) { name = m[1].trim(); break; }
    if (lbl && !/^view/i.test(lbl) && lbl.length < 80) { name = lbl.trim(); break; }
    const sp = a.querySelector('span[aria-hidden="true"]');
    if (sp) { const t = sp.textContent.trim(); if (t.length > 1 && t.length < 80 && !/linkedin member/i.test(t)) { name = t; break; } }
  }
  if (!name || /linkedin member/i.test(name)) {
    // Image alt fallback
    for (const img of el.querySelectorAll('img[alt]')) {
      const alt = img.alt.trim();
      if (alt.length > 2 && alt.length < 60 && !/photo|profile|avatar|linkedin/i.test(alt)) { name = alt; break; }
    }
  }
  if (!name) return null;

  const subEl = el.querySelector('.entity-result__primary-subtitle, [class*="primary-subtitle"], .artdeco-entity-lockup__subtitle, [class*="lockup__subtitle"]');
  const subtitle = subEl ? (subEl.querySelector('span[aria-hidden="true"]') || subEl).textContent.trim() : '';
  const locEl = el.querySelector('.entity-result__secondary-subtitle, [class*="secondary-subtitle"], .artdeco-entity-lockup__caption, [class*="lockup__caption"]');
  let loc = locEl ? (locEl.querySelector('span[aria-hidden="true"]') || locEl).textContent.trim() : '';
  if (/^\d+\s*(connection|follower)/i.test(loc)) loc = '';
  const rawText = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800);

  return { name, subtitle, location: loc, profileUrl, rawText, type: 'linkedin_card' };
}

function liUrl(href) {
  if (!href || !href.includes('/in/')) return '';
  const clean = href.split('?')[0].split('#')[0];
  const slug = clean.slice(clean.lastIndexOf('/in/') + 4).split('/')[0];
  if (!slug || slug.length < 2 || /^(settings|search|messaging|notifications|learning|jobs|feed|mynetwork)$/.test(slug)) return '';
  if (!/[a-zA-Z]/.test(slug)) return '';
  return clean;
}

function walkUp(a) {
  let el = a;
  for (let i = 0; i < 15; i++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    el = el.parentElement;
    if (el.tagName === 'LI' && el.textContent.trim().length > 15) return el;
    if (el.querySelector?.('[class*="primary-subtitle"]')) return el;
  }
  return a.parentElement || a;
}

// ── Google Maps ───────────────────────────────────────────────────────────────
function gatherMaps() {
  const blocks = [], seen = new Set();
  const sels = ['[role="feed"] > div', '[class*="Nv2PK"]', 'div[jsaction*="pane.resultSection"]', '.fontHeadlineSmall'];
  let elems = [];
  for (const s of sels) { const e = document.querySelectorAll(s); if (e.length > 1) { elems = [...e]; break; } }
  // Shadow DOM piercing
  if (!elems.length) {
    for (const el of document.querySelectorAll('*')) {
      if (el.shadowRoot) { const inner = el.shadowRoot.querySelectorAll('[role="listitem"], [class*="result"]'); if (inner.length > 1) { elems = [...inner]; break; } }
    }
  }
  for (const el of elems) {
    const text = (el.innerText || '').trim();
    if (text.length < 10 || seen.has(text.slice(0, 60))) continue;
    seen.add(text.slice(0, 60));
    const head = el.querySelector('.fontHeadlineSmall, [class*="qBF1Pd"], h3, [role="heading"]');
    const link = el.querySelector('a[href*="http"]:not([href*="google.com"])');
    blocks.push({ name: head ? head.textContent.trim() : '', rawText: text.slice(0, 800), website: link ? link.href : '', type: 'maps_listing' });
  }
  return blocks;
}

// ── Card-based sites ──────────────────────────────────────────────────────────
function gatherCards(selStr) {
  const blocks = [], seen = new Set();
  let allEls = [];
  for (const s of selStr.split(',')) { try { allEls.push(...document.querySelectorAll(s.trim())); } catch {} }
  if (allEls.length < 2) return gatherGeneric();
  for (const el of allEls) {
    const text = (el.innerText || '').trim();
    if (text.length < 10) continue;
    const key = text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const em = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const ph = text.match(/[\+]?[\d][\d\s\-(). ]{6,16}[\d]/);
    const lk = el.querySelector('a[href*="http"]');
    blocks.push({ rawText: text.slice(0, 800), email: em?.[0] || '', phone: ph?.[0]?.trim() || '', website: lk?.href || '', type: 'card' });
  }
  return blocks;
}

// ── Generic (any page) ────────────────────────────────────────────────────────
function gatherGeneric() {
  const blocks = [], seen = new Set();

  // 1. Tables
  for (const tbl of document.querySelectorAll('table')) {
    const rows = tbl.querySelectorAll('tbody tr');
    if (rows.length < 2) continue;
    const headers = [...tbl.querySelectorAll('th')].map(th => th.textContent.trim());
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
      if (!cells.length) continue;
      const text = headers.length ? headers.map((h, i) => h + ': ' + (cells[i] || '')).join(' | ') : cells.join(' | ');
      if (text.length < 10 || seen.has(text.slice(0, 80))) continue;
      seen.add(text.slice(0, 80));
      blocks.push({ rawText: text.slice(0, 800), type: 'table_row' });
    }
    if (blocks.length) return blocks;
  }

  // 2. Repeating containers
  const children = findRepeating();
  for (const el of children) {
    const text = (el.innerText || '').trim();
    if (text.length < 10) continue;
    const key = text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const em = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const ph = text.match(/[\+]?[\d][\d\s\-(). ]{6,16}[\d]/);
    const lk = el.querySelector('a[href*="http"]');
    const li = el.querySelector('a[href*="linkedin.com/in/"]');
    blocks.push({ rawText: text.slice(0, 800), email: em?.[0] || '', phone: ph?.[0]?.trim() || '', website: lk?.href || '', linkedinUrl: li ? liUrl(li.href) : '', type: 'generic_card' });
  }

  // 3. Last resort: page chunks
  if (!blocks.length) {
    const chunks = (document.body.innerText || '').split(/\n{2,}/).filter(c => c.trim().length > 20);
    for (const ch of chunks.slice(0, 50)) {
      const t = ch.trim().slice(0, 600);
      if (t.length < 20 || seen.has(t.slice(0, 60))) continue;
      seen.add(t.slice(0, 60));
      blocks.push({ rawText: t, type: 'text_chunk' });
    }
  }
  return blocks;
}

function findRepeating() {
  let best = [], bestScore = 0;
  const tryContainer = (container) => {
    const ch = [...container.children].filter(isVis);
    if (ch.length < 3 || ch.length > 300) return;
    if (['NAV','HEADER','FOOTER','ASIDE','SCRIPT','STYLE'].includes(container.tagName)) return;
    const avg = ch.reduce((a, c) => a + (c.textContent || '').trim().length, 0) / ch.length;
    if (avg < 15) return;
    const score = ch.length * Math.min(avg, 200);
    if (score > bestScore) { bestScore = score; best = ch; }
  };
  for (const sel of ['[class*="list"],[class*="results"],[class*="grid"],[class*="cards"],[class*="feed"],[class*="items"],[role="list"],[role="feed"]']) {
    try { document.querySelectorAll(sel).forEach(tryContainer); } catch {}
  }
  if (best.length < 3) {
    for (const tag of ['ul', 'ol', 'div', 'section', 'main']) {
      document.querySelectorAll(tag).forEach(tryContainer);
    }
  }
  return best;
}

function isVis(el) {
  if (!el || el.hidden) return false;
  try { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; } catch {}
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// LINKEDIN AUTO-SCRAPER
// ══════════════════════════════════════════════════════════════════════════════
async function runAuto() {
  isActive = true; stopFlag = false;
  let pages = 0, saved = 0;
  chrome.runtime.sendMessage({ type: 'SCRAPING_STARTED' }).catch(() => {});

  try {
    while (!stopFlag) {
      if (!isLiPage()) break;
      await waitFor(() => document.querySelectorAll('a[href*="/in/"]').length > 2, 15000);
      if (stopFlag) break;
      await humanScroll();
      if (stopFlag) break;
      await waitStable();
      if (stopFlag) break;

      const blocks = gatherLinkedIn();
      pageLeads = blocks;
      const total = liTotalResults(), pn = liCurrentPage();

      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, detectedThisPage: blocks.length });

      if (blocks.length > 0) {
        try {
          const r = await fetch(API + '/api/scraper/leads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks, url: location.href, strategy: 'linkedin', source: 'linkedin_auto' }),
            signal: AbortSignal.timeout(60000)
          });
          const d = await r.json();
          saved += d.saved || 0;
        } catch (e) {
          progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, error: e.message });
        }
      }

      pages++;
      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total });

      await sleep(2000 + Math.random() * 3000);
      if (stopFlag) break;
      if (!(await nextPage())) break;
    }
  } finally { isActive = false; }
  chrome.runtime.sendMessage({ type: 'SCRAPING_DONE', data: { pagesProcessed: pages, totalSaved: saved } }).catch(() => {});
}

function progress(data) { chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', data }).catch(() => {}); }

// ── Human Scroll ──────────────────────────────────────────────────────────────
async function humanScroll() {
  let pos = window.scrollY, target = document.body.scrollHeight, step = 0;
  while (pos < target) {
    if (stopFlag) return;
    pos += 120 + Math.random() * 160;
    window.scrollTo({ top: pos, behavior: 'smooth' });
    step++;
    await sleep(60 + Math.random() * 140);
    if (step % (3 + Math.floor(Math.random() * 3)) === 0) await sleep(300 + Math.random() * 500);
    target = document.body.scrollHeight; // may grow
  }
  await sleep(400 + Math.random() * 600);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await sleep(500);
}

// ── LinkedIn Helpers ──────────────────────────────────────────────────────────
function isLiPage() {
  const u = location.href;
  return u.includes('linkedin.com/search/results/people') || u.includes('linkedin.com/search/results/all') ||
    u.includes('linkedin.com/mynetwork') || (u.includes('linkedin.com/company/') && u.includes('/people')) ||
    u.includes('linkedin.com/sales/search') || u.includes('linkedin.com/recruiter/search');
}

function liTotalResults() {
  for (const sel of ['.search-results-container h2', '.pb2.t-black--light.t-14 span', '[class*="results-count"]', '.t-black--light']) {
    for (const el of document.querySelectorAll(sel)) { const m = el.textContent.match(/[\d,]+/); if (m) { const n = parseInt(m[0].replace(/,/g, '')); if (n > 0) return n; } }
  }
  for (const el of document.querySelectorAll('span, h2, h3, p')) { const m = el.textContent.trim().match(/^(?:about\s+)?([\d,]+)\s+result/i); if (m) { const n = parseInt(m[1].replace(/,/g, '')); if (n > 0) return n; } }
  return 0;
}

function liCurrentPage() { return Math.floor(parseInt(new URLSearchParams(location.search).get('start') || '0') / 10) + 1; }

function liFilters() {
  const f = {}, p = new URLSearchParams(location.search);
  if (p.get('keywords')) f.keywords = p.get('keywords');
  if (p.get('network'))  f.connectionDegree = p.get('network');
  const pills = [...document.querySelectorAll('.search-reusables__filter-pill-button.toggled span, [aria-checked="true"] span')].map(e => e.textContent.trim()).filter(Boolean);
  if (pills.length) f.activeFilters = pills;
  return f;
}

// ── Pagination ────────────────────────────────────────────────────────────────
async function nextPage() {
  const btns = [
    document.querySelector('button[aria-label="Next"]'),
    document.querySelector('.artdeco-pagination__button--next'),
    ...[...document.querySelectorAll('.artdeco-pagination button, [class*="pagination"] button')].filter(b => /^next$/i.test(b.textContent.trim()))
  ].filter(Boolean);

  for (const btn of btns) {
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
    const prev = new URLSearchParams(location.search).get('start') || '0';
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400 + Math.random() * 300);
    btn.click();
    const ok = await waitFor(() => (new URLSearchParams(location.search).get('start') || '0') !== prev, 15000);
    if (!ok) await sleep(2000);
    window.scrollTo({ top: 0 });
    await waitFor(() => document.querySelectorAll('a[href*="/in/"]').length > 2, 20000);
    await sleep(500 + Math.random() * 500);
    return true;
  }

  // URL fallback
  if (location.href.includes('linkedin.com/search/results/')) {
    const url = new URL(location.href);
    const start = parseInt(url.searchParams.get('start') || '0');
    const total = liTotalResults();
    if (total > 0 && start + 10 >= total) return false;
    url.searchParams.set('start', String(start + 10));
    stopFlag = true;
    chrome.runtime.sendMessage({ type: 'NAV_TO_URL', url: url.toString() }).catch(() => {});
    await sleep(400);
    return false;
  }
  return false;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitFor(fn, ms = 10000) { return new Promise(res => { const t = Date.now(), id = setInterval(() => { if (fn()) { clearInterval(id); res(true); } else if (Date.now() - t > ms) { clearInterval(id); res(false); } }, 200); }); }
function waitStable(stableMs = 1500, timeout = 10000) { return new Promise(res => { let prev = 0, since = Date.now(); const t = Date.now(), id = setInterval(() => { const c = document.querySelectorAll('a[href*="/in/"], tr, li, article').length; if (c !== prev) { prev = c; since = Date.now(); } if ((c > 0 && Date.now() - since >= stableMs) || Date.now() - t > timeout) { clearInterval(id); res(c); } }, 300); }); }

console.log('%c[Data Bunker v5] Strategy: ' + getStrategy(), 'color:#7c3aed;font-weight:bold');
