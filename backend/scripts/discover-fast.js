#!/usr/bin/env node

/**
 * FAST DISCOVERY SYSTEM v4.1
 *
 * Optimized for SPEED and RELIABILITY
 * Uses multiple free sources with simple, fast queries
 *
 * Sources:
 *   1. OpenStreetMap Overpass (individual radius queries)
 *   2. Nominatim POI Search
 *   3. Companies House UK (JSON API)
 *   4. Wikidata SPARQL (organizations/businesses)
 *   5. FSA Food Hygiene Ratings API (UK government - real businesses)
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');

// No timeouts - keep running until done
const REQUEST_TIMEOUT = 0; // No timeout
const DELAY_BETWEEN_REQUESTS = 1000; // 1 second between requests
const OVERPASS_DELAY = 2000; // 2 seconds between Overpass queries
const MAX_RETRIES = 10; // Retry failed requests up to 10 times

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
];

class FastDiscoveryAgent {
  constructor(city, region, country = 'United Kingdom', district = null) {
    this.city = city;
    this.region = region;
    this.country = country;
    this.district = district;
    this.isUK = country.toLowerCase().includes('kingdom') || country.toLowerCase() === 'uk';

    this.stats = {
      companiesFound: 0,
      companiesSaved: 0,
      startTime: Date.now(),
      sources: {}
    };

    this.processedNames = new Set();

    console.log('\n' + '='.repeat(60));
    console.log('   FAST DISCOVERY SYSTEM v4.0');
    console.log('='.repeat(60));
    console.log(`   Target: ${city}${district ? `, ${district}` : ''}, ${region}, ${country}`);
    console.log('   Mode: FAST MULTI-SOURCE\n');
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getCoordinates() {
    // Try multiple search queries with fallbacks
    const searchQueries = [];

    if (this.district) {
      searchQueries.push(`${this.district}, ${this.city}, ${this.country}`);
    }
    searchQueries.push(`${this.city}, ${this.region}, ${this.country}`);
    searchQueries.push(`${this.city}, ${this.country}`);
    searchQueries.push(this.city);

    for (const searchQuery of searchQueries) {
      try {
        console.log(`      Trying: ${searchQuery}`);
        const response = await axios.get(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`,
          {
            headers: { 'User-Agent': 'FastDiscovery/4.0' },
            timeout: 30000
          }
        );

        if (response.data?.[0]) {
          const { lat, lon, boundingbox } = response.data[0];
          console.log(`      Success: Using "${searchQuery}"`);
          return {
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            bbox: {
              south: parseFloat(boundingbox[0]),
              north: parseFloat(boundingbox[1]),
              west: parseFloat(boundingbox[2]),
              east: parseFloat(boundingbox[3])
            }
          };
        }
        await this.delay(1000); // Rate limit between attempts
      } catch (error) {
        console.log(`      [WARNING] Geocoding "${searchQuery}" failed: ${error.message}`);
      }
    }
    return null;
  }

  /**
   * SOURCE 1: OpenStreetMap - Individual radius queries (most reliable)
   */
  async searchOSM(coords) {
    console.log('\n   [SOURCE 1] OpenStreetMap...');
    const companies = [];
    const { lat, lon } = coords;
    const radius = 50000; // 50km radius for maximum coverage

    // Query each type individually - MAXIMUM COVERAGE - ALL INDUSTRIES
    const queries = [
      // ===== FOOD & DRINK (15 types) =====
      { tag: 'amenity', type: 'restaurant' },
      { tag: 'amenity', type: 'cafe' },
      { tag: 'amenity', type: 'fast_food' },
      { tag: 'amenity', type: 'bar' },
      { tag: 'amenity', type: 'pub' },
      { tag: 'amenity', type: 'nightclub' },
      { tag: 'amenity', type: 'food_court' },
      { tag: 'amenity', type: 'ice_cream' },
      { tag: 'amenity', type: 'biergarten' },
      { tag: 'amenity', type: 'juice_bar' },
      { tag: 'amenity', type: 'coffee_shop' },
      { tag: 'amenity', type: 'bistro' },
      { tag: 'amenity', type: 'wine_bar' },
      { tag: 'amenity', type: 'cocktail_bar' },
      { tag: 'amenity', type: 'brewery' },

      // ===== HEALTHCARE (25 types) =====
      { tag: 'amenity', type: 'pharmacy' },
      { tag: 'amenity', type: 'doctors' },
      { tag: 'amenity', type: 'dentist' },
      { tag: 'amenity', type: 'hospital' },
      { tag: 'amenity', type: 'clinic' },
      { tag: 'amenity', type: 'veterinary' },
      { tag: 'amenity', type: 'nursing_home' },
      { tag: 'amenity', type: 'social_facility' },
      { tag: 'healthcare', type: 'doctor' },
      { tag: 'healthcare', type: 'physiotherapist' },
      { tag: 'healthcare', type: 'optometrist' },
      { tag: 'healthcare', type: 'dentist' },
      { tag: 'healthcare', type: 'pharmacy' },
      { tag: 'healthcare', type: 'hospital' },
      { tag: 'healthcare', type: 'clinic' },
      { tag: 'healthcare', type: 'laboratory' },
      { tag: 'healthcare', type: 'psychotherapist' },
      { tag: 'healthcare', type: 'podiatrist' },
      { tag: 'healthcare', type: 'chiropractor' },
      { tag: 'healthcare', type: 'audiologist' },
      { tag: 'healthcare', type: 'speech_therapist' },
      { tag: 'healthcare', type: 'occupational_therapist' },
      { tag: 'healthcare', type: 'midwife' },
      { tag: 'healthcare', type: 'nurse' },
      { tag: 'healthcare', type: 'alternative' },

      // ===== FINANCE & BANKING (12 types) =====
      { tag: 'amenity', type: 'bank' },
      { tag: 'amenity', type: 'atm' },
      { tag: 'amenity', type: 'bureau_de_change' },
      { tag: 'amenity', type: 'money_transfer' },
      { tag: 'office', type: 'financial' },
      { tag: 'office', type: 'insurance' },
      { tag: 'office', type: 'accountant' },
      { tag: 'office', type: 'tax_advisor' },
      { tag: 'office', type: 'financial_advisor' },
      { tag: 'office', type: 'investment' },
      { tag: 'shop', type: 'money_lender' },
      { tag: 'shop', type: 'pawnbroker' },

      // ===== AUTOMOTIVE (15 types) =====
      { tag: 'amenity', type: 'fuel' },
      { tag: 'amenity', type: 'car_repair' },
      { tag: 'amenity', type: 'car_wash' },
      { tag: 'amenity', type: 'car_rental' },
      { tag: 'amenity', type: 'car_sharing' },
      { tag: 'amenity', type: 'motorcycle_parking' },
      { tag: 'amenity', type: 'vehicle_inspection' },
      { tag: 'shop', type: 'car' },
      { tag: 'shop', type: 'car_parts' },
      { tag: 'shop', type: 'tyres' },
      { tag: 'shop', type: 'car_repair' },
      { tag: 'shop', type: 'motorcycle' },
      { tag: 'shop', type: 'motorcycle_parts' },
      { tag: 'shop', type: 'truck' },
      { tag: 'shop', type: 'caravan' },

      // ===== FITNESS & RECREATION (15 types) =====
      { tag: 'amenity', type: 'gym' },
      { tag: 'leisure', type: 'fitness_centre' },
      { tag: 'leisure', type: 'sports_centre' },
      { tag: 'leisure', type: 'swimming_pool' },
      { tag: 'leisure', type: 'golf_course' },
      { tag: 'leisure', type: 'tennis_court' },
      { tag: 'leisure', type: 'bowling_alley' },
      { tag: 'leisure', type: 'ice_rink' },
      { tag: 'leisure', type: 'stadium' },
      { tag: 'leisure', type: 'horse_riding' },
      { tag: 'leisure', type: 'dance' },
      { tag: 'leisure', type: 'sauna' },
      { tag: 'leisure', type: 'spa' },
      { tag: 'leisure', type: 'martial_arts' },
      { tag: 'sport', type: 'yoga' },

      // ===== RETAIL - GENERAL (20 types) =====
      { tag: 'shop', type: 'supermarket' },
      { tag: 'shop', type: 'convenience' },
      { tag: 'shop', type: 'department_store' },
      { tag: 'shop', type: 'mall' },
      { tag: 'shop', type: 'general' },
      { tag: 'shop', type: 'variety_store' },
      { tag: 'shop', type: 'wholesale' },
      { tag: 'shop', type: 'newsagent' },
      { tag: 'shop', type: 'kiosk' },
      { tag: 'shop', type: 'market' },
      { tag: 'shop', type: 'farm' },
      { tag: 'shop', type: 'trade' },
      { tag: 'shop', type: 'outdoor' },
      { tag: 'shop', type: 'hunting' },
      { tag: 'shop', type: 'fishing' },
      { tag: 'shop', type: 'tobacco' },
      { tag: 'shop', type: 'e-cigarette' },
      { tag: 'shop', type: 'cannabis' },
      { tag: 'shop', type: 'chemist' },
      { tag: 'shop', type: 'agrarian' },

      // ===== RETAIL - FASHION & CLOTHING (15 types) =====
      { tag: 'shop', type: 'clothes' },
      { tag: 'shop', type: 'shoes' },
      { tag: 'shop', type: 'jewelry' },
      { tag: 'shop', type: 'boutique' },
      { tag: 'shop', type: 'fashion' },
      { tag: 'shop', type: 'bag' },
      { tag: 'shop', type: 'leather' },
      { tag: 'shop', type: 'fabric' },
      { tag: 'shop', type: 'sewing' },
      { tag: 'shop', type: 'tailor' },
      { tag: 'shop', type: 'watches' },
      { tag: 'shop', type: 'accessories' },
      { tag: 'shop', type: 'hats' },
      { tag: 'shop', type: 'baby_goods' },
      { tag: 'shop', type: 'second_hand' },

      // ===== RETAIL - HOME & GARDEN (20 types) =====
      { tag: 'shop', type: 'furniture' },
      { tag: 'shop', type: 'electronics' },
      { tag: 'shop', type: 'hardware' },
      { tag: 'shop', type: 'doityourself' },
      { tag: 'shop', type: 'garden_centre' },
      { tag: 'shop', type: 'florist' },
      { tag: 'shop', type: 'appliance' },
      { tag: 'shop', type: 'kitchen' },
      { tag: 'shop', type: 'bathroom_furnishing' },
      { tag: 'shop', type: 'bed' },
      { tag: 'shop', type: 'carpet' },
      { tag: 'shop', type: 'curtain' },
      { tag: 'shop', type: 'interior_decoration' },
      { tag: 'shop', type: 'lighting' },
      { tag: 'shop', type: 'tiles' },
      { tag: 'shop', type: 'paint' },
      { tag: 'shop', type: 'glaziery' },
      { tag: 'shop', type: 'houseware' },
      { tag: 'shop', type: 'antiques' },
      { tag: 'shop', type: 'art' },

      // ===== RETAIL - TECHNOLOGY (12 types) =====
      { tag: 'shop', type: 'computer' },
      { tag: 'shop', type: 'mobile_phone' },
      { tag: 'shop', type: 'telecommunication' },
      { tag: 'shop', type: 'electrical' },
      { tag: 'shop', type: 'video' },
      { tag: 'shop', type: 'video_games' },
      { tag: 'shop', type: 'hifi' },
      { tag: 'shop', type: 'radiotechnics' },
      { tag: 'shop', type: 'vacuum_cleaner' },
      { tag: 'shop', type: 'printer_ink' },
      { tag: 'shop', type: 'camera' },
      { tag: 'shop', type: 'photo' },

      // ===== PERSONAL SERVICES (15 types) =====
      { tag: 'shop', type: 'hairdresser' },
      { tag: 'shop', type: 'beauty' },
      { tag: 'shop', type: 'tattoo' },
      { tag: 'shop', type: 'massage' },
      { tag: 'shop', type: 'cosmetics' },
      { tag: 'shop', type: 'perfumery' },
      { tag: 'shop', type: 'nail_salon' },
      { tag: 'shop', type: 'tanning' },
      { tag: 'shop', type: 'piercing' },
      { tag: 'amenity', type: 'beauty_salon' },
      { tag: 'amenity', type: 'spa' },
      { tag: 'amenity', type: 'sauna' },
      { tag: 'shop', type: 'hearing_aids' },
      { tag: 'shop', type: 'optician' },
      { tag: 'shop', type: 'medical_supply' },

      // ===== FOOD RETAIL (20 types) =====
      { tag: 'shop', type: 'bakery' },
      { tag: 'shop', type: 'butcher' },
      { tag: 'shop', type: 'greengrocer' },
      { tag: 'shop', type: 'deli' },
      { tag: 'shop', type: 'alcohol' },
      { tag: 'shop', type: 'beverages' },
      { tag: 'shop', type: 'wine' },
      { tag: 'shop', type: 'coffee' },
      { tag: 'shop', type: 'tea' },
      { tag: 'shop', type: 'chocolate' },
      { tag: 'shop', type: 'confectionery' },
      { tag: 'shop', type: 'dairy' },
      { tag: 'shop', type: 'cheese' },
      { tag: 'shop', type: 'seafood' },
      { tag: 'shop', type: 'frozen_food' },
      { tag: 'shop', type: 'health_food' },
      { tag: 'shop', type: 'organic' },
      { tag: 'shop', type: 'pasta' },
      { tag: 'shop', type: 'spices' },
      { tag: 'shop', type: 'nuts' },

      // ===== PROFESSIONAL OFFICES (25 types) =====
      { tag: 'office', type: 'company' },
      { tag: 'office', type: 'estate_agent' },
      { tag: 'office', type: 'lawyer' },
      { tag: 'office', type: 'it' },
      { tag: 'office', type: 'architect' },
      { tag: 'office', type: 'consulting' },
      { tag: 'office', type: 'marketing' },
      { tag: 'office', type: 'recruitment' },
      { tag: 'office', type: 'advertising' },
      { tag: 'office', type: 'design' },
      { tag: 'office', type: 'engineering' },
      { tag: 'office', type: 'research' },
      { tag: 'office', type: 'telecommunication' },
      { tag: 'office', type: 'logistics' },
      { tag: 'office', type: 'shipping' },
      { tag: 'office', type: 'travel_agent' },
      { tag: 'office', type: 'property_management' },
      { tag: 'office', type: 'newspaper' },
      { tag: 'office', type: 'ngo' },
      { tag: 'office', type: 'charity' },
      { tag: 'office', type: 'association' },
      { tag: 'office', type: 'coworking' },
      { tag: 'office', type: 'notary' },
      { tag: 'office', type: 'surveyor' },
      { tag: 'office', type: 'therapist' },

      // ===== EDUCATION (15 types) =====
      { tag: 'amenity', type: 'school' },
      { tag: 'amenity', type: 'college' },
      { tag: 'amenity', type: 'university' },
      { tag: 'amenity', type: 'training' },
      { tag: 'amenity', type: 'driving_school' },
      { tag: 'amenity', type: 'kindergarten' },
      { tag: 'amenity', type: 'childcare' },
      { tag: 'amenity', type: 'language_school' },
      { tag: 'amenity', type: 'music_school' },
      { tag: 'amenity', type: 'dance_school' },
      { tag: 'amenity', type: 'library' },
      { tag: 'amenity', type: 'prep_school' },
      { tag: 'amenity', type: 'research_institute' },
      { tag: 'office', type: 'educational_institution' },
      { tag: 'shop', type: 'books' },

      // ===== TOURISM & ACCOMMODATION (15 types) =====
      { tag: 'tourism', type: 'hotel' },
      { tag: 'tourism', type: 'guest_house' },
      { tag: 'tourism', type: 'hostel' },
      { tag: 'tourism', type: 'motel' },
      { tag: 'tourism', type: 'apartment' },
      { tag: 'tourism', type: 'camp_site' },
      { tag: 'tourism', type: 'caravan_site' },
      { tag: 'tourism', type: 'chalet' },
      { tag: 'tourism', type: 'museum' },
      { tag: 'tourism', type: 'gallery' },
      { tag: 'tourism', type: 'theme_park' },
      { tag: 'tourism', type: 'zoo' },
      { tag: 'tourism', type: 'aquarium' },
      { tag: 'tourism', type: 'attraction' },
      { tag: 'tourism', type: 'information' },

      // ===== ENTERTAINMENT & CULTURE (20 types) =====
      { tag: 'amenity', type: 'cinema' },
      { tag: 'amenity', type: 'theatre' },
      { tag: 'amenity', type: 'casino' },
      { tag: 'amenity', type: 'gambling' },
      { tag: 'amenity', type: 'arts_centre' },
      { tag: 'amenity', type: 'community_centre' },
      { tag: 'amenity', type: 'conference_centre' },
      { tag: 'amenity', type: 'events_venue' },
      { tag: 'amenity', type: 'music_venue' },
      { tag: 'amenity', type: 'stripclub' },
      { tag: 'amenity', type: 'studio' },
      { tag: 'leisure', type: 'amusement_arcade' },
      { tag: 'leisure', type: 'escape_game' },
      { tag: 'leisure', type: 'miniature_golf' },
      { tag: 'shop', type: 'music' },
      { tag: 'shop', type: 'musical_instrument' },
      { tag: 'shop', type: 'ticket' },
      { tag: 'shop', type: 'games' },
      { tag: 'shop', type: 'toys' },
      { tag: 'shop', type: 'gift' },

      // ===== TRADES & CRAFTS (25 types) =====
      { tag: 'craft', type: 'plumber' },
      { tag: 'craft', type: 'electrician' },
      { tag: 'craft', type: 'carpenter' },
      { tag: 'craft', type: 'painter' },
      { tag: 'craft', type: 'roofer' },
      { tag: 'craft', type: 'hvac' },
      { tag: 'craft', type: 'builder' },
      { tag: 'craft', type: 'bricklayer' },
      { tag: 'craft', type: 'stonemason' },
      { tag: 'craft', type: 'locksmith' },
      { tag: 'craft', type: 'blacksmith' },
      { tag: 'craft', type: 'welder' },
      { tag: 'craft', type: 'glazier' },
      { tag: 'craft', type: 'metal_works' },
      { tag: 'craft', type: 'window_construction' },
      { tag: 'craft', type: 'floorer' },
      { tag: 'craft', type: 'gardener' },
      { tag: 'craft', type: 'scaffolder' },
      { tag: 'craft', type: 'insulation' },
      { tag: 'craft', type: 'tiler' },
      { tag: 'craft', type: 'plasterer' },
      { tag: 'craft', type: 'upholsterer' },
      { tag: 'craft', type: 'signmaker' },
      { tag: 'craft', type: 'printer' },
      { tag: 'craft', type: 'bookbinder' },

      // ===== INDUSTRIAL & MANUFACTURING (20 types) =====
      { tag: 'industrial', type: 'factory' },
      { tag: 'industrial', type: 'warehouse' },
      { tag: 'industrial', type: 'depot' },
      { tag: 'industrial', type: 'distribution_centre' },
      { tag: 'building', type: 'industrial' },
      { tag: 'building', type: 'warehouse' },
      { tag: 'building', type: 'factory' },
      { tag: 'building', type: 'office' },
      { tag: 'building', type: 'commercial' },
      { tag: 'building', type: 'retail' },
      { tag: 'man_made', type: 'works' },
      { tag: 'landuse', type: 'industrial' },
      { tag: 'craft', type: 'brewery' },
      { tag: 'craft', type: 'distillery' },
      { tag: 'craft', type: 'winery' },
      { tag: 'craft', type: 'bakery' },
      { tag: 'craft', type: 'caterer' },
      { tag: 'craft', type: 'confectionery' },
      { tag: 'craft', type: 'clockmaker' },
      { tag: 'craft', type: 'jeweller' },

      // ===== OTHER SERVICES (25 types) =====
      { tag: 'shop', type: 'laundry' },
      { tag: 'shop', type: 'dry_cleaning' },
      { tag: 'shop', type: 'travel_agency' },
      { tag: 'shop', type: 'copyshop' },
      { tag: 'shop', type: 'funeral_directors' },
      { tag: 'shop', type: 'pet' },
      { tag: 'shop', type: 'pet_grooming' },
      { tag: 'shop', type: 'stationery' },
      { tag: 'shop', type: 'lottery' },
      { tag: 'shop', type: 'key_cutter' },
      { tag: 'shop', type: 'locksmith' },
      { tag: 'shop', type: 'shoe_repair' },
      { tag: 'shop', type: 'watch_repair' },
      { tag: 'shop', type: 'computer_repair' },
      { tag: 'shop', type: 'mobile_phone_repair' },
      { tag: 'shop', type: 'appliance_repair' },
      { tag: 'shop', type: 'bicycle_repair' },
      { tag: 'shop', type: 'bicycle' },
      { tag: 'shop', type: 'sports' },
      { tag: 'shop', type: 'fishing' },
      { tag: 'shop', type: 'charity' },
      { tag: 'shop', type: 'frame' },
      { tag: 'shop', type: 'trophy' },
      { tag: 'shop', type: 'party' },
      { tag: 'shop', type: 'rental' },

      // ===== RELIGIOUS & COMMUNITY (10 types) =====
      { tag: 'amenity', type: 'place_of_worship' },
      { tag: 'amenity', type: 'community_centre' },
      { tag: 'amenity', type: 'social_centre' },
      { tag: 'amenity', type: 'youth_centre' },
      { tag: 'building', type: 'church' },
      { tag: 'building', type: 'mosque' },
      { tag: 'building', type: 'synagogue' },
      { tag: 'building', type: 'temple' },
      { tag: 'office', type: 'religion' },
      { tag: 'office', type: 'political_party' },

      // ===== TRANSPORT & LOGISTICS (15 types) =====
      { tag: 'amenity', type: 'taxi' },
      { tag: 'amenity', type: 'bus_station' },
      { tag: 'amenity', type: 'ferry_terminal' },
      { tag: 'amenity', type: 'parking' },
      { tag: 'shop', type: 'storage_rental' },
      { tag: 'office', type: 'courier' },
      { tag: 'office', type: 'moving_company' },
      { tag: 'office', type: 'freight' },
      { tag: 'office', type: 'delivery' },
      { tag: 'office', type: 'taxi' },
      { tag: 'office', type: 'transport' },
      { tag: 'amenity', type: 'car_rental' },
      { tag: 'amenity', type: 'boat_rental' },
      { tag: 'shop', type: 'boat' },
      { tag: 'shop', type: 'trailer' },
    ];

    let totalOSM = 0;
    let errors = 0;

    for (const q of queries) {
      let retries = 0;
      let success = false;

      while (retries < MAX_RETRIES && !success) {
        try {
          const overpassQuery = `[out:json][timeout:180];node["${q.tag}"="${q.type}"]["name"](around:${radius},${lat},${lon});out 10000;`;

          const response = await axios.post(
            'https://overpass-api.de/api/interpreter',
            'data=' + encodeURIComponent(overpassQuery),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
          );

          const count = response.data.elements?.length || 0;
          totalOSM += count;
          for (const el of response.data.elements || []) {
            if (el.tags?.name && this.isValidName(el.tags.name)) {
              companies.push(this.createCompany(el.tags, 'OpenStreetMap'));
            }
          }
          if (count > 0) console.log(`      ${q.type}: ${count}`);
          success = true;
        } catch (e) {
          retries++;
          // On 504/429, wait longer before retry
          if (e.response?.status === 504 || e.response?.status === 429 || e.code === 'ECONNABORTED') {
            const waitTime = 15000 * retries; // 15s, 30s, 45s exponential backoff
            console.log(`      ${q.type}: server busy, retry ${retries}/${MAX_RETRIES} in ${waitTime/1000}s...`);
            await this.delay(waitTime);
          } else {
            console.log(`      ${q.type}: error - ${e.message}`);
            errors++;
            break;
          }
        }
      }

      if (!success) errors++;
      await this.delay(OVERPASS_DELAY); // Delay between queries to avoid rate limits
    }

    this.stats.sources['OpenStreetMap'] = companies.length;
    console.log(`      Total from OSM: ${companies.length} (${errors} errors)`);
    return companies;
  }

  /**
   * SOURCE 2: Nominatim POI Search - Fast text search
   */
  async searchNominatim() {
    console.log('\n   [SOURCE 2] Nominatim POI Search...');
    const companies = [];

    const searchTerms = [
      // Food & Hospitality
      'restaurant', 'cafe', 'pub', 'bar', 'hotel', 'takeaway', 'bakery', 'catering', 'brewery', 'distillery',
      // Retail - General
      'shop', 'supermarket', 'store', 'boutique', 'florist', 'jeweller', 'newsagent', 'gift shop', 'department store',
      // Retail - Fashion
      'clothing', 'shoes', 'fashion', 'tailor', 'bridal', 'menswear', 'womenswear', 'children clothes',
      // Retail - Home & Garden
      'furniture', 'kitchen', 'bathroom', 'bedroom', 'garden centre', 'diy', 'hardware', 'paint', 'tiles', 'carpet',
      // Retail - Electronics
      'computer', 'mobile phone', 'electronics', 'appliances', 'hifi', 'camera', 'tv',
      // Healthcare
      'dentist', 'doctor', 'pharmacy', 'clinic', 'optician', 'veterinary', 'physiotherapy', 'chiropractor',
      'hospital', 'nursing home', 'care home', 'medical centre', 'health centre', 'laboratory', 'podiatrist',
      // Professional Services
      'solicitor', 'accountant', 'estate agent', 'recruitment', 'consultant', 'architect', 'surveyor',
      'lawyer', 'barrister', 'notary', 'tax advisor', 'financial advisor', 'investment', 'wealth management',
      // IT & Tech
      'software', 'it company', 'web design', 'digital agency', 'marketing agency', 'seo', 'app development',
      // Personal Services
      'hairdresser', 'salon', 'spa', 'barber', 'beauty', 'tattoo', 'nail bar', 'massage', 'tanning', 'piercing',
      // Automotive
      'garage', 'car dealer', 'mot', 'tyres', 'car wash', 'car rental', 'motorcycle', 'auto parts', 'body shop',
      // Fitness & Leisure
      'gym', 'fitness', 'sports club', 'swimming pool', 'yoga', 'pilates', 'martial arts', 'dance studio', 'golf', 'tennis',
      // Finance
      'bank', 'insurance', 'mortgage', 'financial advisor', 'pawnbroker', 'money transfer', 'bureau de change',
      // Construction & Trades
      'builder', 'plumber', 'electrician', 'roofer', 'painter', 'decorator', 'scaffolding', 'glazier',
      'carpenter', 'joiner', 'bricklayer', 'plasterer', 'tiler', 'flooring', 'kitchen fitter', 'bathroom fitter',
      // Industrial & Manufacturing
      'factory', 'manufacturer', 'warehouse', 'distribution', 'engineering', 'fabrication', 'machining', 'metalwork',
      // Entertainment
      'cinema', 'theatre', 'casino', 'bowling', 'escape room', 'amusement', 'nightclub', 'music venue', 'concert hall',
      // Education
      'school', 'college', 'university', 'training', 'driving school', 'nursery', 'childcare', 'tutor', 'language school',
      // Tourism
      'travel agent', 'tour operator', 'guest house', 'bed and breakfast', 'hostel', 'holiday let', 'caravan park',
      // Other Services
      'cleaning', 'security', 'removals', 'storage', 'printing', 'photography', 'video production', 'wedding planner',
      'pet shop', 'pet grooming', 'kennels', 'cattery', 'funeral director', 'florist', 'locksmith', 'dry cleaner',
      'laundry', 'tailor', 'alterations', 'shoe repair', 'key cutting', 'engraving', 'signage', 'courier', 'delivery',
      // Property & Real Estate
      'property management', 'lettings', 'commercial property', 'industrial property', 'office space',
      // Media & Creative
      'graphic design', 'advertising', 'pr agency', 'media company', 'film production', 'recording studio', 'publisher',
      // Charity & Community
      'charity shop', 'charity', 'community centre', 'church', 'mosque', 'temple', 'synagogue'
    ];

    for (const term of searchTerms) {
      try {
        const response = await axios.get(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term + ' ' + this.city)}&format=json&limit=1000&addressdetails=1`,
          {
            headers: { 'User-Agent': 'FastDiscovery/4.0' }
          }
        );

        for (const place of response.data || []) {
          if (place.name && this.isValidName(place.name) && place.type !== 'city') {
            companies.push({
              name: place.name,
              address: place.display_name?.split(',').slice(0, 3).join(', '),
              city: this.city,
              region: this.region,
              country: this.country,
              category: term,
              source: 'Nominatim'
            });
          }
        }

        await this.delay(DELAY_BETWEEN_REQUESTS); // Nominatim rate limit
      } catch (e) {
        console.log(`      ${term}: error - ${e.message}`);
        await this.delay(5000); // Wait on error
      }
    }

    this.stats.sources['Nominatim'] = companies.length;
    console.log(`      Found: ${companies.length} places`);
    return companies;
  }

  /**
   * SOURCE 3: Companies House UK - JSON API search
   */
  async searchCompaniesHouse() {
    if (!this.isUK) return [];

    console.log('\n   [SOURCE 3] Companies House UK...');
    const companies = [];

    // Comprehensive search terms for MAXIMUM coverage - ALL INDUSTRIES
    const searchTerms = [
      // City-based searches - General
      `${this.city} limited`, `${this.city} ltd`, `${this.city} services`, `${this.city} group`,
      `${this.city} solutions`, `${this.city} consulting`, `${this.city} properties`, `${this.city} construction`,
      `${this.city} trading`, `${this.city} enterprises`, `${this.city} holdings`, `${this.city} investments`,
      `${this.city} management`, `${this.city} developments`, `${this.city} logistics`, `${this.city} engineering`,
      // Technology & Digital
      `${this.city} digital`, `${this.city} tech`, `${this.city} software`, `${this.city} it`,
      `${this.city} web`, `${this.city} media`, `${this.city} creative`, `${this.city} design`,
      // Healthcare & Medical
      `${this.city} healthcare`, `${this.city} dental`, `${this.city} medical`, `${this.city} clinic`,
      `${this.city} pharmacy`, `${this.city} care`, `${this.city} nursing`, `${this.city} therapy`,
      // Legal & Professional
      `${this.city} legal`, `${this.city} solicitors`, `${this.city} accountants`, `${this.city} financial`,
      `${this.city} insurance`, `${this.city} tax`, `${this.city} advisory`, `${this.city} architects`,
      // Automotive
      `${this.city} motors`, `${this.city} cars`, `${this.city} auto`, `${this.city} garage`,
      `${this.city} tyres`, `${this.city} body shop`, `${this.city} vehicle`,
      // Food & Hospitality
      `${this.city} restaurants`, `${this.city} catering`, `${this.city} cafe`, `${this.city} pub`,
      `${this.city} hotel`, `${this.city} bakery`, `${this.city} food`, `${this.city} bar`,
      // Trades & Construction
      `${this.city} builders`, `${this.city} plumbing`, `${this.city} electrical`, `${this.city} roofing`,
      `${this.city} flooring`, `${this.city} painting`, `${this.city} decorating`, `${this.city} carpentry`,
      `${this.city} glazing`, `${this.city} scaffolding`, `${this.city} joinery`, `${this.city} plastering`,
      // Services
      `${this.city} cleaning`, `${this.city} security`, `${this.city} recruitment`, `${this.city} training`,
      `${this.city} removals`, `${this.city} storage`, `${this.city} courier`, `${this.city} delivery`,
      // Retail
      `${this.city} retail`, `${this.city} fashion`, `${this.city} jewellery`, `${this.city} furniture`,
      `${this.city} electronics`, `${this.city} gifts`, `${this.city} florist`, `${this.city} pet`,
      // Beauty & Personal
      `${this.city} beauty`, `${this.city} hair`, `${this.city} salon`, `${this.city} spa`,
      // Fitness & Leisure
      `${this.city} fitness`, `${this.city} gym`, `${this.city} sports`, `${this.city} leisure`,
      // Manufacturing & Industrial
      `${this.city} manufacturing`, `${this.city} fabrication`, `${this.city} industrial`, `${this.city} factory`,
      `${this.city} production`, `${this.city} machining`, `${this.city} welding`,
      // Property & Real Estate
      `${this.city} property`, `${this.city} estate`, `${this.city} lettings`, `${this.city} rentals`,
      // Education
      `${this.city} education`, `${this.city} school`, `${this.city} tutoring`, `${this.city} academy`,
      // Events & Entertainment
      `${this.city} events`, `${this.city} entertainment`, `${this.city} weddings`, `${this.city} photography`,
      // Agriculture & Environment
      `${this.city} farm`, `${this.city} garden`, `${this.city} landscape`, `${this.city} environmental`,
      // Transport
      `${this.city} transport`, `${this.city} taxi`, `${this.city} haulage`, `${this.city} freight`
    ];
    if (this.district) {
      searchTerms.push(
        `${this.district} limited`,
        `${this.district} ltd`,
        `${this.district} services`,
        `${this.district} properties`,
        `${this.district} trading`,
        `${this.district} group`
      );
    }

    for (const term of searchTerms) {
      // Fetch ALL pages until no more results
      for (let page = 0; page < 100; page++) {
        try {
          const startIndex = page * 20;
          const response = await axios.get(
            `https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(term)}&start_index=${startIndex}`,
            {
              headers: {
                'User-Agent': this.getRandomUserAgent(),
                'Accept': 'application/json'
              }
            }
          );

          // API returns JSON with items array
          const data = response.data;
          const items = data.items || [];

          if (items.length === 0) break; // No more results

          for (const item of items) {
            const name = item.title || item.company_name;
            const status = (item.company_status || '').toLowerCase();

            // Skip dissolved, liquidated, and other inactive companies
            const inactiveStatuses = ['dissolved', 'liquidation', 'receivership', 'administration',
                                       'voluntary-arrangement', 'converted-closed', 'insolvency-proceedings',
                                       'removed', 'closed'];
            if (inactiveStatuses.some(s => status.includes(s))) {
              continue; // Skip inactive companies
            }

            if (name && this.isValidName(name)) {
              // Parse address from address_snippet
              const addressSnippet = item.address_snippet || item.address?.address_line_1 || '';

              companies.push({
                name: name.trim(),
                address: addressSnippet,
                city: this.city,
                region: this.region,
                country: this.country,
                category: item.company_type || 'Active Company',
                source: 'Companies House UK',
                verified: true,
                status: 'active',
                website: item.company_number ? `https://find-and-update.company-information.service.gov.uk/company/${item.company_number}` : null
              });
            }
          }

          console.log(`      "${term}" page ${page + 1}: ${items.length} items`);
          await this.delay(500);
        } catch (e) {
          // If JSON parsing fails, try HTML fallback
          if (page === 0) {
            console.log(`      "${term}": ${e.message}`);
          }
          break; // Stop pagination on error
        }
      }
    }

    this.stats.sources['Companies House'] = companies.length;
    console.log(`      Total from Companies House: ${companies.length} companies`);
    return companies;
  }

  /**
   * SOURCE 4: Wikidata - Free structured business data via SPARQL
   */
  async searchWikidata() {
    console.log('\n   [SOURCE 4] Wikidata...');
    const companies = [];

    try {
      // SPARQL query to find businesses/organizations in or near the city
      const sparql = `
        SELECT ?item ?itemLabel ?typeLabel WHERE {
          ?item wdt:P131* ?place .
          ?place rdfs:label "${this.city}"@en .
          ?item wdt:P31 ?type .
          VALUES ?type {
            wd:Q4830453 wd:Q891723 wd:Q6881511 wd:Q7075
            wd:Q43229 wd:Q3918 wd:Q16917 wd:Q22698
            wd:Q1195942 wd:Q178706 wd:Q5341295
          }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 10000
      `;

      const response = await axios.get(
        `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
        {
          headers: { 'User-Agent': 'FastDiscovery/4.0' },
          timeout: REQUEST_TIMEOUT
        }
      );

      for (const result of response.data?.results?.bindings || []) {
        const name = result.itemLabel?.value;
        const type = result.typeLabel?.value;
        if (name && this.isValidName(name) && !name.startsWith('Q')) {
          companies.push({
            name: name,
            city: this.city,
            region: this.region,
            country: this.country,
            category: type || 'Organization',
            source: 'Wikidata'
          });
        }
      }
    } catch (e) {
      console.log(`      Error: ${e.message}`);
    }

    this.stats.sources['Wikidata'] = companies.length;
    console.log(`      Found: ${companies.length} entities`);
    return companies;
  }

  /**
   * SOURCE 5: FSA Food Hygiene Ratings API (UK Government - free, thousands of businesses)
   */
  async searchFSA() {
    if (!this.isUK) return [];

    console.log('\n   [SOURCE 5] FSA Food Hygiene Ratings...');
    const companies = [];

    // The FSA API returns businesses with food hygiene ratings in the area
    // Includes restaurants, cafes, pubs, hotels, takeaways, shops, schools, hospitals
    const maxPages = 500; // Keep fetching until all pages exhausted

    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await axios.get(
          `https://api.ratings.food.gov.uk/Establishments?name=&address=${encodeURIComponent(this.city)}&pageSize=100&pageNumber=${page}`,
          {
            headers: {
              'x-api-version': '2',
              'Accept': 'application/json'
            },
            timeout: REQUEST_TIMEOUT
          }
        );

        const establishments = response.data?.establishments || [];
        if (establishments.length === 0) break;

        for (const est of establishments) {
          if (est.BusinessName && this.isValidName(est.BusinessName)) {
            const address = [est.AddressLine1, est.AddressLine2, est.AddressLine3, est.PostCode]
              .filter(Boolean).join(', ');

            companies.push({
              name: est.BusinessName.trim(),
              address: address || null,
              city: this.city,
              region: this.region,
              country: this.country,
              category: est.BusinessType || 'Food Business',
              source: 'FSA Food Ratings'
            });
          }
        }

        console.log(`      Page ${page}: ${establishments.length} businesses`);

        // Check if there are more pages
        const totalPages = response.data?.meta?.totalPages || 0;
        if (page >= totalPages) break;

        await this.delay(500);
      } catch (e) {
        console.log(`      Page ${page}: Error - ${e.message}`);
        break;
      }
    }

    this.stats.sources['FSA Food Ratings'] = companies.length;
    console.log(`      Total from FSA: ${companies.length} businesses`);
    return companies;
  }

  createCompany(tags, source) {
    return {
      name: tags.name,
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:postcode']].filter(Boolean).join(', ') || null,
      website: tags.website || tags['contact:website'],
      phone: tags.phone || tags['contact:phone'],
      city: tags['addr:city'] || this.city,
      region: this.region,
      country: this.country,
      category: tags.amenity || tags.shop || tags.office || 'Business',
      source: source
    };
  }

  isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length < 2 || name.length > 100) return false;

    // Must have some letters
    if (!/[a-zA-Z]{2,}/.test(name)) return false;

    // Skip spam patterns
    const spam = /how to|what is|best \d|top \d|reviews?|near me|cheap|discount|\.com|\.co\.uk|http|www\.|wikipedia|facebook|twitter/i;
    if (spam.test(name)) return false;

    return true;
  }

  normalizeCompanyName(name) {
    return name.toLowerCase()
      .replace(/\b(ltd|limited|inc|plc|llc|corp|co|the)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  async saveCompany(company, retryCount = 0) {
    if (!company.name || !this.isValidName(company.name)) return false;

    const normalized = this.normalizeCompanyName(company.name);
    if (this.processedNames.has(normalized)) return false;
    this.processedNames.add(normalized);

    let client;
    try {
      client = await pool.connect();

      // Check if exists
      const exists = await client.query(
        `SELECT 1 FROM accounts WHERE LOWER(company_name) = LOWER($1) AND LOWER(city) = LOWER($2) LIMIT 1`,
        [company.name, company.city || this.city]
      );

      if (exists.rows.length > 0) {
        client.release();
        return false;
      }

      // Insert
      await client.query(
        `INSERT INTO accounts (company_name, industry, country, state_region, city, district, address, website, phone_number, data_source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          company.name,
          company.category,
          company.country || this.country,
          company.region || this.region,
          company.city || this.city,
          this.district,
          company.address,
          company.website,
          company.phone,
          company.source
        ]
      );

      client.release();
      this.stats.companiesSaved++;
      return true;
    } catch (e) {
      if (client) {
        try { client.release(); } catch (releaseErr) { /* ignore */ }
      }

      // Retry on connection errors
      if (retryCount < 3 && (e.code === 'ECONNRESET' || e.code === 'EPIPE' || e.message.includes('terminated'))) {
        await this.delay(2000 * (retryCount + 1));
        this.processedNames.delete(normalized); // Allow retry
        return this.saveCompany(company, retryCount + 1);
      }
      return false;
    }
  }

  async discover() {
    try {
      // Step 1: Get coordinates
      console.log('   [STEP 1] Getting location coordinates...');
      const coords = await this.getCoordinates();

      if (!coords) {
        console.log('   [ERROR] Could not find location coordinates');
        return;
      }

      console.log(`      Found: ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`);

      // Step 2: Search all sources in parallel where possible
      console.log('\n   [STEP 2] Searching data sources...');

      const allCompanies = [];

      // OSM (main source - uses radius queries)
      const osmCompanies = await this.searchOSM(coords);
      allCompanies.push(...osmCompanies);

      // Nominatim
      const nominatimCompanies = await this.searchNominatim();
      allCompanies.push(...nominatimCompanies);

      // Companies House (UK only)
      if (this.isUK) {
        const chCompanies = await this.searchCompaniesHouse();
        allCompanies.push(...chCompanies);
      }

      // Wikidata
      const wdCompanies = await this.searchWikidata();
      allCompanies.push(...wdCompanies);

      // FSA Food Hygiene (UK only - thousands of real businesses)
      if (this.isUK) {
        const fsaCompanies = await this.searchFSA();
        allCompanies.push(...fsaCompanies);
      }

      // Step 3: Save all companies in batches
      console.log('\n   [STEP 3] Saving to database...');
      console.log(`      Total found: ${allCompanies.length}`);

      // Process in batches of 100 to reduce database load
      const batchSize = 100;
      for (let i = 0; i < allCompanies.length; i += batchSize) {
        const batch = allCompanies.slice(i, i + batchSize);

        for (const company of batch) {
          await this.saveCompany(company);
        }

        if (this.stats.companiesSaved % 100 === 0 && this.stats.companiesSaved > 0) {
          console.log(`      Progress: ${this.stats.companiesSaved} saved...`);
        }

        // Small delay between batches to prevent connection pool exhaustion
        if (i + batchSize < allCompanies.length) {
          await this.delay(500);
        }
      }

      // Final report
      const duration = Math.floor((Date.now() - this.stats.startTime) / 1000);
      console.log('\n' + '='.repeat(60));
      console.log('   DISCOVERY COMPLETE');
      console.log('='.repeat(60));
      console.log(`\n   Companies Saved: ${this.stats.companiesSaved}`);
      console.log(`   Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`);
      console.log('\n   Sources:');
      for (const [source, count] of Object.entries(this.stats.sources)) {
        console.log(`      ${source}: ${count} found`);
      }
      console.log('\n' + '='.repeat(60) + '\n');

    } catch (error) {
      console.error('\n   [FATAL ERROR]', error.message);
    }
  }
}

// Main
async function main() {
  const city = process.argv[2];
  const region = process.argv[3];
  const country = process.argv[4] || 'United Kingdom';
  const district = process.argv[5] || null;

  if (!city || !region) {
    console.error('\nUsage: node discover-fast.js <city> <region> [country] [district]\n');
    process.exit(1);
  }

  const agent = new FastDiscoveryAgent(city, region, country, district);
  await agent.discover();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
