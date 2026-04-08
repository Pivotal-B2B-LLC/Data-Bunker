/**
 * Bulk Import API Routes
 */

const express = require('express');
const router = express.Router();
const bulkImportService = require('../services/bulkImportService');

/**
 * Start bulk import
 */
router.post('/start', async (req, res) => {
  try {
    const {
      startFrom = 0,
      batchSize = 100,
      maxCompanies = null,
      delayBetweenBatches = 2000,
      enrichWithContacts = false
    } = req.body;

    // Start import in background
    bulkImportService.importAllActiveUKCompanies({
      startFrom,
      batchSize,
      maxCompanies,
      delayBetweenBatches,
      enrichWithContacts
    }).catch(error => {
      console.error('Background import error:', error);
    });

    res.json({
      success: true,
      message: 'Bulk import started in background',
      note: 'Duplicates will be automatically updated, not created',
      stats: bulkImportService.getStats()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stop bulk import
 */
router.post('/stop', (req, res) => {
  try {
    bulkImportService.stop();
    
    res.json({
      success: true,
      message: 'Import stop requested',
      stats: bulkImportService.getStats()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get import status
 */
router.get('/status', (req, res) => {
  try {
    const stats = bulkImportService.getStats();
    
    res.json({
      success: true,
      stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
