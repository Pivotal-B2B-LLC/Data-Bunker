#!/usr/bin/env node

/**
 * SOCIAL MEDIA FINDER AGENT
 *
 * Finds company social media profiles:
 * - Twitter/X
 * - Facebook
 * - Instagram
 * - YouTube
 *
 * Methods:
 * 1. Scrape company website for social links
 * 2. DuckDuckGo search as fallback
 *
 * 100% FREE - No API costs
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const { pool } = require('../../src/db/connection');

const CONFIG = {
  BATCH_SIZE: 40,
  PARALLEL: 10,
  DELAY_BETWEEN_REQUESTS: 300,
  DELAY_BETWEEN_BATCHES: 2000,
  CYCLE_DELAY: 30000,
  REQUEST_TIMEOUT: 10000,
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
];

// Social media URL patterns
const SOCIAL_PATTERNS = {
  twitter: {
    regex: /https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})\/?/gi,
    column: 'twitter_url',
    searchTemplate: (name) => `site:twitter.com OR site:x.com "${name}"`,
  },
  facebook: {
    regex: /https?:\/\/(www\.)?facebook\.com\/([a-zA-Z0-9._\-]+)\/?/gi,
    column: 'facebook_url',
    searchTemplate: (name) => `site:facebook.com "${name}"`,
  },
  instagram: {
    regex: /https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi,
    column: 'instagram_url',
    searchTemplate: (name) => `site:instagram.com "${name}"`,
  },
  youtube: {
    regex: /https?:\/\/(www\.)?youtube\.com\/(channel|c|user|@)\/([a-zA-Z0-9_\-]+)\/?/gi,
    column: 'youtube_url',
    searchTemplate: (name) => `site:youtube.com "${name}" channel`,
  },
};

// URLs to skip (not company profiles)
const SKIP_PROFILES = [
  'twitter.com/home', 'twitter.com/login', 'twitter.com/search', 'twitter.com/explore',
  'twitter.com/i/', 'twitter.com/intent', 'twitter.com/share',
  'facebook.com/login', 'facebook.com/sharer', 'facebook.com/share',
  'facebook.com/pages', 'facebook.com/help', 'facebook.com/privacy',
  'instagram.com/explore', 'instagram.com/accounts', 'instagram.com/p/',
  'youtube.com/watch', 'youtube.com/results', 'youtube.com/feed',
];

class SocialMediaFinderAgent {
  constructor() {
    this.stats = {
      companiesProcessed: 0,
      twitterFound: 0,
      facebookFound: 0,
      instagramFound: 0,
      youtubeFound: 0,
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
   * Get companies that need social media enrichment
   */
  async getCompaniesNeedingSocial() {
    const result = await pool.query(`
      SELECT account_id, company_name, website
      FROM accounts
      WHERE website IS NOT NULL
        AND website != ''
        AND (twitter_url IS NULL OR facebook_url IS NULL OR instagram_url IS NULL)
      ORDER BY quality_score DESC NULLS LAST, created_at DESC
      LIMIT $1
    `, [CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Scrape website for social media links
   */
  async scrapeWebsiteForSocial(website) {
    const social = { twitter: null, facebook: null, instagram: null, youtube: null };

    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': this.getRandomUA() },
        timeout: CONFIG.REQUEST_TIMEOUT,
        maxRedirects: 3,
        validateStatus: (status) => status < 400,
      });

      const html = response.data;
      if (typeof html !== 'string') return social;

      // Extract social media URLs from HTML
      for (const [platform, config] of Object.entries(SOCIAL_PATTERNS)) {
        const matches = html.match(config.regex) || [];
        for (const match of matches) {
          // Skip non-profile URLs
          if (SKIP_PROFILES.some(skip => match.toLowerCase().includes(skip))) continue;

          // Clean the URL
          const cleanUrl = match.replace(/\/$/, '').split('?')[0];

          // Validate it looks like a real profile
          if (this.isValidSocialUrl(cleanUrl, platform)) {
            social[platform] = cleanUrl;
            break;
          }
        }
      }
    } catch {
      // Website unreachable, will try search fallback
    }

    return social;
  }

  /**
   * Search DuckDuckGo for social profiles (fallback)
   */
  async searchForSocialProfile(companyName, platform) {
    try {
      const config = SOCIAL_PATTERNS[platform];
      const query = config.searchTemplate(companyName);
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await axios.get(url, {
        headers: { 'User-Agent': this.getRandomUA() },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });

      const html = response.data;
      const matches = html.match(config.regex) || [];

      for (const match of matches) {
        if (SKIP_PROFILES.some(skip => match.toLowerCase().includes(skip))) continue;
        const cleanUrl = match.replace(/\/$/, '').split('?')[0];
        if (this.isValidSocialUrl(cleanUrl, platform)) {
          return cleanUrl;
        }
      }
    } catch {
      this.stats.errors++;
    }

    return null;
  }

  /**
   * Validate social URL is a real profile
   */
  isValidSocialUrl(url, platform) {
    if (!url) return false;
    const lower = url.toLowerCase();

    switch (platform) {
      case 'twitter': {
        const handle = lower.split('/').pop();
        return handle && handle.length >= 2 && handle.length <= 15 && !handle.includes('.');
      }
      case 'facebook': {
        const path = lower.split('facebook.com/')[1] || '';
        return path.length >= 2 && !path.includes('/') && path !== 'share' && path !== 'login';
      }
      case 'instagram': {
        const handle = lower.split('instagram.com/')[1] || '';
        return handle.length >= 2 && !handle.includes('/');
      }
      case 'youtube': {
        return lower.includes('youtube.com/') && (lower.includes('/c/') || lower.includes('/channel/') || lower.includes('/@') || lower.includes('/user/'));
      }
      default:
        return false;
    }
  }

  /**
   * Save social media URLs to database
   */
  async saveSocialUrls(accountId, social) {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const [platform, url] of Object.entries(social)) {
      if (!url) continue;
      const column = SOCIAL_PATTERNS[platform].column;
      updates.push(`${column} = COALESCE(${column}, $${paramIndex})`);
      values.push(url);
      paramIndex++;
    }

    if (updates.length === 0) return false;

    values.push(accountId);

    try {
      await pool.query(
        `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${paramIndex}`,
        values
      );
      return true;
    } catch {
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Process a single company
   */
  async processCompany(company) {
    this.stats.companiesProcessed++;

    // Phase 1: Scrape website
    let social = { twitter: null, facebook: null, instagram: null, youtube: null };
    if (company.website) {
      social = await this.scrapeWebsiteForSocial(company.website);
    }

    // Phase 2: Search fallback for missing platforms
    for (const platform of ['twitter', 'facebook', 'instagram']) {
      if (!social[platform]) {
        social[platform] = await this.searchForSocialProfile(company.company_name, platform);
        await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);
      }
    }

    // Count what we found
    if (social.twitter) this.stats.twitterFound++;
    if (social.facebook) this.stats.facebookFound++;
    if (social.instagram) this.stats.instagramFound++;
    if (social.youtube) this.stats.youtubeFound++;

    // Save to database
    await this.saveSocialUrls(company.account_id, social);
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
    console.log('   SOCIAL MEDIA FINDER AGENT');
    console.log('='.repeat(60));
    console.log('   Finds Twitter, Facebook, Instagram, YouTube profiles');
    console.log('   Methods: Website scraping + DuckDuckGo search');
    console.log('   Cost: FREE');
    console.log('');

    // Ensure social media columns exist
    await this.ensureColumns();

    while (this.running) {
      this.stats.cycles++;
      console.log(`\n--- Cycle ${this.stats.cycles} ---`);

      const companies = await this.getCompaniesNeedingSocial();

      if (companies.length === 0) {
        console.log('   No companies need social media enrichment. Waiting...');
        await this.delay(CONFIG.CYCLE_DELAY * 2);
        continue;
      }

      console.log(`   Processing ${companies.length} companies...`);
      await this.processBatch(companies);

      console.log(`\n   Stats: ${this.stats.companiesProcessed} processed | Twitter: ${this.stats.twitterFound} | Facebook: ${this.stats.facebookFound} | Instagram: ${this.stats.instagramFound} | YouTube: ${this.stats.youtubeFound}`);
      await this.delay(CONFIG.CYCLE_DELAY);
    }
  }

  /**
   * Ensure social media columns exist in accounts table
   */
  async ensureColumns() {
    const columns = ['twitter_url', 'facebook_url', 'instagram_url', 'youtube_url'];
    for (const col of columns) {
      try {
        await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      } catch {
        // Column may already exist
      }
    }
  }
}

// Main
const agent = new SocialMediaFinderAgent();

process.on('SIGINT', () => { agent.running = false; });
process.on('SIGTERM', () => { agent.running = false; });

agent.run().catch(e => {
  console.error('Social Media Finder Agent failed:', e.message);
  process.exit(1);
});
