/**
 * Contacts Routes
 * API endpoints for Contact management and filtering
 */

const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');

/**
 * GET /api/contacts
 * Get all contacts with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const {
      name,
      job_title,
      country,
      company_name,
      linked_account_id,
      limit = 50,
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = req.query;

    const filters = {
      name,
      job_title,
      country,
      company_name,
      linked_account_id: linked_account_id ? parseInt(linked_account_id) : undefined
    };

    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      orderBy,
      orderDirection
    };

    const result = await Contact.findAll(filters, options);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts',
      message: error.message
    });
  }
});

/**
 * GET /api/contacts/stats
 * Get contact statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await Contact.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/contacts/filter-options
 * Get available filter options
 */
router.get('/filter-options', async (req, res) => {
  try {
    const options = await Contact.getFilterOptions();
    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filter options',
      message: error.message
    });
  }
});

/**
 * GET /api/contacts/by-account/:accountId
 * Get all contacts for a specific account
 */
router.get('/by-account/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const contacts = await Contact.findByAccountId(accountId);

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts',
      message: error.message
    });
  }
});

/**
 * GET /api/contacts/:id
 * Get single contact by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findById(id);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact',
      message: error.message
    });
  }
});

/**
 * POST /api/contacts
 * Create new contact
 */
router.post('/', async (req, res) => {
  try {
    const contactData = req.body;

    // Validate required fields
    if (!contactData.first_name || contactData.first_name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'first_name is required and cannot be empty'
      });
    }

    if (!contactData.last_name || contactData.last_name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'last_name is required and cannot be empty'
      });
    }

    if (!contactData.linked_account_id) {
      return res.status(400).json({
        success: false,
        error: 'linked_account_id is required - contact must be linked to an account'
      });
    }

    const contact = await Contact.create(contactData);

    res.status(201).json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Error creating contact:', error);
    
    if (error.message.includes('Invalid email format')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('Invalid linked_account_id')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create contact',
      message: error.message
    });
  }
});

/**
 * PUT /api/contacts/:id
 * Update contact
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const contactData = req.body;

    const contact = await Contact.update(id, contactData);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Error updating contact:', error);
    
    if (error.message.includes('Invalid email format') || 
        error.message.includes('Invalid linked_account_id')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update contact',
      message: error.message
    });
  }
});

/**
 * DELETE /api/contacts/:id
 * Delete contact
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.delete(id);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully',
      data: contact
    });
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete contact',
      message: error.message
    });
  }
});

module.exports = router;
