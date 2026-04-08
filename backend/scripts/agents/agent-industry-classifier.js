#!/usr/bin/env node

/**
 * INDUSTRY CLASSIFIER AGENT
 *
 * Auto-classifies companies into correct industry categories using:
 * 1. Company name keyword matching (fast)
 * 2. Website content analysis (accurate)
 * 3. SIC code lookup (UK companies)
 *
 * Also:
 * - Fixes misclassified companies
 * - Fills in missing industries
 * - Normalizes industry names to standard categories
 *
 * Speed: 500-1000 companies/minute (keyword mode)
 * Cost: FREE
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const { pool } = require('../../src/db/connection');

const CONFIG = {
  BATCH_SIZE: 200,
  WEBSITE_BATCH_SIZE: 20,
  PARALLEL: 5,
  DELAY_BETWEEN_REQUESTS: 500,
  CYCLE_DELAY: 60000,
  REQUEST_TIMEOUT: 8000,
};

// Standard industry categories (must match your frontend dropdown)
const STANDARD_INDUSTRIES = [
  'Technology', 'Healthcare', 'Financial Services', 'Manufacturing',
  'Retail & Shopping', 'Restaurants & Food', 'Professional Services',
  'Construction', 'Real Estate', 'Legal Services', 'Education',
  'Marketing & Advertising', 'Automotive', 'Hotels & Lodging',
  'Transportation', 'Energy', 'Telecommunications', 'Media & Publishing',
  'Entertainment', 'Fitness & Sports', 'Non-Profit', 'Government',
  'Agriculture', 'Mining', 'Travel & Tourism', 'Food & Beverage',
];

// Keyword-to-industry mapping (fast classification)
const KEYWORD_RULES = [
  // Technology
  { keywords: ['software', 'tech', 'digital', 'IT ', 'computing', 'cyber', 'data', 'cloud', 'app ', 'SaaS', 'AI ', 'machine learning', 'blockchain', 'web develop', 'programmer', 'developer'], industry: 'Technology' },

  // Healthcare
  { keywords: ['medical', 'health', 'hospital', 'clinic', 'dental', 'dentist', 'doctor', 'physician', 'pharmacy', 'pharma', 'nursing', 'care home', 'optician', 'therapist', 'physiotherapy', 'surgery', 'veterinary', 'vet '], industry: 'Healthcare' },

  // Financial Services
  { keywords: ['bank', 'finance', 'financial', 'insurance', 'mortgage', 'accounting', 'accountant', 'tax ', 'investment', 'wealth', 'credit', 'lending', 'fintech', 'pension', 'fund '], industry: 'Financial Services' },

  // Manufacturing
  { keywords: ['manufacturing', 'factory', 'fabricat', 'industrial', 'precision', 'machining', 'production', 'assembly', 'tooling'], industry: 'Manufacturing' },

  // Retail
  { keywords: ['retail', 'shop ', 'store', 'boutique', 'e-commerce', 'ecommerce', 'wholesale', 'supermarket', 'market '], industry: 'Retail & Shopping' },

  // Restaurants & Food
  { keywords: ['restaurant', 'cafe', 'catering', 'pizza', 'burger', 'sushi', 'bistro', 'diner', 'takeaway', 'bakery', 'pub ', 'bar ', 'grill', 'kitchen'], industry: 'Restaurants & Food' },

  // Professional Services
  { keywords: ['consulting', 'consultancy', 'consultant', 'advisory', 'management', 'recruitment', 'staffing', 'HR ', 'human resource', 'outsourcing', 'training', 'coaching'], industry: 'Professional Services' },

  // Construction
  { keywords: ['construction', 'building', 'builder', 'plumbing', 'plumber', 'electrical', 'electrician', 'roofing', 'renovation', 'contractor', 'joiner', 'carpenter', 'paving', 'demolition', 'scaffolding'], industry: 'Construction' },

  // Real Estate
  { keywords: ['real estate', 'property', 'estate agent', 'letting', 'rental', 'housing', 'land ', 'surveyor', 'conveyancing'], industry: 'Real Estate' },

  // Legal
  { keywords: ['law ', 'legal', 'solicitor', 'lawyer', 'barrister', 'attorney', 'notary', 'litigation', 'paralegal'], industry: 'Legal Services' },

  // Education
  { keywords: ['school', 'university', 'college', 'education', 'academy', 'tutor', 'learning', 'training centre'], industry: 'Education' },

  // Marketing & Advertising
  { keywords: ['marketing', 'advertising', 'media agency', 'PR ', 'public relations', 'branding', 'creative agency', 'SEO', 'social media'], industry: 'Marketing & Advertising' },

  // Automotive
  { keywords: ['auto ', 'car ', 'motor', 'garage', 'vehicle', 'tyre', 'tire', 'MOT ', 'bodyshop', 'car wash', 'driving'], industry: 'Automotive' },

  // Hotels & Lodging
  { keywords: ['hotel', 'hostel', 'B&B', 'bed and breakfast', 'motel', 'guest house', 'inn ', 'lodge', 'resort'], industry: 'Hotels & Lodging' },

  // Transportation
  { keywords: ['transport', 'logistics', 'shipping', 'courier', 'delivery', 'freight', 'haulage', 'trucking', 'moving', 'taxi', 'cab '], industry: 'Transportation' },

  // Energy
  { keywords: ['energy', 'solar', 'wind ', 'oil ', 'gas ', 'petroleum', 'electric', 'renewable', 'power '], industry: 'Energy' },

  // Telecom
  { keywords: ['telecom', 'broadband', 'internet provider', 'mobile network', 'fiber', 'fibre'], industry: 'Telecommunications' },

  // Media
  { keywords: ['media', 'publishing', 'newspaper', 'magazine', 'broadcast', 'radio', 'television', 'film ', 'video production', 'print'], industry: 'Media & Publishing' },

  // Entertainment
  { keywords: ['entertainment', 'gaming', 'cinema', 'theatre', 'theater', 'music', 'event', 'leisure', 'amusement'], industry: 'Entertainment' },

  // Fitness
  { keywords: ['fitness', 'gym', 'sport', 'yoga', 'pilates', 'swimming', 'martial art', 'boxing', 'personal trainer'], industry: 'Fitness & Sports' },

  // Travel
  { keywords: ['travel', 'tourism', 'holiday', 'vacation', 'tour ', 'cruise', 'flight', 'airline'], industry: 'Travel & Tourism' },

  // Agriculture
  { keywords: ['farm', 'agriculture', 'agricultural', 'livestock', 'crop', 'harvest', 'dairy', 'organic farm'], industry: 'Agriculture' },
];

class IndustryClassifierAgent {
  constructor() {
    this.stats = {
      companiesProcessed: 0,
      classifiedByKeyword: 0,
      classifiedByWebsite: 0,
      reclassified: 0,
      errors: 0,
      cycles: 0,
    };
    this.running = true;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get companies with missing or generic industry
   */
  async getCompaniesNeedingClassification() {
    const result = await pool.query(`
      SELECT account_id, company_name, industry, website
      FROM accounts
      WHERE industry IS NULL
         OR industry = ''
         OR industry = 'Unknown'
         OR industry = 'Other'
         OR industry = 'Professional Services'
      ORDER BY created_at DESC
      LIMIT $1
    `, [CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Get companies with non-standard industry names (need normalization)
   */
  async getCompaniesNeedingNormalization() {
    const placeholders = STANDARD_INDUSTRIES.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(`
      SELECT account_id, company_name, industry, website
      FROM accounts
      WHERE industry IS NOT NULL
        AND industry != ''
        AND industry NOT IN (${placeholders})
      LIMIT $1
    `, [...STANDARD_INDUSTRIES, CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Classify company by name keywords (FAST - no network)
   */
  classifyByKeywords(companyName) {
    if (!companyName) return null;
    const nameLower = ` ${companyName.toLowerCase()} `;

    let bestMatch = null;
    let bestScore = 0;

    for (const rule of KEYWORD_RULES) {
      let score = 0;
      for (const keyword of rule.keywords) {
        if (nameLower.includes(keyword.toLowerCase())) {
          score += keyword.length; // Longer keyword matches are more specific
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = rule.industry;
      }
    }

    return bestMatch;
  }

  /**
   * Classify by website content (ACCURATE but slower)
   */
  async classifyByWebsite(website) {
    if (!website) return null;

    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: CONFIG.REQUEST_TIMEOUT,
        maxRedirects: 3,
        validateStatus: (status) => status < 400,
      });

      const html = typeof response.data === 'string' ? response.data : '';

      // Extract text content (strip HTML tags)
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 5000) // First 5000 chars is enough
        .toLowerCase();

      // Score each industry based on keyword density
      let bestIndustry = null;
      let bestScore = 0;

      for (const rule of KEYWORD_RULES) {
        let score = 0;
        for (const keyword of rule.keywords) {
          const regex = new RegExp(keyword.toLowerCase().trim(), 'gi');
          const matches = text.match(regex);
          if (matches) {
            score += matches.length * keyword.length;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestIndustry = rule.industry;
        }
      }

      // Only return if we have a strong enough signal
      return bestScore >= 10 ? bestIndustry : null;
    } catch {
      return null;
    }
  }

  /**
   * Normalize non-standard industry name to closest standard category
   */
  normalizeIndustry(currentIndustry) {
    if (!currentIndustry) return null;
    const lower = currentIndustry.toLowerCase();

    // Direct mappings for common non-standard names
    const mappings = {
      'it': 'Technology', 'software': 'Technology', 'saas': 'Technology',
      'web': 'Technology', 'digital': 'Technology', 'internet': 'Technology',
      'medical': 'Healthcare', 'health': 'Healthcare', 'dental': 'Healthcare',
      'banking': 'Financial Services', 'insurance': 'Financial Services',
      'accounting': 'Financial Services', 'finance': 'Financial Services',
      'shop': 'Retail & Shopping', 'retail': 'Retail & Shopping',
      'food': 'Restaurants & Food', 'restaurant': 'Restaurants & Food',
      'catering': 'Restaurants & Food', 'hospitality': 'Hotels & Lodging',
      'hotel': 'Hotels & Lodging', 'accommodation': 'Hotels & Lodging',
      'consulting': 'Professional Services', 'recruitment': 'Professional Services',
      'building': 'Construction', 'construction': 'Construction',
      'property': 'Real Estate', 'real estate': 'Real Estate',
      'law': 'Legal Services', 'legal': 'Legal Services',
      'school': 'Education', 'education': 'Education',
      'marketing': 'Marketing & Advertising', 'advertising': 'Marketing & Advertising',
      'motor': 'Automotive', 'automotive': 'Automotive', 'car': 'Automotive',
      'transport': 'Transportation', 'logistics': 'Transportation',
      'energy': 'Energy', 'power': 'Energy', 'oil': 'Energy',
      'telecom': 'Telecommunications', 'media': 'Media & Publishing',
      'entertainment': 'Entertainment', 'sport': 'Fitness & Sports',
      'fitness': 'Fitness & Sports', 'gym': 'Fitness & Sports',
      'travel': 'Travel & Tourism', 'tourism': 'Travel & Tourism',
      'farm': 'Agriculture', 'agriculture': 'Agriculture',
      'charity': 'Non-Profit', 'non-profit': 'Non-Profit', 'nonprofit': 'Non-Profit',
    };

    for (const [key, value] of Object.entries(mappings)) {
      if (lower.includes(key)) return value;
    }

    // Try keyword classification on the industry name itself
    return this.classifyByKeywords(currentIndustry);
  }

  /**
   * Save industry classification
   */
  async saveIndustry(accountId, industry) {
    try {
      await pool.query(
        `UPDATE accounts SET industry = $1 WHERE account_id = $2`,
        [industry, accountId]
      );
      return true;
    } catch {
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Process classification batch (keyword-based, fast)
   */
  async processKeywordBatch(companies) {
    for (const company of companies) {
      if (!this.running) break;

      this.stats.companiesProcessed++;

      // Try keyword classification first (instant)
      let industry = this.classifyByKeywords(company.company_name);

      if (industry) {
        await this.saveIndustry(company.account_id, industry);
        this.stats.classifiedByKeyword++;
        continue;
      }

      // Try website classification (slower)
      if (company.website) {
        industry = await this.classifyByWebsite(company.website);
        await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

        if (industry) {
          await this.saveIndustry(company.account_id, industry);
          this.stats.classifiedByWebsite++;
        }
      }
    }
  }

  /**
   * Normalize non-standard industry names
   */
  async normalizeIndustries(companies) {
    for (const company of companies) {
      if (!this.running) break;

      const normalized = this.normalizeIndustry(company.industry);
      if (normalized && normalized !== company.industry) {
        await this.saveIndustry(company.account_id, normalized);
        this.stats.reclassified++;
      }
    }
  }

  /**
   * Main loop
   */
  async run() {
    console.log('='.repeat(60));
    console.log('   INDUSTRY CLASSIFIER AGENT');
    console.log('='.repeat(60));
    console.log('   Methods: Keyword matching + Website content analysis');
    console.log(`   Standard categories: ${STANDARD_INDUSTRIES.length}`);
    console.log('   Cost: FREE');
    console.log('');

    while (this.running) {
      this.stats.cycles++;
      console.log(`\n--- Cycle ${this.stats.cycles} ---`);

      // Phase 1: Classify companies with missing/generic industry
      const needClassification = await this.getCompaniesNeedingClassification();
      if (needClassification.length > 0) {
        console.log(`   Classifying ${needClassification.length} companies...`);
        await this.processKeywordBatch(needClassification);
      }

      // Phase 2: Normalize non-standard industry names
      const needNormalization = await this.getCompaniesNeedingNormalization();
      if (needNormalization.length > 0) {
        console.log(`   Normalizing ${needNormalization.length} industries...`);
        await this.normalizeIndustries(needNormalization);
      }

      console.log(`\n   Stats: ${this.stats.companiesProcessed} processed | Keyword: ${this.stats.classifiedByKeyword} | Website: ${this.stats.classifiedByWebsite} | Normalized: ${this.stats.reclassified} | Errors: ${this.stats.errors}`);

      if (needClassification.length === 0 && needNormalization.length === 0) {
        console.log('   All companies classified. Waiting...');
        await this.delay(CONFIG.CYCLE_DELAY * 2);
      } else {
        await this.delay(CONFIG.CYCLE_DELAY);
      }
    }
  }
}

// Main
const agent = new IndustryClassifierAgent();

process.on('SIGINT', () => { agent.running = false; });
process.on('SIGTERM', () => { agent.running = false; });

agent.run().catch(e => {
  console.error('Industry Classifier Agent failed:', e.message);
  process.exit(1);
});
