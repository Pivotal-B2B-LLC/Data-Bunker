/**
 * Ollama LLM Service
 * Local AI powered by Llama 3.2 1B via Ollama
 * Endpoint: http://localhost:11434
 *
 * Core responsibilities:
 *  - Validate whether company names, contact names, job titles, emails are REAL
 *  - Strip fake/random/gibberish data from the database
 *  - Classify industry and generate descriptions for enrichment
 *  - Power the AI assistant chat
 *  - Generate discovery search queries
 */

const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

// Simple regex guards — fast pre-checks before hitting the LLM
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const GIBBERISH_RE = /^[^aeiouAEIOU]{6,}$|(.)\1{4,}|^[a-z]{1,2}\d{3,}|^\d+$/; // no vowels long run / repeated chars / crap

class OllamaService {
  constructor() {
    this.model = MODEL;
    this.available = null; // null = unchecked
  }

  // ─────────────────────────────────────────────────────────────────
  // Low-level HTTP transport (no external deps)
  // ─────────────────────────────────────────────────────────────────

  _post(path, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const options = {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 180000, // 3 min — LLM inference on CPU can be slow
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ response: data }); }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timed out')); });
      req.write(payload);
      req.end();
    });
  }

  async isAvailable() {
    if (this.available === true) return true;
    try {
      const result = await this._post('/api/generate', {
        model: this.model,
        prompt: 'hi',
        stream: false,
        options: { num_predict: 1 },
      });
      this.available = !!result.response;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /** Single-turn text generation */
  async generate(prompt, options = {}) {
    const result = await this._post('/api/generate', {
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.1,
        num_predict: options.maxTokens ?? 256,
        top_p: 0.9,
      },
    });
    return (result.response || '').trim();
  }

  /** Multi-turn chat */
  async chat(messages, options = {}) {
    const result = await this._post('/api/chat', {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.4,
        num_predict: options.maxTokens ?? 80, // low limit for CPU inference speed
      },
    });
    return (result.message?.content || '').trim();
  }

  // ─────────────────────────────────────────────────────────────────
  // DATA VALIDATION — core purpose: remove fake / garbage data
  // Each method returns an object: { valid: bool, reason: string, cleaned?: string }
  // ─────────────────────────────────────────────────────────────────

  /**
   * Decide if a company name is a real business or fake/random text.
   * Returns { valid, reason, cleaned }
   */
  async validateCompanyName(name) {
    if (!name || name.trim().length < 2) return { valid: false, reason: 'too short' };
    if (GIBBERISH_RE.test(name.trim())) return { valid: false, reason: 'gibberish pattern' };

    // Fast-reject obvious placeholders
    const FAKE_COMPANY_PATTERNS = [
      /^test\b/i, /\btest\s*(company|ltd|inc|corp)\b/i, /^demo\b/i, /^sample\b/i,
      /^example\b/i, /^placeholder\b/i, /^company\s*(name)?\s*here/i, /^n\/?a$/i,
      /^(abc|xyz|foo|bar)\s*(ltd|llc|inc)?$/i, /^[a-z]{1,3}\s*(ltd|llc|inc|corp)?$/i,
    ];
    if (FAKE_COMPANY_PATTERNS.some(r => r.test(name.trim()))) return { valid: false, reason: 'known placeholder pattern' };

    const prompt = `You are a data quality checker for a business database.

Company name: "${name}"

Is this a real, legitimate business name? Answer with EXACTLY one of:
VALID - <cleaned name>
FAKE - <reason>

Rules:
- Real company names look like: "Acme Corp", "Smith & Sons Ltd", "123 Tech Solutions"
- Fake/random names look like: "Asdfg Ltd", "xyzxyz", "Test Company 99", "aaaaaa", random words
- Placeholders like "Sample Business", "Test Ltd", "Demo Inc" are FAKE
- Very short nonsense like "Abc" or "Xyz Ltd" are FAKE
- Do NOT explain. Reply with only VALID or FAKE line.`;

    const raw = await this.generate(prompt, { maxTokens: 30, temperature: 0.1 });
    if (raw.toUpperCase().startsWith('VALID')) {
      const cleaned = (raw.split('-')[1] || name).trim().replace(/^["']|["']$/g, '');
      return { valid: true, reason: 'LLM approved', cleaned: cleaned || name };
    }
    const reason = raw.split('-').slice(1).join('-').trim() || 'LLM rejected';
    return { valid: false, reason };
  }

  /**
   * Decide if a contact name is a real human name (first + last).
   * Returns { valid, reason, firstName, lastName }
   */
  async validatePersonName(fullName) {
    if (!fullName || fullName.trim().length < 3) return { valid: false, reason: 'too short' };
    if (GIBBERISH_RE.test(fullName.trim())) return { valid: false, reason: 'gibberish pattern' };

    // Fast-reject well-known placeholder names before hitting the LLM
    const FAKE_NAMES = new Set([
      'test user', 'john doe', 'jane doe', 'admin user', 'sample user', 'demo user',
      'unknown person', 'n/a', 'na', 'unknown', 'contact', 'user', 'admin', 'staff',
      'anonymous', 'placeholder', 'name here', 'first last', 'firstname lastname',
      'your name', 'full name', 'person name', 'test name',
    ]);
    if (FAKE_NAMES.has(fullName.toLowerCase().trim())) return { valid: false, reason: 'known placeholder name' };

    const prompt = `You are a data quality checker for a contact database.

Full name: "${fullName}"

Is this a real human person's name? Answer with EXACTLY one of:
VALID - <FirstName> <LastName>
FAKE - <reason>

Rules:
- Real names: "John Smith", "Maria García", "James O'Brien", "Li Wei"
- Fake names: "Test User", "John Doe", "Admin Staff", "Unknown Person", "N/A", random letters
- Names must have at least first name and last name
- A single word or initials only is FAKE
- Do NOT explain. Reply with only VALID or FAKE line.`;

    const raw = await this.generate(prompt, { maxTokens: 30, temperature: 0.1 });
    if (raw.toUpperCase().startsWith('VALID')) {
      const cleaned = (raw.split('-')[1] || fullName).trim().replace(/^["']|["']$/g, '');
      const parts = cleaned.split(/\s+/);
      return { valid: true, reason: 'LLM approved', firstName: parts[0], lastName: parts.slice(1).join(' ') || parts[0] };
    }
    const reason = raw.split('-').slice(1).join('-').trim() || 'LLM rejected';
    return { valid: false, reason };
  }

  /**
   * Decide if a job title is a real, professional title.
   * Returns { valid, reason, cleaned }
   */
  async validateJobTitle(title) {
    if (!title || title.trim().length < 2) return { valid: false, reason: 'too short' };
    if (GIBBERISH_RE.test(title.trim())) return { valid: false, reason: 'gibberish pattern' };

    const prompt = `You are a data quality checker for a contacts database.

Job title: "${title}"

Is this a real, legitimate professional job title? Answer with EXACTLY one of:
VALID - <cleaned title>
FAKE - <reason>

Rules:
- Real titles: "CEO", "Software Engineer", "Sales Manager", "Director of Finance", "HR Consultant"
- Fake/random titles: "asdfgh", "test role", "n/a", "unknown", single random letters, numbers only
- Titles from scraped websites that are UI labels ("Contact Us", "Homepage", "Click Here") are FAKE
- Do NOT explain. Reply with only VALID or FAKE line.`;

    const raw = await this.generate(prompt, { maxTokens: 30, temperature: 0.1 });
    if (raw.toUpperCase().startsWith('VALID')) {
      const cleaned = (raw.split('-')[1] || title).trim().replace(/^["']|["']$/g, '');
      return { valid: true, reason: 'LLM approved', cleaned: cleaned || title };
    }
    const reason = raw.split('-').slice(1).join('-').trim() || 'LLM rejected';
    return { valid: false, reason };
  }

  /**
   * Validate an email address is structurally real and not fake/placeholder.
   * Returns { valid, reason }
   */
  async validateEmail(email) {
    if (!email || !EMAIL_RE.test(email.trim())) return { valid: false, reason: 'invalid format' };
    const lower = email.toLowerCase();

    // Fast-reject obvious garbage before LLM
    const fakeKeywords = ['test@', 'fake@', 'sample@', 'example@', 'demo@', 'noreply@', 'no-reply@', 'donotreply@', 'admin@test', 'user@test', '@test.com', '@example.com', '@mailinator', '@tempmail', '@guerrilla', '@throwam'];
    if (fakeKeywords.some(k => lower.includes(k))) return { valid: false, reason: 'known placeholder domain/prefix' };

    const localPart = lower.split('@')[0];
    if (/^[a-z]{1,2}$/.test(localPart)) return { valid: false, reason: 'local part too short' };
    if (GIBBERISH_RE.test(localPart)) return { valid: false, reason: 'gibberish local part' };

    const prompt = `You are a data quality checker for a business email database.

Email: "${email}"

Does this look like a REAL business email address? Answer with EXACTLY one of:
VALID
FAKE - <reason>

Rules:
- Real: "james.smith@acmecorp.com", "j.brown@techfirm.co.uk", "info@company.org"
- Fake: test addresses, placeholder domains (example.com, test.com, foo.com), random characters
- Do NOT explain. Reply with only VALID or FAKE line.`;

    const raw = await this.generate(prompt, { maxTokens: 20, temperature: 0.1 });
    if (raw.toUpperCase().startsWith('VALID')) return { valid: true, reason: 'LLM approved' };
    const reason = raw.split('-').slice(1).join('-').trim() || 'LLM rejected';
    return { valid: false, reason };
  }

  /**
   * Validate a phone number is real (not placeholder, not random digits).
   * Returns { valid, reason, cleaned }
   */
  async validatePhone(phone) {
    if (!phone || phone.trim().length < 7) return { valid: false, reason: 'too short' };
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return { valid: false, reason: 'wrong digit count' };
    if (/^(.)\1{6,}$/.test(digits)) return { valid: false, reason: 'repeated digits' };
    if (['1234567890', '0987654321', '1111111111', '0000000000'].includes(digits.slice(0, 10))) return { valid: false, reason: 'sequential/repeating digits' };
    return { valid: true, reason: 'passes format check', cleaned: phone.trim() };
  }

  /**
   * Validate an industry/category string is a real business sector.
   * Returns { valid, reason, cleaned }
   */
  async validateIndustry(industry) {
    if (!industry || industry.trim().length < 2) return { valid: false, reason: 'empty' };
    if (GIBBERISH_RE.test(industry.trim())) return { valid: false, reason: 'gibberish' };

    const prompt = `Is "${industry}" a real business industry or sector name? Answer VALID or FAKE only.`;
    const raw = await this.generate(prompt, { maxTokens: 10, temperature: 0.1 });
    if (raw.toUpperCase().startsWith('VALID')) return { valid: true, reason: 'LLM approved', cleaned: industry.trim() };
    return { valid: false, reason: 'not a real industry' };
  }

  /**
   * Validate a full company record and return which fields to nullify.
   * Returns { fieldsToNullify: string[], reason: string }
   */
  async validateCompanyRecord(company) {
    const fieldsToNullify = [];
    const reasons = [];

    const checks = await Promise.allSettled([
      company.name          ? this.validateCompanyName(company.name)      : Promise.resolve(null),
      company.email         ? this.validateEmail(company.email)            : Promise.resolve(null),
      company.phone         ? this.validatePhone(company.phone)            : Promise.resolve(null),
      company.industry      ? this.validateIndustry(company.industry)      : Promise.resolve(null),
    ]);

    const [nameR, emailR, phoneR, industryR] = checks.map(c => c.status === 'fulfilled' ? c.value : null);

    if (nameR && !nameR.valid) { fieldsToNullify.push('name_flag'); reasons.push(`name: ${nameR.reason}`); }
    if (emailR && !emailR.valid) { fieldsToNullify.push('email'); reasons.push(`email: ${emailR.reason}`); }
    if (phoneR && !phoneR.valid) { fieldsToNullify.push('phone'); reasons.push(`phone: ${phoneR.reason}`); }
    if (industryR && !industryR.valid) { fieldsToNullify.push('industry'); reasons.push(`industry: ${industryR.reason}`); }

    return { fieldsToNullify, reasons, nameValid: !nameR || nameR.valid };
  }

  /**
   * Validate a full contact record and return which fields to nullify.
   * Returns { keep: bool, fieldsToNullify: string[], reasons: string[] }
   */
  async validateContactRecord(contact) {
    const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    const fieldsToNullify = [];
    const reasons = [];

    const checks = await Promise.allSettled([
      fullName        ? this.validatePersonName(fullName)          : Promise.resolve(null),
      contact.job_title ? this.validateJobTitle(contact.job_title) : Promise.resolve(null),
      contact.email   ? this.validateEmail(contact.email)          : Promise.resolve(null),
      contact.phone_number ? this.validatePhone(contact.phone_number) : Promise.resolve(null),
    ]);

    const [nameR, titleR, emailR, phoneR] = checks.map(c => c.status === 'fulfilled' ? c.value : null);

    const keep = !nameR || nameR.valid; // drop entire contact if name is fake
    if (nameR && !nameR.valid) reasons.push(`name: ${nameR.reason}`);
    if (titleR && !titleR.valid) { fieldsToNullify.push('job_title'); reasons.push(`job_title: ${titleR.reason}`); }
    if (emailR && !emailR.valid) { fieldsToNullify.push('email'); reasons.push(`email: ${emailR.reason}`); }
    if (phoneR && !phoneR.valid) { fieldsToNullify.push('phone_number'); reasons.push(`phone: ${phoneR.reason}`); }

    // If name is valid but has cleaned version, attach it
    const nameData = (nameR && nameR.valid) ? { firstName: nameR.firstName, lastName: nameR.lastName } : null;

    return { keep, fieldsToNullify, reasons, nameData };
  }

  // ─────────────────────────────────────────────────────────────────
  // ENRICHMENT helpers
  // ─────────────────────────────────────────────────────────────────

  /** Classify a company's industry from its name */
  async classifyIndustry(companyName, description = '') {
    const prompt = `Return ONLY a short industry category (2-5 words) for the company "${companyName}"${description ? ` — ${description}` : ''}. Examples: "Software Development", "Civil Engineering", "Retail Food". No explanation.`;
    return this.generate(prompt, { maxTokens: 20, temperature: 0.1 });
  }

  /** Generate a short one-sentence company description */
  async generateDescription(companyName, industry = '', location = '') {
    const prompt = `Write one sentence (max 25 words) describing what "${companyName}"${industry ? ` (${industry})` : ''}${location ? ` in ${location}` : ''} does. No extra text.`;
    return this.generate(prompt, { maxTokens: 60, temperature: 0.4 });
  }

  /** Generate discovery search queries for a city */
  async generateDiscoveryQueries(city, country, industry = '') {
    const prompt = `Generate 5 short search queries (one per line) to find ${industry || 'businesses'} in ${city}, ${country}. 4-8 words each. Return only the queries, no numbering.`;
    const result = await this.generate(prompt, { maxTokens: 120, temperature: 0.7 });
    return result.split('\n').map(q => q.replace(/^[-*\d.]\s*/, '').trim()).filter(Boolean).slice(0, 5);
  }

  // ─────────────────────────────────────────────────────────────────
  // ASSISTANT
  // ─────────────────────────────────────────────────────────────────

  async answerQuestion(userMessage, context = '') {
    // Keep system prompt minimal to reduce input token processing time on CPU
    const systemPrompt = `You are Data Bunker AI. Answer briefly (max 3 sentences).${context ? ' ' + context.slice(0, 120) : ''}`;
    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage.slice(0, 300) },
    ], { maxTokens: 80, temperature: 0.4 });
  }
}

module.exports = new OllamaService();
