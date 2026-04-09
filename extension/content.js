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
      } else {
        runAuto().catch(e => reportError(e.message));
      }
    }
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
    totalResults: s === 'linkedin' ? liTotalResults() : s === 'apollo' ? apolloTotalResults() : 0,
    currentPage: s === 'linkedin' ? liCurrentPage() : s === 'apollo' ? apolloCurrentPage() : 0,
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
    case 'apollo':      return gatherApollo();
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
// Apollo's person name links in the table point to /contacts/{id}, NOT /people/.
// /people/ is the search-page route (the URL you're currently on).
function gatherApollo() {
  const blocks = [], seen = new Set();

  // Primary: person profile links (/contacts/{id})
  // Fallback: any <a> inside a table cell that looks like a name
  let personLinks = [...document.querySelectorAll('a[href*="/contacts/"]')];
  // Deduplicate by href to avoid nav-menu duplicates
  personLinks = personLinks.filter((a, idx, arr) =>
    arr.findIndex(b => b.href === a.href) === idx
  );
  console.log('[Data Bunker] gatherApollo() — contact links found:', personLinks.length);

  for (const link of personLinks) {
    const name = cleanName(link.textContent.trim());
    if (!name || name.length < 2) continue;

    // Deduplicate by normalised name
    const nameKey = name.toLowerCase().replace(/\s+/g, '');
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);

    // Walk up to the containing row or card boundary
    const row = link.closest('tr') || link.closest('[role="row"]') || apolloFindRow(link);
    if (!row) continue;

    // Get text lines from row, stripping Apollo's locked-feature button labels
    const lines = (row.innerText || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 &&
        !/^(access email|access mobile|click to run|qualify contact|qualify account|actions|links|score|add to list|name|job title|company|emails|phone numbers|location|# employees|industries|keywords)$/i.test(l) &&
        !/^\+\d+$/.test(l)); // strip "+63" keyword-count suffixes

    // Name position in cleaned lines
    const nameIdx = lines.findIndex(l => l.toLowerCase() === name.toLowerCase());

    // Title: line immediately after name
    const titleIdx = nameIdx >= 0 ? nameIdx + 1 : 1;
    const title = (titleIdx < lines.length && lines[titleIdx] &&
      !/^(access|click|qualify)/i.test(lines[titleIdx]) &&
      lines[titleIdx].length < 120) ? lines[titleIdx] : '';

    // Company: prefer visible company link, then line after title
    const compLink = row.querySelector('a[href*="/companies/"], a[href*="#/accounts/"]');
    const company = compLink
      ? compLink.textContent.trim()
      : (titleIdx + 1 < lines.length ? lines[titleIdx + 1] : '');

    // Location: any line matching "City, Country"
    let location = '';
    for (const line of lines) {
      if (/,\s*(United Kingdom|United States|Canada|Australia|Germany|France|India|[A-Z][\w\s]{2,20})\s*$/.test(line)) {
        location = line; break;
      }
    }

    // Email (usually locked on Apollo free, but try in case it's visible)
    const em = (row.innerText || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);

    const rawText = lines.join(' | ').slice(0, 800);

    blocks.push({
      name, subtitle: title, company,
      email: em?.[0] || '', location,
      rawText, type: 'apollo_card'
    });
  }

  console.log('[Data Bunker] gatherApollo() TOTAL:', blocks.length);

  // Fallback: plain table rows when person links aren't present
  if (blocks.length === 0) {
    console.log('[Data Bunker] No person links — trying table rows');
    const rows = Array.from(document.querySelectorAll('tr[class*="zp_"], table tbody tr'))
      .filter(r => r.querySelectorAll('td').length >= 2 && (r.innerText || '').trim().length > 20);
    for (const row of rows) {
      const raw = (row.innerText || '').replace(/\s+/g, ' ').trim();
      if (!/[A-Z][a-z]+ [A-Z][a-z]+/.test(raw)) continue;
      const key = raw.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ rawText: raw.slice(0, 800), type: 'apollo_card' });
    }
  }

  return blocks;
}

function apolloFindRow(link) {
  // Walk up until a container that has exactly 1 person link (clean row boundary)
  let el = link;
  for (let i = 0; i < 8; i++) {
    if (!el.parentElement || el.parentElement === document.body) break;
    el = el.parentElement;
    if (el.querySelectorAll('a[href*="/contacts/"]').length === 1) return el;
    if (el.tagName === 'TR' || el.tagName === 'LI') return el;
  }
  return link.closest('td') || link.parentElement;
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
  const links = document.querySelectorAll('a[href*="/contacts/"]');
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

      // Wait for person contact links to load (async in the SPA)
      // /contacts/{id} links are the actual person rows — not the /people nav link
      const hasResults = await waitFor(
        () => document.querySelectorAll('a[href*="/contacts/"]').length >= 2,
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

console.log('%c[Data Bunker v5] Strategy: ' + getStrategy(), 'color:#7c3aed;font-weight:bold');
