/**
 * Enriched Data Routes
 * API endpoints for viewing companies that have been enriched with
 * emails, phones, websites, and contacts
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db/connection');

/**
 * GET /api/enriched
 * Get enriched companies with filters and pagination
 */
router.get('/', async (req, res) => {
  try {
    const {
      search = '',
      country = '',
      city = '',
      industry = '',
      has_website = '',
      has_email = '',
      has_phone = '',
      has_contacts = '',
      has_linkedin = '',
      sort = 'updated_at',
      order = 'DESC',
      limit = 24,
      offset = 0
    } = req.query;

    const conditions = [];
    const values = [];
    let idx = 1;

    // Base: must have at least one enrichment field
    conditions.push(`(
      (a.website IS NOT NULL AND a.website != '') OR
      (a.email_format IS NOT NULL AND a.email_format != '') OR
      (a.phone_number IS NOT NULL AND a.phone_number != '') OR
      (a.linkedin_url IS NOT NULL AND a.linkedin_url != '')
    )`);

    if (search) {
      conditions.push(`a.company_name ILIKE $${idx}`);
      values.push(`%${search}%`);
      idx++;
    }

    if (country) {
      conditions.push(`a.country = $${idx}`);
      values.push(country);
      idx++;
    }

    if (city) {
      conditions.push(`a.city = $${idx}`);
      values.push(city);
      idx++;
    }

    if (industry) {
      conditions.push(`a.industry = $${idx}`);
      values.push(industry);
      idx++;
    }

    if (has_website === 'true') {
      conditions.push(`a.website IS NOT NULL AND a.website != ''`);
    }
    if (has_email === 'true') {
      conditions.push(`a.email_format IS NOT NULL AND a.email_format != ''`);
    }
    if (has_phone === 'true') {
      conditions.push(`a.phone_number IS NOT NULL AND a.phone_number != ''`);
    }
    if (has_linkedin === 'true') {
      conditions.push(`a.linkedin_url IS NOT NULL AND a.linkedin_url != ''`);
    }
    if (has_contacts === 'true') {
      conditions.push(`EXISTS (SELECT 1 FROM contacts c WHERE c.linked_account_id = a.account_id)`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Allowed sort columns
    const sortColumns = {
      'updated_at': 'a.updated_at',
      'company_name': 'a.company_name',
      'created_at': 'a.created_at',
      'enrichment': 'enrichment_score'
    };
    const sortCol = sortColumns[sort] || 'a.updated_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM accounts a ${whereClause}`;
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total);

    // Fetch data with contact count and enrichment score
    const dataQuery = `
      SELECT
        a.account_id, a.company_name, a.website, a.phone_number,
        a.email_format, a.linkedin_url, a.city, a.state_region, a.country,
        a.industry, a.address, a.company_category, a.company_size,
        a.twitter_url, a.facebook_url, a.instagram_url,
        a.employee_count, a.company_status, a.data_source,
        a.created_at, a.updated_at,
        COALESCE(ct.contact_count, 0) as contact_count,
        (
          CASE WHEN a.website IS NOT NULL AND a.website != '' THEN 1 ELSE 0 END +
          CASE WHEN a.email_format IS NOT NULL AND a.email_format != '' THEN 1 ELSE 0 END +
          CASE WHEN a.phone_number IS NOT NULL AND a.phone_number != '' THEN 1 ELSE 0 END +
          CASE WHEN a.linkedin_url IS NOT NULL AND a.linkedin_url != '' THEN 1 ELSE 0 END
        ) as enrichment_score
      FROM accounts a
      LEFT JOIN (
        SELECT linked_account_id, COUNT(*) as contact_count
        FROM contacts
        GROUP BY linked_account_id
      ) ct ON ct.linked_account_id = a.account_id
      ${whereClause}
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    values.push(parseInt(limit), parseInt(offset));

    const dataResult = await pool.query(dataQuery, values);

    res.json({
      success: true,
      data: dataResult.rows,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching enriched data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/enriched/stats
 * Get enrichment statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        COUNT(*) FILTER (WHERE website IS NOT NULL AND website != '') as with_website,
        COUNT(*) FILTER (WHERE email_format IS NOT NULL AND email_format != '') as with_email,
        COUNT(*) FILTER (WHERE phone_number IS NOT NULL AND phone_number != '') as with_phone,
        COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url != '') as with_linkedin,
        COUNT(*) FILTER (
          WHERE website IS NOT NULL AND website != ''
          AND email_format IS NOT NULL AND email_format != ''
          AND phone_number IS NOT NULL AND phone_number != ''
        ) as fully_enriched,
        COUNT(*) FILTER (
          WHERE (website IS NOT NULL AND website != '')
          OR (email_format IS NOT NULL AND email_format != '')
          OR (phone_number IS NOT NULL AND phone_number != '')
          OR (linkedin_url IS NOT NULL AND linkedin_url != '')
        ) as any_enrichment
      FROM accounts
    `);

    const contactResult = await pool.query(`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(DISTINCT linked_account_id) as companies_with_contacts,
        COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '') as contacts_with_email,
        COUNT(*) FILTER (WHERE phone_number IS NOT NULL AND phone_number != '') as contacts_with_phone
      FROM contacts
    `);

    // Recent enrichment activity (last 24h)
    const recentResult = await pool.query(`
      SELECT COUNT(*) as enriched_24h
      FROM accounts
      WHERE updated_at > NOW() - INTERVAL '24 hours'
        AND (
          website IS NOT NULL AND website != ''
          OR email_format IS NOT NULL AND email_format != ''
          OR phone_number IS NOT NULL AND phone_number != ''
        )
    `);

    // Top countries by enrichment
    const countriesResult = await pool.query(`
      SELECT country, COUNT(*) as count
      FROM accounts
      WHERE (website IS NOT NULL AND website != '')
        OR (email_format IS NOT NULL AND email_format != '')
        OR (phone_number IS NOT NULL AND phone_number != '')
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `);

    // Top industries by enrichment
    const industriesResult = await pool.query(`
      SELECT industry, COUNT(*) as count
      FROM accounts
      WHERE industry IS NOT NULL AND industry != ''
        AND (
          (website IS NOT NULL AND website != '')
          OR (email_format IS NOT NULL AND email_format != '')
          OR (phone_number IS NOT NULL AND phone_number != '')
        )
      GROUP BY industry
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        companies: result.rows[0],
        contacts: contactResult.rows[0],
        recent: recentResult.rows[0],
        topCountries: countriesResult.rows,
        topIndustries: industriesResult.rows
      }
    });
  } catch (error) {
    console.error('Error fetching enriched stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/enriched/filter-options
 * Get filter options for enriched data
 */
router.get('/filter-options', async (req, res) => {
  try {
    const [countries, industries] = await Promise.all([
      pool.query(`
        SELECT DISTINCT country FROM accounts
        WHERE country IS NOT NULL AND country != ''
          AND (website IS NOT NULL OR email_format IS NOT NULL OR phone_number IS NOT NULL)
        ORDER BY country LIMIT 50
      `),
      pool.query(`
        SELECT DISTINCT industry FROM accounts
        WHERE industry IS NOT NULL AND industry != ''
          AND (website IS NOT NULL OR email_format IS NOT NULL OR phone_number IS NOT NULL)
        ORDER BY industry LIMIT 50
      `)
    ]);

    res.json({
      success: true,
      data: {
        countries: countries.rows.map(r => r.country),
        industries: industries.rows.map(r => r.industry)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/enriched/:id/contacts
 * Get contacts for a specific enriched company
 */
router.get('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT contact_id, first_name, last_name, job_title, email,
             phone_number, linkedin_url, data_source, verified,
             confidence_score, created_at
      FROM contacts
      WHERE linked_account_id = $1
      ORDER BY verified DESC NULLS LAST, created_at DESC
    `, [id]);

    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
