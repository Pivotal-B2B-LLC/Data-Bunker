/**
 * Officer Import Service
 * Handles importing company officers from Companies House API
 */

const axios = require('axios');
const db = require('../db/database');

class OfficerImportService {
  constructor() {
    this.apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    this.baseURL = 'https://api.company-information.service.gov.uk';
    
    // Rate limiting
    this.requestsPerMinute = 600; // Companies House allows 600 requests/5 min
    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = (60 * 1000) / this.requestsPerMinute; // ~100ms between requests
  }

  /**
   * Get officers for a specific company from Companies House API
   */
  async getOfficersFromAPI(companyNumber) {
    try {
      // Rate limiting
      await this.rateLimit();

      const auth = Buffer.from(`${this.apiKey}:`).toString('base64');
      const url = `${this.baseURL}/company/${companyNumber}/officers`;
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        // Company not found or has no officers
        return null;
      }
      throw error;
    }
  }

  /**
   * Rate limiting to respect API limits
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Parse date from Companies House format
   */
  parseDate(dateObj) {
    if (!dateObj) return null;
    const { year, month, day } = dateObj;
    if (!year || !month || !day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Extract officer ID from links
   */
  extractOfficerId(links) {
    if (!links || !links.officer || !links.officer.appointments) return null;
    
    // Extract from URL like: /officers/abc123/appointments
    const match = links.officer.appointments.match(/\/officers\/([^\/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Insert or update an officer in the database
   */
  async upsertOfficer(officerData) {
    const {
      officer_id,
      name,
      title,
      nationality,
      country_of_residence,
      occupation,
      date_of_birth,
      address
    } = officerData;

    const query = `
      INSERT INTO officers (
        officer_id, name, title, nationality, country_of_residence, 
        occupation, date_of_birth_month, date_of_birth_year,
        address_line_1, address_line_2, locality, region, postal_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (officer_id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        title = EXCLUDED.title,
        nationality = EXCLUDED.nationality,
        country_of_residence = EXCLUDED.country_of_residence,
        occupation = EXCLUDED.occupation,
        date_of_birth_month = EXCLUDED.date_of_birth_month,
        date_of_birth_year = EXCLUDED.date_of_birth_year,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        locality = EXCLUDED.locality,
        region = EXCLUDED.region,
        postal_code = EXCLUDED.postal_code,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const values = [
      officer_id,
      name,
      title || null,
      nationality || null,
      country_of_residence || null,
      occupation || null,
      date_of_birth?.month || null,
      date_of_birth?.year || null,
      address?.address_line_1 || null,
      address?.address_line_2 || null,
      address?.locality || null,
      address?.region || null,
      address?.postal_code || null
    ];

    const result = await db.query(query, values);
    return result.rows[0].id;
  }

  /**
   * Insert or update an officer appointment
   */
  async upsertAppointment(companyId, officerDbId, appointmentData) {
    const {
      officer_role,
      appointed_on,
      resigned_on,
      appointment_type,
      links
    } = appointmentData;

    const appointedDate = this.parseDate(appointed_on);
    const resignedDate = this.parseDate(resigned_on);
    const isActive = !resignedDate;

    const query = `
      INSERT INTO officer_appointments (
        company_id, officer_id, appointment_type, officer_role,
        appointed_on, resigned_on, is_active, ch_links
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (company_id, officer_id, appointed_on)
      DO UPDATE SET
        appointment_type = EXCLUDED.appointment_type,
        officer_role = EXCLUDED.officer_role,
        resigned_on = EXCLUDED.resigned_on,
        is_active = EXCLUDED.is_active,
        ch_links = EXCLUDED.ch_links,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const values = [
      companyId,
      officerDbId,
      appointment_type || 'unknown',
      officer_role || null,
      appointedDate,
      resignedDate,
      isActive,
      JSON.stringify(links || {})
    ];

    const result = await db.query(query, values);
    return result.rows[0].id;
  }

  /**
   * Import officers for a single company
   */
  async importOfficersForCompany(companyNumber, companyId) {
    try {
      const data = await this.getOfficersFromAPI(companyNumber);
      
      if (!data || !data.items || data.items.length === 0) {
        return { success: true, officers: 0, message: 'No officers found' };
      }

      let importedCount = 0;
      const errors = [];

      for (const item of data.items) {
        try {
          // Extract officer ID
          const officerId = this.extractOfficerId(item.links);
          if (!officerId) {
            errors.push(`Could not extract officer ID for ${item.name}`);
            continue;
          }

          // Prepare officer data
          const officerData = {
            officer_id: officerId,
            name: item.name,
            title: item.title,
            nationality: item.nationality,
            country_of_residence: item.country_of_residence,
            occupation: item.occupation,
            date_of_birth: item.date_of_birth,
            address: item.address
          };

          // Upsert officer
          const officerDbId = await this.upsertOfficer(officerData);

          // Prepare appointment data
          const appointmentData = {
            officer_role: item.officer_role,
            appointed_on: item.appointed_on,
            resigned_on: item.resigned_on,
            appointment_type: item.officer_role || 'director',
            links: item.links
          };

          // Upsert appointment
          await this.upsertAppointment(companyId, officerDbId, appointmentData);
          importedCount++;
        } catch (itemError) {
          errors.push(`Error importing ${item.name}: ${itemError.message}`);
        }
      }

      return {
        success: true,
        officers: importedCount,
        errors: errors.length > 0 ? errors : null
      };
    } catch (error) {
      console.error(`Error importing officers for ${companyNumber}:`, error.message);
      return {
        success: false,
        officers: 0,
        error: error.message
      };
    }
  }

  /**
   * Batch import officers for multiple companies
   */
  async batchImportOfficers(companies, onProgress = null) {
    const results = {
      total: companies.length,
      processed: 0,
      successful: 0,
      failed: 0,
      totalOfficers: 0,
      errors: []
    };

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      
      try {
        const result = await this.importOfficersForCompany(
          company.company_number,
          company.id
        );

        results.processed++;
        
        if (result.success) {
          results.successful++;
          results.totalOfficers += result.officers;
        } else {
          results.failed++;
          results.errors.push({
            company: company.company_number,
            error: result.error
          });
        }

        // Progress callback
        if (onProgress && i % 10 === 0) {
          onProgress({
            ...results,
            percentComplete: ((i + 1) / companies.length * 100).toFixed(2)
          });
        }
      } catch (error) {
        results.processed++;
        results.failed++;
        results.errors.push({
          company: company.company_number,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get all companies that don't have officers imported yet
   */
  async getCompaniesWithoutOfficers(limit = 1000, offset = 0) {
    const query = `
      SELECT c.id, c.company_number, c.name
      FROM companies c
      LEFT JOIN officer_appointments oa ON c.id = oa.company_id
      WHERE oa.id IS NULL
      ORDER BY c.id
      LIMIT $1 OFFSET $2;
    `;

    const result = await db.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get statistics about officer data
   */
  async getOfficerStats() {
    const queries = {
      totalOfficers: 'SELECT COUNT(*) as count FROM officers',
      totalAppointments: 'SELECT COUNT(*) as count FROM officer_appointments',
      activeAppointments: 'SELECT COUNT(*) as count FROM officer_appointments WHERE is_active = TRUE',
      companiesWithOfficers: `
        SELECT COUNT(DISTINCT company_id) as count 
        FROM officer_appointments
      `,
      companiesWithoutOfficers: `
        SELECT COUNT(*) as count
        FROM companies c
        LEFT JOIN officer_appointments oa ON c.id = oa.company_id
        WHERE oa.id IS NULL
      `
    };

    const stats = {};
    for (const [key, query] of Object.entries(queries)) {
      const result = await db.query(query);
      stats[key] = parseInt(result.rows[0].count);
    }

    return stats;
  }
}

module.exports = new OfficerImportService();
