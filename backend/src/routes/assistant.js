/**
 * AI Assistant API Route
 * Endpoint: /api/assistant
 */

const express = require('express');
const router = express.Router();
const aiAssistant = require('../services/aiAssistantService');
const webScraper = require('../services/webScraperService');

/**
 * POST /api/assistant/chat
 * Send a message to the AI assistant
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, context } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    console.log('[AI Assistant] User message:', message);

    const response = await aiAssistant.processMessage(
      message, 
      sessionId || `session_${Date.now()}`,
      context || {}
    );

    res.json({
      success: true,
      response: response.message,
      type: response.type,
      data: response.data,
      suggestions: response.suggestions || [],
      action: response.action
    });
  } catch (error) {
    console.error('[AI Assistant] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      response: "I'm having trouble with that request. Could you try rephrasing?",
      suggestions: ["Try again", "Get help"]
    });
  }
});

/**
 * POST /api/assistant/scrape
 * Scrape a company website
 */
router.post('/scrape', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    console.log('[AI Assistant] Scraping URL:', url);

    const data = await webScraper.scrapeCompanyWebsite(url);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[AI Assistant] Scrape error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/assistant/enrich
 * Enrich company data using web scraping
 */
router.post('/enrich', async (req, res) => {
  try {
    const { companyName, website } = req.body;

    if (!companyName) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required'
      });
    }

    console.log('[AI Assistant] Enriching data for:', companyName);

    const enrichedData = await webScraper.enrichCompanyData(companyName, website);

    res.json({
      success: true,
      data: enrichedData
    });
  } catch (error) {
    console.error('[AI Assistant] Enrich error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
