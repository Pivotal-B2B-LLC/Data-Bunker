/**
 * Deduplication Service
 * Finds and merges duplicate companies based on name, address, website, etc.
 */

const { pool, query } = require('../db/connection');

class DeduplicationService {
  /**
   * Find potential duplicate companies
   * @param {number} minConfidence - Minimum confidence score (0.0 to 1.0)
   * @returns {Array} List of potential duplicate pairs
   */
  async findDuplicates(minConfidence = 0.7) {
    try {
      console.log('🔍 Searching for duplicate companies...');

      const duplicates = [];

      // Strategy 1: Exact website match
      const websiteDuplicates = await this._findByWebsite();
      duplicates.push(...websiteDuplicates);

      // Strategy 2: Same name + same address
      const nameAddressDuplicates = await this._findByNameAndAddress();
      duplicates.push(...nameAddressDuplicates);

      // Strategy 3: Same registration number (different formats)
      const registrationDuplicates = await this._findByRegistrationNumber();
      duplicates.push(...registrationDuplicates);

      // Filter by confidence and deduplicate the list itself
      const filtered = this._deduplicateResults(duplicates, minConfidence);

      console.log(`✅ Found ${filtered.length} potential duplicate pairs`);
      return filtered;
    } catch (error) {
      console.error('❌ Error finding duplicates:', error);
      throw error;
    }
  }

  /**
   * Find duplicates by matching website
   */
  async _findByWebsite() {
    const result = await query(`
      SELECT 
        c1.id as id1,
        c1.name as name1,
        c1.website as website,
        c2.id as id2,
        c2.name as name2,
        c1.address_line_1,
        c1.locality
      FROM companies c1
      INNER JOIN companies c2 ON c1.website = c2.website
      WHERE c1.id < c2.id
        AND c1.website IS NOT NULL
        AND c1.website != ''
      ORDER BY c1.website
    `);

    return result.rows.map(row => ({
      company1_id: row.id1,
      company1_name: row.name1,
      company2_id: row.id2,
      company2_name: row.name2,
      match_reason: 'same_website',
      match_field: row.website,
      confidence: 0.95,
      address: row.address_line_1 || row.locality
    }));
  }

  /**
   * Find duplicates by matching name AND address
   */
  async _findByNameAndAddress() {
    const result = await query(`
      SELECT 
        c1.id as id1,
        c1.name as name1,
        c1.address_line_1,
        c1.locality,
        c1.postal_code,
        c2.id as id2,
        c2.name as name2
      FROM companies c1
      INNER JOIN companies c2 ON 
        LOWER(TRIM(c1.name)) = LOWER(TRIM(c2.name))
        AND LOWER(TRIM(COALESCE(c1.address_line_1, ''))) = LOWER(TRIM(COALESCE(c2.address_line_1, '')))
        AND LOWER(TRIM(COALESCE(c1.locality, ''))) = LOWER(TRIM(COALESCE(c2.locality, '')))
      WHERE c1.id < c2.id
        AND c1.name IS NOT NULL
        AND LENGTH(c1.name) > 3
        AND (c1.address_line_1 IS NOT NULL OR c1.locality IS NOT NULL)
      ORDER BY c1.name
    `);

    return result.rows.map(row => ({
      company1_id: row.id1,
      company1_name: row.name1,
      company2_id: row.id2,
      company2_name: row.name2,
      match_reason: 'same_name_and_address',
      match_field: `${row.name1} @ ${row.locality || row.address_line_1}`,
      confidence: 0.90,
      address: row.address_line_1 || row.locality
    }));
  }

  /**
   * Find duplicates by registration number (handles formatting differences)
   */
  async _findByRegistrationNumber() {
    const result = await query(`
      SELECT 
        c1.id as id1,
        c1.name as name1,
        c1.company_number as reg1,
        c2.id as id2,
        c2.name as name2,
        c2.company_number as reg2
      FROM companies c1
      INNER JOIN companies c2 ON 
        REPLACE(REPLACE(UPPER(c1.company_number), '-', ''), ' ', '') = 
        REPLACE(REPLACE(UPPER(c2.company_number), '-', ''), ' ', '')
      WHERE c1.id < c2.id
        AND c1.company_number IS NOT NULL
        AND c2.company_number IS NOT NULL
        AND LENGTH(c1.company_number) > 3
      ORDER BY c1.company_number
    `);

    return result.rows.map(row => ({
      company1_id: row.id1,
      company1_name: row.name1,
      company2_id: row.id2,
      company2_name: row.name2,
      match_reason: 'same_registration_number',
      match_field: `${row.reg1} / ${row.reg2}`,
      confidence: 1.00,
      address: null
    }));
  }

  /**
   * Remove duplicate results and filter by confidence
   */
  _deduplicateResults(duplicates, minConfidence) {
    const seen = new Set();
    const filtered = [];

    for (const dup of duplicates) {
      if (dup.confidence < minConfidence) continue;

      const key = [dup.company1_id, dup.company2_id].sort().join('-');
      if (seen.has(key)) continue;

      seen.add(key);
      filtered.push(dup);
    }

    return filtered.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Merge two companies by consolidating their data
   * @param {number} primaryId - ID of company to keep
   * @param {number} duplicateId - ID of company to merge and delete/mark inactive
   * @param {Object} options - Merge options
   * @returns {Object} Merged company data
   */
  async mergeDuplicates(primaryId, duplicateId, options = {}) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get both companies
      const primaryResult = await client.query(
        'SELECT * FROM companies WHERE id = $1',
        [primaryId]
      );
      const duplicateResult = await client.query(
        'SELECT * FROM companies WHERE id = $1',
        [duplicateId]
      );

      if (!primaryResult.rows[0] || !duplicateResult.rows[0]) {
        throw new Error('One or both companies not found');
      }

      const primary = primaryResult.rows[0];
      const duplicate = duplicateResult.rows[0];

      console.log(`🔄 Merging: "${duplicate.name}" (ID ${duplicateId}) → "${primary.name}" (ID ${primaryId})`);

      // Consolidate data - take non-null values from duplicate
      const updates = {};
      const fieldsToMerge = [
        'website', 'email', 'phone', 'linkedin_url',
        'address_line_1', 'locality', 'region', 'postal_code',
        'registration_number'
      ];

      for (const field of fieldsToMerge) {
        if (!primary[field] && duplicate[field]) {
          updates[field] = duplicate[field];
        }
      }

      // Merge enrichment data - keep best quality
      if (duplicate.last_enriched && (!primary.last_enriched || 
          new Date(duplicate.last_enriched) > new Date(primary.last_enriched))) {
        if (duplicate.enrichment_status === 'completed') {
          updates.last_enriched = duplicate.last_enriched;
          updates.enrichment_status = duplicate.enrichment_status;
        }
      }

      // Update primary company with merged data
      if (Object.keys(updates).length > 0) {
        const setClause = Object.keys(updates)
          .map((key, idx) => `${key} = $${idx + 2}`)
          .join(', ');
        
        await client.query(
          `UPDATE companies SET ${setClause}, last_enriched = NOW() WHERE id = $1`,
          [primaryId, ...Object.values(updates)]
        );

        console.log(`✅ Updated ${Object.keys(updates).length} fields on primary company`);
      }

      // Mark duplicate as merged (don't delete, keep for audit trail)
      await client.query(
        `UPDATE companies SET 
          status = 'merged',
          notes = COALESCE(notes || E'\\n', '') || $1
         WHERE id = $2`,
        [`Merged into company ID ${primaryId} on ${new Date().toISOString()}`, duplicateId]
      );

      // Log the merge in enrichment_logs
      await client.query(
        `INSERT INTO enrichment_logs (
          company_id, status, notes, processing_time_ms
        ) VALUES ($1, $2, $3, 0)`,
        [
          primaryId,
          'merged',
          `Merged duplicate company ID ${duplicateId} (${duplicate.name})`
        ]
      );

      await client.query('COMMIT');

      console.log(`✅ Successfully merged companies`);

      return {
        success: true,
        primary_id: primaryId,
        duplicate_id: duplicateId,
        fields_updated: Object.keys(updates),
        primary_company: primary.name
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Merge failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Auto-merge high-confidence duplicates
   * @param {number} minConfidence - Minimum confidence to auto-merge (default 0.95)
   * @returns {Object} Merge statistics
   */
  async autoMerge(minConfidence = 0.95) {
    try {
      console.log(`🤖 Starting auto-merge (confidence >= ${minConfidence})...`);

      const duplicates = await this.findDuplicates(minConfidence);
      const stats = {
        found: duplicates.length,
        merged: 0,
        failed: 0,
        skipped: 0
      };

      for (const dup of duplicates) {
        try {
          // Always keep the older company (lower ID) as primary
          await this.mergeDuplicates(dup.company1_id, dup.company2_id);
          stats.merged++;
        } catch (error) {
          console.error(`Failed to merge ${dup.company1_id} and ${dup.company2_id}:`, error.message);
          stats.failed++;
        }
      }

      console.log(`✅ Auto-merge complete: ${stats.merged} merged, ${stats.failed} failed`);
      return stats;

    } catch (error) {
      console.error('❌ Auto-merge error:', error);
      throw error;
    }
  }

  /**
   * Get merge preview - show what would change without actually merging
   */
  async getMergePreview(primaryId, duplicateId) {
    try {
      const primaryResult = await query(
        'SELECT * FROM companies WHERE id = $1',
        [primaryId]
      );
      const duplicateResult = await query(
        'SELECT * FROM companies WHERE id = $1',
        [duplicateId]
      );

      if (!primaryResult.rows[0] || !duplicateResult.rows[0]) {
        throw new Error('One or both companies not found');
      }

      const primary = primaryResult.rows[0];
      const duplicate = duplicateResult.rows[0];

      const fieldsToUpdate = {};
      const fieldsToMerge = [
        'website', 'email', 'phone', 'linkedin_url',
        'address_line_1', 'locality', 'region', 'postal_code',
        'registration_number'
      ];

      for (const field of fieldsToMerge) {
        if (!primary[field] && duplicate[field]) {
          fieldsToUpdate[field] = {
            current: null,
            new: duplicate[field],
            source: 'duplicate'
          };
        }
      }

      return {
        primary: {
          id: primary.id,
          name: primary.name,
          company_number: primary.company_number
        },
        duplicate: {
          id: duplicate.id,
          name: duplicate.name,
          company_number: duplicate.company_number
        },
        changes: fieldsToUpdate,
        will_update: Object.keys(fieldsToUpdate).length
      };

    } catch (error) {
      console.error('❌ Preview error:', error);
      throw error;
    }
  }
}

module.exports = new DeduplicationService();
