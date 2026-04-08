-- Add verification columns to contacts table
-- This helps track which contacts are real/verified vs generated

-- Data source field (where the contact came from)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS data_source VARCHAR(100);

-- Verified flag (true if from reliable source like Companies House)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;

-- Verification date
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;

-- Companies House officer ID (for UK directors)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS companies_house_id VARCHAR(100);

-- Confidence score (0-100)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 0;

-- Create index for finding verified contacts
CREATE INDEX IF NOT EXISTS idx_contacts_verified ON contacts(verified);
CREATE INDEX IF NOT EXISTS idx_contacts_data_source ON contacts(data_source);

COMMENT ON COLUMN contacts.data_source IS 'Source of contact data: companies_house, website_scrape, linkedin, manual';
COMMENT ON COLUMN contacts.verified IS 'True if contact is from a verified/reliable source';
COMMENT ON COLUMN contacts.confidence_score IS 'Confidence in data accuracy (0-100)';
