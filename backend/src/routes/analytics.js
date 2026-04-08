const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * GET /api/analytics/locations
 * Get count of companies by location (city and state combination)
 */
router.get('/locations', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT city, state_region, COUNT(*) as count
       FROM accounts
       GROUP BY city, state_region
       ORDER BY count DESC
       LIMIT 100`
    );

    const locationStats = {};
    result.rows.forEach(row => {
      const key = row.city ? `${row.city}, ${row.state_region}` : row.state_region;
      locationStats[key] = row.count;
    });

    res.json({
      success: true,
      data: locationStats
    });
  } catch (error) {
    console.error('Failed to get location analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get location analytics'
    });
  }
});

/**
 * GET /api/analytics/industries
 * Get count of companies by industry
 */
router.get('/industries', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT industry, COUNT(*) as count
       FROM accounts
       WHERE industry IS NOT NULL
       GROUP BY industry
       ORDER BY count DESC
       LIMIT 100`
    );

    const industryStats = {};
    result.rows.forEach(row => {
      industryStats[row.industry] = row.count;
    });

    res.json({
      success: true,
      data: industryStats
    });
  } catch (error) {
    console.error('Failed to get industry analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get industry analytics'
    });
  }
});

/**
 * GET /api/analytics/enrichment-status
 * Get enrichment completion status by field
 */
router.get('/enrichment-status', async (req, res) => {
  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM accounts`
    );

    const websiteResult = await pool.query(
      `SELECT COUNT(*) as count FROM accounts WHERE website IS NOT NULL AND website != ''`
    );

    const emailResult = await pool.query(
      `SELECT COUNT(*) as count FROM accounts WHERE email_format IS NOT NULL AND email_format != ''`
    );

    const phoneResult = await pool.query(
      `SELECT COUNT(*) as count FROM accounts WHERE phone_number IS NOT NULL AND phone_number != ''`
    );

    const linkedinResult = await pool.query(
      `SELECT COUNT(*) as count FROM accounts WHERE linkedin_url IS NOT NULL AND linkedin_url != ''`
    );

    const total = parseInt(totalResult.rows[0]?.total || 0);

    res.json({
      success: true,
      data: {
        total,
        withWebsite: parseInt(websiteResult.rows[0]?.count || 0),
        withEmail: parseInt(emailResult.rows[0]?.count || 0),
        withPhone: parseInt(phoneResult.rows[0]?.count || 0),
        withLinkedin: parseInt(linkedinResult.rows[0]?.count || 0)
      }
    });
  } catch (error) {
    console.error('Failed to get enrichment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get enrichment status'
    });
  }
});

/**
 * GET /api/analytics/summary
 * Get comprehensive analytics summary
 */
router.get('/summary', async (req, res) => {
  try {
    const [
      totalResult,
      websiteResult,
      emailResult,
      phoneResult,
      linkedinResult,
      industryResult,
      locationResult,
      recentResult
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM accounts`),
      pool.query(`SELECT COUNT(*) as count FROM accounts WHERE website IS NOT NULL AND website != ''`),
      pool.query(`SELECT COUNT(*) as count FROM accounts WHERE email_format IS NOT NULL AND email_format != ''`),
      pool.query(`SELECT COUNT(*) as count FROM accounts WHERE phone_number IS NOT NULL AND phone_number != ''`),
      pool.query(`SELECT COUNT(*) as count FROM accounts WHERE linkedin_url IS NOT NULL AND linkedin_url != ''`),
      pool.query(`SELECT COUNT(DISTINCT industry) as count FROM accounts WHERE industry IS NOT NULL`),
      pool.query(`SELECT COUNT(DISTINCT (city, state_region)) as count FROM accounts`),
      pool.query(`SELECT COUNT(*) as count FROM accounts WHERE created_at > NOW() - INTERVAL '7 days'`)
    ]);

    const total = parseInt(totalResult.rows[0]?.total || 0);

    res.json({
      success: true,
      data: {
        totalCompanies: total,
        withWebsite: parseInt(websiteResult.rows[0]?.count || 0),
        withEmail: parseInt(emailResult.rows[0]?.count || 0),
        withPhone: parseInt(phoneResult.rows[0]?.count || 0),
        withLinkedin: parseInt(linkedinResult.rows[0]?.count || 0),
        uniqueIndustries: parseInt(industryResult.rows[0]?.count || 0),
        uniqueLocations: parseInt(locationResult.rows[0]?.count || 0),
        addedThisWeek: parseInt(recentResult.rows[0]?.count || 0),
        enrichmentRate: total > 0 ? Math.round(((parseInt(websiteResult.rows[0]?.count || 0) / total) * 100)) : 0
      }
    });
  } catch (error) {
    console.error('Failed to get analytics summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics summary'
    });
  }
});

module.exports = router;
