/**
 * UK Companies Routes - Database Only
 * Searches 5M+ UK companies from local PostgreSQL database
 * Fast, offline-capable, no API keys needed
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db/connection');

/**
 * Search UK companies in database
 * GET /api/companies/uk/search?query=tesco&limit=20
 */
router.get('/search', async (req, res) => {
  try {
    const { query, status, industry, locality, region, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT 
        id,
        company_number,
        name,
        legal_name,
        status,
        company_type,
        jurisdiction,
        incorporation_date,
        address_line_1,
        locality,
        region,
        postal_code,
        country,
        industry,
        website,
        email,
        phone,
        linkedin_url,
        last_enriched
      FROM companies
      WHERE jurisdiction = 'gb'
    `;

    const params = [];
    let paramCount = 1;

    // Search by name or company number
    if (query) {
      sql += ` AND (name ILIKE $${paramCount} OR company_number ILIKE $${paramCount})`;
      params.push(`%${query}%`);
      paramCount++;
    }

    // Filter by status
    if (status) {
      sql += ` AND status ILIKE $${paramCount}`;
      params.push(`%${status}%`);
      paramCount++;
    }

    // Filter by industry
    if (industry) {
      sql += ` AND industry ILIKE $${paramCount}`;
      params.push(`%${industry}%`);
      paramCount++;
    }

    // Filter by locality
    if (locality) {
      sql += ` AND locality ILIKE $${paramCount}`;
      params.push(`%${locality}%`);
      paramCount++;
    }

    // Filter by region
    if (region) {
      sql += ` AND region ILIKE $${paramCount}`;
      params.push(`%${region}%`);
      paramCount++;
    }

    // Add ordering and pagination
    sql += ` ORDER BY name LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(sql, params);

    // Get total count
    let countSql = `SELECT COUNT(*) FROM companies WHERE jurisdiction = 'gb'`;
    const countParams = [];
    let countParamCount = 1;

    if (query) {
      countSql += ` AND (name ILIKE $${countParamCount} OR company_number ILIKE $${countParamCount})`;
      countParams.push(`%${query}%`);
      countParamCount++;
    }

    const countResult = await pool.query(countSql, countParams);

    res.json({
      success: true,
      source: 'database',
      country: 'UK',
      companies: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
      message: 'UK companies from local database'
    });

  } catch (error) {
    console.error('UK search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search UK companies',
      details: error.message
    });
  }
});

/**
 * Get UK database statistics
 * GET /api/companies/uk/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { companyNumber } = req.params;

    const result = await pool.query(`
      SELECT 
        id,
        company_number,
        name,
        legal_name,
        status,
        company_type,
        jurisdiction,
        incorporation_date,
        address_line_1,
        locality,
        region,
        postal_code,
        country,
        industry,
        sic_codes,
        website,
        email,
        phone,
        linkedin_url,
        enrichment_status,
        last_enriched,
        data_source,
        created_at,
        last_updated
      FROM companies
      WHERE company_number = $1 AND jurisdiction = 'gb'
    `, [companyNumber]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'UK company not found',
        company_number: companyNumber
      });
    }

    res.json({
      success: true,
      source: 'database',
      country: 'UK',
      company: result.rows[0]
    });

  } catch (error) {
    console.error('UK company fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch UK company',
      details: error.message
    });
  }
});

/**
 * Get UK database statistics
 * GET /api/companies/uk/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_companies,
        COUNT(*) FILTER (WHERE status ILIKE '%active%') as active_companies,
        COUNT(*) FILTER (WHERE website IS NOT NULL) as companies_with_website,
        COUNT(*) FILTER (WHERE email IS NOT NULL) as companies_with_email,
        COUNT(*) FILTER (WHERE phone IS NOT NULL) as companies_with_phone,
        COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL) as companies_with_linkedin,
        COUNT(DISTINCT industry) as industries,
        COUNT(DISTINCT locality) as localities,
        COUNT(DISTINCT region) as regions
      FROM companies
      WHERE jurisdiction = 'gb'
    `);

    res.json({
      success: true,
      source: 'database',
      country: 'UK',
      statistics: stats.rows[0]
    });

  } catch (error) {
    console.error('UK stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get UK statistics',
      details: error.message
    });
  }
});

module.exports = router;
