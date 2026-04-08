const express = require('express');
const router = express.Router();
const bulkCSVImporter = require('../services/bulkCSVImporter');
const path = require('path');

router.post('/companies', async (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'filePath is required'
      });
    }

    const fullPath = path.resolve(filePath);
    
    // Start in background
    bulkCSVImporter.importCompaniesFromCSV(fullPath)
      .then(stats => console.log('✅ Import completed:', stats))
      .catch(error => console.error('❌ Import error:', error));

    res.json({
      success: true,
      message: 'CSV import started in background - importing at ~5,000 companies/sec',
      estimatedTime: '20-30 minutes for 5M companies'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/status', (req, res) => {
  try {
    res.json({
      success: true,
      stats: bulkCSVImporter.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/stop', (req, res) => {
  try {
    bulkCSVImporter.stop();
    res.json({
      success: true,
      message: 'Import stopped'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
