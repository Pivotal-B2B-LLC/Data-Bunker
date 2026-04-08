#!/usr/bin/env node

/**
 * LINKEDIN SCRAPER AGENT
 *
 * Finds company and contact data via LinkedIn search (using DuckDuckGo/Bing as proxy)
 * No LinkedIn API key needed - uses search engine scraping
 *
 * Capabilities:
 * - Find LinkedIn company pages and extract data
 * - Find decision-maker profiles (CEO, CTO, Directors, etc.)
 * - Extract job titles, profile URLs
 * - Match contacts to companies in database
 *
 * 100% FREE - No API costs
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const { pool } = require('../../src/db/connection');

const CONFIG = {
  BATCH_SIZE: 30,
  PARALLEL: 8,
  DELAY_BETWEEN_BATCHES: 2000,
  DELAY_BETWEEN_REQUESTS: 500,
  CYCLE_DELAY: 30000,
  REQUEST_TIMEOUT: 12000,
  MAX_CONTACTS_PER_COMPANY: 5,
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
];

const DECISION_MAKER_TITLES = [
  'CEO', 'Chief Executive', 'Managing Director', 'Founder', 'Co-Founder',
  'CTO', 'Chief Technology', 'VP Engineering', 'Head of Engineering',
  'CFO', 'Chief Financial', 'Finance Director',
  'COO', 'Chief Operating', 'Operations Director',
  'CMO', 'Chief Marketing', 'Marketing Director', 'Head of Marketing',
  'Sales Director', 'Head of Sales', 'VP Sales', 'Business Development',
  'HR Director', 'Head of HR', 'People Director',
  'Director', 'Partner', 'Owner', 'President', 'Vice President',
  'General Manager', 'Regional Manager',
];

class LinkedInScraperAgent {
  constructor() {
    this.stats = {
      companiesProcessed: 0,
      linkedInUrlsFound: 0,
      contactsFound: 0,
      errors: 0,
      cycles: 0,
    };
    this.running = true;
  }

  getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get companies that need LinkedIn enrichment
   */
  async getCompaniesNeedingLinkedIn() {
    const result = await pool.query(`
      SELECT account_id, company_name, city, state_region, country, website, industry
      FROM accounts
      WHERE (linkedin_url IS NULL OR linkedin_url = '')
        AND company_name IS NOT NULL
        AND LENGTH(company_name) > 2
      ORDER BY quality_score DESC NULLS LAST, created_at DESC
      LIMIT $1
    `, [CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Get companies that have few contacts
   */
  async getCompaniesNeedingContacts() {
    const result = await pool.query(`
      SELECT a.account_id, a.company_name, a.city, a.state_region, a.country, a.website, a.industry
      FROM accounts a
      LEFT JOIN (
        SELECT linked_account_id, COUNT(*) as contact_count
        FROM contacts
        GROUP BY linked_account_id
      ) c ON a.account_id = c.linked_account_id
      WHERE (c.contact_count IS NULL OR c.contact_count < 3)
        AND a.company_name IS NOT NULL
        AND LENGTH(a.company_name) > 2
      ORDER BY a.quality_score DESC NULLS LAST
      LIMIT $1
    `, [CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Search for LinkedIn company page via DuckDuckGo
   */
  async findLinkedInCompanyPage(company) {
    try {
      const query = `site:linkedin.com/company "${company.company_name}"`;
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await axios.get(url, {
        headers: { 'User-Agent': this.getRandomUA() },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });

      const html = response.data;

      // Extract LinkedIn company URLs
      const linkedInPattern = /https?:\/\/(www\.)?linkedin\.com\/company\/[a-z0-9\-]+/gi;
      const matches = html.match(linkedInPattern) || [];

      // Deduplicate and pick best match
      const uniqueUrls = [...new Set(matches.map(u => u.toLowerCase().replace('http://', 'https://').replace('www.', '')))];

      if (uniqueUrls.length > 0) {
        // Score URLs by relevance to company name
        const companySlug = company.company_name.toLowerCase().replace(/[^a-z0-9]/g, '');
        let bestUrl = uniqueUrls[0];
        let bestScore = 0;

        for (const linkedInUrl of uniqueUrls) {
          const slug = linkedInUrl.split('/company/')[1] || '';
          const slugClean = slug.replace(/-/g, '');
          const score = this.similarityScore(companySlug, slugClean);
          if (score > bestScore) {
            bestScore = score;
            bestUrl = linkedInUrl;
          }
        }

        return bestUrl;
      }

      return null;
    } catch (error) {
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Search for LinkedIn contacts (decision makers) at a company
   */
  async findLinkedInContacts(company) {
    const contacts = [];

    try {
      // Search for people at the company with decision-maker titles
      const titleGroups = [
        'CEO OR "Managing Director" OR Founder',
        'Director OR "Head of" OR VP',
        'CTO OR CFO OR COO OR CMO',
      ];

      for (const titles of titleGroups) {
        if (contacts.length >= CONFIG.MAX_CONTACTS_PER_COMPANY) break;

        const query = `site:linkedin.com/in "${company.company_name}" ${titles}`;
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        try {
          const response = await axios.get(url, {
            headers: { 'User-Agent': this.getRandomUA() },
            timeout: CONFIG.REQUEST_TIMEOUT,
          });

          const html = response.data;

          // Extract profile URLs and names from search results
          const resultBlocks = html.match(/<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi) || [];

          for (const block of resultBlocks) {
            if (contacts.length >= CONFIG.MAX_CONTACTS_PER_COMPANY) break;

            const hrefMatch = block.match(/href="([^"]*)"/);
            const textMatch = block.match(/>([^<]*)</);

            if (!hrefMatch || !textMatch) continue;

            const profileUrl = decodeURIComponent(hrefMatch[1]);
            const resultText = textMatch[1].trim();

            // Must be a LinkedIn profile URL
            if (!profileUrl.includes('linkedin.com/in/')) continue;

            // Extract name and title from result text
            // Typical format: "John Smith - CEO - Company Name | LinkedIn"
            const parsed = this.parseLinkedInResult(resultText);
            if (!parsed) continue;

            // Verify this person is associated with the company
            const companyNameLower = company.company_name.toLowerCase();
            const resultLower = resultText.toLowerCase();
            if (!resultLower.includes(companyNameLower.substring(0, Math.min(10, companyNameLower.length)))) continue;

            // Check for decision-maker title
            const hasRelevantTitle = DECISION_MAKER_TITLES.some(title =>
              (parsed.title || '').toLowerCase().includes(title.toLowerCase())
            );
            if (!hasRelevantTitle && parsed.title) continue;

            // Extract clean LinkedIn URL
            const cleanUrl = this.extractLinkedInUrl(profileUrl);
            if (!cleanUrl) continue;

            // Avoid duplicates
            if (contacts.some(c => c.linkedInUrl === cleanUrl)) continue;

            contacts.push({
              firstName: parsed.firstName,
              lastName: parsed.lastName,
              title: parsed.title || 'Director',
              linkedInUrl: cleanUrl,
              source: 'LinkedIn Search',
            });
          }

          await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);
        } catch {
          // Silently skip failed searches
        }
      }
    } catch (error) {
      this.stats.errors++;
    }

    return contacts;
  }

  /**
   * Parse LinkedIn search result text
   * e.g. "John Smith - CEO at Company | LinkedIn"
   */
  parseLinkedInResult(text) {
    if (!text) return null;

    // Remove "| LinkedIn" suffix
    text = text.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();

    // Try pattern: "FirstName LastName - Title - Company"
    const dashParts = text.split(/\s*[-–—]\s*/);
    if (dashParts.length >= 2) {
      const namePart = dashParts[0].trim();
      const titlePart = dashParts.length >= 3 ? dashParts[1].trim() : dashParts[1].replace(/\s+at\s+.*/i, '').trim();

      const nameParts = namePart.split(/\s+/);
      if (nameParts.length >= 2 && nameParts[0].length >= 2) {
        return {
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' '),
          title: titlePart,
        };
      }
    }

    return null;
  }

  /**
   * Extract clean LinkedIn URL from search result href
   */
  extractLinkedInUrl(rawUrl) {
    const match = rawUrl.match(/(https?:\/\/(www\.)?linkedin\.com\/in\/[a-z0-9\-]+)/i);
    return match ? match[1].toLowerCase().replace('http://', 'https://').replace('www.', '') : null;
  }

  /**
   * Simple string similarity score (0-1)
   */
  similarityScore(a, b) {
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1.0;

    // Check if shorter is contained in longer
    if (longer.includes(shorter)) return shorter.length / longer.length;

    // Count matching chars
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) matches++;
    }
    return matches / longer.length;
  }

  /**
   * Generate email from LinkedIn contact data
   */
  generateEmail(firstName, lastName, companyWebsite) {
    let domain = null;
    if (companyWebsite) {
      try {
        const url = new URL(companyWebsite.startsWith('http') ? companyWebsite : `https://${companyWebsite}`);
        domain = url.hostname.replace('www.', '');
      } catch {}
    }
    if (!domain) return null;
    return `${firstName.toLowerCase()}.${lastName.toLowerCase().split(' ')[0]}@${domain}`;
  }

  /**
   * Save LinkedIn URL to company
   */
  async saveLinkedInUrl(accountId, linkedInUrl) {
    try {
      await pool.query(
        `UPDATE accounts SET linkedin_url = $1 WHERE account_id = $2 AND (linkedin_url IS NULL OR linkedin_url = '')`,
        [linkedInUrl, accountId]
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save contact to database
   */
  async saveContact(accountId, contact, companyWebsite) {
    try {
      // Check if contact already exists
      const existing = await pool.query(
        `SELECT contact_id FROM contacts
         WHERE linked_account_id = $1
           AND LOWER(first_name) = LOWER($2)
           AND LOWER(last_name) = LOWER($3)`,
        [accountId, contact.firstName, contact.lastName]
      );

      if (existing.rows.length > 0) return false;

      const email = this.generateEmail(contact.firstName, contact.lastName, companyWebsite);

      await pool.query(
        `INSERT INTO contacts (linked_account_id, first_name, last_name, job_title, email, linkedin_url, data_source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [accountId, contact.firstName, contact.lastName, contact.title, email, contact.linkedInUrl, 'Agent:LinkedIn']
      );

      return true;
    } catch (error) {
      if (!error.message.includes('duplicate')) {
        this.stats.errors++;
      }
      return false;
    }
  }

  /**
   * Process a single company
   */
  async processCompany(company) {
    // Find LinkedIn company page
    const linkedInUrl = await this.findLinkedInCompanyPage(company);
    if (linkedInUrl) {
      await this.saveLinkedInUrl(company.account_id, linkedInUrl);
      this.stats.linkedInUrlsFound++;
    }

    await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

    // Find contacts at this company
    const contacts = await this.findLinkedInContacts(company);
    for (const contact of contacts) {
      const saved = await this.saveContact(company.account_id, contact, company.website);
      if (saved) this.stats.contactsFound++;
    }

    this.stats.companiesProcessed++;
  }

  /**
   * Process batch in parallel
   */
  async processBatch(companies) {
    const chunks = [];
    for (let i = 0; i < companies.length; i += CONFIG.PARALLEL) {
      chunks.push(companies.slice(i, i + CONFIG.PARALLEL));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(c => this.processCompany(c)));
      await this.delay(CONFIG.DELAY_BETWEEN_BATCHES);
    }
  }

  /**
   * Main loop
   */
  async run() {
    console.log('='.repeat(60));
    console.log('   LINKEDIN SCRAPER AGENT');
    console.log('='.repeat(60));
    console.log('   Searches for LinkedIn company pages & decision-maker contacts');
    console.log('   100% FREE - Uses DuckDuckGo as search proxy');
    console.log('');

    while (this.running) {
      this.stats.cycles++;
      console.log(`\n--- Cycle ${this.stats.cycles} ---`);

      // Phase 1: Find LinkedIn URLs for companies
      const needLinkedIn = await this.getCompaniesNeedingLinkedIn();
      if (needLinkedIn.length > 0) {
        console.log(`   Finding LinkedIn URLs for ${needLinkedIn.length} companies...`);
        await this.processBatch(needLinkedIn);
      }

      // Phase 2: Find contacts for companies with few contacts
      const needContacts = await this.getCompaniesNeedingContacts();
      if (needContacts.length > 0) {
        console.log(`   Finding contacts for ${needContacts.length} companies...`);
        await this.processBatch(needContacts);
      }

      // Print stats
      console.log(`\n   Stats: ${this.stats.companiesProcessed} processed | ${this.stats.linkedInUrlsFound} LinkedIn URLs | ${this.stats.contactsFound} contacts | ${this.stats.errors} errors`);

      if (needLinkedIn.length === 0 && needContacts.length === 0) {
        console.log('   No companies need LinkedIn enrichment. Waiting...');
        await this.delay(CONFIG.CYCLE_DELAY * 2);
      } else {
        await this.delay(CONFIG.CYCLE_DELAY);
      }
    }
  }
}

// Main
const agent = new LinkedInScraperAgent();

process.on('SIGINT', () => { agent.running = false; });
process.on('SIGTERM', () => { agent.running = false; });

agent.run().catch(e => {
  console.error('LinkedIn Scraper Agent failed:', e.message);
  process.exit(1);
});
