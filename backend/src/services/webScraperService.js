/**
 * Web Scraper Service
 * Uses headless browser to collect company information from the web
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const cache = require('../utils/cache');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BLOCKED_DOMAINS = [
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'wikipedia.org',
  'companieshouse.gov.uk',
  'beta.companieshouse.gov.uk',
  'opencorporates.com',
  'bloomberg.com',
  'crunchbase.com'
];

class WebScraperService {
  constructor() {
    this.maxHtmlBytes = 600000; // avoid downloading very large pages
  }

  /**
   * Find most likely official website using direct guessing and web search.
   * @param {string} companyName - Company name
   * @param {string} location - Location (city/region)
   * @param {string} fullAddress - Full address for better matching
   */
  async findCompanyWebsite(companyName, location = '', fullAddress = '') {
    const cached = cache.get('scraper:websiteLookup', { companyName, location });
    if (cached) return cached;

    // Try direct website guessing first (fast, no API needed)
    const guessedSite = await this._guessCompanyWebsite(companyName, location);
    if (guessedSite) {
      cache.set('scraper:websiteLookup', { companyName, location }, guessedSite, 86400);
      return guessedSite;
    }

    // Fallback to Google search with full address for better context
    const searchQuery = fullAddress ? `${companyName} ${fullAddress}` : `${companyName} ${location}`;
    const results = await this.searchCompanyOnGoogle(searchQuery, location);

    for (const result of results) {
      const normalized = this._normalizeUrl(result.url);
      if (!normalized) continue;
      if (this._isBlockedDomain(normalized)) continue;
      if (!this._isLikelyCompanySite(normalized, companyName)) continue;

      cache.set('scraper:websiteLookup', { companyName, location }, normalized, 86400);
      return normalized;
    }

    return null;
  }

  /**
   * Try to guess company website by common patterns
   */
  async _guessCompanyWebsite(companyName, location = '') {
    // Clean company name: remove legal entities, punctuation
    let clean = companyName
      .toLowerCase()
      .replace(/\b(plc|ltd|limited|inc|corp|corporation|llc|llp|gmbh|sa|ag)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

    // Country-specific TLDs
    const country = location.toLowerCase();
    const tlds = [
      '.com',
      country.includes('uk') || country.includes('united kingdom') ? '.co.uk' : null,
      country.includes('uk') ? '.com' : null,
      country.includes('germany') || country.includes('de') ? '.de' : null,
      country.includes('france') || country.includes('fr') ? '.fr' : null,
    ].filter(Boolean);

    // Generate URL variations
    const variations = [
      ...tlds.map(tld => `https://www.${clean}${tld}`),
      ...tlds.map(tld => `https://${clean}${tld}`),
    ];

    console.log(`[Direct Discovery] Checking ${variations.length} possible URLs...`);

    // Test each variation
    for (const url of variations) {
      try {
        const response = await axios.head(url, {
          timeout: 3000,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          maxRedirects: 5,
          validateStatus: (status) => status < 500, // Accept 2xx, 3xx, 4xx
        });
        
        // Accept 200, 301, 302, 403 (403 means site exists but blocks bots)
        if ([200, 301, 302, 403].includes(response.status)) {
          console.log(`[Direct Discovery] ✓ Found website: ${url} (HTTP ${response.status})`);
          return url;
        }
      } catch (error) {
        // Try next variation
        continue;
      }
    }

    console.log(`[Direct Discovery] ✗ No website found for: ${companyName}`);
    return null;
  }
  /**
   * Search Google for company information
   * @param {string} searchQuery - Full search query with name and address
   * @param {string} location - Additional location context (optional)
   */
  async searchCompanyOnGoogle(searchQuery, location = '') {
    try {
      const query = searchQuery; // Already contains name + address
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' company website')}`;
      
      console.log('[Web Scraper] Searching Google for:', query);

      // Note: This is a basic implementation. For production, consider using:
      // - Google Custom Search API (already configured)
      // - Puppeteer for JavaScript-heavy sites
      // - Proxy services for rate limiting
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT
        },
        timeout: 8000
      });

      const $ = cheerio.load(response.data);
      const results = [];

      // Extract search results
      $('.g').each((i, element) => {
        if (i < 5) {
          const title = $(element).find('h3').text();
          const link = $(element).find('a').attr('href');
          const snippet = $(element).find('.VwiC3b').text();
          
          if (title && link) {
            results.push({
              title,
              url: link,
              snippet: snippet || ''
            });
          }
        }
      });

      return results;
    } catch (error) {
      console.error('[Web Scraper] Search error:', error.message);
      return [];
    }
  }

  /**
   * Scrape a company website for contact information
   */
  async scrapeCompanyWebsite(url) {
    const cached = cache.get('scraper:website', { url });
    if (cached) return cached;

    try {
      console.log('[Web Scraper] Scraping website:', url);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT
        },
        timeout: 10000,
        maxContentLength: this.maxHtmlBytes
      });

      const body = typeof response.data === 'string' ? response.data.slice(0, this.maxHtmlBytes) : '';
      const $ = cheerio.load(body);
      
      // Extract various information
      const data = {
        url,
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
        emails: this._extractEmails(body),
        phones: this._extractPhones(body),
        socialMedia: this._extractSocialMedia($),
        address: this._extractAddress($),
        links: this._extractLinks($, url),
        timestamp: new Date().toISOString()
      };

      cache.set('scraper:website', { url }, data, 86400); // Cache 24 hours
      return data;
    } catch (error) {
      console.error('[Web Scraper] Website scraping error:', error.message);
      return null;
    }
  }

  /**
   * Scrape site and contact page, returning normalized contact details
   */
  async scrapeCompanyData(websiteUrl, country = null) {
    const normalized = this._normalizeUrl(websiteUrl);
    if (!normalized) return null;

    const allowed = await this._isAllowedByRobots(normalized);
    if (!allowed) {
      console.warn('[Web Scraper] robots.txt disallows', normalized);
      return null;
    }

    const mainPage = await this.scrapeCompanyWebsite(normalized);
    if (!mainPage) return null;

    const contactUrl = this._findContactLink(mainPage, normalized);
    let contactPage = null;

    if (contactUrl && await this._isAllowedByRobots(contactUrl)) {
      contactPage = await this.scrapeCompanyWebsite(contactUrl);
    }

    // Pass country to merge function for phone formatting
    if (country) {
      mainPage.country = country;
      if (contactPage) contactPage.country = country;
    }

    return this._mergeScrapedContacts(normalized, mainPage, contactPage);
  }

  /**
   * Extract email addresses from text
   */
  _extractEmails(text) {
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
    const matches = text.match(emailRegex);
    
    if (!matches) return [];
    
    // Filter out common false positives
    return [...new Set(matches)]
      .filter(email => !email.includes('example.com'))
      .filter(email => !email.includes('placeholder'))
      .slice(0, 10); // Limit to 10 emails
  }

  /**
   * Extract phone numbers from text
   */
  _extractPhones(text) {
    const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = text.match(phoneRegex);
    
    if (!matches) return [];
    
    return [...new Set(matches)].slice(0, 5); // Limit to 5 numbers
  }
  /**
   * Format UK phone numbers properly with +44 country code
   */
  _formatUKPhone(phone, country) {
    // Only format UK numbers
    if (!country || !['england', 'scotland', 'wales', 'united kingdom', 'uk', 'gb'].some(c => 
      country.toLowerCase().includes(c))) {
      return phone; // Not UK, return as-is
    }
    
    // Remove all non-digits
    let digits = phone.replace(/\D/g, '');
    
    // Remove leading 0 or 44
    if (digits.startsWith('0')) digits = digits.substring(1);
    if (digits.startsWith('44')) digits = digits.substring(2);
    
    // Validate length (UK numbers are 10 digits after removing 0)
    if (digits.length < 10 || digits.length > 11) return null;
    
    // Format: +44 XXXX XXX XXX
    if (digits.length === 10) {
      return `+44 ${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7)}`;
    } else {
      return `+44 ${digits.substring(0, 3)} ${digits.substring(3, 7)} ${digits.substring(7)}`;
    }
  }
  /**
   * Extract social media links
   */
  _extractSocialMedia($) {
    const social = {};
    
    $('a[href*="linkedin.com"]').each((i, el) => {
      if (!social.linkedin) social.linkedin = $(el).attr('href');
    });
    
    $('a[href*="twitter.com"], a[href*="x.com"]').each((i, el) => {
      if (!social.twitter) social.twitter = $(el).attr('href');
    });
    
    $('a[href*="facebook.com"]').each((i, el) => {
      if (!social.facebook) social.facebook = $(el).attr('href');
    });
    
    $('a[href*="instagram.com"]').each((i, el) => {
      if (!social.instagram) social.instagram = $(el).attr('href');
    });
    
    return social;
  }

  /**
   * Extract physical address
   */
  _extractAddress($) {
    const addressSelectors = [
      '[itemtype*="PostalAddress"]',
      '.address',
      '#address',
      '[class*="address"]'
    ];
    
    for (const selector of addressSelectors) {
      const address = $(selector).text().trim();
      if (address && address.length > 10 && address.length < 200) {
        return address;
      }
    }
    
    return null;
  }

  /**
   * Extract links for contact page discovery
   */
  _extractLinks($, baseUrl) {
    const links = [];
    $('a[href]').each((i, el) => {
      if (links.length > 200) return; // avoid huge lists
      const raw = $(el).attr('href');
      const text = $(el).text().trim();

      try {
        const absolute = new URL(raw, baseUrl).toString();
        links.push({ href: absolute, text });
      } catch (_) {
        // ignore invalid URLs
      }
    });
    return links;
  }

  /**
   * Enrich company data with web scraping
   */
  async enrichCompanyData(companyName, companyWebsite) {
    const enrichedData = {
      searchResults: [],
      websiteData: null,
      source: 'Web Scraper'
    };

    try {
      const website = companyWebsite || await this.findCompanyWebsite(companyName);

      // Search Google for additional info
      enrichedData.searchResults = await this.searchCompanyOnGoogle(companyName);

      // If we have a website, scrape it
      if (website) {
        enrichedData.websiteData = await this.scrapeCompanyData(website);
      }

      return enrichedData;
    } catch (error) {
      console.error('[Web Scraper] Enrichment error:', error.message);
      return enrichedData;
    }
  }

  _normalizeUrl(rawUrl) {
    if (!rawUrl) return null;

    let candidate = rawUrl;
    // Handle Google redirect URLs that look like /url?q=https://example.com
    if (candidate.startsWith('/url?q=')) {
      try {
        const parsed = new URL(candidate, 'https://www.google.com');
        candidate = parsed.searchParams.get('q') || candidate;
      } catch (_) {
        return null;
      }
    }

    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }

    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname) return null;
      // Normalize to origin + path without fragments
      parsed.hash = '';
      return parsed.toString();
    } catch (_) {
      return null;
    }
  }

  _domainFromUrl(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  _isBlockedDomain(url) {
    const domain = this._domainFromUrl(url);
    return BLOCKED_DOMAINS.some(blocked => domain.includes(blocked));
  }

  _isLikelyCompanySite(url, companyName) {
    const domain = this._domainFromUrl(url);
    if (!domain) return false;

    const tokens = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(token => token.length > 2);

    return tokens.some(token => domain.includes(token));
  }

  async _isAllowedByRobots(targetUrl) {
    try {
      const urlObj = new URL(targetUrl);
      const robotsUrl = `${urlObj.origin}/robots.txt`;

      const cached = cache.get('scraper:robots', { origin: urlObj.origin });
      if (cached !== undefined) {
        return this._pathAllowed(urlObj.pathname, cached);
      }

      const response = await axios.get(robotsUrl, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 5000
      });

      const rules = this._parseRobots(response.data || '');
      cache.set('scraper:robots', { origin: urlObj.origin }, rules, 86400);
      return this._pathAllowed(urlObj.pathname, rules);
    } catch (_) {
      // If robots.txt is missing or cannot be parsed, default to allow
      return true;
    }
  }

  _parseRobots(content) {
    const lines = content.split('\n');
    let applies = false;
    const disallow = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const [directive, value] = line.split(':').map(part => part && part.trim());
      if (!directive || !value) continue;

      if (directive.toLowerCase() === 'user-agent') {
        applies = value === '*' ? true : false;
      }

      if (applies && directive.toLowerCase() === 'disallow') {
        disallow.push(value || '/');
      }
    }

    return { disallow };
  }

  _pathAllowed(pathname, rules) {
    if (!rules || !rules.disallow) return true;
    return !rules.disallow.some(rule => rule === '/' || pathname.startsWith(rule));
  }

  _findContactLink(mainPage, websiteUrl) {
    const contactRegex = /(contact|kontakt|get in touch|support)/i;

    if (!mainPage || !mainPage.links) return null;
    const match = mainPage.links.find(link => contactRegex.test(link.text) || contactRegex.test(link.href));
    if (match) return this._normalizeUrl(match.href);

    // Fallback common contact paths
    const candidates = ['contact', 'contact-us', 'support'];
    for (const path of candidates) {
      try {
        const candidate = new URL(path, websiteUrl).toString();
        return candidate;
      } catch (_) {
        continue;
      }
    }

    return null;
  }

  _mergeScrapedContacts(websiteUrl, mainPage, contactPage) {
    const phones = [...(mainPage.phones || []), ...(contactPage?.phones || [])];
    const emails = [...(mainPage.emails || []), ...(contactPage?.emails || [])];
    const social = contactPage?.socialMedia || mainPage.socialMedia || {};
    
    // Combine page content for email format detection
    const pageContent = [
      mainPage?.description || '',
      mainPage?.title || '',
      contactPage?.description || '',
      contactPage?.title || ''
    ].join(' ');

    return {
      website: websiteUrl,
      phone: this._choosePhone(phones, mainPage.country || contactPage?.country),
      email: this._chooseEmail(emails, websiteUrl, pageContent),
      linkedin: social.linkedin || null,
      twitter: social.twitter || null,
      facebook: social.facebook || null,
      industry: this._inferIndustry(mainPage, contactPage)
    };
  }

  _choosePhone(phones, country) {
    if (!phones || phones.length === 0) return null;
    
    // Format UK phones properly
    const formatted = phones.map(phone => this._formatUKPhone(phone, country)).filter(Boolean);
    if (formatted.length === 0) return null;
    
    // Prefer numbers with country codes
    return formatted.find(p => p.startsWith('+')) || formatted[0];
  }

  _chooseEmail(emails, websiteUrl, pageContent = '') {
    const domain = this._domainFromUrl(websiteUrl);
    
    if (!emails || emails.length === 0) {
      // Try to detect email format from page content
      const detectedFormat = this._detectEmailFormatSync(pageContent, domain);
      if (detectedFormat) return detectedFormat;
      
      // No format detected - use generic fallback
      return `hello@${domain}`;
    }
    
    // Skip generic emails
    const genericPatterns = /^(info|contact|hello|support|sales|admin|noreply|no-reply|enquiries|enquiry|mail|office)[@+_.-]/i;
    
    // Filter to company domain only and exclude generic
    const companyEmails = emails.filter(email => {
      return email.toLowerCase().includes(`@${domain}`) && 
             !genericPatterns.test(email);
    });
    
    // Prefer personal format: firstname@, first.last@
    const personalEmail = companyEmails.find(email => {
      const localPart = email.split('@')[0].toLowerCase();
      return localPart.includes('.') || (/^[a-z]+$/.test(localPart) && localPart.length >= 3);
    });
    
    // If found actual employee email, add the format pattern
    if (personalEmail) {
      const format = this._detectFormatFromEmail(personalEmail, domain);
      return format ? `${personalEmail} | Format: ${format}` : personalEmail;
    }
    
    if (companyEmails[0]) {
      const format = this._detectFormatFromEmail(companyEmails[0], domain);
      return format ? `${companyEmails[0]} | Format: ${format}` : companyEmails[0];
    }
    
    // Only generic emails found - try to detect format first
    const detectedFormat = this._detectEmailFormatSync(pageContent, domain);
    if (detectedFormat) return detectedFormat;
    
    // Last resort: use best generic email available
    const genericEmails = emails.filter(e => e.toLowerCase().includes(`@${domain}`));
    const preferredGeneric = ['hello@', 'info@', 'contact@'];
    for (const pref of preferredGeneric) {
      const found = genericEmails.find(e => e.toLowerCase().startsWith(pref));
      if (found) return found;
    }
    
    return genericEmails[0] || `hello@${domain}`;
  }

  /**
   * Detect email format pattern from an actual email
   * e.g., sarah.jones@company.com -> first.last@company.com
   */
  _detectFormatFromEmail(email, domain) {
    if (!email || !domain) return null;
    
    const localPart = email.split('@')[0].toLowerCase();
    
    // Detect pattern by checking structure
    if (localPart.includes('.')) {
      // first.last format (sarah.jones)
      return `first.last@${domain}`;
    } else if (localPart.includes('_')) {
      // first_last format (john_doe)
      return `first_last@${domain}`;
    } else if (localPart.length >= 3 && localPart.length <= 7 && /^[a-z]+$/.test(localPart)) {
      // Short single word: james, sarah, john (firstname)
      return `firstname@${domain}`;
    } else if (localPart.length >= 8 && /^[a-z]+$/.test(localPart)) {
      // Long single word: johnsmith (firstlast)
      return `firstlast@${domain}`;
    } else if (localPart.length >= 5 && localPart.length <= 8 && /^[a-z]{1}[a-z]+$/.test(localPart)) {
      // Could be flast format (jsmith) if looks abbreviated
      // This is a guess - firstname is more common
      return `firstname@${domain}`;
    }
    
    return `firstname@${domain}`; // Default to firstname as it's most common
  }

  /**
   * Generate common email format patterns when no actual emails found
   * Try to detect which format the company uses by analyzing context
   */
  _generateEmailPatterns(domain) {
    if (!domain) return null;
    
    // Don't return all patterns - this will be replaced by smart detection
    // For now, return null to trigger fallback to generic emails
    return null;
  }

  /**
   * Synchronous email format detection from page content
   * Analyzes text for clues about email format
   */
  _detectEmailFormatSync(pageContent, domain) {
    if (!pageContent || !domain) return null;

    const text = pageContent.toLowerCase();
    
    // Look for explicit email format mentions
    if (text.includes('first.last@' + domain) || text.includes('firstname.lastname@')) {
      return `first.last@${domain}`;
    }
    if (text.includes('firstname@' + domain) || text.match(/\b[a-z]{3,}@/)) {
      return `firstname@${domain}`;
    }
    if (text.includes('firstnamelastname@') || text.includes('fullname@')) {
      return `firstlast@${domain}`;
    }
    if (text.includes('first_last@') || text.includes('firstname_lastname@')) {
      return `first_last@${domain}`;
    }

    // Look for patterns in examples
    const emailExamplePatterns = [
      /(?:e\.?g\.?|example|format)[\s:]+([a-z]+)\.([a-z]+)@/i,  // first.last
      /(?:e\.?g\.?|example|format)[\s:]+([a-z]+)@/i,            // firstname
      /(?:e\.?g\.?|example|format)[\s:]+([a-z])([a-z]+)@/i      // jsmith
    ];

    for (const pattern of emailExamplePatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[0].includes('.')) {
          return `first.last@${domain}`;
        } else if (match[1] && match[1].length === 1) {
          return `flast@${domain}`;
        } else {
          return `firstname@${domain}`;
        }
      }
    }

    return null;
  }

  _inferIndustry(mainPage, contactPage) {
    const descriptions = [mainPage?.description, contactPage?.description].filter(Boolean).join(' ');
    if (!descriptions) return null;

    const lowered = descriptions.toLowerCase();
    if (lowered.includes('software')) return 'Software';
    if (lowered.includes('consulting')) return 'Consulting';
    if (lowered.includes('manufactur')) return 'Manufacturing';
    if (lowered.includes('marketing')) return 'Marketing';
    if (lowered.includes('finance') || lowered.includes('financial')) return 'Financial Services';
    if (lowered.includes('health')) return 'Health';
    if (lowered.includes('education')) return 'Education';
    return null;
  }

  /**
   * Search for company contact info directly from Google/Bing search results
   * Uses queries like "Company Name phone number" or "Company Name address"
   * to find info displayed in search snippets without scraping websites
   */
  async findContactInfoFromSearch(companyName, location = '') {
    console.log(`[Web Scraper] Searching for contact info: ${companyName}`);
    
    const results = {
      phones: [],
      emails: [],
      addresses: []
    };

    try {
      // Query 1: Search for phone number
      const phoneQuery = `"${companyName}" ${location} phone number`;
      const phoneResults = await this.searchCompanyOnGoogle(phoneQuery, location);
      
      for (const result of phoneResults.slice(0, 3)) {
        const snippet = result.snippet || '';
        const phones = this._extractPhones(snippet);
        results.phones.push(...phones);
      }

      // Query 2: Search for address
      const addressQuery = `"${companyName}" ${location} address`;
      const addressResults = await this.searchCompanyOnGoogle(addressQuery, location);
      
      for (const result of addressResults.slice(0, 3)) {
        const snippet = result.snippet || '';
        const address = this._extractAddressFromText(snippet);
        if (address) results.addresses.push(address);
      }

      // Query 3: Search for contact info
      const contactQuery = `"${companyName}" ${location} contact`;
      const contactResults = await this.searchCompanyOnGoogle(contactQuery, location);
      
      for (const result of contactResults.slice(0, 3)) {
        const snippet = result.snippet || '';
        const phones = this._extractPhones(snippet);
        const emails = this._extractEmails(snippet);
        results.phones.push(...phones);
        results.emails.push(...emails);
      }

      // Deduplicate and clean
      results.phones = [...new Set(results.phones)].slice(0, 3);
      results.emails = [...new Set(results.emails)].slice(0, 3);
      results.addresses = [...new Set(results.addresses)].slice(0, 2);

      console.log(`[Web Scraper] Found from search - Phones: ${results.phones.length}, Emails: ${results.emails.length}, Addresses: ${results.addresses.length}`);
      return results;

    } catch (error) {
      console.error('[Web Scraper] Search contact info error:', error.message);
      return results;
    }
  }

  /**
   * Extract address patterns from plain text
   */
  _extractAddressFromText(text) {
    if (!text) return null;

    // Look for US address patterns: number + street + city, state zip
    const usAddressRegex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl)[,\s]+[A-Z][a-zA-Z\s]+,\s+[A-Z]{2}\s+\d{5}/;
    const usMatch = text.match(usAddressRegex);
    if (usMatch) return usMatch[0];

    // Look for UK address patterns: postcode
    const ukAddressRegex = /[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}/;
    const ukMatch = text.match(ukAddressRegex);
    if (ukMatch) {
      // Try to get surrounding context
      const index = text.indexOf(ukMatch[0]);
      const start = Math.max(0, index - 100);
      const end = Math.min(text.length, index + 50);
      return text.substring(start, end).trim();
    }

    return null;
  }
}

module.exports = new WebScraperService();
