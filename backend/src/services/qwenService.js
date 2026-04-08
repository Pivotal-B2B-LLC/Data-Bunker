'use strict';

/**
 * Qwen 2.5 (0.5B) Extraction Service
 *
 * Responsibilities:
 *  1. extractFullContact — master method: extracts ALL contact fields from ANY
 *     raw scraped text (LinkedIn card, website snippet, any HTML text dump).
 *     Returns: firstName, lastName, jobTitle, company, city, country,
 *              email, phone, industry, seniority, emailFormatGuess
 *  2. Enrich partial records — industry, country, normalised title, seniority
 *  3. Validate: is this a real person / real company?
 *
 * All prompts are few-shot engineered for 0.5B — JSON-only output.
 */

const http = require('http');

const HOST  = process.env.OLLAMA_HOST  || 'localhost';
const PORT  = parseInt(process.env.OLLAMA_PORT || '11434', 10);
const MODEL = process.env.QWEN_MODEL   || 'qwen2.5:0.5b';

const EXTRACT_SYSTEM = `You are a contact data extractor. Output ONLY valid JSON. No markdown, no explanation, no extra text.`;
const ENRICH_SYSTEM  = `You are a business data enricher. Output ONLY valid JSON. No markdown, no explanation.`;

// ── Few-shot examples baked into the extraction prompt ────────────────────────
// These teach Qwen exactly what we expect, critical for a 0.5B model
const FULL_EXTRACT_FEW_SHOT = `You extract contact info from scraped text. Output ONLY JSON. No extra text.

EXAMPLE 1:
Text: "Sarah Jones · CEO at TechCorp Ltd · London, United Kingdom · sarah.jones@techcorp.co.uk · +44 207 946 0958"
Output: {"firstName":"Sarah","lastName":"Jones","jobTitle":"CEO","company":"TechCorp Ltd","city":"London","country":"United Kingdom","email":"sarah.jones@techcorp.co.uk","phone":"+44 207 946 0958","industry":"Technology","seniority":"C-Suite"}

EXAMPLE 2:
Text: "James Wilson Senior Marketing Manager DigitalHub Solutions New York United States"
Output: {"firstName":"James","lastName":"Wilson","jobTitle":"Senior Marketing Manager","company":"DigitalHub Solutions","city":"New York","country":"United States","email":null,"phone":null,"industry":"Marketing","seniority":"Senior"}

EXAMPLE 3:
Text: "Mohammed Al-Rashid · Founder & Managing Director · Al-Rashid Consulting · Dubai, UAE · +971 50 123 4567 · mohammed@alrashid.ae"
Output: {"firstName":"Mohammed","lastName":"Al-Rashid","jobTitle":"Founder & Managing Director","company":"Al-Rashid Consulting","city":"Dubai","country":"United Arab Emirates","email":"mohammed@alrashid.ae","phone":"+971 50 123 4567","industry":"Consulting","seniority":"C-Suite"}

EXAMPLE 4:
Text: "Emma Clarke · Junior Software Developer · StartupXYZ · Manchester, England"
Output: {"firstName":"Emma","lastName":"Clarke","jobTitle":"Junior Software Developer","company":"StartupXYZ","city":"Manchester","country":"United Kingdom","email":null,"phone":null,"industry":"Technology","seniority":"Junior"}

Now extract from this text:`;

class QwenService {
  constructor() {
    this.model     = MODEL;
    this.available = null;
  }

  // ── Low-level transport ────────────────────────────────────────────────────
  _post(body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: HOST, port: PORT, path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 60000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ response: data }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Qwen request timed out')); });
      req.write(payload);
      req.end();
    });
  }

  async _ask(system, prompt, maxTokens = 200) {
    const resp = await this._post({
      model:  this.model,
      system,
      prompt,
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.1, top_p: 0.9 },
    });
    const raw = (resp.response || '').trim();
    // Strip any accidental markdown fences
    return raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  }

  async isAvailable() {
    if (this.available !== null) return this.available;
    try {
      const res = await new Promise((resolve, reject) => {
        http.get({ hostname: HOST, port: PORT, path: '/api/tags', timeout: 5000 }, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
        }).on('error', reject).on('timeout', reject);
      });
      const tags = JSON.parse(res);
      this.available = Array.isArray(tags.models) &&
        tags.models.some(m => m.name.startsWith('qwen2.5'));
    } catch {
      this.available = false;
    }
    return this.available;
  }

  // ── 1. MASTER EXTRACTION — all fields from any raw scraped text ───────────────
  /**
   * extractFullContact: the primary method called by the scraper.
   * Extracts every possible field from raw scraped text using few-shot prompting.
   *
   * Input:  rawText — any text dump from a LinkedIn card, website page, etc.
   * Returns: {
   *   firstName, lastName, jobTitle, company, city, country,
   *   email, phone, industry, seniority, emailFormatGuess
   * }
   * All fields null if not found. Never throws.
   */
  async extractFullContact(rawText) {
    if (!rawText || rawText.trim().length < 3) return this._emptyContact();

    const truncated = rawText.slice(0, 600);

    // Always run regex first — fast, reliable for common patterns
    const regex = this._fullRegexExtract(truncated);

    // If Qwen is not available, return regex result
    const available = await this.isAvailable().catch(() => false);
    if (!available) {
      return { ...this._emptyContact(), ...regex };
    }

    const prompt = `${FULL_EXTRACT_FEW_SHOT}
Text: "${truncated}"
Output:`;

    try {
      const raw = await this._ask(EXTRACT_SYSTEM, prompt, 180);
      const parsed = this._safeParseJSON(raw);
      if (!parsed) return { ...this._emptyContact(), ...regex };

      // Merge: prefer LLM, fall back to regex for each field
      const merged = {
        firstName:       parsed.firstName       || regex.firstName       || null,
        lastName:        parsed.lastName        || regex.lastName        || null,
        jobTitle:        parsed.jobTitle        || regex.jobTitle        || null,
        company:         parsed.company         || regex.company         || null,
        city:            parsed.city            || regex.city            || null,
        country:         parsed.country         || regex.country         || null,
        email:           parsed.email           || regex.email           || null,
        phone:           parsed.phone           || regex.phone           || null,
        industry:        parsed.industry        || regex.industry        || null,
        seniority:       parsed.seniority       || null,
        emailFormatGuess: null,
      };

      // If no email found, guess format from name + company domain
      if (!merged.email && merged.firstName && merged.company) {
        merged.emailFormatGuess = this._guessEmailFormat(merged.firstName, merged.lastName, merged.company);
      }

      // Infer seniority from job title if AI missed it
      if (!merged.seniority && merged.jobTitle) {
        merged.seniority = this._inferSeniority(merged.jobTitle);
      }

      return merged;
    } catch {
      return { ...this._emptyContact(), ...regex };
    }
  }

  _emptyContact() {
    return {
      firstName: null, lastName: null, jobTitle: null, company: null,
      city: null, country: null, email: null, phone: null,
      industry: null, seniority: null, emailFormatGuess: null,
    };
  }

  // ── 1b. Legacy focused extraction (kept for backward compat) ──────────────
  /**
   * extractFromText: lighter extraction — company, jobTitle, city, country only.
   * Used by the background enricher batch loop. For new saves, use extractFullContact.
   */
  async extractFromText(rawText) {
    if (!rawText || rawText.trim().length < 3) return {};
    const truncated = rawText.slice(0, 400);

    // First try fast regex heuristics (no LLM needed for common patterns)
    const regexResult = this._regexExtract(truncated);

    const prompt = `From this LinkedIn card text, extract ONLY:
- company name
- job title
- city
- country

Text: "${truncated}"

Reply with ONLY this JSON (use null if not found):
{"company":null,"jobTitle":null,"city":null,"country":null}`;

    try {
      const raw = await this._ask(EXTRACT_SYSTEM, prompt, 80);
      const parsed = this._safeParseJSON(raw);
      if (parsed) {
        return {
          company:  parsed.company  || regexResult.company  || null,
          jobTitle: parsed.jobTitle || regexResult.jobTitle || null,
          city:     parsed.city     || regexResult.city     || null,
          country:  parsed.country  || regexResult.country  || null,
        };
      }
      return regexResult;
    } catch {
      return regexResult;
    }
  }

  // ── Full regex extractor — runs before LLM, handles common patterns ──────────
  _fullRegexExtract(text) {
    const r = {
      firstName: null, lastName: null, jobTitle: null, company: null,
      city: null, country: null, email: null, phone: null, industry: null,
    };

    // Email
    const emailM = text.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/);
    if (emailM) r.email = emailM[0].toLowerCase();

    // Phone — international format: +44, +1, +971, etc.
    const phoneM = text.match(/(?:\+\d{1,3}[\s\-]?)?(?:\(?\d{2,4}\)?[\s\-]?)(?:\d{3,4}[\s\-]?\d{3,4})/);
    if (phoneM) r.phone = phoneM[0].trim();

    // "Name · Title at Company · Location" — bullet-separated LinkedIn format
    // Split on bullet characters FIRST so we get clean segments
    const bullets = text.split(/\s*[·•|]\s*/);
    if (bullets.length >= 3) {
      // First segment = name
      const nameParts = bullets[0].trim().split(/\s+/);
      if (nameParts.length >= 2 && /^[A-Z]/.test(bullets[0])) {
        r.firstName = nameParts[0];
        r.lastName  = nameParts.slice(1).join(' ');
      }
      // Second segment = "Title at Company" or just title
      const titleSeg = (bullets[1] || '').trim();
      if (titleSeg) {
        const atIdx = titleSeg.lastIndexOf(' at ');
        if (atIdx > 0) {
          r.jobTitle = titleSeg.slice(0, atIdx).trim();
          r.company  = titleSeg.slice(atIdx + 4).split(/[·•\n]/)[0].trim();
        } else {
          r.jobTitle = titleSeg;
          // Third segment might be the company (if second was just title)
          if (bullets.length >= 3 && !r.company) {
            const seg3 = (bullets[2] || '').trim();
            // Only use as company if it doesn't look like a location (no comma+country)
            if (seg3 && !seg3.match(/^[A-Z][a-z]+, [A-Z]/)) {
              r.company = seg3;
            }
          }
        }
      }
      // Look for "City, Country" in remaining segments
      for (let i = 2; i < bullets.length; i++) {
        const seg = (bullets[i] || '').trim();
        const locM = seg.match(/^([A-Z][a-zA-Z ]{2,30}),\s*([A-Z][a-zA-Z ]{2,30})$/);
        if (locM) { r.city = locM[1].trim(); r.country = locM[2].trim(); break; }
      }
    } else {
      // No bullets — try "Title at Company" pattern in full text (no bullets)
      const atMatch = text.match(/([A-Z][^·•@\n]{3,50}?)\s+(?:at|@)\s+([A-Z][^·•@\n\d]{2,60})/);
      if (atMatch) {
        r.jobTitle = atMatch[1].trim();
        r.company  = atMatch[2].split(/[·•\n]/)[0].trim();
      }
      // Location
      const locMatch = text.match(/([A-Z][a-zA-Z ]{2,30}),\s*([A-Z][a-zA-Z ]{2,30})/);
      if (locMatch && !r.company) {
        r.city    = locMatch[1].trim();
        r.country = locMatch[2].trim();
      }
    }

    return r;
  }

  // Legacy regex extract (used by extractFromText)
  _regexExtract(text) {
    const result = { company: null, jobTitle: null, city: null, country: null };
    const atMatch = text.match(/([A-Z][^·•\n]{3,50})\s+at\s+([A-Z][^·•\n]{2,60})/);
    if (atMatch) {
      result.jobTitle = atMatch[1].trim();
      result.company  = atMatch[2].split(/[·•\n]/)[0].trim();
    }
    const locMatch = text.match(/([A-Z][a-zA-Z\s]+),\s*([A-Z][a-zA-Z\s]+)/);
    if (locMatch && !result.company) {
      result.city    = locMatch[1].trim();
      result.country = locMatch[2].trim();
    }
    return result;
  }

  // Infer seniority from job title using rules
  _inferSeniority(jobTitle) {
    if (!jobTitle) return 'Unknown';
    const t = jobTitle.toLowerCase();
    if (/\b(ceo|cto|cfo|cmo|coo|chief|founder|owner|president|partner|managing director|md)\b/.test(t)) return 'C-Suite';
    if (/\b(vp|vice president|director|head of|principal)\b/.test(t)) return 'Director';
    if (/\b(senior|sr\.?|lead|staff)\b/.test(t)) return 'Senior';
    if (/\b(manager|supervisor|team lead)\b/.test(t)) return 'Manager';
    if (/\b(junior|jr\.?|associate|graduate|intern|trainee|entry)\b/.test(t)) return 'Junior';
    if (/\b(consultant|specialist|analyst|engineer|developer|designer|executive|coordinator)\b/.test(t)) return 'Mid';
    return 'Unknown';
  }

  // Guess email format when no email found: "john.doe@company.com"
  _guessEmailFormat(firstName, lastName, company) {
    if (!firstName || !company) return null;
    const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const l = (lastName || '').toLowerCase().replace(/[^a-z]/g, '');
    // Strip legal suffixes and clean company name to get likely domain
    const domain = company.toLowerCase()
      .replace(/\b(ltd|llc|plc|inc|corp|limited|group|holdings|international|solutions|services|consulting)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30);
    if (!domain) return null;
    const formats = [];
    if (f && l) formats.push(`${f}.${l}@${domain}.com`);
    if (f && l) formats.push(`${f[0]}${l}@${domain}.com`);
    if (f)      formats.push(`${f}@${domain}.com`);
    return formats.join(' | ');
  }

  // ── 2. Enrich a partial contact record ────────────────────────────────────
  /**
   * Given what we already know about a person, fill in gaps:
   * - infer industry from company name + job title
   * - infer country from city
   * - normalise / expand abbreviated job title
   * - add seniority level
   * - suggest email format guess
   */
  async enrichContact({ firstName, lastName, jobTitle, company, city, country, industry }) {
    const known = JSON.stringify({ firstName, lastName, jobTitle, company, city, country, industry });

    const prompt = `You have partial info about a person:
${known}

Return JSON with inferred/normalised values:
{
  "industry": "...",         (infer from company/title if missing)
  "country": "...",          (infer from city if missing)
  "jobTitleNormalised": "...", (expand abbreviations, standardise)
  "seniority": "Director|Manager|Senior|Mid|Junior|C-Suite|Unknown",
  "emailFormatGuess": "first.last|firstlast|flast|f.last"
}`;

    try {
      const raw = await this._ask(ENRICH_SYSTEM, prompt, 120);
      return this._safeParseJSON(raw);
    } catch { return {}; }
  }

  // ── 3. Enrich a company/account record ────────────────────────────────────
  /**
   * Given a company name (+optional city/country), infer industry, size bracket,
   * company type, and generate a short description.
   */
  async enrichCompany({ company, city, country, website, companySize }) {
    const known = JSON.stringify({ company, city, country, website, companySize });

    const prompt = `Company info: ${known}

Return JSON:
{
  "industry": "...",
  "companyType": "Ltd|PLC|LLC|Startup|Enterprise|SME|NGO|Government|Unknown",
  "description": "one sentence max",
  "enrichedSize": "1-10|11-50|51-200|201-500|501-1000|1000+"
}`;

    try {
      const raw = await this._ask(ENRICH_SYSTEM, prompt, 120);
      return this._safeParseJSON(raw);
    } catch { return {}; }
  }

  // ── 4. Validate record (is it real?) ─────────────────────────────────────
  /**
   * Quick sanity check — is this a real company/person name or garbage?
   * Returns { valid: true/false, reason: string, confidence: 0-100 }
   */
  async validate(type, value) {
    if (!value) return { valid: false, reason: 'empty', confidence: 0 };

    const prompt = `Is this a real ${type} name or garbage/test data?
Value: "${value.slice(0, 100)}"
Reply JSON: {"valid": true/false, "reason": "brief", "confidence": 0-100}`;

    try {
      const raw = await this._ask(EXTRACT_SYSTEM, prompt, 60);
      return this._safeParseJSON(raw) || { valid: false, reason: 'parse error', confidence: 0 };
    } catch { return { valid: true, reason: 'offline', confidence: 50 }; }
  }

  // ── 5. Batch extract from a list of raw strings ───────────────────────────
  /**
   * Process an array of raw text strings, return array of extracted records.
   * Runs sequentially to avoid overloading the 0.5B model on CPU.
   */
  async extractBatch(rawTexts) {
    const results = [];
    for (const text of rawTexts) {
      results.push(await this.extractFromText(text));
      await new Promise(r => setTimeout(r, 50)); // tiny gap between calls
    }
    return results;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _safeParseJSON(str) {
    try { return JSON.parse(str); } catch {
      // Try to extract the first {...} block
      const m = str.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch {}
      return null;
    }
  }
}

module.exports = new QwenService();
