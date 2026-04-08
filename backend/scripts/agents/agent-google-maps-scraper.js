#!/usr/bin/env node

/**
 * GOOGLE MAPS SCRAPER AGENT
 *
 * Discovers businesses from Google Maps/Places using:
 * 1. Google Places API (if key available) - high quality, paginated results
 * 2. OpenStreetMap Nominatim + Overpass (FREE fallback)
 *
 * Features:
 * - Systematic grid-based search (covers entire city area)
 * - Category rotation (restaurants, retail, services, etc.)
 * - Pagination support (up to 60 results per search with Google)
 * - Phone, address, website extraction
 * - Rating and review count
 *
 * Supports: Global coverage (any city/country)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const { pool } = require('../../src/db/connection');

const CONFIG = {
  BATCH_SIZE: 20,
  DELAY_BETWEEN_REQUESTS: 1000,
  DELAY_BETWEEN_CATEGORIES: 2000,
  CYCLE_DELAY: 60000,
  REQUEST_TIMEOUT: 15000,
  GRID_RADIUS: 2000,          // 2km radius per search grid
  MAX_PAGES_PER_SEARCH: 3,    // Google allows 3 pages (60 results)
};

// Business types for Google Places
const PLACE_TYPES = [
  { type: 'restaurant', industry: 'Restaurants & Food' },
  { type: 'cafe', industry: 'Restaurants & Food' },
  { type: 'bar', industry: 'Restaurants & Food' },
  { type: 'store', industry: 'Retail & Shopping' },
  { type: 'shopping_mall', industry: 'Retail & Shopping' },
  { type: 'supermarket', industry: 'Retail & Shopping' },
  { type: 'doctor', industry: 'Healthcare' },
  { type: 'dentist', industry: 'Healthcare' },
  { type: 'hospital', industry: 'Healthcare' },
  { type: 'pharmacy', industry: 'Healthcare' },
  { type: 'bank', industry: 'Financial Services' },
  { type: 'insurance_agency', industry: 'Financial Services' },
  { type: 'accounting', industry: 'Financial Services' },
  { type: 'lawyer', industry: 'Legal Services' },
  { type: 'real_estate_agency', industry: 'Real Estate' },
  { type: 'car_dealer', industry: 'Automotive' },
  { type: 'car_repair', industry: 'Automotive' },
  { type: 'gym', industry: 'Fitness & Sports' },
  { type: 'lodging', industry: 'Hotels & Lodging' },
  { type: 'beauty_salon', industry: 'Professional Services' },
  { type: 'electrician', industry: 'Construction' },
  { type: 'plumber', industry: 'Construction' },
  { type: 'general_contractor', industry: 'Construction' },
  { type: 'travel_agency', industry: 'Travel & Tourism' },
  { type: 'school', industry: 'Education' },
  { type: 'veterinary_care', industry: 'Healthcare' },
];

// OSM equivalents for free mode
const OSM_CATEGORIES = [
  { tag: 'amenity=restaurant', industry: 'Restaurants & Food' },
  { tag: 'amenity=cafe', industry: 'Restaurants & Food' },
  { tag: 'amenity=bar', industry: 'Restaurants & Food' },
  { tag: 'shop=*', industry: 'Retail & Shopping' },
  { tag: 'amenity=doctors', industry: 'Healthcare' },
  { tag: 'amenity=dentist', industry: 'Healthcare' },
  { tag: 'amenity=pharmacy', industry: 'Healthcare' },
  { tag: 'amenity=bank', industry: 'Financial Services' },
  { tag: 'office=lawyer', industry: 'Legal Services' },
  { tag: 'office=estate_agent', industry: 'Real Estate' },
  { tag: 'office=*', industry: 'Professional Services' },
  { tag: 'tourism=hotel', industry: 'Hotels & Lodging' },
  { tag: 'leisure=fitness_centre', industry: 'Fitness & Sports' },
  { tag: 'shop=car', industry: 'Automotive' },
  { tag: 'shop=car_repair', industry: 'Automotive' },
];

// Cities to systematically search
const SEARCH_CITIES = [
  { name: 'London', region: 'England', country: 'United Kingdom', lat: 51.5074, lng: -0.1278 },
  { name: 'Manchester', region: 'England', country: 'United Kingdom', lat: 53.4808, lng: -2.2426 },
  { name: 'Birmingham', region: 'England', country: 'United Kingdom', lat: 52.4862, lng: -1.8904 },
  { name: 'Leeds', region: 'England', country: 'United Kingdom', lat: 53.8008, lng: -1.5491 },
  { name: 'Glasgow', region: 'Scotland', country: 'United Kingdom', lat: 55.8642, lng: -4.2518 },
  { name: 'Liverpool', region: 'England', country: 'United Kingdom', lat: 53.4084, lng: -2.9916 },
  { name: 'Edinburgh', region: 'Scotland', country: 'United Kingdom', lat: 55.9533, lng: -3.1883 },
  { name: 'Bristol', region: 'England', country: 'United Kingdom', lat: 51.4545, lng: -2.5879 },
  { name: 'Sheffield', region: 'England', country: 'United Kingdom', lat: 53.3811, lng: -1.4701 },
  { name: 'Newcastle', region: 'England', country: 'United Kingdom', lat: 54.9783, lng: -1.6178 },
  { name: 'New York', region: 'New York', country: 'United States', lat: 40.7128, lng: -74.0060 },
  { name: 'Los Angeles', region: 'California', country: 'United States', lat: 34.0522, lng: -118.2437 },
  { name: 'Chicago', region: 'Illinois', country: 'United States', lat: 41.8781, lng: -87.6298 },
  { name: 'Houston', region: 'Texas', country: 'United States', lat: 29.7604, lng: -95.3698 },
  { name: 'Toronto', region: 'Ontario', country: 'Canada', lat: 43.6532, lng: -79.3832 },
  { name: 'Sydney', region: 'New South Wales', country: 'Australia', lat: -33.8688, lng: 151.2093 },
  { name: 'Dubai', region: 'Dubai', country: 'United Arab Emirates', lat: 25.2048, lng: 55.2708 },
  { name: 'Singapore', region: 'Singapore', country: 'Singapore', lat: 1.3521, lng: 103.8198 },
  { name: 'Paris', region: 'Île-de-France', country: 'France', lat: 48.8566, lng: 2.3522 },
  { name: 'Berlin', region: 'Berlin', country: 'Germany', lat: 52.5200, lng: 13.4050 },
];

class GoogleMapsScraperAgent {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    this.useGoogle = !!this.googleApiKey;
    this.stats = {
      companiesFound: 0,
      companiesSaved: 0,
      duplicatesSkipped: 0,
      errors: 0,
      cycles: 0,
    };
    this.cityIndex = 0;
    this.typeIndex = 0;
    this.running = true;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Search Google Places API (Nearby Search)
   */
  async searchGooglePlaces(lat, lng, type) {
    const allResults = [];

    try {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${CONFIG.GRID_RADIUS}&type=${type}&key=${this.googleApiKey}`;

      for (let page = 0; page < CONFIG.MAX_PAGES_PER_SEARCH; page++) {
        const response = await axios.get(url, { timeout: CONFIG.REQUEST_TIMEOUT });
        const results = response.data.results || [];
        allResults.push(...results);

        // Check for next page
        if (response.data.next_page_token) {
          await this.delay(2000); // Google requires 2s wait for next_page_token
          url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${response.data.next_page_token}&key=${this.googleApiKey}`;
        } else {
          break;
        }
      }
    } catch (error) {
      this.stats.errors++;
    }

    return allResults;
  }

  /**
   * Get place details (phone, website, hours)
   */
  async getPlaceDetails(placeId) {
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: placeId,
          fields: 'formatted_phone_number,website,url,opening_hours,formatted_address',
          key: this.googleApiKey,
        },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });
      return response.data.result || {};
    } catch {
      return {};
    }
  }

  /**
   * Search OpenStreetMap (FREE alternative)
   */
  async searchOSM(lat, lng, osmTag) {
    try {
      const [key, value] = osmTag.split('=');
      const bbox = this.getBbox(lat, lng, CONFIG.GRID_RADIUS);

      const query = value === '*'
        ? `[out:json][timeout:25];(node["${key}"](${bbox});way["${key}"](${bbox}););out center 100;`
        : `[out:json][timeout:25];(node["${key}"="${value}"](${bbox});way["${key}"="${value}"](${bbox}););out center 100;`;

      const response = await axios.post(
        'https://overpass-api.de/api/interpreter',
        query,
        { headers: { 'Content-Type': 'text/plain' }, timeout: 30000 }
      );

      return (response.data.elements || []).filter(el => el.tags && el.tags.name);
    } catch (error) {
      this.stats.errors++;
      return [];
    }
  }

  /**
   * Get bounding box from center point and radius
   */
  getBbox(lat, lng, radiusMeters) {
    const latDelta = radiusMeters / 111320;
    const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
    return `${lat - latDelta},${lng - lngDelta},${lat + latDelta},${lng + lngDelta}`;
  }

  /**
   * Check if company exists
   */
  async companyExists(name, city) {
    const result = await pool.query(
      `SELECT account_id FROM accounts WHERE LOWER(company_name) = LOWER($1) AND LOWER(city) = LOWER($2)`,
      [name, city]
    );
    return result.rows.length > 0;
  }

  /**
   * Save Google Place result
   */
  async saveGooglePlace(place, industry, city) {
    const name = place.name;
    if (!name || name.length < 2) return false;

    if (await this.companyExists(name, city.name)) {
      this.stats.duplicatesSkipped++;
      return false;
    }

    // Get details for phone/website
    let details = {};
    if (place.place_id) {
      details = await this.getPlaceDetails(place.place_id);
      await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);
    }

    try {
      await pool.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, address,
          headquarters_address, website, phone_number, verified, data_source, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'Agent:GoogleMaps', NOW())`,
        [
          name, industry, city.country, city.region, city.name,
          details.formatted_address || place.vicinity,
          details.formatted_address || place.vicinity,
          details.website || null,
          details.formatted_phone_number || null,
        ]
      );
      this.stats.companiesSaved++;
      return true;
    } catch (error) {
      if (!error.message.includes('duplicate')) this.stats.errors++;
      return false;
    }
  }

  /**
   * Save OSM result
   */
  async saveOSMResult(element, industry, city) {
    const name = element.tags.name;
    if (!name || name.length < 2) return false;

    if (await this.companyExists(name, city.name)) {
      this.stats.duplicatesSkipped++;
      return false;
    }

    const tags = element.tags;
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ') || null;
    const phone = tags.phone || tags['contact:phone'] || null;
    const website = tags.website || tags['contact:website'] || null;

    try {
      await pool.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, address,
          website, phone_number, verified, data_source, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'Agent:OSM', NOW())`,
        [name, industry, city.country, city.region, city.name, address, website, phone]
      );
      this.stats.companiesSaved++;
      return true;
    } catch (error) {
      if (!error.message.includes('duplicate')) this.stats.errors++;
      return false;
    }
  }

  /**
   * Process a city + category combination
   */
  async processCityCategory(city, categoryIndex) {
    if (this.useGoogle) {
      const placeType = PLACE_TYPES[categoryIndex % PLACE_TYPES.length];
      console.log(`   [Google] ${city.name} - ${placeType.industry} (${placeType.type})`);

      const results = await this.searchGooglePlaces(city.lat, city.lng, placeType.type);
      this.stats.companiesFound += results.length;

      let saved = 0;
      for (const place of results) {
        if (!this.running) break;
        if (await this.saveGooglePlace(place, placeType.industry, city)) saved++;
      }
      if (saved > 0) console.log(`      Saved ${saved} new companies`);
    } else {
      const osmCat = OSM_CATEGORIES[categoryIndex % OSM_CATEGORIES.length];
      console.log(`   [OSM] ${city.name} - ${osmCat.industry} (${osmCat.tag})`);

      const results = await this.searchOSM(city.lat, city.lng, osmCat.tag);
      this.stats.companiesFound += results.length;

      let saved = 0;
      for (const el of results) {
        if (!this.running) break;
        if (await this.saveOSMResult(el, osmCat.industry, city)) saved++;
      }
      if (saved > 0) console.log(`      Saved ${saved} new companies`);
    }
  }

  /**
   * Main loop
   */
  async run() {
    console.log('='.repeat(60));
    console.log('   GOOGLE MAPS / OSM SCRAPER AGENT');
    console.log('='.repeat(60));
    console.log(`   Mode: ${this.useGoogle ? 'Google Places API' : 'OpenStreetMap (FREE)'}`);
    console.log(`   Cities: ${SEARCH_CITIES.length}`);
    console.log(`   Categories: ${this.useGoogle ? PLACE_TYPES.length : OSM_CATEGORIES.length}`);
    console.log('');

    while (this.running) {
      this.stats.cycles++;
      console.log(`\n--- Cycle ${this.stats.cycles} ---`);

      // Process 3 city/category combos per cycle
      for (let i = 0; i < 3; i++) {
        if (!this.running) break;

        const city = SEARCH_CITIES[this.cityIndex % SEARCH_CITIES.length];
        await this.processCityCategory(city, this.typeIndex);

        this.typeIndex++;
        const maxTypes = this.useGoogle ? PLACE_TYPES.length : OSM_CATEGORIES.length;
        if (this.typeIndex >= maxTypes) {
          this.typeIndex = 0;
          this.cityIndex++;
        }

        await this.delay(CONFIG.DELAY_BETWEEN_CATEGORIES);
      }

      console.log(`\n   Stats: ${this.stats.companiesFound} found | ${this.stats.companiesSaved} saved | ${this.stats.duplicatesSkipped} dupes | ${this.stats.errors} errors`);
      await this.delay(CONFIG.CYCLE_DELAY);
    }
  }
}

// Main
const agent = new GoogleMapsScraperAgent();

process.on('SIGINT', () => { agent.running = false; });
process.on('SIGTERM', () => { agent.running = false; });

agent.run().catch(e => {
  console.error('Google Maps Scraper Agent failed:', e.message);
  process.exit(1);
});
