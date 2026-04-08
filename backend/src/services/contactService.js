/**
 * Contact Database Service
 * Handles all CRUD operations for company contacts
 */

const { query, transaction } = require('../db/connection');

class ContactService {
  /**
   * Create a new contact for a company
   */
  static async createContact(data) {
    const {
      companyId,
      email = null,
      phone = null,
      linkedinProfileUrl = null,
      contactName = null,
      jobTitle = null,
      department = null,
      contactType = 'general',
      source = 'manual',
      confidenceScore = 0.5,
      isPrimary = false,
    } = data;

    try {
      const result = await query(
        `INSERT INTO contacts (
          company_id, email, phone, linkedin_profile_url, 
          contact_name, job_title, department, contact_type,
          source, confidence_score, is_primary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          companyId, email, phone, linkedinProfileUrl,
          contactName, jobTitle, department, contactType,
          source, confidenceScore, isPrimary,
        ]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  /**
   * Get all contacts for a company
   */
  static async getContactsByCompanyId(companyId) {
    try {
      const result = await query(
        `SELECT c.*, 
                cv.email_status, cv.phone_status, cv.email_verified,
                cv.phone_verified, cv.validation_confidence
         FROM contacts c
         LEFT JOIN contact_validations cv ON c.id = cv.contact_id
         WHERE c.company_id = $1
         ORDER BY c.is_primary DESC, c.confidence_score DESC`,
        [companyId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting contacts:', error);
      throw error;
    }
  }

  /**
   * Get primary contact for a company
   */
  static async getPrimaryContact(companyId) {
    try {
      const result = await query(
        `SELECT * FROM contacts 
         WHERE company_id = $1 AND is_primary = true
         LIMIT 1`,
        [companyId]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting primary contact:', error);
      throw error;
    }
  }

  /**
   * Update contact information
   */
  static async updateContact(id, updates) {
    try {
      const fields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && value !== null) {
          const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          fields.push(`${dbKey} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      fields.push('updated_at = NOW()');
      values.push(id);

      const result = await query(
        `UPDATE contacts SET ${fields.join(', ')} 
         WHERE id = $${paramCount} 
         RETURNING *`,
        values
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error updating contact:', error);
      throw error;
    }
  }

  /**
   * Set primary contact for a company
   */
  static async setPrimaryContact(companyId, contactId) {
    try {
      return await transaction(async (client) => {
        // Remove primary flag from other contacts
        await client.query(
          'UPDATE contacts SET is_primary = false WHERE company_id = $1',
          [companyId]
        );

        // Set this contact as primary
        const result = await client.query(
          'UPDATE contacts SET is_primary = true WHERE id = $1 AND company_id = $2 RETURNING *',
          [contactId, companyId]
        );

        return result.rows[0];
      });
    } catch (error) {
      console.error('Error setting primary contact:', error);
      throw error;
    }
  }

  /**
   * Search contacts by email
   */
  static async findByEmail(email) {
    try {
      const result = await query(
        `SELECT c.*, cm.name as company_name
         FROM contacts c
         JOIN companies cm ON c.company_id = cm.id
         WHERE c.email = $1`,
        [email]
      );

      return result.rows;
    } catch (error) {
      console.error('Error finding contact by email:', error);
      throw error;
    }
  }

  /**
   * Search contacts by phone
   */
  static async findByPhone(phone) {
    try {
      const result = await query(
        `SELECT c.*, cm.name as company_name
         FROM contacts c
         JOIN companies cm ON c.company_id = cm.id
         WHERE c.phone = $1 OR c.phone_formatted = $1`,
        [phone]
      );

      return result.rows;
    } catch (error) {
      console.error('Error finding contact by phone:', error);
      throw error;
    }
  }

  /**
   * Get verified contacts (email or phone verified)
   */
  static async getVerifiedContacts(companyId) {
    try {
      const result = await query(
        `SELECT c.* FROM contacts c
         WHERE c.company_id = $1 
         AND (c.email_verified = true OR c.phone_verified = true)
         ORDER BY c.confidence_score DESC`,
        [companyId]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting verified contacts:', error);
      throw error;
    }
  }

  /**
   * Get contacts by type (sales, hr, cto, etc)
   */
  static async getContactsByType(companyId, contactType) {
    try {
      const result = await query(
        `SELECT * FROM contacts 
         WHERE company_id = $1 AND contact_type = $2
         ORDER BY confidence_score DESC`,
        [companyId, contactType]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting contacts by type:', error);
      throw error;
    }
  }

  /**
   * Get contacts by source (clearbit, linkedin, etc)
   */
  static async getContactsBySource(companyId, source) {
    try {
      const result = await query(
        `SELECT * FROM contacts 
         WHERE company_id = $1 AND source = $2
         ORDER BY created_at DESC`,
        [companyId, source]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting contacts by source:', error);
      throw error;
    }
  }

  /**
   * Check if email exists for company
   */
  static async emailExists(companyId, email) {
    try {
      const result = await query(
        'SELECT COUNT(*) as count FROM contacts WHERE company_id = $1 AND email = $2',
        [companyId, email]
      );

      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      console.error('Error checking email existence:', error);
      throw error;
    }
  }

  /**
   * Delete contact
   */
  static async deleteContact(id) {
    try {
      const result = await query(
        'DELETE FROM contacts WHERE id = $1 RETURNING id',
        [id]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error deleting contact:', error);
      throw error;
    }
  }

  /**
   * Get contacts needing verification
   */
  static async getContactsNeedingVerification(limit = 100) {
    try {
      const result = await query(
        `SELECT c.id, c.email, c.phone, c.company_id, cm.name as company_name
         FROM contacts c
         JOIN companies cm ON c.company_id = cm.id
         WHERE (c.email IS NOT NULL AND c.email_verified = false)
         OR (c.phone IS NOT NULL AND c.phone_verified = false)
         ORDER BY c.created_at ASC
         LIMIT $1`,
        [limit]
      );

      return result.rows;
    } catch (error) {
      console.error('Error getting contacts needing verification:', error);
      throw error;
    }
  }

  /**
   * Validate contact email
   */
  static async validateEmail(contactId, isValid, validationSource) {
    try {
      return await transaction(async (client) => {
        // Update contact verification status
        await client.query(
          `UPDATE contacts 
           SET email_verified = $1, email_valid_status = $2, verification_date = NOW()
           WHERE id = $3`,
          [isValid, isValid ? 'valid' : 'invalid', contactId]
        );

        // Update contact validations table
        const result = await client.query(
          `INSERT INTO contact_validations (contact_id, email_status, email_validation_source, email_last_check)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (contact_id) DO UPDATE SET
           email_status = EXCLUDED.email_status,
           email_validation_source = EXCLUDED.email_validation_source,
           email_last_check = NOW()
           RETURNING *`,
          [contactId, isValid ? 'valid' : 'invalid', validationSource]
        );

        return result.rows[0];
      });
    } catch (error) {
      console.error('Error validating email:', error);
      throw error;
    }
  }

  /**
   * Validate contact phone
   */
  static async validatePhone(contactId, isValid, validationSource) {
    try {
      return await transaction(async (client) => {
        // Update contact verification status
        await client.query(
          `UPDATE contacts 
           SET phone_verified = $1, phone_valid_status = $2, verification_date = NOW()
           WHERE id = $3`,
          [isValid, isValid ? 'valid' : 'invalid', contactId]
        );

        // Update contact validations table
        const result = await client.query(
          `INSERT INTO contact_validations (contact_id, phone_status, phone_validation_source, phone_last_check)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (contact_id) DO UPDATE SET
           phone_status = EXCLUDED.phone_status,
           phone_validation_source = EXCLUDED.phone_validation_source,
           phone_last_check = NOW()
           RETURNING *`,
          [contactId, isValid ? 'valid' : 'invalid', validationSource]
        );

        return result.rows[0];
      });
    } catch (error) {
      console.error('Error validating phone:', error);
      throw error;
    }
  }

  /**
   * Get contacts summary for company
   */
  static async getContactsSummary(companyId) {
    try {
      const result = await query(
        `SELECT 
          COUNT(*) as total_contacts,
          COUNT(CASE WHEN email_verified = true THEN 1 END) as verified_emails,
          COUNT(CASE WHEN phone_verified = true THEN 1 END) as verified_phones,
          COUNT(CASE WHEN linkedin_profile_url IS NOT NULL THEN 1 END) as linkedin_profiles,
          AVG(confidence_score) as avg_confidence
         FROM contacts 
         WHERE company_id = $1`,
        [companyId]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error getting contacts summary:', error);
      throw error;
    }
  }
}

module.exports = ContactService;
