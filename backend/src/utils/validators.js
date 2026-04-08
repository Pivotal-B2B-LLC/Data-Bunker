/**
 * Input validation utilities
 */

const Joi = require('joi');

/**
 * Validate search query with hierarchical location filters
 * Query is optional - if not provided, will fetch all companies in the location
 */
const searchSchema = Joi.object({
  query: Joi.string().min(1).max(200).optional().allow(null, ''),
  country: Joi.string().min(2).max(100).optional().allow(null, ''),
  state: Joi.string().max(100).optional().allow(null, ''),
  city: Joi.string().max(100).optional().allow(null, ''),
  district: Joi.string().max(100).optional().allow(null, ''),
  limit: Joi.number().min(1).max(100).default(20),
  offset: Joi.number().min(0).default(0)
});

/**
 * Validate location filter
 */
const locationSchema = Joi.object({
  country: Joi.string().length(2).optional(),
  state: Joi.string().max(100).optional(),
  city: Joi.string().max(100).optional()
});

/**
 * Validate company number
 */
const companyNumberSchema = Joi.object({
  companyNumber: Joi.string().min(1).max(50).required(),
  country: Joi.string().length(2).required()
});

function validateSearch(data) {
  return searchSchema.validate(data);
}

function validateLocation(data) {
  return locationSchema.validate(data);
}

function validateCompanyNumber(data) {
  return companyNumberSchema.validate(data);
}

function validateAndRespond(schema, data, res) {
  const { error, value } = schema.validate(data);
  if (error) {
    res.status(400).json({
      error: 'Validation error',
      details: error.details[0].message
    });
    return null;
  }
  return value;
}

module.exports = {
  searchSchema,
  locationSchema,
  companyNumberSchema,
  validateSearch,
  validateLocation,
  validateCompanyNumber,
  validateAndRespond
};
