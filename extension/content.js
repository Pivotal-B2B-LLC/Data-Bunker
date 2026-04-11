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
let navPending = false;   // true when nextPage() is doing URL fallback navigation
let pageLeads = [];

// API URL loaded from chrome.storage.sync — configurable in popup Settings.
let API = 'http://localhost:5000';
chrome.storage.sync.get('serverUrl', ({ serverUrl }) => {
  if (serverUrl) API = serverUrl;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.serverUrl) API = changes.serverUrl.newValue;
});

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
  if (h.includes('linkedin.com'))        return 'linkedin';
  if (h.includes('apollo.io'))           return 'apollo';
  if (h.includes('google.com') && u.includes('/maps')) return 'maps';
  if (h.includes('opencorporates.com'))  return 'opencorporates';
  if (h.includes('yelp.com'))            return 'yelp';
  if (h.includes('yellowpages'))         return 'yellowpages';
  if (h.includes('crunchbase.com'))      return 'crunchbase';
  if (h.includes('zoominfo.com'))        return 'zoominfo';
  if (h.includes('hunter.io'))           return 'hunter';
  return 'generic';
}

const LABELS = {
  linkedin:'LinkedIn', apollo:'Apollo.io', maps:'Google Maps',
  opencorporates:'OpenCorporates',
  yelp:'Yelp', yellowpages:'YellowPages', crunchbase:'Crunchbase',
  zoominfo:'ZoomInfo', hunter:'Hunter.io', generic:'Directory'
};

// ── Name sanitizer — strip bullets, connection degree, pipe-delimited junk ────
// Also detects when a job title is concatenated after the name and splits them.
const JOB_SPLIT_WORDS = new Set([
  'professor', 'director', 'manager', 'engineer', 'analyst', 'consultant',
  'specialist', 'coordinator', 'administrator', 'officer', 'associate',
  'executive', 'president', 'founder', 'co-founder', 'owner', 'partner',
  'lead', 'head', 'chief', 'senior', 'junior', 'principal', 'vp',
  'advisor', 'counsel', 'attorney', 'doctor', 'surgeon', 'ceo', 'cto', 'cfo', 'coo',
  'teacher', 'instructor', 'lecturer', 'researcher', 'scientist',
  'developer', 'architect', 'designer', 'producer', 'editor',
  'supervisor', 'captain', 'colonel', 'general', 'sergeant',
  'intern', 'fellow', 'student', 'graduate',
  // Business / operations words
  'operations', 'strategy', 'marketing', 'sales', 'finance', 'accounting',
  'business', 'digital', 'clinical', 'research', 'software', 'tech',
  'technology', 'data', 'product', 'project', 'program', 'management',
  'development', 'engineering', 'design', 'creative', 'content',
  'customer', 'success', 'support', 'service', 'human', 'resources',
  'talent', 'recruitment', 'procurement', 'supply', 'logistics',
  'manufacturing', 'production', 'quality', 'compliance', 'legal',
  'planning', 'analytics', 'intelligence', 'innovation', 'growth',
  'revenue', 'performance', 'brand', 'communications', 'relations',
  // Board / governance
  'board', 'trustee', 'member', 'committee', 'advisory', 'chairman',
  'emeritus', 'retired',
  // Company / institution words
  'group', 'solutions', 'services', 'systems', 'technologies', 'consulting',
  'global', 'international', 'industries', 'enterprises', 'agency',
  'university', 'college', 'school', 'institute', 'hospital',
  // LinkedIn junk
  'linkedin', 'top', 'voice', 'influencer', 'keynote', 'speaker',
  'author', 'bestselling', 'champion', 'olympic', 'veteran', 'expert',
  'professional', 'certified', 'entrepreneur', 'freelance',
  'outsourcing', 'enterprise', 'startup', 'lean', 'agile',
  'resilience', 'leadership', 'payable', 'accounts', 'helping',
  'mental', 'health', 'private', 'equity', 'public',
]);

function cleanName(raw) {
  if (!raw) return '';
  let n = raw
    .replace(/^[\s•·\-–—|]+/, '')          // leading bullets / pipes
    .replace(/[\s•·\-–—|]+$/, '')          // trailing bullets / pipes
    .replace(/\b\d+(st|nd|rd|th)\+?\b/gi, '') // 1st, 2nd, 3rd+, etc.
    .replace(/<[^>]*>/g, '')                // stray HTML tags
    .replace(/[^a-zA-ZÀ-ÿ\s'.\-]/g, '')   // keep only letters, spaces, hyphens, apostrophes, dots
    .replace(/\s{2,}/g, ' ')               // collapse whitespace
    .trim();

  // Split name from job title: if word 3+ is a known job word, truncate
  const words = n.split(/\s+/);
  let cutoff = Math.min(words.length, 3); // Max 3 name words (first, middle, last)
  for (let i = 2; i < words.length; i++) {
    if (JOB_SPLIT_WORDS.has(words[i].toLowerCase())) { cutoff = Math.min(cutoff, i); break; }
    // "at" or "@" after 2+ name words = rest is subtitle
    if (words[i].toLowerCase() === 'at') { cutoff = Math.min(cutoff, i); break; }
  }
  n = words.slice(0, cutoff).join(' ');

  if (n.length > 60) n = n.slice(0, 60).replace(/\s\S*$/, '').trim();
  if ((n.match(/[a-zA-ZÀ-ÿ]/g) || []).length < 2) return '';
  return n;
}

// ── Quick scroll to trigger lazy-loading of off-screen results ────────────────
async function quickScroll() {
  const h = document.body.scrollHeight;
  for (let y = 0; y < h; y += 300) {
    window.scrollTo(0, y);
    await sleep(80);
  }
  await sleep(500);
  window.scrollTo(0, 0);
  await sleep(300);
}

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
        if (getStrategy() === 'linkedin' || getStrategy() === 'apollo') await quickScroll();
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
        const isLi = getStrategy() === 'linkedin';
        if (isLi) await quickScroll();
        pageLeads = await gatherBlocks();
        if (!pageLeads.length) { sendResponse({ ok: false, error: 'No leads found', saved: 0 }); return; }
        const filters = getStrategy() === 'linkedin' ? liFilters() : {};
        const resp = await fetch(API + '/api/scraper/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: pageLeads, url: location.href, strategy: getStrategy(), source: getStrategy() + '_scrape', filters }),
          signal: AbortSignal.timeout(60000)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
        // Auto-advance: if on LinkedIn, trigger full auto-scrape of remaining pages
        if (isLi && isLiPage()) {
          sendResponse({ ok: true, ...data, autoAdvancing: true });
          await sleep(1500 + Math.random() * 2000);
          if (!isActive) runAuto().catch(e => reportError(e.message));
        } else {
          sendResponse({ ok: true, ...data });
        }
      } catch (e) { sendResponse({ ok: false, error: e.message, saved: 0 }); }
    })();
    return true;
  }

  if (msg.action === 'START_AUTO') {
    if (!isActive) {
      const strategy = getStrategy();
      if (strategy === 'apollo') {
        runAutoApollo().catch(e => reportError(e.message));
      } else if (strategy === 'opencorporates') {
        runAutoOpenCorporates().catch(e => reportError(e.message));
      } else if (strategy === 'linkedin') {
        runAuto().catch(e => reportError(e.message));
      } else {
        // Generic auto-scraper for "Other" sites (uses nextPage button detection)
        runAutoGeneric().catch(e => reportError(e.message));
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'STOP') {
    stopFlag = true;
    navPending = false;
    chrome.storage.local.remove(['pendingAutoStart', 'pendingTabId']).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'OC_DIAGNOSE') {
    const diag = ocDiagnose();
    console.log('[Data Bunker] OC DIAGNOSIS:', JSON.stringify(diag, null, 2));
    sendResponse(diag);
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
    totalResults: s === 'linkedin' ? liTotalResults() : s === 'apollo' ? apolloTotalResults() : s === 'opencorporates' ? ocTotalResults() : 0,
    currentPage: s === 'linkedin' ? liCurrentPage() : s === 'apollo' ? apolloCurrentPage() : s === 'opencorporates' ? ocCurrentPage() : 0,
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
    case 'linkedin':        return gatherLinkedIn();
    case 'apollo':          return gatherApollo();
    case 'maps':            return gatherMaps();
    case 'opencorporates':  return gatherOpenCorporates();
    case 'yelp':            return gatherCards('[class*="businessName"], [class*="container__09f24"]');
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

  console.log('[Data Bunker] gatherLinkedIn() — scanning DOM...');

  // ── Approach 1: Find containers by known CSS classes ──
  const containerSelectors = [
    'li.reusable-search__result-container',
    'li[class*="result-container"]',
    'li[class*="entity-result"]',
    'div[data-view-name*="search-entity"]',
    'li[class*="search-result"]',
    'li[class*="reusable-search"]',
    // 2025-2026 LinkedIn class patterns
    '[class*="entity-result__item"]',
    '[class*="search-result__wrapper"]',
    '[class*="search-entity"]',
    'div[class*="t-roman"][class*="t-sans"]',
  ];

  const containers = [];
  for (const sel of containerSelectors) {
    try {
      const els = document.querySelectorAll(sel);
      if (els.length >= 2) {
        console.log('[Data Bunker] Container selector hit:', sel, '→', els.length, 'elements');
        els.forEach(li => containers.push(li));
        break;
      }
    } catch {}
  }

  // ── Approach 2: Find the <ul> or <div> that holds all the search results ──
  // LinkedIn always has a list of results — find it by looking for the parent
  // that contains the most /in/ profile links.
  if (containers.length === 0) {
    console.log('[Data Bunker] No containers via CSS — trying parent-list approach');
    const allProfileLinks = document.querySelectorAll('a[href*="/in/"]');
    console.log('[Data Bunker] Total /in/ links on page:', allProfileLinks.length);

    // Find the best parent <ul> or <ol> or <div> that has the most profile link children
    const parentMap = new Map();
    for (const a of allProfileLinks) {
      const url = liUrl(a.href);
      if (!url) continue;
      // Walk up to find a reasonable list container
      let el = a;
      for (let i = 0; i < 12; i++) {
        if (!el.parentElement || el.parentElement === document.body) break;
        el = el.parentElement;
        if (el.tagName === 'UL' || el.tagName === 'OL' || el.tagName === 'MAIN' ||
            (el.tagName === 'DIV' && el.children.length >= 5)) {
          const key = el;
          if (!parentMap.has(key)) parentMap.set(key, 0);
          parentMap.set(key, parentMap.get(key) + 1);
        }
      }
    }

    // Pick the container with the most profile links
    let bestParent = null, bestCount = 0;
    for (const [el, count] of parentMap) {
      if (count > bestCount) { bestCount = count; bestParent = el; }
    }

    if (bestParent && bestCount >= 3) {
      console.log('[Data Bunker] Best parent:', bestParent.tagName, 'class:', (bestParent.className || '').slice(0, 60), 'with', bestCount, 'profiles');
      // Use direct children of this container as card boundaries
      for (const child of bestParent.children) {
        const links = child.querySelectorAll('a[href*="/in/"]');
        if (links.length > 0) containers.push(child);
      }
      console.log('[Data Bunker] Found', containers.length, 'child containers');
    }
  }

  // ── Process containers ──
  for (const li of containers) {
    const profileLinks = li.querySelectorAll('a[href*="/in/"]');
    if (profileLinks.length === 0) continue;

    // Check unique profiles — if >1, skip (multi-person container)
    const uniqueProfiles = new Set();
    for (const a of profileLinks) {
      const url = liUrl(a.href);
      if (url) uniqueProfiles.add(url);
    }
    if (uniqueProfiles.size > 2) continue; // allow up to 2 (same person may have 2 links)

    const b = liCard(li);
    const key = b?.profileUrl || b?.rawText?.slice(0, 80);
    if (b && key && !seen.has(key)) { seen.add(key); blocks.push(b); }
  }

  console.log('[Data Bunker] After container approach:', blocks.length, 'blocks');

  // ── Approach 3: Nuclear fallback — process each /in/ link individually ──
  if (blocks.length === 0) {
    console.log('[Data Bunker] Containers yielded 0 — trying per-link fallback');
    const allLinks = document.querySelectorAll('a[href*="/in/"]');
    console.log('[Data Bunker] Processing', allLinks.length, 'individual /in/ links');

    for (const a of allLinks) {
      const href = liUrl(a.href);
      if (!href || seen.has(href)) continue;

      // Get the name from the anchor itself
      let name = '';
      // aria-label pattern: "View John Smith's profile"
      const lbl = a.getAttribute('aria-label') || '';
      const m = lbl.match(/View\s+(.+?)[\u2019\u2018\u0027\u2032']s(?:\s+full)?\s+profile/i);
      if (m) name = m[1].trim();
      // span[aria-hidden="true"] inside the link
      if (!name) {
        const sp = a.querySelector('span[aria-hidden="true"]') || a.querySelector('span');
        if (sp) name = sp.textContent.trim();
      }
      // Direct text
      if (!name) name = a.textContent.trim();

      name = cleanName(name);
      if (!name || name.length < 2) continue;
      if (/linkedin member/i.test(name)) continue;

      // Walk up to a reasonable parent for subtitle/location text
      let card = a;
      for (let i = 0; i < 6; i++) {
        if (!card.parentElement || card.parentElement === document.body) break;
        card = card.parentElement;
        const text = (card.innerText || '').trim();
        // Stop when we have enough text (subtitle + location)
        if (text.length > 50 && text.split('\n').length >= 3) break;
        // Stop at list items
        if (card.tagName === 'LI') break;
      }

      // Extract subtitle and location from the card text
      const lines = (card.innerText || '').split('\n').map(l => l.trim()).filter(l => l.length > 2);
      let subtitle = '', loc = '';
      // Find the line after the name
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(name) || name.includes(lines[i])) {
          if (i + 1 < lines.length) {
            const candidate = lines[i + 1];
            if (!/connect|follow|message|^\d+\s*(connection|follower|mutual)/i.test(candidate)) {
              subtitle = candidate;
            }
          }
          if (i + 2 < lines.length && !subtitle) {
            subtitle = lines[i + 2];
          }
          // Location is typically 1-2 lines after subtitle
          const subIdx = subtitle ? lines.indexOf(subtitle) : i + 1;
          if (subIdx + 1 < lines.length) {
            const locCandidate = lines[subIdx + 1];
            if (locCandidate && !/connect|follow|message|^\d+\s*(connection|follower|mutual)/i.test(locCandidate) && locCandidate.length < 100) {
              loc = locCandidate;
            }
          }
          break;
        }
      }

      const rawText = (card.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800);

      seen.add(href);
      blocks.push({ name, subtitle, location: loc, profileUrl: href, rawText, type: 'linkedin_card' });
    }

    console.log('[Data Bunker] Per-link fallback:', blocks.length, 'blocks');
  }

  console.log('[Data Bunker] gatherLinkedIn() TOTAL:', blocks.length, 'blocks');
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
    // Nested spans (LinkedIn often uses span > span[aria-hidden])
    const sp = a.querySelector('span[aria-hidden="true"]') || a.querySelector('span span');
    if (sp) { const t = sp.textContent.trim(); if (t.length > 1 && t.length < 80 && !/linkedin member/i.test(t)) { name = t; break; } }
    // Direct text content of the anchor
    const directText = a.textContent.trim();
    if (directText && directText.length > 2 && directText.length < 80 && !/linkedin member|view.*profile/i.test(directText)) { name = directText; break; }
  }
  // Title-text selectors (LinkedIn 2024-2026 layouts)
  if (!name || /linkedin member/i.test(name)) {
    for (const sel of ['[class*="title-text"] a span[aria-hidden="true"]', '[class*="title-text"] span[aria-hidden="true"]', '.entity-result__title-text span', '[class*="actor-name"]', '[data-anonymize="person-name"]']) {
      const el2 = el.querySelector(sel);
      if (el2) { const t = el2.textContent.trim(); if (t.length > 2 && t.length < 80 && !/linkedin member/i.test(t)) { name = t; break; } }
    }
  }
  if (!name || /linkedin member/i.test(name)) {
    for (const img of el.querySelectorAll('img[alt]')) {
      const alt = img.alt.trim();
      if (alt.length > 2 && alt.length < 60 && !/photo|profile|avatar|linkedin|logo/i.test(alt)) { name = alt; break; }
    }
  }
  // Last resort: first line that looks like a person name (2-4 capitalized words)
  if (!name) {
    const lines = (el.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 5)) {
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(line) && line.length < 60) { name = line; break; }
    }
  }
  // Clean the name — strip bullets, connection degree, special chars
  name = cleanName(name);
  if (!name) return null;

  // Subtitle (job title): try multiple selectors — LinkedIn changes DOM frequently
  const subSelectors = [
    '.entity-result__primary-subtitle',
    '[class*="primary-subtitle"]',
    '.artdeco-entity-lockup__subtitle',
    '[class*="lockup__subtitle"]',
    '[class*="entity-result__summary"]',
    '.reusable-search-simple-insight__text-container',
    '[class*="t-black--light"][class*="t-14"]',
    '.entity-result__content-summary',
    '[class*="entity-result"] [class*="subtitle"]',
    '[class*="entity-result__content"] > div:nth-child(2)',
  ];
  let subtitle = '';
  for (const sel of subSelectors) {
    try {
      const subEl = el.querySelector(sel);
      if (subEl) {
        subtitle = (subEl.querySelector('span[aria-hidden="true"]') || subEl).textContent.trim();
        if (subtitle && subtitle.length > 2 && subtitle !== name) break;
        subtitle = '';
      }
    } catch {}
  }

  // Positional fallback: element right after the name link is usually the job title
  if (!subtitle) {
    const nameLink = el.querySelector('a[href*="/in/"]');
    if (nameLink) {
      let titleContainer = nameLink.closest('[class*="title-line"], [class*="title-text"]') || nameLink.parentElement;
      if (titleContainer) {
        let sibling = titleContainer.nextElementSibling;
        for (let i = 0; i < 3 && sibling; i++) {
          const t = (sibling.querySelector('span[aria-hidden="true"]') || sibling).textContent.trim();
          if (t && t.length > 2 && t.length < 200 && t !== name && !/connect|follow|message|^\d+\s*(connection|follower)/i.test(t)) {
            subtitle = t;
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }
    }
  }

  // Fallback: extract subtitle from rawText
  const rawText = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  if (!subtitle && rawText) {
    // Try newline splitting first — the line right after the name is the job title
    const nlLines = (el.innerText || '').split('\n').map(l => l.trim()).filter(l => l.length > 2);
    let nameIdx = -1;
    for (let i = 0; i < Math.min(nlLines.length, 5); i++) {
      if (name && nlLines[i].includes(name)) { nameIdx = i; break; }
    }
    if (nameIdx >= 0 && nameIdx + 1 < nlLines.length) {
      const candidate = nlLines[nameIdx + 1];
      if (!/connect|follow|message|^\d+\s*(connection|follower|mutual)/i.test(candidate)) {
        subtitle = candidate;
      }
    }
    // Fallback: middle-dot splitting
    if (!subtitle) {
      const lines = rawText.split(/[·]/).map(l => l.trim()).filter(Boolean);
      for (let i = 1; i < Math.min(lines.length, 5); i++) {
        const line = lines[i];
        if (!line || line.length < 3) continue;
        if (/connect|follow|message|degree|mutual/i.test(line)) continue;
        if (/^\d+\s*(connection|follower|mutual)/i.test(line)) continue;
        subtitle = line;
        break;
      }
    }
  }

  const locSelectors = [
    '.entity-result__secondary-subtitle',
    '[class*="secondary-subtitle"]',
    '.artdeco-entity-lockup__caption',
    '[class*="lockup__caption"]',
    '[class*="entity-result__content"] > div:nth-child(3)',
  ];
  let loc = '';
  for (const sel of locSelectors) {
    try {
      const locEl = el.querySelector(sel);
      if (locEl) {
        loc = (locEl.querySelector('span[aria-hidden="true"]') || locEl).textContent.trim();
        if (loc && loc.length > 2 && !/^\d+\s*(connection|follower)/i.test(loc)) break;
        loc = '';
      }
    } catch {}
  }
  // Positional fallback: location is usually the line after the subtitle
  if (!loc && subtitle) {
    const nlLines = (el.innerText || '').split('\n').map(l => l.trim()).filter(l => l.length > 2);
    for (let i = 0; i < nlLines.length; i++) {
      if (nlLines[i].includes(subtitle) && i + 1 < nlLines.length) {
        const candidate = nlLines[i + 1];
        if (candidate && !/connect|follow|message|^\d+\s*(connection|follower|mutual)/i.test(candidate) && candidate.length < 100) {
          loc = candidate;
          break;
        }
      }
    }
  }

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
  const myUrl = liUrl(a.href);
  for (let i = 0; i < 8; i++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    el = el.parentElement;
    // Stop if this element contains other people's profile links
    const otherPeople = [...el.querySelectorAll('a[href*="/in/"]')]
      .filter(x => liUrl(x.href) && liUrl(x.href) !== myUrl);
    if (otherPeople.length > 0) return el.previousElementSibling || el;
    // Good stopping points
    if (el.tagName === 'LI' && el.textContent.trim().length > 15) return el;
    if (el.querySelector?.('[class*="primary-subtitle"]')) return el;
  }
  return a.closest('li') || a.parentElement || a;
}

// ── Apollo.io ─────────────────────────────────────────────────────────────────
// Apollo is a dynamic React app with heavy anti-scraping protections.
// DO NOT spam queries or use simple querySelector loops only.
// Strategy: wait for render, target rows by [role='row'] OR div structure,
// extract by text patterns + position in DOM, deduplicate, rate limit.
function isApolloPersonLink(a) {
  return !a.href.includes('overrideScoreId') && /\/people\/[a-f0-9]{15,}/.test(a.href);
}

function gatherApollo() {
  const blocks = [], seen = new Set();

  // Step 1: FIND ROW CONTAINERS
  // Strategy A: [role='row'] elements (Apollo's table-like structure)
  let rows = [...document.querySelectorAll('[role="row"]')];

  // Strategy B: if no role=row, find repeated div containers with person links
  if (rows.length < 2) {
    const personLinks = [...document.querySelectorAll('a[href*="/people/"]')]
      .filter(isApolloPersonLink);
    // Deduplicate by href
    const uniqueLinks = personLinks.filter((a, idx, arr) =>
      arr.findIndex(b => b.href === a.href) === idx
    );
    // Walk up to row container for each link
    for (const link of uniqueLinks) {
      const row = apolloFindRow(link);
      if (row && !rows.includes(row)) rows.push(row);
    }
  }
  console.log('[Data Bunker] gatherApollo() — rows found:', rows.length);

  // Noise lines in Apollo's row that should be stripped before parsing
  const APOLLO_UI_NOISE = /^(access email|access mobile|click to run|qualify contact|qualify account|actions|links|score|add to list|name|job title|company|emails|phone numbers|location|# employees|industries|keywords|save contact|lists|sequence|\+\d+)$/i;

  // Step 2: EXTRACT FIELDS per row using text patterns + position
  for (const row of rows) {
    // Find Apollo person ID from any person link in the row
    const personLink = [...row.querySelectorAll('a[href*="/people/"]')].find(isApolloPersonLink);
    const apolloId = personLink ? (personLink.href.match(/\/people\/([a-f0-9]{15,})/) || [])[1] || '' : '';
    const rowKey = apolloId || (row.innerText || '').slice(0, 80);
    if (!rowKey || seen.has(rowKey)) continue;
    seen.add(rowKey);

    // Parse row innerText — Apollo row format (newline-separated):
    //   Name, Title, Company, noise, Location, employees, industry, keyword
    const lines = (row.innerText || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !APOLLO_UI_NOISE.test(l));

    if (lines.length === 0) continue;

    // Line 0 = person name
    const name = cleanName(lines[0]);
    if (!name || name.length < 2) continue;

    // ── Extract every visible cell in the row ─────────────────────────────────
    let title = '', company = '', email = '', phone = '', location = '';
    let employees = '', industry = '', keywords = '';

    // --- Company: prefer a company/organizations link ---
    const compLink = row.querySelector('a[href*="/organizations/"], a[href*="/companies/"], a[href*="#/accounts/"]');
    if (compLink) company = compLink.textContent.trim();

    // --- Email: mailto link or email pattern ---
    const mailtoLink = row.querySelector('a[href^="mailto:"]');
    if (mailtoLink) email = mailtoLink.href.replace('mailto:', '').trim();
    if (!email) {
      const em = (row.innerText || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      if (em) email = em[0];
    }

    // --- Phone: visible phone number ---
    const ph = (row.innerText || '').match(/[\+]?[\d][\d\s\-().]{6,16}[\d]/);
    if (ph) phone = ph[0].trim();

    // Title = line 1 (right after name)
    if (lines.length > 1 && lines[1].length < 120 && !/^(access|click|qualify|save)/i.test(lines[1])) {
      title = lines[1];
    }

    // Company from line 2 if org link didn't get it
    if (!company && lines.length > 2) {
      const candidate = lines[2];
      if (candidate.length > 1 && candidate.length < 100 &&
          !/^[\d\s\-+()]+$/.test(candidate) &&
          !candidate.includes('@') &&
          !/^(access|click|qualify)/i.test(candidate)) {
        company = candidate;
      }
    }

    // Location: line matching "City, Country" pattern
    for (const line of lines) {
      if (/,\s*(United Kingdom|United States|USA|UK|Canada|Australia|Germany|France|Netherlands|India|Singapore|UAE|Ireland|Spain|Italy|Poland|Sweden|Norway|Denmark|Finland|Belgium|Switzerland|New Zealand|Nigeria|Kenya|South Africa|Brazil|Mexico)/i.test(line)) {
        location = line; break;
      }
    }
    if (!location) {
      for (const line of lines) {
        if (/^[A-Z][a-z][\w\s]+,\s*[A-Z][\w\s]+$/.test(line) && line.length < 60) {
          location = line; break;
        }
      }
    }

    // Employee count: standalone number (Apollo shows headcount like "5" or "201-500")
    for (const line of lines) {
      if (/^\d[\d,]*(\s*[-–]\s*\d[\d,]*)?$/.test(line)) {
        employees = line; break;
      }
    }

    // Industry + keywords: lines after location
    const locationIdx = location ? lines.indexOf(location) : -1;
    const afterLocation = locationIdx >= 0 ? lines.slice(locationIdx + 1) : lines.slice(3);
    for (const line of afterLocation) {
      if (!line || /^\d/.test(line)) continue;
      if (!industry && line.length > 3) { industry = line; continue; }
      if (industry && line.length > 2) { keywords += (keywords ? ', ' : '') + line; }
    }

    // Build a richly labelled rawText so the backend AI can parse everything
    const rawParts = [`Name: ${name}`];
    if (title)     rawParts.push(`Title: ${title}`);
    if (company)   rawParts.push(`Company: ${company}`);
    if (location)  rawParts.push(`Location: ${location}`);
    if (email)     rawParts.push(`Email: ${email}`);
    if (phone)     rawParts.push(`Phone: ${phone}`);
    if (employees) rawParts.push(`Employees: ${employees}`);
    if (industry)  rawParts.push(`Industry: ${industry}`);
    if (keywords)  rawParts.push(`Keywords: ${keywords}`);

    blocks.push({
      name,
      subtitle: title,         // → parseLeadBlock reads this as jobTitle
      company,                  // → parseLeadBlock will now read this directly
      location,
      email,
      phone,
      industry,
      employees,
      keywords,
      rawText: rawParts.join(' | ').slice(0, 800),
      type: 'apollo_card'
    });
  }

  console.log('[Data Bunker] gatherApollo() TOTAL:', blocks.length);

  // Fallback: div row containers when person links have no text (rare)
  if (blocks.length === 0) {
    console.log('[Data Bunker] No person link text — trying zp_ div row fallback');
    // Apollo row divs often share a consistent zp_ class; find ones with both a person and an org link
    const candidateDivs = [...document.querySelectorAll('div[class*="zp_"]')]
      .filter(div => {
        const hasName = [...div.querySelectorAll('a[href*="/people/"]')].some(isApolloPersonLink);
        const hasOrg  = div.querySelector('a[href*="/organizations/"]');
        const childDivs = div.querySelectorAll('div[class*="zp_"]').length;
        return hasName && hasOrg && childDivs < 5; // leaf-level row
      });
    for (const div of candidateDivs) {
      const raw = (div.innerText || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length < 10) continue;
      const key = raw.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ rawText: raw.slice(0, 800), type: 'apollo_card' });
    }
  }

  return blocks;
}

function apolloFindRow(link) {
  // Walk up from a clean person name link until a container holds exactly 1 such link.
  // Apollo uses div+CSS grid, so we can't rely on <tr>.
  let el = link;
  let prev = link;
  for (let i = 0; i < 12; i++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    prev = el;
    el = el.parentElement;
    const cleanLinks = [...el.querySelectorAll('a[href*="/people/"]')].filter(isApolloPersonLink);
    // Exactly 1 clean person link in this container = it's the row boundary
    if (cleanLinks.length === 1 && cleanLinks[0].href === link.href) return el;
    // More than 1 = we've overshot into the list container — go back
    if (cleanLinks.length > 1) return prev;
    if (el.tagName === 'LI') return el;
  }
  return link.parentElement;
}

// ── Apollo Helpers ─────────────────────────────────────────────────────────────
function apolloTotalResults() {
  for (const el of document.querySelectorAll('span, div, p')) {
    const t = el.textContent.trim();
    const m = t.match(/(?:of|total)\s+([\d,]+)/i) || t.match(/([\d,]+)\s+(?:people|contacts|results)/i);
    if (m) { const n = parseInt(m[1].replace(/,/g, '')); if (n > 0) return n; }
  }
  return 0;
}

function apolloCurrentPage() {
  // Apollo hash: #/people?page=2&finderViewId=...
  const hash = location.hash || '';
  const m = hash.match(/[?&]page=(\d+)/);
  return m ? parseInt(m[1]) : 1;
}

function getFirstApolloName() {
  const links = [...document.querySelectorAll('a[href*="/people/"]')].filter(isApolloPersonLink);
  for (const link of links) {
    const name = cleanName(link.textContent.trim());
    if (name && name.length > 2) return name;
  }
  return '';
}

function findApolloNextButton() {
  // Strategy 1: aria-label / title / data-cy
  for (const q of [
    '[aria-label*="Next" i]', '[aria-label*="next page" i]',
    '[title*="next" i]', '[data-cy*="next" i]',
  ]) {
    try {
      const el = document.querySelector(q);
      if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') return el;
    } catch {}
  }

  // Strategy 2: find the "X - Y of Z" pagination text and look for the following button
  for (const el of document.querySelectorAll('span, div')) {
    if (/\d+\s*-\s*\d+\s+of\s+[\d,]+/.test(el.textContent) && el.children.length === 0) {
      let container = el.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const btns = [...container.querySelectorAll('button:not([disabled])')];
        if (btns.length >= 2) {
          const last = btns[btns.length - 1];
          if (!/prev|back|first|<<|«/i.test(last.getAttribute('aria-label') || '')) return last;
        }
        container = container.parentElement;
      }
      break;
    }
  }

  // Strategy 3: icon-only button in page-bottom area (Apollo uses SVG chevron buttons)
  const allBtns = [...document.querySelectorAll('button:not([disabled])')].reverse();
  for (const btn of allBtns) {
    const ariaLabel = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
    if (ariaLabel.includes('next')) return btn;
    if (btn.querySelector('svg') && !btn.textContent.trim()) {
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.5 && rect.width > 0 && rect.width < 60) return btn;
    }
  }
  return null;
}

async function apolloClickNext() {
  const prevName = getFirstApolloName();
  const nextBtn = findApolloNextButton();

  if (nextBtn) {
    console.log('[Data Bunker] Apollo Next button found — clicking');
    nextBtn.click();
  } else {
    // Fallback: update the hash URL — Apollo's React Router will re-render
    const current = apolloCurrentPage();
    const hash = location.hash || '#/people';
    const newHash = hash.includes('page=')
      ? hash.replace(/page=\d+/, 'page=' + (current + 1))
      : hash + (hash.includes('?') ? '&' : '?') + 'page=' + (current + 1);
    console.log('[Data Bunker] Apollo no Next btn — updating hash:', newHash);
    location.hash = newHash.replace(/^#/, '');
    window.dispatchEvent(new Event('hashchange'));
  }

  // Wait for the person list to change (new page data)
  const changed = await waitFor(
    () => getFirstApolloName() !== prevName && getFirstApolloName() !== '',
    20000
  );
  if (changed) console.log('[Data Bunker] Apollo page changed → first name:', getFirstApolloName());
  else console.log('[Data Bunker] Apollo: page content did not change — stopping');
  return changed;
}

// ── Apollo Auto-Scraper (SPA mode — stays in same content script session) ─────
async function runAutoApollo() {
  isActive = true; stopFlag = false; navPending = false;
  console.log('[Data Bunker] runAutoApollo() started');

  const stored = await chrome.storage.local.get('scraperStats').catch(() => ({}));
  const prev = stored?.scraperStats || {};
  let pages = (prev.status === 'running') ? (prev.pagesProcessed || 0) : 0;
  let saved  = (prev.status === 'running') ? (prev.totalSaved    || 0) : 0;
  const seenKeys = new Set();

  chrome.runtime.sendMessage({ type: 'SCRAPING_STARTED' }).catch(() => {});

  let consecutiveEmpty = 0;
  const MAX_EMPTY = 2;  // stop only after 2 pages in a row with 0 new leads

  try {
    while (!stopFlag && pages < MAX_PAGES) {
      const pn = apolloCurrentPage();
      console.log('[Data Bunker] ═══ Apollo page', pn, '═══');

      // Wait for person name links to load (SPA async render)
      // Filter to clean /#/people/{ObjectId} links (exclude ?overrideScoreId avatar links)
      const hasResults = await waitFor(
        () => [...document.querySelectorAll('a[href*="/people/"]')]
          .filter(isApolloPersonLink).length >= 2,
        30000
      );
      if (!hasResults || stopFlag) break;

      await humanScroll();
      if (stopFlag) break;
      await sleep(1500 + Math.random() * 1000);
      if (stopFlag) break;

      const blocks = gatherApollo();
      const newBlocks = blocks.filter(b => {
        const k = b.name + '|' + (b.rawText || '').slice(0, 60);
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });

      pageLeads = blocks;
      const total = apolloTotalResults();
      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, detectedThisPage: blocks.length, newThisPage: newBlocks.length });

      let pageSaved = 0;
      if (newBlocks.length > 0) {
        consecutiveEmpty = 0;
        try {
          const r = await fetch(API + '/api/scraper/leads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: newBlocks, url: location.href, strategy: 'apollo', source: 'apollo_auto' }),
            signal: AbortSignal.timeout(60000)
          });
          const d = await r.json();
          pageSaved = (d.saved || 0) + (d.updated || 0);
          saved += pageSaved;
          console.log('[Data Bunker] ✅ Apollo page', pn, '— saved', pageSaved, '(total:', saved, ')');
        } catch (e) {
          console.error('[Data Bunker] ❌ Apollo save failed:', e.message);
        }
      } else {
        consecutiveEmpty++;
        console.log('[Data Bunker] ⚠️ Apollo page', pn, '— 0 new (' + consecutiveEmpty + '/' + MAX_EMPTY + ')');
        if (consecutiveEmpty >= MAX_EMPTY) break;
      }

      pages++;
      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, pageSaved });

      await sleep(2000 + Math.random() * 3000);
      if (stopFlag) break;

      // SPA navigation — content script stays alive, no background restart needed
      const moved = await apolloClickNext();
      if (!moved) { console.log('[Data Bunker] Apollo: no more pages'); break; }
      await sleep(1500 + Math.random() * 1000); // let React re-render
    }
  } finally { isActive = false; }

  console.log('[Data Bunker] 🏁 Apollo complete — pages:', pages, 'saved:', saved);
  chrome.runtime.sendMessage({ type: 'SCRAPING_DONE', data: { pagesProcessed: pages, totalSaved: saved } }).catch(() => {});
}


// ── OpenCorporates ────────────────────────────────────────────────────────────
// DIAGNOSTIC: dumps page structure to help debug extraction failures
function ocDiagnose() {
  const result = {
    url: location.href,
    pathname: location.pathname,
    strategy: getStrategy(),
    bodyTextLength: (document.body.innerText || '').length,
    // Count key element types
    allLinks: document.querySelectorAll('a').length,
    companyLinks: document.querySelectorAll('a[href*="/companies/"]').length,
    officerLinks: document.querySelectorAll('a[href*="/officers/"]').length,
    lis: document.querySelectorAll('li').length,
    trs: document.querySelectorAll('tr').length,
    uls: document.querySelectorAll('ul').length,
    divs: document.querySelectorAll('div').length,
    // Sample first 5 company links
    sampleCompanyLinks: [...document.querySelectorAll('a[href*="/companies/"]')].slice(0, 5).map(a => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim().slice(0, 80),
      parentTag: a.parentElement?.tagName,
      parentParentTag: a.parentElement?.parentElement?.tagName,
      closestLi: a.closest('li') ? 'YES' : 'no',
      closestTr: a.closest('tr') ? 'YES' : 'no',
      closestDiv: a.closest('div')?.className?.slice(0, 50) || 'no class',
      parentText: (a.parentElement?.innerText || '').slice(0, 200),
    })),
    // Sample body text (first 2000 chars)
    bodyTextSample: (document.body.innerText || '').slice(0, 2000),
    // Sample first 5 <li> contents
    sampleLis: [...document.querySelectorAll('li')].slice(0, 10).map(li => ({
      text: (li.innerText || '').slice(0, 150),
      hasCompanyLink: li.querySelector('a[href*="/companies/"]') ? true : false,
    })),
  };
  return result;
}

// OpenCorporates is server-rendered HTML (no SPA / lazy loading).
// Page types handled:
//   1. Company search  /companies?q=     /companies/{jur}?q=     → company records
//   2. Company detail  /companies/{jur}/{number}                 → officers as person leads
//   3. Officers search /officers?q=                             → person leads
//
// Extraction strategy:
//   BLOCK-BASED EXTRACTION — DO NOT rely on class names.
//   Use structure, text patterns, position in DOM.
//   Strategy: find all <li>/<div> blocks, filter by content keywords, extract fields.
function gatherOpenCorporates() {
  const path = location.pathname;

  // Route to sub-handlers by URL pattern
  if (/^\/companies\/[a-z_]+\/[^/?#]+$/i.test(path)) {
    return gatherOpenCorporatesCompanyPage();
  }
  if (/^\/officers\b/.test(path)) {
    return gatherOpenCorporatesOfficers();
  }

  const blocks = [], seen = new Set();

  // ══════════════════════════════════════════════════════════════════════════
  // PRIMARY STRATEGY: LINK-CENTRIC EXTRACTION
  // Find ALL <a href="/companies/{jur}/{id}"> on the page.
  // Extract company name from anchor text, metadata from surrounding context.
  // This works regardless of the container structure (li, div, tr, span, etc.)
  // ══════════════════════════════════════════════════════════════════════════
  const companyLinks = [...document.querySelectorAll('a[href*="/companies/"]')];
  const validLinks = companyLinks.filter(a => {
    const href = a.getAttribute('href') || '';
    // Must match /companies/{jurisdiction}/{id_or_slug}
    return /\/companies\/[a-z_]{2,}\/[^/?#]+/i.test(href);
  });
  console.log('[Data Bunker] OC link-centric: found', validLinks.length, 'company links');

  for (const a of validLinks) {
    const companyName = a.textContent.trim();
    if (!companyName || companyName.length < 2) continue;

    // Skip nav/filter links (e.g. "Companies", "remove filter", short labels)
    if (companyName.length > 200) continue;
    if (/^(companies|officers|search|remove|filter|show|hide|view|more|next|prev)/i.test(companyName)) continue;

    // Deduplicate
    const key = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || key.length < 3 || seen.has(key)) continue;
    seen.add(key);

    // JURISDICTION + NUMBER from href
    const href = a.getAttribute('href') || '';
    const hrefMatch = href.match(/\/companies\/([a-z_]+)\/([^/?#]+)/i);
    const jurisdiction = hrefMatch ? hrefMatch[1] : '';
    const companyNumber = hrefMatch ? hrefMatch[2] : '';

    // CONTEXT TEXT: get text from parent or closest block (li, tr, div)
    // This captures "(Jurisdiction, Date, Address)" text around the link
    const container = a.closest('li') || a.closest('tr') || a.parentElement;
    const contextText = container ? (container.innerText || '').trim() : '';

    // Parse metadata from context text
    // OC format: "COMPANY NAME (Jurisdiction, Date-, Address)"
    let incorporationDate = '', address = '', status = '', companyType = '';

    // DATE: "3 Sep 2015" or "2015-09-03" etc
    const dateMatch = contextText.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/i);
    if (dateMatch) incorporationDate = dateMatch[0];

    // ADDRESS: parse from context text
    // OC format: "COMPANY NAME (New York (US), 3 Sep 2015- , 100 MERIDIAN BLVD., ROCHESTER, NY, 14618)"
    // Nested parens means we can't use simple [^)]+ — instead work with the full text
    // Strategy: split by comma, find the date part, everything after it is address
    const allParts = contextText.split(',').map(p => p.trim());
    let addrStartIdx = -1;
    for (let i = 0; i < allParts.length; i++) {
      // The date part looks like "3 Sep 2015-" or "2015-09-03-"
      if (/\d{4}\s*-/.test(allParts[i]) || /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(allParts[i])) {
        addrStartIdx = i + 1;
        break;
      }
    }
    if (addrStartIdx > 0 && addrStartIdx < allParts.length) {
      // Remove trailing paren from last part
      const addrParts = allParts.slice(addrStartIdx);
      const last = addrParts[addrParts.length - 1].replace(/\)\s*$/, '').trim();
      addrParts[addrParts.length - 1] = last;
      address = addrParts.join(', ').trim();
    }
    if (!address) {
      // Fallback: last 3 comma-separated chunks
      if (allParts.length >= 3) address = allParts.slice(-3).join(', ').trim().replace(/\)\s*$/, '');
    }

    // STATUS
    const statusMatch = contextText.match(/\b(active|inactive|dissolved|liquidation|struck off|in administration|closed|revoked|cancelled)\b/i);
    if (statusMatch) status = statusMatch[0];

    // COMPANY TYPE
    const typeMatch = contextText.match(/\b(LLC|LTD\.?|INC\.?|PLC|CORP\.?|L\.?L\.?C\.?|P\.?C\.?|PARTNERSHIP|GMBH|PTY|S\.A\.|S\.R\.L|NONPROFIT)\b/i);
    if (typeMatch) companyType = typeMatch[0];

    // Build rawText
    const rawParts = ['Company: ' + companyName];
    if (companyNumber)     rawParts.push('Number: ' + companyNumber);
    if (jurisdiction)      rawParts.push('Jurisdiction: ' + jurisdiction);
    if (status)            rawParts.push('Status: ' + status);
    if (companyType)       rawParts.push('Type: ' + companyType);
    if (incorporationDate) rawParts.push('Incorporated: ' + incorporationDate);
    if (address)           rawParts.push('Address: ' + address);
    rawParts.push('Raw: ' + contextText.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 400));

    blocks.push({
      name: companyName,
      company: companyName,
      rawText: rawParts.join(' | ').slice(0, 900),
      location: address.slice(0, 200) || '',
      type: 'opencorporates_company',
      source: 'opencorporates',
      companyNumber,
      jurisdiction,
      status,
    });
  }

  console.log('[Data Bunker] OC link-centric extraction: got', blocks.length, 'companies');

  // ══════════════════════════════════════════════════════════════════════════
  // FALLBACK: If link-centric fails, try block-based approaches
  // ══════════════════════════════════════════════════════════════════════════
  if (blocks.length === 0) {
    console.log('[Data Bunker] OC link-centric found 0, trying block fallbacks');
    let items = [];

    // Fallback A: Largest repeating list
    let bestList = null, bestCount = 0;
    for (const list of document.querySelectorAll('ul, ol, tbody')) {
      const children = list.querySelectorAll(':scope > li, :scope > tr');
      if (children.length > bestCount) { bestCount = children.length; bestList = list; }
    }
    if (bestList && bestCount >= 3) {
      items = [...bestList.querySelectorAll(':scope > li, :scope > tr')];
      console.log('[Data Bunker] OC fallback-A (largest list):', items.length);
    }

    // Fallback B: Main content children
    if (items.length === 0) {
      const main = document.querySelector('main, #content, [role="main"], .content, .results');
      if (main) {
        items = [...main.querySelectorAll(':scope > *')].filter(el =>
          (el.innerText || '').trim().length > 15 && (el.innerText || '').trim().length < 2000
        );
        console.log('[Data Bunker] OC fallback-B (main children):', items.length);
      }
    }

    for (const item of items) {
      const text = (item.innerText || '').trim();
      if (!text || text.length < 8) continue;
      let name = '';
      const anchor = item.querySelector('a');
      if (anchor) name = anchor.textContent.trim();
      if (!name) name = text.split('\n')[0].trim().slice(0, 120);
      if (!name || name.length < 2) continue;
      const itemKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!itemKey || seen.has(itemKey)) continue;
      seen.add(itemKey);

      blocks.push({
        name, company: name,
        rawText: 'Company: ' + name + ' | Raw: ' + text.replace(/\n+/g, ' ').slice(0, 600),
        location: '', type: 'opencorporates_company', source: 'opencorporates',
        companyNumber: '', jurisdiction: '', status: '',
      });
    }
    console.log('[Data Bunker] OC fallback extraction: got', blocks.length, 'total');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NUCLEAR FALLBACK: PURE TEXT-BASED EXTRACTION
  // If DOM-based methods fail, parse document.body.innerText directly.
  // OC results appear as lines like:
  //   "APPLE ACQUISITIONS LLC (New York (US), 3 Sep 2015- , 123 MAIN ST, CITY, NY, 12345)"
  // Each company name is typically ALL CAPS or Title Case, followed by parenthesized details.
  // ══════════════════════════════════════════════════════════════════════════
  if (blocks.length === 0) {
    console.log('[Data Bunker] OC — trying pure text-based extraction from page text');
    const bodyText = document.body.innerText || '';
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 15);

    for (const rawLine of lines) {
      let line = rawLine;
      // Strip leading non-ASCII (flag emojis) and country flag text
      line = line.replace(/^[^\x20-\x7E]*\s*/, '');
      line = line.replace(/^(?:United States|United Kingdom|Canada|Australia|Germany|France|Ireland|Netherlands|Singapore|New Zealand|Hong Kong|Japan|India|Brazil|Mexico|South Korea|China|Russia|Switzerland|Sweden|Norway|Denmark|Finland|Belgium|Austria|Spain|Italy|Portugal|Poland|Czech Republic|Israel|South Africa|Thailand|Philippines|Malaysia|Indonesia|Vietnam|Argentina|Chile|Colombia|Peru|Egypt|Turkey|Greece|Romania|Hungary|Bulgaria|Croatia|Serbia|Slovakia|Slovenia|Estonia|Latvia|Lithuania|Luxembourg|Malta|Cyprus|Iceland|Liechtenstein|Monaco|San Marino)\s+flag\s*/i, '');
      line = line.replace(/^branch\s+/i, '');

      // Find first ( and last ) — company name before (, details inside
      const firstParen = line.indexOf('(');
      const lastParen = line.lastIndexOf(')');
      if (firstParen < 3 || lastParen <= firstParen) continue;

      const companyName = line.slice(0, firstParen).trim();
      const details = line.slice(firstParen + 1, lastParen).trim();

      // Must contain a date to be a real result (not a nav link)
      if (!/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}/i.test(details)) continue;

      if (companyName.length < 3 || companyName.length > 200) continue;
      if (/^(search|filter|found|showing|page|companies|officers|next|prev|open|the )/i.test(companyName)) continue;

      const key = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!key || key.length < 3 || seen.has(key)) continue;
      seen.add(key);

      // Parse details: "New York (US), 3 Sep 2015- , ADDRESS PARTS"
      const detailParts = details.split(',').map(p => p.trim());
      let jurisdiction = '', incorporationDate = '', address = '';

      if (detailParts.length > 0) {
        jurisdiction = detailParts[0].replace(/\s*\([^)]*\)\s*/, '').trim();
      }

      let addrStart = -1;
      for (let j = 0; j < detailParts.length; j++) {
        const dm = detailParts[j].match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
        if (dm) { incorporationDate = dm[1]; addrStart = j + 1; break; }
      }
      if (addrStart > 0 && addrStart < detailParts.length) {
        address = detailParts.slice(addrStart).join(', ').trim();
      }

      let companyType = '';
      const typeMatch = companyName.match(/\b(LLC|LTD\.?|INC\.?|PLC|CORP\.?|L\.?L\.?C\.?|P\.?C\.?)\b/i);
      if (typeMatch) companyType = typeMatch[0];

      const rawParts = ['Company: ' + companyName];
      if (jurisdiction)      rawParts.push('Jurisdiction: ' + jurisdiction);
      if (incorporationDate) rawParts.push('Incorporated: ' + incorporationDate);
      if (address)           rawParts.push('Address: ' + address);
      if (companyType)       rawParts.push('Type: ' + companyType);

      blocks.push({
        name: companyName, company: companyName,
        rawText: rawParts.join(' | ').slice(0, 900),
        location: address.slice(0, 200) || '',
        type: 'opencorporates_company', source: 'opencorporates',
        companyNumber: '', jurisdiction, status: '',
      });
    }
    console.log('[Data Bunker] OC text-based extraction: got', blocks.length, 'companies');
  }

  // Final fallback
  if (blocks.length === 0) {
    console.log('[Data Bunker] OC — 0 from ALL strategies, trying gatherGeneric()');
    return gatherGeneric();
  }

  console.log('[Data Bunker] gatherOpenCorporates() TOTAL:', blocks.length);
  return blocks;
}

// Individual company page: extract directors/officers as person leads
function gatherOpenCorporatesCompanyPage() {
  const blocks = [];

  // Company name from the page — try multiple approaches
  let companyName = '';
  const h1 = document.querySelector('h1');
  if (h1) companyName = h1.textContent.trim();
  if (!companyName) companyName = document.title.split(/[-|·—]/)[0].trim();

  // OC officer list: look for officer-related sections
  const officerSelectors = [
    '#officers li',
    '#directors li',
    '#secretaries li',
    'li.officer',
    'ul.officers li',
    '[class*="officer"] li',
    '[id*="officer"] li',
    '[id*="director"] li',
  ];
  let officerItems = [];
  for (const sel of officerSelectors) {
    try {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { officerItems = [...found]; break; }
    } catch {}
  }

  // Fallback: scan for anchor links to /officers/
  if (officerItems.length === 0) {
    const officerLinks = document.querySelectorAll('a[href*="/officers/"]');
    const linkSeen = new Set();
    for (const a of officerLinks) {
      const block = a.closest('li') || a.closest('div') || a.closest('tr') || a.parentElement;
      if (block && !linkSeen.has(block)) { linkSeen.add(block); officerItems.push(block); }
    }
  }

  const seen = new Set();
  for (const item of officerItems) {
    const nameEl = item.querySelector('a[href*="/officers/"], a[href*="/people/"], strong, b');
    const rawName = nameEl ? nameEl.textContent.trim() : (item.innerText || '').split('\n')[0].trim();
    const name = cleanName(rawName);
    if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const roleEl = item.querySelector('[class*="position"], [class*="role"], em');
    const position = roleEl ? roleEl.textContent.trim() : '';

    const dateEl = item.querySelector('[class*="start_date"], [class*="appointed"], time');
    const dateStr = dateEl ? dateEl.textContent.trim() : '';

    const rawText = ['Name: ' + name, position && 'Role: ' + position, dateStr && 'Appointed: ' + dateStr, 'Company: ' + companyName].filter(Boolean).join(' | ');
    blocks.push({ name, subtitle: position, company: companyName, rawText, type: 'opencorporates_officer', source: 'opencorporates' });
  }

  // If no officers, capture the company itself
  if (blocks.length === 0 && companyName) {
    // Grab all page attribute text
    const body = document.querySelector('main, #content, [role="main"], .content') || document.body;
    const attrText = (body?.innerText || '').replace(/\n+/g, ' | ').replace(/\s{2,}/g, ' ').slice(0, 600);
    blocks.push({ name: companyName, company: companyName, rawText: 'Company: ' + companyName + ' | ' + attrText, location: '', type: 'opencorporates_company', source: 'opencorporates' });
  }

  console.log('[Data Bunker] gatherOpenCorporatesCompanyPage() TOTAL:', blocks.length);
  return blocks;
}

// Officers search results: /officers?q=...
function gatherOpenCorporatesOfficers() {
  const blocks = [], seen = new Set();

  // ══════════════════════════════════════════════════════════════════════════
  // PRIMARY: LINK-CENTRIC — find all <a href="/officers/{id}"> links
  // Each officer result has: officer link (name), company link, role/status text
  // OC format: "JOHN SMITH, APPLE INC (New York (US), director, active)"
  // ══════════════════════════════════════════════════════════════════════════
  const officerLinks = [...document.querySelectorAll('a[href*="/officers/"]')];
  const validLinks = officerLinks.filter(a => {
    const href = a.getAttribute('href') || '';
    return /\/officers\/\d+/i.test(href) || /\/officers\/[a-z0-9-]+/i.test(href);
  });
  console.log('[Data Bunker] OC officers link-centric: found', validLinks.length, 'officer links');

  for (const a of validLinks) {
    const rawName = a.textContent.trim();
    if (!rawName || rawName.length < 2 || rawName.length > 200) continue;
    if (/^(officers|search|remove|filter|show|hide|view|more|next|prev)/i.test(rawName)) continue;

    const name = cleanName(rawName);
    if (!name || name.length < 2) continue;

    const nameKey = name.toLowerCase();
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);

    // Get context from container
    const container = a.closest('li') || a.closest('tr') || a.parentElement;
    const contextText = container ? (container.innerText || '').trim() : '';

    // COMPANY: look for a /companies/ link in same container
    let company = '';
    if (container) {
      const compLink = container.querySelector('a[href*="/companies/"]');
      if (compLink) company = compLink.textContent.trim();
    }
    // Fallback: second link in context
    if (!company && container) {
      const allLinks = container.querySelectorAll('a');
      for (const link of allLinks) {
        if (link === a) continue;
        const lt = link.textContent.trim();
        if (lt && lt.length > 2 && lt !== name) { company = lt; break; }
      }
    }

    // ROLE: extract from context text
    const roleMatch = contextText.match(/\b(director|officer|secretary|manager|agent|trustee|member|partner|ceo|cfo|cto|treasurer|president|vice president|chairman|incorporator|subscriber|registered agent)\b/i);
    const position = roleMatch ? roleMatch[0] : '';

    // STATUS
    const statusText = /inactive|resigned|terminated|removed|ceased/i.test(contextText) ? 'inactive' : 'active';

    // DATE
    let dateStr = '';
    const dateMatch = contextText.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2})\b/i);
    if (dateMatch) dateStr = dateMatch[0];

    const rawParts = ['Name: ' + name];
    if (position) rawParts.push('Role: ' + position);
    if (company)  rawParts.push('Company: ' + company);
    if (dateStr)  rawParts.push('Date: ' + dateStr);
    rawParts.push('Status: ' + statusText);
    rawParts.push('Raw: ' + contextText.replace(/\n+/g, ' ').slice(0, 400));

    blocks.push({ name, subtitle: position, company, rawText: rawParts.join(' | ').slice(0, 900), type: 'opencorporates_officer', source: 'opencorporates' });
  }

  console.log('[Data Bunker] OC officers link-centric: got', blocks.length, 'officers');

  // ══════════════════════════════════════════════════════════════════════════
  // FALLBACK: if no /officers/ links, try /companies/ links (some pages list
  // officers alongside their companies)
  // ══════════════════════════════════════════════════════════════════════════
  if (blocks.length === 0) {
    // Try largest repeating list
    let bestList = null, bestCount = 0;
    for (const list of document.querySelectorAll('ul, ol, tbody')) {
      const children = list.querySelectorAll(':scope > li, :scope > tr');
      if (children.length > bestCount) { bestCount = children.length; bestList = list; }
    }
    if (bestList && bestCount >= 3) {
      const items = bestList.querySelectorAll(':scope > li, :scope > tr');
      for (const item of items) {
        const text = (item.innerText || '').trim();
        if (!text || text.length < 5) continue;
        const firstA = item.querySelector('a');
        let name = firstA ? cleanName(firstA.textContent.trim()) : cleanName(text.split('\n')[0]);
        if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());

        let company = '';
        const compLink = item.querySelector('a[href*="/companies/"]');
        if (compLink) company = compLink.textContent.trim();

        const roleMatch = text.match(/\b(director|officer|secretary|manager|agent|trustee)\b/i);
        const position = roleMatch ? roleMatch[0] : '';

        blocks.push({ name, subtitle: position, company, rawText: 'Name: ' + name + (company ? ' | Company: ' + company : '') + ' | Raw: ' + text.replace(/\n/g, ' ').slice(0, 400), type: 'opencorporates_officer', source: 'opencorporates' });
      }
      console.log('[Data Bunker] OC officers fallback (list):', blocks.length);
    }
  }

  if (blocks.length === 0) return gatherGeneric();
  console.log('[Data Bunker] gatherOpenCorporatesOfficers() TOTAL:', blocks.length);
  return blocks;
}

// ── OpenCorporates Pagination Helpers ─────────────────────────────────────────
function ocTotalResults() {
  // OC shows "Found 2,911 companies" or "Found 2,729,279 officers" near the top.
  // Only match the "Found N" pattern to avoid sidebar/marketing text.
  const bodyText = document.body.innerText || '';
  const m = bodyText.match(/found\s+([\d,]+)\s+(?:companies?|officers?|records?|results?)/i);
  if (m) {
    const n = parseInt(m[1].replace(/,/g, ''));
    if (n > 0) return n;
  }
  return 0;
}

function ocCurrentPage() {
  const m = location.search.match(/[?&]page=(\d+)/);
  return m ? parseInt(m[1]) : 1;
}

function ocBuildNextPageUrl() {
  if (!/opencorporates\.com\/(companies|officers|corporate_groupings)/.test(location.href)) return '';
  const url = new URL(location.href);
  url.searchParams.set('page', String(ocCurrentPage() + 1));
  return url.toString();
}

// ── OpenCorporates Auto-Scraper ────────────────────────────────────────────────
// OC is server-rendered: each page is a full page load.
// Strategy:
//   1. Wait for DOM ready (already is when content.js fires)
//   2. Extract companies from current page
//   3. Save to backend — WAIT for confirmation before navigating
//   4. Only navigate if save succeeded; on failure, stop and report
//   5. Background.js detects the OC URL reload and calls START_AUTO again
async function runAutoOpenCorporates() {
  isActive = true; stopFlag = false; navPending = false;
  const MAX_PAGES = 200;

  // Read persistent counters (survive page reloads via storage)
  const stored = await chrome.storage.local.get('scraperStats').catch(() => ({}));
  const prev = stored?.scraperStats || {};
  let pages = (prev.status === 'running') ? (prev.pagesProcessed || 0) : 0;
  let saved  = (prev.status === 'running') ? (prev.totalSaved    || 0) : 0;

  chrome.runtime.sendMessage({ type: 'SCRAPING_STARTED' }).catch(() => {});

  const pn = ocCurrentPage();
  console.log('[Data Bunker] runAutoOpenCorporates() — page', pn, '— prev saved:', saved);

  function done() {
    isActive = false;
    chrome.storage.local.remove('ocConsecutiveEmpty').catch(() => {});
    chrome.storage.local.set({ scraperStats: { status: 'done', pagesProcessed: pages, totalSaved: saved, lastUpdate: Date.now() } }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'SCRAPING_DONE', data: { pagesProcessed: pages, totalSaved: saved } }).catch(() => {});
  }

  function finish() {
    isActive = false;
    chrome.storage.local.remove(['pendingAutoStart', 'pendingTabId', 'ocConsecutiveEmpty']).catch(() => {});
    chrome.storage.local.set({ scraperStats: { status: 'idle', pagesProcessed: pages, totalSaved: saved, lastUpdate: Date.now() } }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'SCRAPING_DONE', data: { pagesProcessed: pages, totalSaved: saved } }).catch(() => {});
  }

  async function navigateToNext(nextUrl) {
    const delay = 2500 + Math.random() * 2500;
    console.log('[Data Bunker] OC — waiting', Math.round(delay / 1000) + 's before next page');
    await sleep(delay);
    if (stopFlag) { finish(); return; }
    navPending = true;
    await chrome.storage.local.set({
      scraperStats: { status: 'running', pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: ocTotalResults(), lastUpdate: Date.now() },
      pendingAutoStart: true,
    }).catch(() => {});
    console.log('[Data Bunker] OC — navigating to:', nextUrl);
    try { chrome.runtime.sendMessage({ type: 'NAV_TO_URL', url: nextUrl }).catch(() => {}); } catch {}
    setTimeout(() => { if (navPending) location.href = nextUrl; }, 1000);
  }

  try {
    if (pages >= MAX_PAGES) { console.log('[Data Bunker] OC — reached MAX_PAGES limit'); done(); return; }

    // --- Step 1: Scroll to trigger lazy content ---
    await quickScroll();
    if (stopFlag) { finish(); return; }
    await sleep(400 + Math.random() * 300);
    if (stopFlag) { finish(); return; }

    // --- Step 2: Gather blocks ---
    const blocks = gatherOpenCorporates();
    pageLeads = blocks;
    const total = ocTotalResults();
    console.log('[Data Bunker] OC page', pn, '— gathered', blocks.length, 'blocks, total results:', total);
    progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, detectedThisPage: blocks.length });

    if (blocks.length === 0) {
      // Don't give up on empty page — could be a layout mismatch or captcha page.
      // Track consecutive empty pages; stop after 3 in a row.
      const stored2 = await chrome.storage.local.get('ocConsecutiveEmpty').catch(() => ({}));
      const emptyRun = ((stored2?.ocConsecutiveEmpty) || 0) + 1;
      await chrome.storage.local.set({ ocConsecutiveEmpty: emptyRun }).catch(() => {});
      if (emptyRun >= 3) {
        console.log('[Data Bunker] OC page', pn, '— 0 blocks for', emptyRun, 'consecutive pages. Stopping.');
        done();
        return;
      }
      console.log('[Data Bunker] OC page', pn, '— 0 blocks, advancing to next page (empty run:', emptyRun, ')');
      const nextUrl = ocBuildNextPageUrl();
      if (!nextUrl) { done(); return; }
      await navigateToNext(nextUrl);
      return;
    }
    // Reset consecutive empty counter on successful extraction
    await chrome.storage.local.remove('ocConsecutiveEmpty').catch(() => {});

    // --- Step 3: Save to backend (MUST succeed before navigating) ---
    let pageSaved = 0;
    let saveOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(API + '/api/scraper/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks, url: location.href, strategy: 'opencorporates', source: 'opencorporates_auto' }),
          signal: AbortSignal.timeout(60000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        pageSaved = (d.saved || 0) + (d.updated || 0);
        saved += pageSaved;
        pages++;
        saveOk = true;
        console.log('[Data Bunker] OC page', pn, '\u2705 saved', pageSaved, '(running total:', saved, ')');
        progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, pageSaved });
        break;
      } catch (e) {
        console.error('[Data Bunker] OC save attempt', attempt, 'failed:', e.message);
        if (attempt < 3) await sleep(3000);
      }
    }

    if (!saveOk) {
      console.error('[Data Bunker] OC — all 3 save attempts failed. Stopping.');
      done();
      return;
    }

    if (stopFlag) { finish(); return; }

    // --- Step 4: Check if there are more pages ---
    const nextUrl = ocBuildNextPageUrl();
    if (!nextUrl) { done(); return; }

    // End detection: no next link AND few results on this page
    const nextLink = document.querySelector('a[rel="next"], a[href*="page=' + (pn + 1) + '"]');
    if (!nextLink && blocks.length < 5 && pn > 1) {
      console.log('[Data Bunker] OC — no next link and few results, last page.');
      done();
      return;
    }

    // --- Step 5: Navigate to next page ---
    await navigateToNext(nextUrl);

  } finally {
    if (!navPending) { isActive = false; }
  }
}


// ── Generic Auto-Scraper — works on any site with a "Next" button ─────────────
// Used by the "Other" tab. Scrapes the current page, saves, then tries to click
// a "Next page" button. Stops when no Next button is found or blocks dry up.
async function runAutoGeneric() {
  isActive = true; stopFlag = false;
  chrome.runtime.sendMessage({ type: 'SCRAPING_STARTED' }).catch(() => {});

  let pages = 0, saved = 0;
  const MAX_PAGES = 100;
  const seenKeys = new Set();

  try {
    while (!stopFlag && pages < MAX_PAGES) {
      pages++;
      console.log('[Data Bunker] runAutoGeneric() — page', pages);

      await quickScroll();
      if (stopFlag) break;
      await sleep(500);
      if (stopFlag) break;

      const blocks = await gatherBlocks();
      const newBlocks = blocks.filter(b => {
        const k = (b.name || b.rawText || '').slice(0, 80);
        if (!k || seenKeys.has(k)) return false;
        seenKeys.add(k); return true;
      });
      pageLeads = blocks;
      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pages, detectedThisPage: blocks.length });

      if (newBlocks.length > 0) {
        try {
          const r = await fetch(API + '/api/scraper/leads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: newBlocks, url: location.href, strategy: getStrategy(), source: 'generic_auto' }),
            signal: AbortSignal.timeout(60000)
          });
          const d = await r.json();
          const ps = (d.saved || 0) + (d.updated || 0);
          saved += ps;
          console.log('[Data Bunker] Generic page', pages, '✅ saved', ps, '(total:', saved, ')');
          progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pages, pageSaved: ps });
        } catch (e) {
          console.error('[Data Bunker] Generic save failed:', e.message);
        }
      }

      if (stopFlag) break;

      // Try to find and click a "Next" button
      const nextBtn = findGenericNextButton();
      if (!nextBtn) { console.log('[Data Bunker] Generic — no Next button found, done.'); break; }
      const prevUrl = location.href;
      nextBtn.click();
      // Wait up to 8s for URL or DOM to change
      const changed = await waitFor(() => location.href !== prevUrl || document.body.scrollHeight > 200, 8000);
      if (!changed) { console.log('[Data Bunker] Generic — Next click did not navigate, done.'); break; }
      await sleep(1200 + Math.random() * 800);
    }
  } finally { isActive = false; }

  console.log('[Data Bunker] 🏁 Generic auto done — pages:', pages, 'saved:', saved);
  chrome.runtime.sendMessage({ type: 'SCRAPING_DONE', data: { pagesProcessed: pages, totalSaved: saved } }).catch(() => {});
}

function findGenericNextButton() {
  // Priority: aria-label, rel, text content
  const queries = [
    '[aria-label*="next" i]:not([disabled])',
    '[rel="next"]',
    'a[href*="page="]:last-of-type',
    '.pagination .next a',
    '.paginering .next a',
    'nav a[href*="page"]',
  ];
  for (const q of queries) {
    try { const el = document.querySelector(q); if (el) return el; } catch {}
  }
  // Fallback: any button/link whose text includes "next" or "→" or ">"
  const all = [...document.querySelectorAll('a, button')];
  for (const el of all) {
    const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (/^(next|next page|следующая|下一页|›|»|→|>)$/.test(t) && !el.disabled && el.offsetParent !== null) return el;
  }
  return null;
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
  console.log('[Data Bunker] runAuto() started — URL:', location.href, 'Page:', liCurrentPage());

  // Restore counters from storage (survived page navigation via NAV_TO_URL)
  const stored = await chrome.storage.local.get('scraperStats').catch(() => ({}));
  const prev = stored?.scraperStats || {};
  let pages = (prev.status === 'running') ? (prev.pagesProcessed || 0) : 0;
  let saved = (prev.status === 'running') ? (prev.totalSaved || 0) : 0;
  const seenUrls = new Set(); // dedup: track profile URLs already scraped

  chrome.runtime.sendMessage({ type: 'SCRAPING_STARTED' }).catch(() => {});

  let consecutiveEmpty = 0; // stop if N pages in a row yield 0 new leads
  const MAX_EMPTY = 3;
  const MAX_PAGES = 200; // safety cap

  try {
    while (!stopFlag && pages < MAX_PAGES) {
      if (!isLiPage()) break;
      const pn = liCurrentPage();
      console.log('[Data Bunker] ═══ Processing page', pn, '═══');

      // ── Step 1: Wait for SEARCH RESULT cards to load ──
      // Wait for profile links to appear on the page.
      // Use a simple count — need at least 2 /in/ links for results to be loaded.
      const hasResults = await waitFor(() => {
        const count = document.querySelectorAll('a[href*="/in/"]').length;
        return count >= 2;
      }, 25000);

      if (!hasResults) {
        console.log('[Data Bunker] No search results loaded on page', pn, '— end of results');
        break;
      }
      if (stopFlag) break;

      // ── Step 2: Scroll and wait for DOM to stabilize ──
      await humanScroll();
      if (stopFlag) break;
      await waitStable(2000, 12000);
      if (stopFlag) break;

      // ── Step 3: Gather leads — RETRY up to 3 times if we get 0 ──
      let blocks = [];
      let newBlocks = [];
      const MAX_GATHER_RETRIES = 3;

      for (let attempt = 1; attempt <= MAX_GATHER_RETRIES; attempt++) {
        blocks = gatherLinkedIn();
        newBlocks = blocks.filter(b => {
          const url = b.profileUrl || b.linkedinUrl || '';
          if (!url || seenUrls.has(url)) return false;
          return true;
        });
        console.log('[Data Bunker] Gather attempt', attempt + '/' + MAX_GATHER_RETRIES,
          '— found', blocks.length, 'blocks,', newBlocks.length, 'new');

        if (newBlocks.length > 0) break;

        // If 0 results, maybe page hasn't fully rendered yet — wait and retry
        if (attempt < MAX_GATHER_RETRIES) {
          console.log('[Data Bunker] 0 results — waiting 5s and retrying...');
          await sleep(5000);
          await humanScroll(); // scroll again to trigger lazy loading
          await waitStable(2000, 8000);
        }
        if (stopFlag) break;
      }

      // Mark all gathered URLs as seen (after retry loop succeeds)
      for (const b of newBlocks) {
        const url = b.profileUrl || b.linkedinUrl || '';
        if (url) seenUrls.add(url);
      }

      pageLeads = blocks;
      const total = liTotalResults();
      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, detectedThisPage: blocks.length, newThisPage: newBlocks.length });

      // ── Step 4: Save leads to backend — ONLY navigate after confirmed save ──
      let pageSaved = 0;
      if (newBlocks.length > 0) {
        consecutiveEmpty = 0;
        try {
          const r = await fetch(API + '/api/scraper/leads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: newBlocks, url: location.href, strategy: 'linkedin', source: 'linkedin_auto', filters: liFilters() }),
            signal: AbortSignal.timeout(60000)
          });
          const d = await r.json();
          pageSaved = (d.saved || 0) + (d.updated || 0);
          saved += pageSaved;
          console.log('[Data Bunker] ✅ Page', pn, '— saved', pageSaved, 'leads (total:', saved, ')');
        } catch (e) {
          console.error('[Data Bunker] ❌ Save failed on page', pn, ':', e.message);
          progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, error: e.message });
          // Don't navigate if save failed — retry this page
          console.log('[Data Bunker] Retrying save in 5s...');
          await sleep(5000);
          if (stopFlag) break;
          try {
            const r2 = await fetch(API + '/api/scraper/leads', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blocks: newBlocks, url: location.href, strategy: 'linkedin', source: 'linkedin_auto', filters: liFilters() }),
              signal: AbortSignal.timeout(60000)
            });
            const d2 = await r2.json();
            pageSaved = (d2.saved || 0) + (d2.updated || 0);
            saved += pageSaved;
            console.log('[Data Bunker] ✅ Retry succeeded — saved', pageSaved, 'leads');
          } catch (e2) {
            console.error('[Data Bunker] ❌ Retry also failed:', e2.message);
          }
        }
      } else {
        consecutiveEmpty++;
        console.log('[Data Bunker] ⚠️ Page', pn, '— 0 new leads (consecutive empty:', consecutiveEmpty + '/' + MAX_EMPTY + ')');
        if (consecutiveEmpty >= MAX_EMPTY) {
          console.log('[Data Bunker] Stopping: ' + MAX_EMPTY + ' consecutive pages with 0 new leads');
          break;
        }
      }

      pages++;
      progress({ pagesProcessed: pages, totalSaved: saved, pageNum: pn, totalResults: total, pageSaved });

      // ── Step 5: Wait, then navigate to next page ──
      // Human-like delay before pagination
      const delay = 3000 + Math.random() * 4000;
      console.log('[Data Bunker] Waiting', Math.round(delay / 1000) + 's before next page...');
      await sleep(delay);
      if (stopFlag) break;

      console.log('[Data Bunker] Calling nextPage() — page', pn, 'done (' + pageSaved + ' saved)');
      if (!(await nextPage())) break;
    }
  } finally { isActive = false; }
  // Only send SCRAPING_DONE if we truly finished (not navigating to next page)
  if (!navPending) {
    console.log('[Data Bunker] 🏁 Scraping complete — pages:', pages, 'total saved:', saved);
    chrome.runtime.sendMessage({ type: 'SCRAPING_DONE', data: { pagesProcessed: pages, totalSaved: saved } }).catch(() => {});
  }
  navPending = false;
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

function liCurrentPage() {
  const p = new URLSearchParams(location.search);
  // LinkedIn uses ?page=N (1-indexed)
  if (p.get('page')) return parseInt(p.get('page')) || 1;
  // Fallback: older URLs use ?start=N (0-indexed, 10 per page)
  if (p.get('start')) return Math.floor(parseInt(p.get('start')) / 10) + 1;
  return 1;
}

function liFilters() {
  const f = {}, p = new URLSearchParams(location.search);
  // Standard LinkedIn search URL parameters
  if (p.get('keywords'))        f.keywords = p.get('keywords');
  if (p.get('network'))         f.connectionDegree = p.get('network');
  if (p.get('geoUrn'))          f.geoUrn = p.get('geoUrn');
  if (p.get('industry')) {
    // LinkedIn industries come as URL-encoded JSON arrays like ["25"] — resolve to text
    let raw = p.get('industry');
    // Strip JSON array brackets and quotes
    raw = raw.replace(/^[\["\]]+|[\["\]]+$/g, '').trim();
    // If it's a numeric code, try to read the industry name from the page filter pills
    if (/^\d+$/.test(raw)) {
      // Look for active industry pill text on the page
      const pillText = extractFilterPillText('industry');
      f.industry = pillText || null; // don't save numeric codes
    } else if (raw.length > 1 && !/^\d+$/.test(raw)) {
      f.industry = raw;
    }
  }
  if (p.get('currentCompany'))  f.currentCompany = p.get('currentCompany');
  if (p.get('pastCompany'))     f.pastCompany = p.get('pastCompany');
  if (p.get('school'))          f.school = p.get('school');
  if (p.get('profileLanguage')) f.profileLanguage = p.get('profileLanguage');
  if (p.get('serviceCategory')) f.serviceCategory = p.get('serviceCategory');
  if (p.get('title'))           f.title = p.get('title');
  // Collect all active filter pills from the page UI
  const pillSelectors = [
    '.search-reusables__filter-pill-button.toggled span',
    '[aria-checked="true"] span',
    '.search-reusables__filter-value-text',
    '[class*="filter-pill"][class*="active"] span',
    '.artdeco-pill--selected span',
    '.search-reusables__filter-list button[aria-pressed="true"] span',
  ];
  const pills = new Set();
  for (const sel of pillSelectors) {
    try { document.querySelectorAll(sel).forEach(e => { const t = e.textContent.trim(); if (t && t.length > 1 && t.length < 100) pills.add(t); }); } catch {}
  }
  if (pills.size) f.activeFilters = [...pills];
  // Try to extract location text from results header
  for (const sel of ['.search-results__cluster-title', '[class*="search-results-container"] h1', '[class*="search-results-container"] h2']) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        const locMatch = text.match(/(?:in|from|near)\s+(.+?)(?:\s*$|\s*\|)/i);
        if (locMatch) { f.locationText = locMatch[1].trim(); break; }
      }
    } catch {}
  }
  return f;
}

// Helper: try to extract a human-readable filter label from LinkedIn's UI pills
function extractFilterPillText(filterType) {
  // LinkedIn shows active filters as pill buttons with text labels
  const selectors = [
    '.search-reusables__filter-pill-button span',
    '[aria-checked="true"] span',
    '.search-reusables__filter-value-text',
    '.artdeco-pill--selected span',
    '.search-reusables__filter-list button[aria-pressed="true"] span',
    // The filter sidebar shows labels
    '[class*="search-reusables__filter"] [class*="t-bold"]',
    '[class*="filter-pill"] span',
  ];
  for (const sel of selectors) {
    try {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent.trim();
        // Industry pills are typically >3 chars, not numeric, not generic labels
        if (t && t.length > 3 && t.length < 80 && !/^\d+$/.test(t) &&
            !/^(all|any|filter|clear|show|results|people|apply)/i.test(t)) {
          return t;
        }
      }
    } catch {}
  }
  return null;
}

// ── Pagination ────────────────────────────────────────────────────────────────

async function nextPage() {
  const currentPage = liCurrentPage();
  const nextPageNum = currentPage + 1;
  console.log('[Data Bunker] nextPage() — currently on page', currentPage, '→ going to page', nextPageNum);
  console.log('[Data Bunker] Current URL:', location.href);

  // Only paginate on LinkedIn search pages
  const isPaginatable = location.href.includes('linkedin.com/search/results/') ||
                        location.href.includes('linkedin.com/sales/search');
  if (!isPaginatable) {
    console.log('[Data Bunker] Not a paginatable LinkedIn search page — stopping');
    return false;
  }

  // Build next page URL by changing/adding ?page=N
  const url = new URL(location.href);
  url.searchParams.set('page', String(nextPageNum));
  // Remove old 'start' param if present (LinkedIn doesn't need both)
  url.searchParams.delete('start');
  const nextUrl = url.toString();

  console.log('[Data Bunker] Next URL:', nextUrl);

  // Prepare for page reload — stop the current runAuto() loop cleanly
  navPending = true;
  stopFlag = true;

  // Save progress so runAuto() resumes after the page reloads
  // Merge with existing stats to preserve totalSaved counter
  const currentStats = await chrome.storage.local.get('scraperStats').catch(() => ({}));
  const existingSaved = currentStats?.scraperStats?.totalSaved || 0;
  await chrome.storage.local.set({
    scraperStats: {
      status: 'running',
      pagesProcessed: currentPage,
      totalSaved: existingSaved,
      lastUpdate: Date.now()
    },
    pendingAutoStart: true
  }).catch(() => {});

  // Layer 1: Ask background.js to navigate (sets pendingTabId for tab watcher)
  try {
    chrome.runtime.sendMessage({ type: 'NAV_TO_URL', url: nextUrl }).catch(() => {});
  } catch (e) {
    console.warn('[Data Bunker] NAV_TO_URL message failed:', e.message);
  }

  // Layer 2: If background.js doesn't navigate within 3s, force it directly
  await sleep(3000);
  if (liCurrentPage() === currentPage) {
    console.log('[Data Bunker] Background nav timeout — forcing window.location.href');
    window.location.href = nextUrl;
  }

  return false;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitFor(fn, ms = 10000) { return new Promise(res => { const t = Date.now(), id = setInterval(() => { if (fn()) { clearInterval(id); res(true); } else if (Date.now() - t > ms) { clearInterval(id); res(false); } }, 200); }); }
function waitStable(stableMs = 1500, timeout = 10000) { return new Promise(res => { let prev = 0, since = Date.now(); const t = Date.now(), id = setInterval(() => { const c = document.querySelectorAll('a[href*="/in/"], tr, li, article').length; if (c !== prev) { prev = c; since = Date.now(); } if ((c > 0 && Date.now() - since >= stableMs) || Date.now() - t > timeout) { clearInterval(id); res(c); } }, 300); }); }

// ── Floating Overlay — small draggable panel showing scraping progress ────────
(function initOverlay() {
  if (document.getElementById('db-overlay')) return;
  const strategy = getStrategy();
  if (strategy === 'generic' && !location.hostname.includes('linkedin') && !location.hostname.includes('apollo') && !location.hostname.includes('opencorporates')) return;

  const overlay = document.createElement('div');
  overlay.id = 'db-overlay';
  overlay.innerHTML = `
    <div id="db-ov-header" style="cursor:grab;display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="url(#dbg)" stroke-width="2"/><path d="M8 12h8M12 8v8" stroke="url(#dbg)" stroke-width="2" stroke-linecap="round"/><defs><linearGradient id="dbg" x1="3" y1="3" x2="21" y2="21"><stop stop-color="#818cf8"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs></svg>
      <span style="font-weight:700;font-size:11px;background:linear-gradient(135deg,#818cf8,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Data Banker</span>
      <span id="db-ov-badge" style="margin-left:auto;font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(129,140,248,0.15);color:#818cf8;font-weight:700">IDLE</span>
    </div>
    <div id="db-ov-status" style="font-size:11px;color:#94a3b8;margin-bottom:4px">Ready</div>
    <div style="display:flex;gap:4px;">
      <div style="text-align:center;flex:1"><div id="db-ov-saved" style="font-size:16px;font-weight:700;color:#818cf8">0</div><div style="font-size:8px;color:#64748b;letter-spacing:0.5px">SAVED</div></div>
      <div style="text-align:center;flex:1"><div id="db-ov-page" style="font-size:16px;font-weight:700;color:#e6edf3">0</div><div style="font-size:8px;color:#64748b;letter-spacing:0.5px">PAGE</div></div>
    </div>
  `;
  overlay.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;width:180px;padding:10px 12px;background:rgba(11,15,20,0.92);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.08);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#e6edf3;transition:opacity 0.3s;';
  document.body.appendChild(overlay);

  // Draggable
  const header = overlay.querySelector('#db-ov-header');
  let isDrag = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => { isDrag = true; ox = e.clientX - overlay.offsetLeft; oy = e.clientY - overlay.offsetTop; header.style.cursor = 'grabbing'; });
  document.addEventListener('mousemove', e => { if (!isDrag) return; overlay.style.left = (e.clientX - ox) + 'px'; overlay.style.top = (e.clientY - oy) + 'px'; overlay.style.right = 'auto'; overlay.style.bottom = 'auto'; });
  document.addEventListener('mouseup', () => { isDrag = false; header.style.cursor = 'grab'; });

  // Poll scraper stats and update overlay
  setInterval(async () => {
    try {
      const { scraperStats } = await chrome.storage.local.get('scraperStats');
      if (!scraperStats) return;
      const badge = overlay.querySelector('#db-ov-badge');
      const statusEl = overlay.querySelector('#db-ov-status');
      const savedEl = overlay.querySelector('#db-ov-saved');
      const pageEl = overlay.querySelector('#db-ov-page');
      savedEl.textContent = (scraperStats.totalSaved || 0).toLocaleString();
      pageEl.textContent = scraperStats.pagesProcessed || scraperStats.pageNum || 0;
      if (scraperStats.status === 'running') {
        badge.textContent = 'SCRAPING';
        badge.style.background = 'rgba(45,212,191,0.15)';
        badge.style.color = '#2dd4bf';
        statusEl.textContent = (scraperStats.totalSaved || 0) + ' records found';
        statusEl.style.color = '#2dd4bf';
      } else if (scraperStats.status === 'done') {
        badge.textContent = 'DONE';
        badge.style.background = 'rgba(52,211,153,0.15)';
        badge.style.color = '#34d399';
        statusEl.textContent = 'Completed — ' + (scraperStats.totalSaved || 0) + ' saved';
        statusEl.style.color = '#34d399';
      } else {
        badge.textContent = 'IDLE';
        badge.style.background = 'rgba(129,140,248,0.15)';
        badge.style.color = '#818cf8';
        statusEl.textContent = 'Ready';
        statusEl.style.color = '#94a3b8';
      }
    } catch(e) {}
  }, 1000);
})();

console.log('%c[Data Banker v7] Strategy: ' + getStrategy(), 'color:#818cf8;font-weight:bold');
