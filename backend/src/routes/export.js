/**
 * EXPORT API
 *
 * Export enriched data to CSV/JSON
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db/connection');

/**
 * Export companies to CSV
 * GET /api/export/companies?format=csv&minQuality=50&limit=1000
 */
router.get('/companies', async (req, res) => {
  try {
    const { format = 'csv', minQuality = 0, limit = 1000, city, industry } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (minQuality > 0) {
      whereClause += ` AND quality_score >= $${paramIdx++}`;
      params.push(parseInt(minQuality));
    }

    if (city) {
      whereClause += ` AND LOWER(city) LIKE LOWER($${paramIdx++})`;
      params.push(`%${city}%`);
    }

    if (industry) {
      whereClause += ` AND LOWER(industry) LIKE LOWER($${paramIdx++})`;
      params.push(`%${industry}%`);
    }

    params.push(parseInt(limit) || 1000);

    const result = await pool.query(`
      SELECT
        a.company_name,
        a.industry,
        a.city,
        a.address,
        a.phone_number,
        a.website,
        a.email_format,
        a.linkedin_url,
        a.twitter_url,
        a.facebook_url,
        a.instagram_url,
        a.employee_count,
        a.quality_score,
        (SELECT COUNT(*) FROM contacts c WHERE c.linked_account_id = a.account_id) as contact_count
      FROM accounts a
      ${whereClause}
      ORDER BY quality_score DESC NULLS LAST
      LIMIT $${paramIdx}
    `, params);

    if (format === 'json') {
      return res.json({
        count: result.rows.length,
        data: result.rows
      });
    }

    // CSV format
    const headers = [
      'Company Name', 'Industry', 'City', 'Address', 'Phone', 'Website',
      'Email Format', 'LinkedIn', 'Twitter', 'Facebook', 'Instagram',
      'Employee Count', 'Quality Score', 'Contact Count'
    ];

    let csv = headers.join(',') + '\n';

    for (const row of result.rows) {
      const values = [
        `"${(row.company_name || '').replace(/"/g, '""')}"`,
        `"${(row.industry || '').replace(/"/g, '""')}"`,
        `"${(row.city || '').replace(/"/g, '""')}"`,
        `"${(row.address || '').replace(/"/g, '""')}"`,
        `"${row.phone_number || ''}"`,
        `"${row.website || ''}"`,
        `"${row.email_format || ''}"`,
        `"${row.linkedin_url || ''}"`,
        `"${row.twitter_url || ''}"`,
        `"${row.facebook_url || ''}"`,
        `"${row.instagram_url || ''}"`,
        row.employee_count || '',
        row.quality_score || '',
        row.contact_count || 0
      ];
      csv += values.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=companies_export_${Date.now()}.csv`);
    res.send(csv);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export contacts to CSV
 * GET /api/export/contacts?format=csv&limit=1000
 */
router.get('/contacts', async (req, res) => {
  try {
    const { format = 'csv', limit = 1000, hasEmail, hasPhone } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (hasEmail === 'true') {
      whereClause += ` AND c.email IS NOT NULL AND c.email != ''`;
    }

    if (hasPhone === 'true') {
      whereClause += ` AND c.phone_number IS NOT NULL AND c.phone_number != ''`;
    }

    params.push(parseInt(limit) || 1000);

    const result = await pool.query(`
      SELECT
        c.first_name,
        c.last_name,
        c.job_title,
        c.email,
        c.phone_number,
        c.linkedin_url,
        a.company_name,
        a.website as company_website,
        a.city as company_city
      FROM contacts c
      LEFT JOIN accounts a ON c.linked_account_id = a.account_id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramIdx}
    `, params);

    if (format === 'json') {
      return res.json({
        count: result.rows.length,
        data: result.rows
      });
    }

    // CSV format
    const headers = [
      'First Name', 'Last Name', 'Job Title', 'Email', 'Phone',
      'LinkedIn', 'Company', 'Company Website', 'City'
    ];

    let csv = headers.join(',') + '\n';

    for (const row of result.rows) {
      const values = [
        `"${(row.first_name || '').replace(/"/g, '""')}"`,
        `"${(row.last_name || '').replace(/"/g, '""')}"`,
        `"${(row.job_title || '').replace(/"/g, '""')}"`,
        `"${row.email || ''}"`,
        `"${row.phone_number || ''}"`,
        `"${row.linkedin_url || ''}"`,
        `"${(row.company_name || '').replace(/"/g, '""')}"`,
        `"${row.company_website || ''}"`,
        `"${(row.company_city || '').replace(/"/g, '""')}"`
      ];
      csv += values.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=contacts_export_${Date.now()}.csv`);
    res.send(csv);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get export stats
 * GET /api/export/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts) as total_companies,
        (SELECT COUNT(*) FROM accounts WHERE quality_score >= 50) as high_quality_companies,
        (SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL) as with_website,
        (SELECT COUNT(*) FROM accounts WHERE phone_number IS NOT NULL) as with_phone,
        (SELECT COUNT(*) FROM accounts WHERE email_format IS NOT NULL) as with_email_format,
        (SELECT COUNT(*) FROM accounts WHERE linkedin_url IS NOT NULL) as with_linkedin,
        (SELECT COUNT(*) FROM contacts) as total_contacts,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL) as contacts_with_email,
        (SELECT COUNT(*) FROM contacts WHERE phone_number IS NOT NULL) as contacts_with_phone,
        (SELECT COUNT(*) FROM contacts WHERE linkedin_url IS NOT NULL) as contacts_with_linkedin,
        (SELECT AVG(quality_score) FROM accounts WHERE quality_score IS NOT NULL) as avg_quality_score
    `);

    res.json(stats.rows[0]);

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
