-- Add ward/parish/hamlet and address columns to accounts table
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ward VARCHAR(200);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address VARCHAR(500);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS headquarters_address TEXT;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_accounts_ward ON accounts(ward);
CREATE INDEX IF NOT EXISTS idx_accounts_city_district_ward ON accounts(city, district, ward);

-- Update discovery_progress table to include ward if it exists
ALTER TABLE discovery_progress ADD COLUMN IF NOT EXISTS ward VARCHAR(200);
