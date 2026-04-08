/**
 * Company Database Service
 * Handles all CRUD operations for companies
 */

const { query, transaction } = require('../db/connection');

class CompanyService {
  /**
   * Create a new company
   */
  static async createCompany(data) {
    const {
      registrationNumber,
      name,
      countryId,
      stateId = null,
      cityId = null,
      districtId = null,
      industry = null,
      status = 'active',
      website = null,
      linkedinUrl = null,
      primaryDataSource = 'manual',
    } = data;

    try {
      const result = await query(
        `INSERT INTO companies (
          registration_number, name, country_id, state_id, city_id, 
          district_id, industry, status, website, linkedin_url, 
          primary_data_source, created_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING id, name, registration_number, status`,
        [
          registrationNumber, name, countryId, stateId, cityId,
          districtId, industry, status, website, linkedinUrl,
          primaryDataSource,
        ]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error creating company:', error);
      throw error;
    }
  }

  /**
   * Get company by ID with full details
   */
  static async getCompanyById(id) {
    try {
      const result = await query(
        `SELECT c.*, 
          co.name as country_name, co.code as country_code,
          s.name as state_name, ci.name as city_name, d.name as district_name
         FROM companies c
         JOIN countries co ON c.country_id = co.id
         LEFT JOIN states s ON c.state_id = s.id
         LEFT JOIN cities ci ON c.city_id = ci.id
         LEFT JOIN districts d ON c.district_id = d.id
         WHERE c.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const company = result.rows[0];

      // Fetch contacts for this company
      const contactsResult = await query(
        `SELECT id, email, phone, linkedin_profile_url, contact_name, 
                job_title, contact_type, is_primary, confidence_score
         FROM contacts WHERE company_id = $1 ORDER BY is_primary DESC`,
        [id]
      );

      company.contacts = contactsResult.rows;

      // Fetch data sources for this company
      const sourcesResult = await query(
        `SELECT source_name, source_entity_id, last_fetched 
         FROM data_sources WHERE company_id = $1`,
        [id]
      );

      company.sources = sourcesResult.rows;

      return company;
    } catch (error) {
      console.error('Error getting company:', error);
      throw error;
    }
  }

  /**
   * Search companies by name
   */
  static async searchCompanies(searchTerm, countryId = null, limit = 50) {
    try {
      let sql = `
        SELECT c.id, c.name, c.registration_number, c.status, 
               c.industry, c.employee_count,
               co.name as country_name, s.name as state_name
        FROM companies c
        JOIN countries co ON c.country_id = co.id
        LEFT JOIN states s ON c.state_id = s.id
        WHERE (c.name ILIKE $1 OR c.registration_number ILIKE $1)
      `;

      const params = [`%${searchTerm}%`];

      if (countryId) {
        sql += ` AND c.country_id = $${params.length + 1}`;
        params.push(countryId);
      }

      sql += ` ORDER BY c.data_quality_score DESC, c.name ASC
               LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('Error searching companies:', error);
      throw error;
    }
  }

  /**
   * Search companies by location hierarchy
   */
  static async searchByLocation(filters) {
    const { countryId, stateId = null, cityId = null, districtId = null, limit = 50 } = filters;

    try {
      let sql = `
        SELECT c.id, c.name, c.registration_number, c.status, 
               c.industry, c.employee_count,
               co.name as country_name, s.name as state_name,
               ci.name as city_name, d.name as district_name
        FROM companies c
        JOIN countries co ON c.country_id = co.id
        LEFT JOIN states s ON c.state_id = s.id
        LEFT JOIN cities ci ON c.city_id = ci.id
        LEFT JOIN districts d ON c.district_id = d.id
        WHERE c.country_id = $1
      `;

      const params = [countryId];

      if (stateId) {
        sql += ` AND c.state_id = $${params.length + 1}`;
        params.push(stateId);
      }

      if (cityId) {
        sql += ` AND c.city_id = $${params.length + 1}`;
        params.push(cityId);
      }

      if (districtId) {
        sql += ` AND c.district_id = $${params.length + 1}`;
        params.push(districtId);
      }

      sql += ` ORDER BY c.name ASC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('Error searching by location:', error);
      throw error;
    }
  }

  /**
   * Advanced filtering with multiple criteria
   */
  static async advancedFilter(filters) {
    const {
      industry = null,
      status = null,
      createdAfter = null,
      createdBefore = null,
      minEmployees = null,
      maxEmployees = null,
      countryId = null,
      limit = 50,
    } = filters;

    try {
      let sql = `
        SELECT c.id, c.name, c.registration_number, c.status, 
               c.industry, c.employee_count, c.created_date,
               co.name as country_name
        FROM companies c
        JOIN countries co ON c.country_id = co.id
        WHERE 1=1
      `;

      const params = [];

      if (industry) {
        sql += ` AND c.industry ILIKE $${params.length + 1}`;
        params.push(`%${industry}%`);
      }

      if (status) {
        sql += ` AND c.status = $${params.length + 1}`;
        params.push(status);
      }

      if (createdAfter) {
        sql += ` AND c.created_date >= $${params.length + 1}`;
        params.push(createdAfter);
      }

      if (createdBefore) {
        sql += ` AND c.created_date <= $${params.length + 1}`;
        params.push(createdBefore);
      }

      if (minEmployees !== null) {
        sql += ` AND c.employee_count >= $${params.length + 1}`;
        params.push(minEmployees);
      }

      if (maxEmployees !== null) {
        sql += ` AND c.employee_count <= $${params.length + 1}`;
        params.push(maxEmployees);
      }

      if (countryId) {
        sql += ` AND c.country_id = $${params.length + 1}`;
        params.push(countryId);
      }

      sql += ` ORDER BY c.name ASC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('Error in advanced filter:', error);
      throw error;
    }
  }

  /**
   * Update company information
   */
  static async updateCompany(id, updates) {
    try {
      const fields = [];
      const values = [];
      let paramCount = 1;

      // Dynamically build SET clause
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && value !== null) {
          const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          fields.push(`${dbKey} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      fields.push(`last_updated = NOW()`);

      if (fields.length === 1) {
        return null; // Nothing to update
      }

      values.push(id);

      const result = await query(
        `UPDATE companies SET ${fields.join(', ')} 
         WHERE id = $${paramCount} 
         RETURNING *`,
        values
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error updating company:', error);
      throw error;
    }
  }

  /**
   * Get companies by status
   */
  static async getCompaniesByStatus(status, limit = 50) {
    try {
      const result = await query(
        `SELECT id, name, registration_number, status, 
                industry, created_date
         FROM companies 
         WHERE status = $1
         ORDER BY created_date DESC
         LIMIT $2`,
        [status, limit]
      );

      return result.rows;
    } catch (error) {
      console.error('Error fetching companies by status:', error);
      throw error;
    }
  }

  /**
   * Get recent companies (newly added)
   */
  static async getRecentCompanies(days = 30, limit = 50) {
    try {
      const result = await query(
        `SELECT id, name, registration_number, status, 
                industry, created_date,
                co.name as country_name
         FROM companies c
         JOIN countries co ON c.country_id = co.id
         WHERE c.created_date >= NOW() - INTERVAL $1
         ORDER BY c.created_date DESC
         LIMIT $2`,
        [`${days} days`, limit]
      );

      return result.rows;
    } catch (error) {
      console.error('Error fetching recent companies:', error);
      throw error;
    }
  }

  /**
   * Get company count by status
   */
  static async getCompanyCountByStatus() {
    try {
      const result = await query(
        `SELECT status, COUNT(*) as count
         FROM companies
         GROUP BY status`
      );

      return result.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {});
    } catch (error) {
      console.error('Error getting company count:', error);
      throw error;
    }
  }

  /**
   * Delete company and all related data
   */
  static async deleteCompany(id) {
    try {
      return await transaction(async (client) => {
        // Delete associated records (cascading would handle this, but explicit is safer)
        await client.query('DELETE FROM contacts WHERE company_id = $1', [id]);
        await client.query('DELETE FROM data_sources WHERE company_id = $1', [id]);
        await client.query('DELETE FROM company_history WHERE company_id = $1', [id]);

        // Delete the company
        const result = await client.query(
          'DELETE FROM companies WHERE id = $1 RETURNING id',
          [id]
        );

        return result.rows[0];
      });
    } catch (error) {
      console.error('Error deleting company:', error);
      throw error;
    }
  }
}

module.exports = CompanyService;
