/**
 * Officers API Routes
 * Endpoints for querying company officers and appointments
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const officerImportService = require('../services/officerImportService');

/**
 * GET /api/officers/stats
 * Get overall statistics about officers data
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await officerImportService.getOfficerStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching officer stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch officer statistics'
    });
  }
});

/**
 * GET /api/officers/company/:companyNumber
 * Get all officers for a specific company
 */
router.get('/company/:companyNumber', async (req, res) => {
  try {
    const { companyNumber } = req.params;
    const { activeOnly = 'true' } = req.query;

    let query = `
      SELECT 
        o.id,
        o.name,
        o.role,
        o.nationality,
        o.occupation,
        o.appointed_date,
        o.resigned_date,
        o.date_of_birth,
        o.address,
        CASE WHEN o.resigned_date IS NULL THEN true ELSE false END as is_active
      FROM companies c
      JOIN officers o ON c.id = o.company_id
      WHERE c.company_number = $1
    `;

    const params = [companyNumber];

    if (activeOnly === 'true') {
      query += ' AND o.resigned_date IS NULL';
    }

    query += ' ORDER BY o.appointed_date DESC';

    const result = await db.query(query, params);

    res.json({
      success: true,
      companyNumber,
      count: result.rows.length,
      officers: result.rows
    });
  } catch (error) {
    console.error('Error fetching officers for company:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch officers'
    });
  }
});

/**
 * GET /api/officers/:officerId
 * Get details of a specific officer
 */
router.get('/:officerId', async (req, res) => {
  try {
    const { officerId } = req.params;

    const query = `
      SELECT 
        o.*,
        COALESCE(
          json_agg(
            json_build_object(
              'company_number', c.company_number,
              'company_name', c.name,
              'role', o.role,
              'appointed_date', o.appointed_date,
              'resigned_date', o.resigned_date,
              'is_active', CASE WHEN o.resigned_date IS NULL THEN true ELSE false END
            )
            ORDER BY o.appointed_date DESC
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'
        ) as appointments
      FROM officers o
      LEFT JOIN companies c ON o.company_id = c.id
      WHERE o.id = $1
      GROUP BY o.id;
    `;

    const result = await db.query(query, [officerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Officer not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching officer details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch officer details'
    });
  }
});

/**
 * GET /api/officers/search
 * Search for officers by name
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 50, offset = 0 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query (q) is required'
      });
    }

    const query = `
      SELECT 
        o.id,
        o.name,
        o.nationality,
        o.occupation,
        COUNT(DISTINCT o.company_id) as total_appointments,
        COUNT(DISTINCT o.company_id) FILTER (WHERE o.resigned_date IS NULL) as active_appointments
      FROM officers o
      WHERE o.name ILIKE $1
      GROUP BY o.id
      ORDER BY active_appointments DESC, o.name
      LIMIT $2 OFFSET $3;
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM officers
      WHERE name ILIKE $1;
    `;

    const searchPattern = `%${q}%`;
    const [results, countResult] = await Promise.all([
      db.query(query, [searchPattern, limit, offset]),
      db.query(countQuery, [searchPattern])
    ]);

    res.json({
      success: true,
      query: q,
      total: parseInt(countResult.rows[0].total),
      count: results.rows.length,
      officers: results.rows
    });
  } catch (error) {
    console.error('Error searching officers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search officers'
    });
  }
});

/**
 * POST /api/officers/import/:companyNumber
 * Manually trigger import of officers for a specific company
 */
router.post('/import/:companyNumber', async (req, res) => {
  try {
    const { companyNumber } = req.params;

    // Get company ID
    const companyQuery = 'SELECT id FROM companies WHERE company_number = $1';
    const companyResult = await db.query(companyQuery, [companyNumber]);

    if (companyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    const companyId = companyResult.rows[0].id;

    // Import officers
    const result = await officerImportService.importOfficersForCompany(
      companyNumber,
      companyId
    );

    res.json({
      success: result.success,
      companyNumber,
      officersImported: result.officers,
      errors: result.errors
    });
  } catch (error) {
    console.error('Error importing officers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import officers'
    });
  }
});

/**
 * POST /api/officers/batch-import
 * Start batch import of officers (limited to prevent overload)
 */
router.post('/batch-import', async (req, res) => {
  try {
    const { limit = 100 } = req.body;

    if (limit > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Limit cannot exceed 1000 companies per request'
      });
    }

    // Get companies without officers
    const companies = await officerImportService.getCompaniesWithoutOfficers(limit, 0);

    if (companies.length === 0) {
      return res.json({
        success: true,
        message: 'All companies already have officers imported'
      });
    }

    // Start import (don't wait for completion, send progress updates)
    res.json({
      success: true,
      message: 'Batch import started',
      companiesToProcess: companies.length
    });

    // Run import in background
    officerImportService.batchImportOfficers(companies, (progress) => {
      console.log(`Import progress: ${progress.percentComplete}%`);
    }).catch(error => {
      console.error('Batch import error:', error);
    });

  } catch (error) {
    console.error('Error starting batch import:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start batch import'
    });
  }
});

/**
 * GET /api/officers/companies-without
 * Get list of companies that don't have officers imported yet
 */
router.get('/companies-without', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    
    const companies = await officerImportService.getCompaniesWithoutOfficers(
      parseInt(limit),
      parseInt(offset)
    );

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM companies c
      LEFT JOIN officers o ON c.id = o.company_id
      WHERE o.id IS NULL
    `;
    const countResult = await db.query(countQuery);

    res.json({
      success: true,
      total: parseInt(countResult.rows[0].total),
      count: companies.length,
      companies
    });
  } catch (error) {
    console.error('Error fetching companies without officers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch companies'
    });
  }
});

module.exports = router;
