-- Add district/village/area column to accounts table
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS district VARCHAR(200);

-- Create index for district queries
CREATE INDEX IF NOT EXISTS idx_accounts_district ON accounts(district);
CREATE INDEX IF NOT EXISTS idx_accounts_city_district ON accounts(city, district);
