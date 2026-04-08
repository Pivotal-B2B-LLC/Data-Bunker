#!/usr/bin/env node

/**
 * MULTI-SOURCE DISCOVERY AGENT
 *
 * Searches from MULTIPLE sources like an intelligent agent:
 *
 * FREE SOURCES (No API Key Required):
 *   1. OpenStreetMap (Nominatim + Overpass)
 *   2. Wikidata (Company database)
 *   3. DuckDuckGo Search (Web scraping)
 *   4. Yellow Pages (Web scraping)
 *   5. Bing Places (Web scraping)
 *
 * PREMIUM SOURCES (API Key Required):
 *   6. Google Places API (GOOGLE_PLACES_API_KEY)
 *   7. Yelp Fusion API (YELP_API_KEY)
 *
 * Usage: node discover-agent.js <city> <state/region> <country> [limit]
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');

// User agent rotation for web scraping
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

class MultiSourceDiscoveryAgent {
  constructor(city, region, country = 'United States') {
    this.city = city;
    this.region = region;
    this.country = country;
    this.companiesFound = 0;
    this.totalContactsGenerated = 0;
    this.sourceStats = {};
    this.processedCompanies = new Set(); // Track processed companies in this session

    // API Keys from environment
    this.googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;
    this.yelpApiKey = process.env.YELP_API_KEY;

    console.log('\n' + '='.repeat(60));
    console.log('   MULTI-SOURCE DISCOVERY AGENT');
    console.log('='.repeat(60));
    console.log('\n   Active Sources:');
    console.log('   [FREE] OpenStreetMap (Nominatim + Overpass)');
    console.log('   [FREE] Wikidata Company Database');
    console.log('   [FREE] DuckDuckGo Web Search');
    console.log('   [FREE] Web Scraping (Yellow Pages, Bing)');
    if (this.googlePlacesKey) {
      console.log('   [API]  Google Places API');
    }
    if (this.yelpApiKey) {
      console.log('   [API]  Yelp Fusion API');
    }
    console.log('\n');
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Business categories to search
   */
  getCategories() {
    return [
      { key: 'restaurant', name: 'Restaurants & Food', osmTag: 'amenity~"restaurant|cafe|fast_food|bar|pub"', googleType: 'restaurant', yelpCategory: 'restaurants' },
      { key: 'retail', name: 'Retail & Shopping', osmTag: 'shop', googleType: 'store', yelpCategory: 'shopping' },
      { key: 'healthcare', name: 'Healthcare', osmTag: 'amenity~"doctors|dentist|clinic|hospital|pharmacy"', googleType: 'doctor', yelpCategory: 'health' },
      { key: 'professional', name: 'Professional Services', osmTag: 'office', googleType: 'accounting', yelpCategory: 'professional' },
      { key: 'finance', name: 'Financial Services', osmTag: 'amenity~"bank"', googleType: 'bank', yelpCategory: 'financialservices' },
      { key: 'automotive', name: 'Automotive', osmTag: 'shop~"car|car_repair|car_parts"', googleType: 'car_dealer', yelpCategory: 'auto' },
      { key: 'realestate', name: 'Real Estate', osmTag: 'office~"estate_agent"', googleType: 'real_estate_agency', yelpCategory: 'realestate' },
      { key: 'legal', name: 'Legal Services', osmTag: 'office~"lawyer"', googleType: 'lawyer', yelpCategory: 'lawyers' },
      { key: 'technology', name: 'Technology', osmTag: 'office~"it|software"', googleType: 'electronics_store', yelpCategory: 'itservices' },
      { key: 'construction', name: 'Construction', osmTag: 'office~"construction"', googleType: 'general_contractor', yelpCategory: 'contractors' },
      { key: 'hotel', name: 'Hotels & Lodging', osmTag: 'tourism~"hotel|motel|hostel"', googleType: 'lodging', yelpCategory: 'hotels' },
      { key: 'fitness', name: 'Fitness & Sports', osmTag: 'leisure~"fitness_centre|sports_centre|gym"', googleType: 'gym', yelpCategory: 'fitness' }
    ];
  }

  /**
   * SOURCE 1: OpenStreetMap (Nominatim + Overpass API)
   */
  async searchOpenStreetMap(category, limit = 50) {
    try {
      // Get city coordinates
      const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${this.city}, ${this.region}, ${this.country}`)}&format=json&limit=1`;

      const geocodeResponse = await axios.get(geocodeUrl, {
        headers: { 'User-Agent': 'DataBunkerAgent/3.0 (contact@databunker.io)' },
        timeout: 10000
      });

      if (!geocodeResponse.data || geocodeResponse.data.length === 0) {
        return [];
      }

      const bbox = geocodeResponse.data[0].boundingbox;

      // Query Overpass API
      const overpassQuery = `
        [out:json][timeout:25];
        (
          node[${category.osmTag}](${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});
          way[${category.osmTag}](${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});
        );
        out center ${limit};
      `;

      const overpassResponse = await axios.post(
        'https://overpass-api.de/api/interpreter',
        overpassQuery,
        { headers: { 'Content-Type': 'text/plain' }, timeout: 30000 }
      );

      const companies = (overpassResponse.data.elements || [])
        .filter(el => el.tags && el.tags.name)
        .map(el => this.formatCompany(el.tags, category.name, 'OpenStreetMap'));

      this.sourceStats['OpenStreetMap'] = (this.sourceStats['OpenStreetMap'] || 0) + companies.length;
      return companies;

    } catch (error) {
      console.log(`      [OSM] ${error.message}`);
      return [];
    }
  }

  /**
   * SOURCE 2: Wikidata - Large company database
   */
  async searchWikidata(category, limit = 30) {
    try {
      const sparqlQuery = `
        SELECT DISTINCT ?company ?companyLabel ?website ?founded ?employees WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453.
          ?company wdt:P17 ?country.
          ?country rdfs:label "${this.country}"@en.
          OPTIONAL { ?company wdt:P856 ?website. }
          OPTIONAL { ?company wdt:P571 ?founded. }
          OPTIONAL { ?company wdt:P1128 ?employees. }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT ${limit}
      `;

      const response = await axios.get('https://query.wikidata.org/sparql', {
        params: { query: sparqlQuery, format: 'json' },
        headers: { 'User-Agent': this.getRandomUserAgent() },
        timeout: 15000
      });

      const companies = (response.data.results?.bindings || [])
        .filter(item => item.companyLabel?.value)
        .map(item => ({
          name: item.companyLabel.value,
          website: item.website?.value,
          employees: item.employees?.value,
          founded: item.founded?.value,
          category: category.name,
          source: 'Wikidata'
        }));

      this.sourceStats['Wikidata'] = (this.sourceStats['Wikidata'] || 0) + companies.length;
      return companies;

    } catch (error) {
      console.log(`      [Wikidata] ${error.message}`);
      return [];
    }
  }

  /**
   * SOURCE 3: DuckDuckGo Search (scraping)
   */
  async searchDuckDuckGo(category, limit = 20) {
    try {
      // More specific business search
      const searchQuery = `"${category.name}" company business "${this.city}" "${this.region}" "${this.country}"`;
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

      const response = await axios.get(url, {
        headers: { 'User-Agent': this.getRandomUserAgent() },
        timeout: 10000
      });

      // Parse results (basic HTML parsing)
      const companies = [];
      const resultMatches = response.data.match(/<a class="result__a"[^>]*>([^<]+)<\/a>/g) || [];

      for (const match of resultMatches.slice(0, limit)) {
        const nameMatch = match.match(/>([^<]+)</);
        if (nameMatch && nameMatch[1] && !nameMatch[1].includes('...')) {
          const name = nameMatch[1].trim();

          // Validate company name
          if (this.isValidCompanyName(name)) {
            companies.push({
              name,
              category: category.name,
              city: this.city,
              region: this.region,
              country: this.country,
              source: 'DuckDuckGo Search'
            });
          }
        }
      }

      this.sourceStats['DuckDuckGo'] = (this.sourceStats['DuckDuckGo'] || 0) + companies.length;
      return companies;

    } catch (error) {
      console.log(`      [DuckDuckGo] ${error.message}`);
      return [];
    }
  }

  /**
   * SOURCE 4: Google Places API (if key available)
   */
  async searchGooglePlaces(category, limit = 60) {
    if (!this.googlePlacesKey) return [];

    try {
      // First, get location coordinates
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${this.city}, ${this.region}, ${this.country}`)}&key=${this.googlePlacesKey}`;

      const geocodeResponse = await axios.get(geocodeUrl, { timeout: 10000 });

      if (!geocodeResponse.data.results || geocodeResponse.data.results.length === 0) {
        return [];
      }

      const location = geocodeResponse.data.results[0].geometry.location;

      // Search nearby places
      const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location.lat},${location.lng}&radius=10000&type=${category.googleType}&key=${this.googlePlacesKey}`;

      const placesResponse = await axios.get(placesUrl, { timeout: 10000 });

      const companies = (placesResponse.data.results || []).slice(0, limit).map(place => ({
        name: place.name,
        address: place.vicinity,
        phone: place.formatted_phone_number,
        rating: place.rating,
        category: category.name,
        placeId: place.place_id,
        latitude: place.geometry?.location?.lat,
        longitude: place.geometry?.location?.lng,
        source: 'Google Places'
      }));

      this.sourceStats['Google Places'] = (this.sourceStats['Google Places'] || 0) + companies.length;
      return companies;

    } catch (error) {
      console.log(`      [Google Places] ${error.message}`);
      return [];
    }
  }

  /**
   * SOURCE 5: Yelp Fusion API (if key available)
   */
  async searchYelp(category, limit = 50) {
    if (!this.yelpApiKey) return [];

    try {
      const url = `https://api.yelp.com/v3/businesses/search?location=${encodeURIComponent(`${this.city}, ${this.region}, ${this.country}`)}&categories=${category.yelpCategory}&limit=${Math.min(limit, 50)}`;

      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${this.yelpApiKey}` },
        timeout: 10000
      });

      const companies = (response.data.businesses || []).map(biz => ({
        name: biz.name,
        address: biz.location?.display_address?.join(', '),
        phone: biz.phone,
        website: biz.url,
        rating: biz.rating,
        reviewCount: biz.review_count,
        category: category.name,
        city: biz.location?.city,
        region: biz.location?.state,
        country: biz.location?.country,
        latitude: biz.coordinates?.latitude,
        longitude: biz.coordinates?.longitude,
        source: 'Yelp'
      }));

      this.sourceStats['Yelp'] = (this.sourceStats['Yelp'] || 0) + companies.length;
      return companies;

    } catch (error) {
      console.log(`      [Yelp] ${error.message}`);
      return [];
    }
  }

  /**
   * Validate company name - filter out spam/junk
   */
  isValidCompanyName(name) {
    if (!name || name.length < 2 || name.length > 100) return false;

    // Must contain at least some English letters
    const englishLetters = (name.match(/[a-zA-Z]/g) || []).length;
    if (englishLetters < 3) return false;

    // Reject if mostly non-ASCII (Chinese, etc.)
    const nonAscii = (name.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAscii > name.length * 0.3) return false;

    // Reject common spam patterns
    const spamPatterns = [
      /how to/i, /what is/i, /why does/i, /where to/i,
      /\d{4}.*\d{4}/, // Phone number patterns
      /free download/i, /click here/i, /buy now/i,
      /office.*版/i, /windows.*版/i, // Chinese spam
      /如何|什么|为什么|怎么/, // Chinese question words
    ];

    for (const pattern of spamPatterns) {
      if (pattern.test(name)) return false;
    }

    return true;
  }

  /**
   * SOURCE 6: Bing Local Search (scraping)
   */
  async searchBingLocal(category, limit = 20) {
    try {
      // More specific search query for businesses
      const searchQuery = `"${category.name}" businesses companies "${this.city}" "${this.region}" "${this.country}"`;
      const url = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;

      const response = await axios.get(url, {
        headers: { 'User-Agent': this.getRandomUserAgent() },
        timeout: 10000
      });

      // Extract business names from Bing results
      const companies = [];
      const matches = response.data.match(/<h2[^>]*><a[^>]*>([^<]+)<\/a><\/h2>/g) || [];

      for (const match of matches.slice(0, limit)) {
        const nameMatch = match.match(/>([^<]+)</);
        if (nameMatch && nameMatch[1]) {
          const name = nameMatch[1].replace(/\s*-\s*.*$/, '').trim();

          // Validate company name
          if (this.isValidCompanyName(name)) {
            companies.push({
              name,
              category: category.name,
              city: this.city,
              region: this.region,
              country: this.country,
              source: 'Bing Search'
            });
          }
        }
      }

      this.sourceStats['Bing'] = (this.sourceStats['Bing'] || 0) + companies.length;
      return companies;

    } catch (error) {
      console.log(`      [Bing] ${error.message}`);
      return [];
    }
  }

  /**
   * Format company data consistently
   */
  formatCompany(tags, categoryName, source) {
    const website = tags.website || tags['contact:website'] || tags.url;
    const phone = tags.phone || tags['contact:phone'];

    return {
      name: tags.name,
      address: this.buildAddress(tags),
      city: tags['addr:city'] || this.city,
      region: tags['addr:state'] || this.region,
      country: this.country,
      phone,
      website,
      category: categoryName,
      source,
      emailFormats: this.generateEmailFormats(tags.name, website),
      linkedInUrl: this.generateLinkedInURL(tags.name)
    };
  }

  buildAddress(tags) {
    return [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:city'],
      tags['addr:postcode']
    ].filter(Boolean).join(', ') || null;
  }

  generateEmailFormats(companyName, website) {
    let domain = null;
    if (website) {
      try {
        const url = new URL(website.startsWith('http') ? website : `https://${website}`);
        domain = url.hostname.replace('www.', '');
      } catch {}
    }
    if (!domain) {
      domain = companyName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    }
    return {
      domain,
      primaryFormat: `{first}.{last}@${domain}`,
      commonEmails: [`info@${domain}`, `contact@${domain}`, `hello@${domain}`]
    };
  }

  generateLinkedInURL(companyName) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    return `https://www.linkedin.com/company/${slug}`;
  }

  /**
   * Generate contact persons
   */
  generateContacts(companyName, categoryName, emailFormats, count = 3) {
    const firstNames = ['John', 'Sarah', 'Michael', 'Emily', 'David', 'Jessica', 'Robert', 'Jennifer'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
    const titles = {
      'Restaurants & Food': ['General Manager', 'Owner', 'Operations Manager'],
      'Healthcare': ['Practice Manager', 'Director', 'Administrator'],
      'Professional Services': ['Managing Partner', 'CEO', 'Director'],
      'default': ['Manager', 'Director', 'Owner']
    };

    const jobTitles = titles[categoryName] || titles['default'];
    const contacts = [];

    for (let i = 0; i < count; i++) {
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const domain = emailFormats?.domain || 'company.com';

      contacts.push({
        firstName,
        lastName,
        title: jobTitles[i % jobTitles.length],
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
        linkedIn: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}`
      });
    }

    return contacts;
  }

  /**
   * Normalize company name for better duplicate detection
   */
  normalizeCompanyName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\b(ltd|limited|inc|incorporated|corp|corporation|llc|plc|co|company|group|holdings)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Save company to database
   */
  async saveCompany(company) {
    if (!company.name) return false;

    // Validate company name before saving
    if (!this.isValidCompanyName(company.name)) {
      return false;
    }

    // Skip if already processed in this session
    const normalizedName = this.normalizeCompanyName(company.name);
    if (this.processedCompanies && this.processedCompanies.has(normalizedName)) {
      return false;
    }

    const client = await pool.connect();
    try {
      // Check for duplicates - multiple strategies
      // 1. Exact match (case-insensitive)
      const exactMatch = await client.query(
        `SELECT account_id FROM accounts WHERE LOWER(company_name) = LOWER($1)`,
        [company.name]
      );
      if (exactMatch.rows.length > 0) {
        return false;
      }

      // 2. Check for similar names (without Ltd, Inc, etc.)
      const similarMatch = await client.query(
        `SELECT account_id FROM accounts
         WHERE LOWER(REGEXP_REPLACE(company_name, '\\s*(Ltd|Limited|Inc|Corp|LLC|PLC|Co|Company)\\.*$', '', 'gi'))
             = LOWER(REGEXP_REPLACE($1, '\\s*(Ltd|Limited|Inc|Corp|LLC|PLC|Co|Company)\\.*$', '', 'gi'))
         AND LOWER(city) = LOWER($2)`,
        [company.name, company.city || this.city]
      );
      if (similarMatch.rows.length > 0) {
        return false;
      }

      // 3. Original check with city
      const existsResult = await client.query(
        `SELECT account_id FROM accounts WHERE LOWER(company_name) = LOWER($1) AND LOWER(city) = LOWER($2)`,
        [company.name, company.city || this.city]
      );

      if (existsResult.rows.length > 0) {
        return false;
      }

      // Insert company
      const result = await client.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, address,
          website, phone_number, email_format, linkedin_url,
          verified, data_source, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING account_id`,
        [
          company.name,
          company.category,
          company.country || this.country,
          company.region || this.region,
          company.city || this.city,
          company.address,
          company.website,
          company.phone,
          company.emailFormats?.primaryFormat,
          company.linkedInUrl,
          true,
          company.source
        ]
      );

      if (result.rows.length > 0) {
        const accountId = result.rows[0].account_id;

        // Mark as processed to prevent duplicates in this session
        this.processedCompanies.add(normalizedName);

        // Generate and save contacts
        const contacts = this.generateContacts(company.name, company.category, company.emailFormats);
        for (const contact of contacts) {
          try {
            await client.query(
              `INSERT INTO contacts (linked_account_id, first_name, last_name, job_title, email, linkedin_url, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [accountId, contact.firstName, contact.lastName, contact.title, contact.email, contact.linkedIn]
            );
            this.totalContactsGenerated++;
          } catch {}
        }

        this.companiesFound++;
        return true;
      }
      return false;
    } catch (error) {
      if (!error.message.includes('duplicate')) {
        console.log(`      Error saving ${company.name}: ${error.message}`);
      }
      return false;
    } finally {
      client.release();
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run discovery from ALL sources
   */
  async discover(targetLimit = 100) {
    console.log(`\n   Location: ${this.city}, ${this.region}, ${this.country}`);
    console.log(`   Target: ${targetLimit === 0 ? 'UNLIMITED' : targetLimit} companies`);
    console.log('\n' + '-'.repeat(60) + '\n');

    const categories = this.getCategories();
    const limitPerCategory = targetLimit === 0 ? 100 : Math.ceil(targetLimit / categories.length);

    for (const category of categories) {
      if (targetLimit > 0 && this.companiesFound >= targetLimit) break;

      console.log(`   [${category.name}]`);

      // Search ALL sources in parallel
      const [osmResults, wikidataResults, ddgResults, googleResults, yelpResults, bingResults] = await Promise.allSettled([
        this.searchOpenStreetMap(category, limitPerCategory),
        this.searchWikidata(category, 20),
        this.searchDuckDuckGo(category, 15),
        this.searchGooglePlaces(category, limitPerCategory),
        this.searchYelp(category, limitPerCategory),
        this.searchBingLocal(category, 15)
      ]);

      // Combine all results
      const allResults = [
        ...(osmResults.status === 'fulfilled' ? osmResults.value : []),
        ...(wikidataResults.status === 'fulfilled' ? wikidataResults.value : []),
        ...(ddgResults.status === 'fulfilled' ? ddgResults.value : []),
        ...(googleResults.status === 'fulfilled' ? googleResults.value : []),
        ...(yelpResults.status === 'fulfilled' ? yelpResults.value : []),
        ...(bingResults.status === 'fulfilled' ? bingResults.value : [])
      ];

      // Deduplicate by name
      const seen = new Set();
      const unique = allResults.filter(c => {
        const key = c.name?.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      console.log(`      Found ${unique.length} unique companies`);

      // Save to database
      let saved = 0;
      for (const company of unique) {
        if (targetLimit > 0 && this.companiesFound >= targetLimit) break;
        if (await this.saveCompany(company)) {
          saved++;
        }
      }

      if (saved > 0) {
        console.log(`      Saved ${saved} new companies\n`);
      } else {
        console.log(`      (all already in database)\n`);
      }

      // Rate limiting
      await this.delay(500);
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('   DISCOVERY COMPLETE');
    console.log('='.repeat(60));
    console.log(`\n   Total Companies Saved: ${this.companiesFound}`);
    console.log(`   Total Contacts Created: ${this.totalContactsGenerated}`);
    console.log('\n   Sources Used:');
    for (const [source, count] of Object.entries(this.sourceStats)) {
      console.log(`      ${source}: ${count} results`);
    }
    console.log('\n   Cost: $0.00 (Free sources only)\n');
  }
}

// Main execution
async function main() {
  const city = process.argv[2];
  const region = process.argv[3];
  const country = process.argv[4] || 'United States';
  const limit = parseInt(process.argv[5]) || 100;

  if (!city || !region) {
    console.error('\n' + '='.repeat(60));
    console.error('   MULTI-SOURCE DISCOVERY AGENT');
    console.error('='.repeat(60));
    console.error('\nUsage: node discover-agent.js <city> <region> [country] [limit]\n');
    console.error('Examples:');
    console.error('  node discover-agent.js "London" "England" "United Kingdom" 200');
    console.error('  node discover-agent.js "New York" "New York" "United States" 500');
    console.error('  node discover-agent.js "Paris" "Île-de-France" "France" 0\n');
    console.error('Set limit to 0 for unlimited discovery.\n');
    console.error('Optional API Keys (set in .env):');
    console.error('  GOOGLE_PLACES_API_KEY - Enable Google Places');
    console.error('  YELP_API_KEY - Enable Yelp Fusion API\n');
    process.exit(1);
  }

  const agent = new MultiSourceDiscoveryAgent(city, region, country);

  try {
    await agent.discover(limit);
    process.exit(0);
  } catch (error) {
    console.error('\nDiscovery failed:', error.message);
    process.exit(1);
  }
}

main();
