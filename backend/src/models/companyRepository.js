/**
 * Company Repository - Database operations for companies
 */

const db = require('../db/database');

class CompanyRepository {
  
  /**
   * Create or update company
   */
  async upsertCompany(companyData) {
    const {
      company_number, name, legal_name, jurisdiction, company_type, status,
      incorporation_date, address_line_1, address_line_2, locality, region,
      postal_code, country, website, phone, email, description, industry,
      employee_count, annual_revenue, data_source
    } = companyData;

    const query = `
      INSERT INTO companies (
        company_number, name, legal_name, jurisdiction, company_type, status,
        incorporation_date, address_line_1, address_line_2, locality, region,
        postal_code, country, website, phone, email, description, industry,
        employee_count, annual_revenue, data_source, last_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
      ON CONFLICT (company_number) 
      DO UPDATE SET
        name = EXCLUDED.name,
        legal_name = EXCLUDED.legal_name,
        company_type = EXCLUDED.company_type,
        status = EXCLUDED.status,
        incorporation_date = EXCLUDED.incorporation_date,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        locality = EXCLUDED.locality,
        region = EXCLUDED.region,
        postal_code = EXCLUDED.postal_code,
        country = EXCLUDED.country,
        website = COALESCE(EXCLUDED.website, companies.website),
        phone = COALESCE(EXCLUDED.phone, companies.phone),
        email = COALESCE(EXCLUDED.email, companies.email),
        description = COALESCE(EXCLUDED.description, companies.description),
        industry = COALESCE(EXCLUDED.industry, companies.industry),
        employee_count = COALESCE(EXCLUDED.employee_count, companies.employee_count),
        annual_revenue = COALESCE(EXCLUDED.annual_revenue, companies.annual_revenue),
        data_source = EXCLUDED.data_source,
        last_updated = NOW()
      RETURNING *;
    `;

    const values = [
      company_number, name, legal_name, jurisdiction, company_type, status,
      incorporation_date, address_line_1, address_line_2, locality, region,
      postal_code, country, website, phone, email, description, industry,
      employee_count, annual_revenue, data_source
    ];

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Advanced search with filters
   */
  async searchCompanies(filters = {}, limit = 50, offset = 0) {
    const {
      query: searchQuery,
      country,
      region,
      locality,
      status,
      industry,
      min_employees,
      max_employees,
      jurisdiction
    } = filters;

    let conditions = [];
    let params = [];
    let paramCount = 1;

    if (searchQuery) {
      conditions.push(`name ILIKE $${paramCount}`);
      params.push(`%${searchQuery}%`);
      paramCount += 1;
    }

    if (country) {
      // Handle multiple country name variations (ENGLAND, England, United Kingdom, etc.)
      if (country.toLowerCase().includes('united kingdom') || country.toLowerCase() === 'uk' || country.toLowerCase() === 'gb') {
        conditions.push(`(country ILIKE '%United Kingdom%' OR country ILIKE '%England%' OR country ILIKE '%Scotland%' OR country ILIKE '%Wales%' OR country ILIKE '%Northern Ireland%')`);
      } else {
        conditions.push(`country ILIKE $${paramCount}`);
        params.push(`%${country}%`);
        paramCount++;
      }
    }

    if (region) {
      conditions.push(`region ILIKE $${paramCount}`);
      params.push(`%${region}%`);
      paramCount++;
    }

    if (locality) {
      conditions.push(`locality ILIKE $${paramCount}`);
      params.push(`%${locality}%`);
      paramCount++;
    }

    if (status) {
      conditions.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    if (industry) {
      conditions.push(`industry ILIKE $${paramCount}`);
      params.push(`%${industry}%`);
      paramCount++;
    }

    if (jurisdiction) {
      conditions.push(`jurisdiction = $${paramCount}`);
      params.push(jurisdiction);
      paramCount++;
    }

    if (min_employees) {
      conditions.push(`employee_count >= $${paramCount}`);
      params.push(min_employees);
      paramCount++;
    }

    if (max_employees) {
      conditions.push(`employee_count <= $${paramCount}`);
      params.push(max_employees);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const query = `
      SELECT * FROM companies
      ${whereClause}
      ORDER BY last_updated DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(limit, offset);

    // Get results - fast with indexes
    const results = await db.query(query, params);
    
    // Get total count - use WHERE clause but without limit/offset
    const countQuery = `
      SELECT COUNT(*) as total FROM companies
      ${whereClause}
    `;
    const countParams = params.slice(0, -2); // Remove limit and offset
    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);
    
    return {
      companies: results.rows,
      total: total,
      limit,
      offset,
      hasMore: results.rows.length === limit && (offset + limit < total)
    };
  }

  /**
   * Get company by number
   */
  async getCompanyByNumber(companyNumber) {
    const query = `SELECT * FROM companies WHERE company_number = $1`;
    const result = await db.query(query, [companyNumber]);
    return result.rows[0];
  }

  /**
   * Add contact information
   */
  async addContact(companyId, contactData) {
    const { contact_type, value, label, source, verified } = contactData;
    
    const query = `
      INSERT INTO contacts (company_id, contact_type, value, label, source, verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (company_id, contact_type, value) DO NOTHING
      RETURNING *
    `;

    const result = await db.query(query, [
      companyId, contact_type, value, label, source, verified || false
    ]);

    return result.rows[0];
  }

  /**
   * Add officer/director
   */
  async addOfficer(companyId, officerData) {
    const {
      name, role, appointed_date, resigned_date, nationality,
      date_of_birth, occupation, address
    } = officerData;

    const query = `
      INSERT INTO officers (
        company_id, name, role, appointed_date, resigned_date,
        nationality, date_of_birth, occupation, address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await db.query(query, [
      companyId, name, role, appointed_date, resigned_date,
      nationality, date_of_birth, occupation, address
    ]);

    return result.rows[0];
  }

  /**
   * Log tracking activity
   */
  async logTracking(companyId, trackingData) {
    const { url, data_found, status, error_message } = trackingData;

    const query = `
      INSERT INTO tracking_history (company_id, url, data_found, status, error_message)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await db.query(query, [
      companyId, url, JSON.stringify(data_found), status, error_message
    ]);

    return result.rows[0];
  }

  /**
   * Get companies that need updating
   */
  async getStaleCompanies(daysOld = 30, limit = 100) {
    // Sanitize daysOld to prevent SQL injection - must be a positive integer
    const safeDays = Math.max(1, Math.min(365, parseInt(daysOld) || 30));

    const query = `
      SELECT * FROM companies
      WHERE last_updated < NOW() - ($1 || ' days')::INTERVAL
      ORDER BY last_updated ASC
      LIMIT $2
    `;

    const result = await db.query(query, [safeDays.toString(), limit]);
    return result.rows;
  }

  /**
   * Get popular searches
   */
  async getPopularSearches(limit = 10) {
    const query = `
      SELECT search_query, COUNT(*) as count
      FROM search_logs
      WHERE search_query IS NOT NULL
      GROUP BY search_query
      ORDER BY count DESC
      LIMIT $1
    `;

    const result = await db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Log search
   */
  async logSearch(searchQuery, filters, resultsCount, userSession) {
    try {
      const query = `
        INSERT INTO search_logs (search_query, filters, results_count, user_session)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const result = await db.query(query, [
        searchQuery,
        JSON.stringify(filters),
        resultsCount,
        userSession
      ]);

      return result.rows[0];
    } catch (error) {
      // Silently fail if search_logs table doesn't exist
      console.log('Search logging skipped (table not found)');
      return null;
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    const queries = [
      db.query('SELECT COUNT(*) as total FROM companies'),
      db.query('SELECT COUNT(*) as total FROM contacts'),
      db.query('SELECT COUNT(*) as total FROM officers'),
      db.query('SELECT COUNT(*) as total FROM tracking_history'),
      db.query(`SELECT COUNT(*) as stale FROM companies WHERE last_updated < NOW() - INTERVAL '30 days'`) // hardcoded literal is safe
    ];

    const results = await Promise.all(queries);

    return {
      totalCompanies: parseInt(results[0].rows[0].total),
      totalContacts: parseInt(results[1].rows[0].total),
      totalOfficers: parseInt(results[2].rows[0].total),
      totalTrackings: parseInt(results[3].rows[0].total),
      staleCompanies: parseInt(results[4].rows[0].stale)
    };
  }
}

module.exports = new CompanyRepository();
