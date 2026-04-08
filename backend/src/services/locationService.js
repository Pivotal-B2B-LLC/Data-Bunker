/**
 * Location Database Service
 * Manages geographic hierarchy: Countries -> States -> Cities -> Districts
 */

const { query } = require('../db/connection');

class LocationService {
  /**
   * Get all countries
   */
  static async getAllCountries() {
    try {
      const result = await query(
        'SELECT id, code, name, region FROM countries ORDER BY name ASC'
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting countries:', error);
      throw error;
    }
  }

  /**
   * Get country by ID or code
   */
  static async getCountry(idOrCode) {
    try {
      const result = await query(
        `SELECT id, code, name, region FROM countries 
         WHERE id = $1 OR code = $2 LIMIT 1`,
        [isNaN(idOrCode) ? null : idOrCode, idOrCode]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting country:', error);
      throw error;
    }
  }

  /**
   * Get states for a country
   */
  static async getStatesByCountry(countryId) {
    try {
      const result = await query(
        `SELECT id, code, name FROM states 
         WHERE country_id = $1 
         ORDER BY name ASC`,
        [countryId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting states:', error);
      throw error;
    }
  }

  /**
   * Get state by ID or code
   */
  static async getState(stateId) {
    try {
      const result = await query(
        `SELECT id, country_id, code, name FROM states WHERE id = $1 LIMIT 1`,
        [stateId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting state:', error);
      throw error;
    }
  }

  /**
   * Get cities for a state
   */
  static async getCitiesByState(stateId) {
    try {
      const result = await query(
        `SELECT id, name, latitude, longitude, population FROM cities 
         WHERE state_id = $1 
         ORDER BY name ASC`,
        [stateId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting cities:', error);
      throw error;
    }
  }

  /**
   * Get city by ID
   */
  static async getCity(cityId) {
    try {
      const result = await query(
        `SELECT id, state_id, name, latitude, longitude FROM cities 
         WHERE id = $1 LIMIT 1`,
        [cityId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting city:', error);
      throw error;
    }
  }

  /**
   * Get districts for a city
   */
  static async getDistrictsByCity(cityId) {
    try {
      const result = await query(
        `SELECT id, name, zip_code FROM districts 
         WHERE city_id = $1 
         ORDER BY name ASC`,
        [cityId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting districts:', error);
      throw error;
    }
  }

  /**
   * Get district by ID
   */
  static async getDistrict(districtId) {
    try {
      const result = await query(
        `SELECT id, city_id, name, zip_code FROM districts 
         WHERE id = $1 LIMIT 1`,
        [districtId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting district:', error);
      throw error;
    }
  }

  /**
   * Add a new country
   */
  static async addCountry(code, name, region = null) {
    try {
      const result = await query(
        `INSERT INTO countries (code, name, region) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (code) DO NOTHING
         RETURNING id, code, name, region`,
        [code, name, region]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error adding country:', error);
      throw error;
    }
  }

  /**
   * Add a new state
   */
  static async addState(countryId, code, name) {
    try {
      const result = await query(
        `INSERT INTO states (country_id, code, name) 
         VALUES ($1, $2, $3)
         ON CONFLICT (country_id, code) DO NOTHING
         RETURNING id, country_id, code, name`,
        [countryId, code, name]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error adding state:', error);
      throw error;
    }
  }

  /**
   * Add a new city
   */
  static async addCity(stateId, name, latitude = null, longitude = null) {
    try {
      const result = await query(
        `INSERT INTO cities (state_id, name, latitude, longitude) 
         VALUES ($1, $2, $3, $4)
         RETURNING id, state_id, name, latitude, longitude`,
        [stateId, name, latitude, longitude]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error adding city:', error);
      throw error;
    }
  }

  /**
   * Add a new district
   */
  static async addDistrict(cityId, name, zipCode = null) {
    try {
      const result = await query(
        `INSERT INTO districts (city_id, name, zip_code) 
         VALUES ($1, $2, $3)
         ON CONFLICT (city_id, name) DO NOTHING
         RETURNING id, city_id, name, zip_code`,
        [cityId, name, zipCode]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error adding district:', error);
      throw error;
    }
  }

  /**
   * Get complete location hierarchy for a country
   */
  static async getCompleteHierarchy(countryId) {
    try {
      const country = await this.getCountry(countryId);
      if (!country) return null;

      const states = await this.getStatesByCountry(countryId);
      
      const hierarchyData = {
        country,
        states: [],
      };

      for (const state of states) {
        const cities = await this.getCitiesByState(state.id);
        const stateData = {
          ...state,
          cities: [],
        };

        for (const city of cities) {
          const districts = await this.getDistrictsByCity(city.id);
          stateData.cities.push({
            ...city,
            districts,
          });
        }

        hierarchyData.states.push(stateData);
      }

      return hierarchyData;
    } catch (error) {
      console.error('Error getting complete hierarchy:', error);
      throw error;
    }
  }

  /**
   * Search locations by name
   */
  static async searchLocations(searchTerm) {
    try {
      const result = await query(
        `SELECT 'city' as type, c.id, c.name, s.id as parent_id, s.name as parent_name, co.name as country_name
         FROM cities c
         JOIN states s ON c.state_id = s.id
         JOIN countries co ON s.country_id = co.id
         WHERE c.name ILIKE $1
         UNION ALL
         SELECT 'state' as type, s.id, s.name, co.id as parent_id, co.name as parent_name, co.name as country_name
         FROM states s
         JOIN countries co ON s.country_id = co.id
         WHERE s.name ILIKE $1
         UNION ALL
         SELECT 'country' as type, c.id, c.name, NULL::integer as parent_id, NULL as parent_name, c.name as country_name
         FROM countries c
         WHERE c.name ILIKE $1
         ORDER BY country_name, parent_name, name`,
        [`%${searchTerm}%`]
      );

      return result.rows;
    } catch (error) {
      console.error('Error searching locations:', error);
      throw error;
    }
  }

  /**
   * Get statistics for locations
   */
  static async getLocationStatistics() {
    try {
      const stats = {
        countries: (await query('SELECT COUNT(*) as count FROM countries')).rows[0].count,
        states: (await query('SELECT COUNT(*) as count FROM states')).rows[0].count,
        cities: (await query('SELECT COUNT(*) as count FROM cities')).rows[0].count,
        districts: (await query('SELECT COUNT(*) as count FROM districts')).rows[0].count,
      };

      return stats;
    } catch (error) {
      console.error('Error getting location statistics:', error);
      throw error;
    }
  }

  /**
   * Get companies count by country
   */
  static async getCompaniesByCountry() {
    try {
      const result = await query(
        `SELECT co.id, co.code, co.name, COUNT(c.id) as company_count
         FROM countries co
         LEFT JOIN companies c ON co.id = c.country_id
         GROUP BY co.id, co.code, co.name
         ORDER BY company_count DESC`
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting companies by country:', error);
      throw error;
    }
  }

  /**
   * Get companies count by state
   */
  static async getCompaniesByState(countryId) {
    try {
      const result = await query(
        `SELECT s.id, s.code, s.name, COUNT(c.id) as company_count
         FROM states s
         LEFT JOIN companies c ON s.id = c.state_id
         WHERE s.country_id = $1
         GROUP BY s.id, s.code, s.name
         ORDER BY company_count DESC`,
        [countryId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting companies by state:', error);
      throw error;
    }
  }

  /**
   * Get companies count by city
   */
  static async getCompaniesByCity(stateId) {
    try {
      const result = await query(
        `SELECT ci.id, ci.name, COUNT(c.id) as company_count
         FROM cities ci
         LEFT JOIN companies c ON ci.id = c.city_id
         WHERE ci.state_id = $1
         GROUP BY ci.id, ci.name
         ORDER BY company_count DESC`,
        [stateId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting companies by city:', error);
      throw error;
    }
  }
}

module.exports = LocationService;
