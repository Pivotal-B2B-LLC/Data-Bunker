-- Add verification and API source fields to accounts table
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS rating DECIMAL(2,1);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS total_ratings INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS place_id VARCHAR(500);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_source VARCHAR(100);

-- Create indexes for verified companies
CREATE INDEX IF NOT EXISTS idx_accounts_verified ON accounts(verified);
CREATE INDEX IF NOT EXISTS idx_accounts_data_source ON accounts(data_source);
CREATE INDEX IF NOT EXISTS idx_accounts_place_id ON accounts(place_id);

-- Add unique constraint to prevent duplicate companies
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unique_company
ON accounts(company_name, city, state_region)
WHERE company_name IS NOT NULL;
