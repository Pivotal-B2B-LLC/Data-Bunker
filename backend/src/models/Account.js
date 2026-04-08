/**
 * Account Model
 * Handles all database operations for Accounts (Companies)
 */

const { pool } = require('../db/connection');
const { getLinkedInCategories, getNAICSCodesForCategory } = require('../data/industry-mapping');

// Whitelist of allowed columns for ordering
const ALLOWED_ORDER_COLUMNS = [
  'created_at', 'updated_at', 'company_name', 'city',
  'country', 'state_region', 'industry', 'account_id'
];

const ALLOWED_ORDER_DIRECTIONS = ['ASC', 'DESC'];

class Account {
  /**
   * Build WHERE clause and params from filters (shared between data + count queries)
   */
  static _buildFilterClause(filters) {
    const { country, state_region, city, district, ward, industry, company_size, revenue, search } = filters;
    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (country) {
      conditions.push(`country = $${paramCount++}`);
      params.push(country);
    }
    if (state_region) {
      conditions.push(`state_region = $${paramCount++}`);
      params.push(state_region);
    }
    if (city) {
      conditions.push(`city = $${paramCount++}`);
      params.push(city);
    }
    if (district) {
      conditions.push(`district = $${paramCount++}`);
      params.push(district);
    }
    if (ward) {
      conditions.push(`ward = $${paramCount++}`);
      params.push(ward);
    }
    if (industry) {
      const naicsCodes = getNAICSCodesForCategory(industry);
      if (naicsCodes && naicsCodes.length > 0) {
        const sub = naicsCodes.map((code, idx) => `industry LIKE $${paramCount + idx}`);
        conditions.push(`(${sub.join(' OR ')})`);
        naicsCodes.forEach(code => params.push(`${code}%`));
        paramCount += naicsCodes.length;
      } else {
        conditions.push(`industry ILIKE $${paramCount++}`);
        params.push(`%${industry}%`);
      }
    }
    if (company_size) {
      conditions.push(`company_size ILIKE $${paramCount++}`);
      params.push(`${company_size}%`);
    }
    if (revenue) {
      conditions.push(`revenue = $${paramCount++}`);
      params.push(revenue);
    }
    if (search) {
      conditions.push(`(company_name ILIKE $${paramCount} OR website ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return { whereClause, params, paramCount };
  }

  /**
   * Get all accounts with filtering and pagination
   */
  static async findAll(filters = {}, options = {}) {
    let {
      limit = 50,
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = options;

    // Sanitize ordering to prevent SQL injection
    if (!ALLOWED_ORDER_COLUMNS.includes(orderBy)) orderBy = 'created_at';
    if (!ALLOWED_ORDER_DIRECTIONS.includes(orderDirection.toUpperCase())) orderDirection = 'DESC';

    // Enforce pagination limits
    limit = Math.min(Math.max(1, parseInt(limit) || 50), 500);
    offset = Math.max(0, parseInt(offset) || 0);

    const { whereClause, params, paramCount } = Account._buildFilterClause(filters);

    // Data query
    const dataQuery = `SELECT * FROM accounts ${whereClause} ORDER BY ${orderBy} ${orderDirection} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    // Count query (reuse same filter clause)
    const { whereClause: countWhere, params: countParams } = Account._buildFilterClause(filters);
    const countQuery = `SELECT COUNT(*) FROM accounts ${countWhere}`;

    const [result, countResult] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].count) || 0,
      limit,
      offset
    };
  }

  /**
   * Get account by ID with contacts
   */
  static async findById(accountId) {
    const accountQuery = 'SELECT * FROM accounts WHERE account_id = $1';
    const contactsQuery = 'SELECT * FROM contacts WHERE linked_account_id = $1';

    const [accountResult, contactsResult] = await Promise.all([
      pool.query(accountQuery, [accountId]),
      pool.query(contactsQuery, [accountId])
    ]);

    if (accountResult.rows.length === 0) {
      return null;
    }

    return {
      ...accountResult.rows[0],
      contacts: contactsResult.rows
    };
  }

  /**
   * Create new account
   */
  static async create(accountData) {
    const {
      company_name, industry, company_size, country, state_region,
      city, district, ward, address, headquarters_address, website,
      phone_number, email_format, revenue, linkedin_url, company_category
    } = accountData;

    const query = `
      INSERT INTO accounts (
        company_name, industry, company_size, country, state_region,
        city, district, ward, address, headquarters_address, website, phone_number,
        email_format, revenue, linkedin_url, company_category
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      company_name, industry, company_size, country, state_region,
      city, district, ward, address, headquarters_address, website, phone_number,
      email_format, revenue, linkedin_url, company_category
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update account
   */
  static async update(accountId, accountData) {
    const allowedFields = [
      'company_name', 'industry', 'company_size', 'country', 'state_region',
      'city', 'district', 'ward', 'address', 'headquarters_address', 'website',
      'phone_number', 'email_format', 'revenue', 'linkedin_url', 'company_category'
    ];

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(accountData).forEach(key => {
      if (accountData[key] !== undefined && allowedFields.includes(key)) {
        fields.push(`${key} = $${paramCount++}`);
        values.push(accountData[key]);
      }
    });

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(accountId);

    const query = `
      UPDATE accounts
      SET ${fields.join(', ')}
      WHERE account_id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete account
   */
  static async delete(accountId) {
    const query = 'DELETE FROM accounts WHERE account_id = $1 RETURNING *';
    const result = await pool.query(query, [accountId]);
    return result.rows[0];
  }

  /**
   * Get filter options
   */
  static async getFilterOptions() {
    const allCountries = [
      'United States', 'United Kingdom', 'Canada', 'Australia', 'India',
      'Germany', 'France', 'Japan', 'China', 'Brazil', 'Mexico', 'Spain',
      'Italy', 'Netherlands', 'Switzerland', 'Sweden', 'Norway', 'Denmark',
      'Belgium', 'Austria', 'Poland', 'Russia', 'South Africa', 'Saudi Arabia',
      'UAE', 'Singapore', 'Hong Kong', 'Thailand', 'Malaysia', 'Indonesia',
      'Philippines', 'Vietnam', 'South Korea', 'Taiwan', 'Pakistan',
      'Bangladesh', 'Sri Lanka', 'Afghanistan', 'Iran', 'Turkey', 'Egypt',
      'Nigeria', 'Kenya', 'Morocco', 'Argentina', 'Chile', 'Colombia',
      'Peru', 'New Zealand'
    ];

    const [companySizes, revenues] = await Promise.all([
      pool.query('SELECT DISTINCT company_size FROM accounts WHERE company_size IS NOT NULL ORDER BY company_size'),
      pool.query('SELECT DISTINCT revenue FROM accounts WHERE revenue IS NOT NULL ORDER BY revenue')
    ]);

    return {
      countries: allCountries,
      industries: getLinkedInCategories(),
      companySizes: companySizes.rows.map(r => r.company_size),
      revenues: revenues.rows.map(r => r.revenue),
      regions: [],
      cities: []
    };
  }

  /**
   * Get states/regions for a country
   */
  static async getRegionsByCountry(country) {
    const result = await pool.query(
      'SELECT DISTINCT state_region FROM accounts WHERE country = $1 AND state_region IS NOT NULL ORDER BY state_region',
      [country]
    );
    return result.rows.map(r => r.state_region);
  }

  /**
   * Get cities for a region
   */
  static async getCitiesByRegion(country, state_region) {
    const result = await pool.query(
      'SELECT DISTINCT city FROM accounts WHERE country = $1 AND state_region = $2 AND city IS NOT NULL ORDER BY city',
      [country, state_region]
    );
    return result.rows.map(r => r.city);
  }

  /**
   * Get statistics
   */
  static async getStats() {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT country) as countries,
        COUNT(DISTINCT industry) as industries,
        COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as "withWebsite",
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as "withPhone",
        COUNT(CASE WHEN email_format IS NOT NULL AND email_format != '' THEN 1 END) as "withEmail"
      FROM accounts
    `;
    const result = await pool.query(query);
    return result.rows[0];
  }
}

module.exports = Account;
