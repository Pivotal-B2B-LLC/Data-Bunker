const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

/**
 * Get geographic distribution of companies
 * Returns company counts grouped by country, state, and city
 */
router.get('/geographic-distribution', async (req, res) => {
  try {
    const { country } = req.query;
    
    // Get state-level distribution
    const stateQuery = country
      ? `SELECT 
          country, 
          state_region as state, 
          COUNT(*) as count,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_count
         FROM accounts 
         WHERE country = $1 AND state_region IS NOT NULL
         GROUP BY country, state_region 
         ORDER BY count DESC`
      : `SELECT 
          country, 
          state_region as state, 
          COUNT(*) as count,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_count
         FROM accounts 
         WHERE state_region IS NOT NULL
         GROUP BY country, state_region 
         ORDER BY count DESC`;
    
    const stateResult = country 
      ? await pool.query(stateQuery, [country])
      : await pool.query(stateQuery);
    
    // Get city-level distribution for top states
    const cityQuery = country
      ? `SELECT 
          country,
          state_region as state,
          city,
          COUNT(*) as count,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_count
         FROM accounts 
         WHERE country = $1 AND city IS NOT NULL AND state_region IS NOT NULL
         GROUP BY country, state_region, city 
         HAVING COUNT(*) >= 10
         ORDER BY count DESC 
         LIMIT 500`
      : `SELECT 
          country,
          state_region as state,
          city,
          COUNT(*) as count,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_count
         FROM accounts 
         WHERE city IS NOT NULL AND state_region IS NOT NULL
         GROUP BY country, state_region, city 
         HAVING COUNT(*) >= 10
         ORDER BY count DESC 
         LIMIT 500`;
    
    const cityResult = country
      ? await pool.query(cityQuery, [country])
      : await pool.query(cityQuery);
    
    // Get country totals
    const countryQuery = `
      SELECT 
        country, 
        COUNT(*) as total_companies,
        COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_companies
      FROM accounts 
      WHERE country IS NOT NULL
      GROUP BY country 
      ORDER BY total_companies DESC
    `;
    const countryResult = await pool.query(countryQuery);
    
    res.json({
      success: true,
      data: {
        countries: countryResult.rows,
        states: stateResult.rows,
        cities: cityResult.rows
      }
    });
  } catch (error) {
    console.error('Error fetching geographic distribution:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Get top cities by company count
 */
router.get('/top-cities', async (req, res) => {
  try {
    const { country, limit = 20 } = req.query;
    
    const query = country
      ? `SELECT 
          city,
          state_region as state,
          country,
          COUNT(*) as company_count,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_count
         FROM accounts 
         WHERE country = $1 AND city IS NOT NULL
         GROUP BY city, state_region, country
         ORDER BY company_count DESC
         LIMIT $2`
      : `SELECT 
          city,
          state_region as state,
          country,
          COUNT(*) as company_count,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as enriched_count
         FROM accounts 
         WHERE city IS NOT NULL
         GROUP BY city, state_region, country
         ORDER BY company_count DESC
         LIMIT $1`;
    
    const result = country
      ? await pool.query(query, [country, limit])
      : await pool.query(query, [limit]);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching top cities:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
