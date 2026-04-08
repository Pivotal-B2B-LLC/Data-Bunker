/**
 * Google Places API Service
 * Enriches company data with contact information
 */

const axios = require('axios');
const cache = require('../utils/cache');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BASE_URL = 'https://maps.googleapis.com/maps/api/place';

class GooglePlacesService {
  /**
   * Search for a place by company name and location
   */
  async searchPlace(companyName, location) {
    if (!API_KEY) {
      console.warn('[Google Places] API key not configured, skipping');
      return null;
    }

    const cacheKey = { companyName, location };
    const cached = cache.get('places:search', cacheKey);
    if (cached) return cached;

    try {
      const query = location 
        ? `${companyName} ${location}`
        : companyName;

      console.log('[Google Places] Searching for:', query);

      const response = await axios.get(`${BASE_URL}/textsearch/json`, {
        params: {
          query,
          key: API_KEY
        }
      });

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const place = response.data.results[0];
        console.log('[Google Places] Found place:', place.name);
        
        cache.set('places:search', cacheKey, place, 86400); // Cache 24 hours
        return place;
      }

      return null;
    } catch (error) {
      console.error('[Google Places] Search error:', error.message);
      return null;
    }
  }

  /**
   * Get detailed place information including contact details
   */
  async getPlaceDetails(placeId) {
    if (!API_KEY) {
      return null;
    }

    const cached = cache.get('places:details', { placeId });
    if (cached) return cached;

    try {
      console.log('[Google Places] Getting details for place:', placeId);

      const response = await axios.get(`${BASE_URL}/details/json`, {
        params: {
          place_id: placeId,
          fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,business_status,opening_hours,rating,user_ratings_total,price_level,types,url',
          key: API_KEY
        }
      });

      if (response.data.status === 'OK') {
        const details = response.data.result;
        console.log('[Google Places] Retrieved details:', {
          name: details.name,
          hasWebsite: !!details.website,
          hasPhone: !!details.formatted_phone_number
        });

        cache.set('places:details', { placeId }, details, 86400);
        return details;
      }

      return null;
    } catch (error) {
      console.error('[Google Places] Details error:', error.message);
      return null;
    }
  }

  /**
   * Enrich company data with contact information from Google Places
   */
  async enrichCompanyData(companyName, companyAddress) {
    try {
      // Search for the place
      const place = await this.searchPlace(companyName, companyAddress);
      if (!place) {
        return null;
      }

      // Get detailed information
      const details = await this.getPlaceDetails(place.place_id);
      if (!details) {
        return null;
      }

      // Format the enriched data
      return {
        website: details.website || null,
        phone: details.formatted_phone_number || details.international_phone_number || null,
        address: details.formatted_address || null,
        rating: details.rating || null,
        totalRatings: details.user_ratings_total || null,
        businessStatus: details.business_status || null,
        googleMapsUrl: details.url || null,
        placeId: place.place_id,
        // Generate email patterns based on website domain
        emailPatterns: this._generateEmailPatterns(details.website, companyName),
        source: 'Google Places'
      };
    } catch (error) {
      console.error('[Google Places] Enrichment error:', error.message);
      return null;
    }
  }

  /**
   * Generate common email patterns based on domain
   */
  _generateEmailPatterns(website, companyName) {
    if (!website) return null;

    try {
      const domain = new URL(website).hostname.replace('www.', '');
      const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

      return {
        domain: domain,
        patterns: [
          `info@${domain}`,
          `contact@${domain}`,
          `support@${domain}`,
          `hello@${domain}`,
          `sales@${domain}`,
          `enquiries@${domain}`,
          `admin@${domain}`
        ],
        note: 'These are common email patterns. Verify before using.'
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get autocomplete suggestions for places
   */
  async autocomplete(input) {
    if (!API_KEY) {
      return [];
    }

    try {
      const response = await axios.get(`${BASE_URL}/autocomplete/json`, {
        params: {
          input,
          types: 'establishment',
          key: API_KEY
        }
      });

      if (response.data.status === 'OK') {
        return response.data.predictions.map(p => ({
          description: p.description,
          placeId: p.place_id,
          types: p.types
        }));
      }

      return [];
    } catch (error) {
      console.error('[Google Places] Autocomplete error:', error.message);
      return [];
    }
  }
}

module.exports = new GooglePlacesService();
