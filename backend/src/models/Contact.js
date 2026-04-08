/**
 * Contact Model
 * Handles all database operations for Contacts (People)
 */

const { pool } = require('../db/connection');

class Contact {
  /**
   * Get all contacts with filtering and pagination
   */
  static async findAll(filters = {}, options = {}) {
    const {
      name,
      job_title,
      country,
      company_name,
      linked_account_id
    } = filters;

    let {
      limit = 50,
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = options;

    // Whitelist allowed ORDER BY columns to prevent SQL injection
    const ALLOWED_ORDER_COLUMNS = [
      'created_at', 'updated_at', 'first_name', 'last_name',
      'job_title', 'email', 'contact_id'
    ];
    const ALLOWED_ORDER_DIRECTIONS = ['ASC', 'DESC'];

    if (!ALLOWED_ORDER_COLUMNS.includes(orderBy)) orderBy = 'created_at';
    if (!ALLOWED_ORDER_DIRECTIONS.includes(orderDirection.toUpperCase())) orderDirection = 'DESC';
    limit = Math.min(Math.max(1, parseInt(limit) || 50), 500);

    let query = `
      SELECT
        c.*,
        a.company_name,
        a.industry as company_industry,
        a.website as company_website
      FROM contacts c
      LEFT JOIN accounts a ON c.linked_account_id = a.account_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    // Add filters
    if (name) {
      query += ` AND (c.first_name ILIKE $${paramCount} OR c.last_name ILIKE $${paramCount})`;
      params.push(`%${name}%`);
      paramCount++;
    }

    if (job_title) {
      query += ` AND c.job_title ILIKE $${paramCount}`;
      params.push(`%${job_title}%`);
      paramCount++;
    }

    if (country) {
      query += ` AND c.country = $${paramCount}`;
      params.push(country);
      paramCount++;
    }

    if (company_name) {
      query += ` AND a.company_name ILIKE $${paramCount}`;
      params.push(`%${company_name}%`);
      paramCount++;
    }

    if (linked_account_id) {
      query += ` AND c.linked_account_id = $${paramCount}`;
      params.push(linked_account_id);
      paramCount++;
    }

    // Add ordering (sanitized above)
    query += ` ORDER BY c.${orderBy} ${orderDirection}`;

    // Add pagination
    query += ` LIMIT $${paramCount++} OFFSET $${paramCount}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    
    // Get total count
    const countParams = params.slice(0, params.length - 2);
    let countQuery = `
      SELECT COUNT(*) 
      FROM contacts c
      LEFT JOIN accounts a ON c.linked_account_id = a.account_id
      WHERE 1=1
    `;
    
    if (name) countQuery += ` AND (c.first_name ILIKE $1 OR c.last_name ILIKE $1)`;
    if (job_title) countQuery += ` AND c.job_title ILIKE $${countParams.length}`;
    if (country) countQuery += ` AND c.country = $${countParams.length}`;
    if (company_name) countQuery += ` AND a.company_name ILIKE $${countParams.length}`;
    if (linked_account_id) countQuery += ` AND c.linked_account_id = $${countParams.length}`;
    
    const countResult = await pool.query(countQuery, countParams);

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset
    };
  }

  /**
   * Get contact by ID
   */
  static async findById(contactId) {
    const query = `
      SELECT 
        c.*,
        a.company_name,
        a.industry as company_industry,
        a.website as company_website,
        a.address as company_address
      FROM contacts c
      LEFT JOIN accounts a ON c.linked_account_id = a.account_id
      WHERE c.contact_id = $1
    `;
    
    const result = await pool.query(query, [contactId]);
    return result.rows[0] || null;
  }

  /**
   * Create new contact
   */
  static async create(contactData) {
    const {
      first_name,
      last_name,
      job_title,
      email,
      phone_number,
      country,
      city,
      linked_account_id,
      linkedin_url
    } = contactData;

    // Validate that linked_account_id exists
    const accountCheck = await pool.query(
      'SELECT account_id FROM accounts WHERE account_id = $1',
      [linked_account_id]
    );

    if (accountCheck.rows.length === 0) {
      throw new Error('Invalid linked_account_id: Account does not exist');
    }

    // Validate email format if provided
    if (email && !this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    const query = `
      INSERT INTO contacts (
        first_name, last_name, job_title, email, phone_number,
        country, city, linked_account_id, linkedin_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      first_name, last_name, job_title, email, phone_number,
      country, city, linked_account_id, linkedin_url
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update contact
   */
  static async update(contactId, contactData) {
    // Validate email if being updated
    if (contactData.email && !this.isValidEmail(contactData.email)) {
      throw new Error('Invalid email format');
    }

    // Validate linked_account_id if being updated
    if (contactData.linked_account_id) {
      const accountCheck = await pool.query(
        'SELECT account_id FROM accounts WHERE account_id = $1',
        [contactData.linked_account_id]
      );

      if (accountCheck.rows.length === 0) {
        throw new Error('Invalid linked_account_id: Account does not exist');
      }
    }

    // Whitelist allowed fields to prevent arbitrary column injection
    const ALLOWED_UPDATE_FIELDS = [
      'first_name', 'last_name', 'job_title', 'email', 'phone_number',
      'country', 'city', 'linked_account_id', 'linkedin_url',
      'verified', 'confidence_score', 'data_source'
    ];

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(contactData).forEach(key => {
      if (contactData[key] !== undefined && ALLOWED_UPDATE_FIELDS.includes(key)) {
        fields.push(`${key} = $${paramCount++}`);
        values.push(contactData[key]);
      }
    });

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(contactId);

    const query = `
      UPDATE contacts
      SET ${fields.join(', ')}
      WHERE contact_id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete contact
   */
  static async delete(contactId) {
    const query = 'DELETE FROM contacts WHERE contact_id = $1 RETURNING *';
    const result = await pool.query(query, [contactId]);
    return result.rows[0];
  }

  /**
   * Get contacts by account ID
   */
  static async findByAccountId(accountId) {
    const query = 'SELECT * FROM contacts WHERE linked_account_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [accountId]);
    return result.rows;
  }

  /**
   * Get filter options
   */
  static async getFilterOptions() {
    const queries = {
      countries: 'SELECT DISTINCT country FROM contacts WHERE country IS NOT NULL ORDER BY country',
      jobTitles: 'SELECT DISTINCT job_title FROM contacts WHERE job_title IS NOT NULL ORDER BY job_title LIMIT 100'
    };

    const [countries, jobTitles] = await Promise.all([
      pool.query(queries.countries),
      pool.query(queries.jobTitles)
    ]);

    return {
      countries: countries.rows.map(r => r.country),
      jobTitles: jobTitles.rows.map(r => r.job_title)
    };
  }

  /**
   * Get statistics
   */
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_contacts,
        COUNT(DISTINCT linked_account_id) as total_companies,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL THEN 1 END) as with_phone,
        COUNT(CASE WHEN linkedin_url IS NOT NULL THEN 1 END) as with_linkedin
      FROM contacts
    `;
    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Email validation helper
   */
  static isValidEmail(email) {
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    return emailRegex.test(email);
  }
}

module.exports = Contact;
