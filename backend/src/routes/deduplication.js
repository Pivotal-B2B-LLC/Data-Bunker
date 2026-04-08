/**
 * Deduplication API Routes
 * Find and merge duplicate companies
 */

const express = require('express');
const router = express.Router();
const deduplicationService = require('../services/deduplicationService');

/**
 * GET /api/deduplication/find
 * Find potential duplicate companies
 * Query params:
 *   - minConfidence (optional): Minimum confidence score 0.0-1.0 (default: 0.7)
 */
router.get('/find', async (req, res) => {
  try {
    const minConfidence = parseFloat(req.query.minConfidence) || 0.7;
    
    if (minConfidence < 0 || minConfidence > 1) {
      return res.status(400).json({ 
        error: 'minConfidence must be between 0.0 and 1.0' 
      });
    }

    const duplicates = await deduplicationService.findDuplicates(minConfidence);

    res.json({
      success: true,
      count: duplicates.length,
      minConfidence,
      duplicates
    });
  } catch (error) {
    console.error('Error finding duplicates:', error);
    res.status(500).json({ 
      error: 'Failed to find duplicates',
      message: error.message 
    });
  }
});

/**
 * GET /api/deduplication/preview/:primaryId/:duplicateId
 * Preview what would change if two companies were merged
 */
router.get('/preview/:primaryId/:duplicateId', async (req, res) => {
  try {
    const { primaryId, duplicateId } = req.params;

    const preview = await deduplicationService.getMergePreview(
      parseInt(primaryId),
      parseInt(duplicateId)
    );

    res.json({
      success: true,
      preview
    });
  } catch (error) {
    console.error('Error previewing merge:', error);
    res.status(500).json({ 
      error: 'Failed to preview merge',
      message: error.message 
    });
  }
});

/**
 * POST /api/deduplication/merge
 * Merge two companies
 * Body:
 *   - primaryId: ID of company to keep
 *   - duplicateId: ID of company to merge into primary
 */
router.post('/merge', async (req, res) => {
  try {
    const { primaryId, duplicateId } = req.body;

    if (!primaryId || !duplicateId) {
      return res.status(400).json({ 
        error: 'primaryId and duplicateId are required' 
      });
    }

    if (primaryId === duplicateId) {
      return res.status(400).json({ 
        error: 'Cannot merge a company with itself' 
      });
    }

    const result = await deduplicationService.mergeDuplicates(
      parseInt(primaryId),
      parseInt(duplicateId)
    );

    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error merging companies:', error);
    res.status(500).json({ 
      error: 'Failed to merge companies',
      message: error.message 
    });
  }
});

/**
 * POST /api/deduplication/auto-merge
 * Automatically merge high-confidence duplicates
 * Body:
 *   - minConfidence (optional): Minimum confidence to auto-merge (default: 0.95)
 */
router.post('/auto-merge', async (req, res) => {
  try {
    const minConfidence = parseFloat(req.body.minConfidence) || 0.95;
    
    if (minConfidence < 0 || minConfidence > 1) {
      return res.status(400).json({ 
        error: 'minConfidence must be between 0.0 and 1.0' 
      });
    }

    const stats = await deduplicationService.autoMerge(minConfidence);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error in auto-merge:', error);
    res.status(500).json({ 
      error: 'Failed to auto-merge',
      message: error.message 
    });
  }
});

module.exports = router;
