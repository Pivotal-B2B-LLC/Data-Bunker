-- Data-Bunker Global Business Database Schema
-- PostgreSQL 12+
-- This script creates the complete hierarchical database structure
-- for managing companies, contacts, and locations globally

-- ============================================================
-- 1. GEOGRAPHIC HIERARCHY TABLES
-- ============================================================

-- Countries table - Base of the geographic hierarchy
CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  code VARCHAR(2) UNIQUE NOT NULL COMMENT 'ISO 3166-1 alpha-2 code',
  name VARCHAR(100) NOT NULL,
  region VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_countries_code ON countries(code);
CREATE INDEX idx_countries_name ON countries(name);

-- States/Provinces - Level 2 of hierarchy
CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  code VARCHAR(10),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_states_country_id ON states(country_id);
CREATE INDEX idx_states_code ON states(code);
CREATE UNIQUE INDEX idx_states_unique ON states(country_id, code);

-- Cities - Level 3 of hierarchy
CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  population INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cities_state_id ON cities(state_id);
CREATE INDEX idx_cities_name ON cities(name);

-- Districts - Level 4 of hierarchy (sub-city level)
CREATE TABLE IF NOT EXISTS districts (
  id SERIAL PRIMARY KEY,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  zip_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_districts_city_id ON districts(city_id);
CREATE UNIQUE INDEX idx_districts_unique ON districts(city_id, name);

-- ============================================================
-- 2. COMPANY CORE DATA TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  
  -- Identifiers (must have at least one per country)
  registration_number VARCHAR(50) NOT NULL COMMENT 'Primary registration number in home country',
  company_number VARCHAR(100) UNIQUE,
  
  -- Basic Company Information
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  description TEXT,
  
  -- Location Hierarchy (at least country is required)
  country_id INTEGER NOT NULL REFERENCES countries(id),
  state_id INTEGER REFERENCES states(id),
  city_id INTEGER REFERENCES cities(id),
  district_id INTEGER REFERENCES districts(id),
  
  -- Address Details
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  postal_code VARCHAR(20),
  coordinates_lat DECIMAL(10, 8),
  coordinates_lon DECIMAL(11, 8),
  
  -- Business Classification
  industry VARCHAR(100),
  industry_category VARCHAR(50),
  sub_industry VARCHAR(100),
  sic_code VARCHAR(10) COMMENT 'Standard Industrial Classification',
  nace_code VARCHAR(10) COMMENT 'Statistical classification of economic activities',
  company_size VARCHAR(50) COMMENT 'Employee range: 1-10, 11-50, 51-200, etc',
  
  -- Company Status
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active, inactive, dissolved, dormant, liquidating',
  status_updated_at TIMESTAMP,
  
  -- Important Dates
  created_date DATE COMMENT 'When company was founded/registered',
  incorporation_date DATE,
  dissolution_date DATE,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Data Quality Metrics
  data_quality_score DECIMAL(3, 2) COMMENT '0.00 to 1.00 score',
  verification_status VARCHAR(20) DEFAULT 'unverified' COMMENT 'verified, unverified, needs_update',
  last_verified TIMESTAMP,
  
  -- Web Properties
  website VARCHAR(255),
  linkedin_url VARCHAR(255),
  crunchbase_url VARCHAR(255),
  twitter_handle VARCHAR(100),
  
  -- Financial Information (optional)
  annual_revenue BIGINT COMMENT 'Last known annual revenue in base currency',
  employee_count INTEGER,
  
  -- Source Tracking
  primary_data_source VARCHAR(50) COMMENT 'companies_house, opencorporates, clearbit, crunchbase, etc',
  source_urls TEXT[] COMMENT 'Array of URLs where data came from',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_company UNIQUE(country_id, registration_number)
);

CREATE INDEX idx_companies_country_state_city ON companies(country_id, state_id, city_id);
CREATE INDEX idx_companies_status ON companies(status);
CREATE INDEX idx_companies_created_date ON companies(created_date);
CREATE INDEX idx_companies_industry ON companies(industry);
CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_companies_registration ON companies(registration_number);

-- ============================================================
-- 3. CONTACT DATA TABLES
-- ============================================================

-- Main contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Contact Information
  email VARCHAR(255),
  phone VARCHAR(20),
  phone_formatted VARCHAR(20) COMMENT 'Standardized phone number',
  linkedin_profile_url VARCHAR(500),
  linkedin_profile_id VARCHAR(100),
  
  -- Personal Details
  contact_name VARCHAR(200),
  job_title VARCHAR(200),
  department VARCHAR(100),
  contact_type VARCHAR(50) DEFAULT 'general' COMMENT 'general, sales, hr, cto, ceo, legal, founder, investor',
  
  -- Validation Status
  email_verified BOOLEAN DEFAULT false,
  email_valid_status VARCHAR(20) COMMENT 'valid, invalid, unverified, bounce, role_account, disposable',
  phone_verified BOOLEAN DEFAULT false,
  phone_valid_status VARCHAR(20) COMMENT 'valid, invalid, unverified',
  verification_date TIMESTAMP,
  
  -- Data Source
  source VARCHAR(50) COMMENT 'clearbit, crunchbase, linkedin, company_website, hunter, manual',
  confidence_score DECIMAL(3, 2) COMMENT '0.00 to 1.00 confidence score',
  is_primary BOOLEAN DEFAULT false COMMENT 'Primary contact for company',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_contacts_company_id ON contacts(company_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_contact_type ON contacts(contact_type);
CREATE INDEX idx_contacts_is_primary ON contacts(is_primary);

-- ============================================================
-- 4. AUDIT & TRACKING TABLES
-- ============================================================

-- Company history - tracks all changes to company records
CREATE TABLE IF NOT EXISTS company_history (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Change tracking
  field_changed VARCHAR(50),
  old_value TEXT,
  new_value TEXT,
  
  -- Change metadata
  source VARCHAR(50),
  change_reason VARCHAR(255),
  changed_by VARCHAR(100),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_company_history_company_id ON company_history(company_id);
CREATE INDEX idx_company_history_created_at ON company_history(created_at);

-- Data source tracking - which sources contributed to each company
CREATE TABLE IF NOT EXISTS data_sources (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  -- Source identification
  source_name VARCHAR(100) COMMENT 'companies_house, opencorporates, clearbit, crunchbase, linkedin',
  source_entity_id VARCHAR(255) COMMENT 'ID in the source system',
  source_url VARCHAR(500),
  
  -- Tracking
  last_fetched TIMESTAMP,
  last_updated TIMESTAMP,
  is_primary BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(company_id, source_name)
);

CREATE INDEX idx_data_sources_company_id ON data_sources(company_id);
CREATE INDEX idx_data_sources_source_name ON data_sources(source_name);

-- Update log - all API operations and data loads
CREATE TABLE IF NOT EXISTS update_log (
  id SERIAL PRIMARY KEY,
  
  -- Operation type
  operation_type VARCHAR(50) COMMENT 'insert, update, delete, scrape, validate, merge',
  entity_type VARCHAR(50) COMMENT 'company, contact, location',
  entity_id INTEGER,
  
  -- Source and status
  data_source VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending, success, failed, partial',
  error_message TEXT,
  
  -- Metrics
  records_processed INTEGER DEFAULT 0,
  records_succeeded INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  execution_time_ms INTEGER,
  
  -- User/system tracking
  triggered_by VARCHAR(100) COMMENT 'system, api_key, user_id',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_update_log_status ON update_log(status);
CREATE INDEX idx_update_log_created_at ON update_log(created_at);
CREATE INDEX idx_update_log_data_source ON update_log(data_source);

-- ============================================================
-- 5. VALIDATION TABLES
-- ============================================================

-- Contact validation details
CREATE TABLE IF NOT EXISTS contact_validations (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  
  -- Email validation
  email_status VARCHAR(20) COMMENT 'valid, invalid, disposable, role, catch_all, smtp_check_failed',
  email_validation_date TIMESTAMP,
  email_validation_source VARCHAR(50) COMMENT 'hunter, clearbit, neverbounce, zoominfo',
  email_last_check TIMESTAMP,
  
  -- Phone validation
  phone_status VARCHAR(20) COMMENT 'valid, invalid, unverified, mobile, landline',
  phone_validation_date TIMESTAMP,
  phone_validation_source VARCHAR(50),
  phone_last_check TIMESTAMP,
  
  -- LinkedIn validation
  linkedin_profile_valid BOOLEAN,
  linkedin_last_check TIMESTAMP,
  
  -- Confidence scores
  validation_confidence DECIMAL(3, 2),
  next_validation_date TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_contact_validations_contact_id ON contact_validations(contact_id);
CREATE INDEX idx_contact_validations_email_status ON contact_validations(email_status);
CREATE INDEX idx_contact_validations_phone_status ON contact_validations(phone_status);

-- ============================================================
-- 6. DEDUPLICATION & MERGE TRACKING
-- ============================================================

-- Track merged/duplicate companies
CREATE TABLE IF NOT EXISTS company_duplicates (
  id SERIAL PRIMARY KEY,
  
  company_id_primary INTEGER NOT NULL REFERENCES companies(id),
  company_id_duplicate INTEGER NOT NULL REFERENCES companies(id),
  
  -- Match quality
  match_confidence DECIMAL(3, 2) COMMENT '0.00 to 1.00',
  match_reason VARCHAR(255) COMMENT 'Same registration number, name similarity, etc',
  
  -- Merge status
  status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending, confirmed, merged, rejected',
  merged_at TIMESTAMP,
  merged_by VARCHAR(100),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_company_duplicates_primary ON company_duplicates(company_id_primary);
CREATE INDEX idx_company_duplicates_status ON company_duplicates(status);

-- ============================================================
-- 7. CACHE & PERFORMANCE TABLES (Optional)
-- ============================================================

-- Cache frequently accessed queries
CREATE TABLE IF NOT EXISTS query_cache (
  id SERIAL PRIMARY KEY,
  
  -- Cache key and value
  cache_key VARCHAR(255) UNIQUE NOT NULL COMMENT 'Hash of query and params',
  query_type VARCHAR(50),
  cached_data JSON,
  
  -- Expiration
  expires_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_query_cache_expires_at ON query_cache(expires_at);

-- ============================================================
-- 8. SYSTEM CONFIGURATION TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value TEXT,
  config_type VARCHAR(20) COMMENT 'string, integer, boolean, json',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================

-- Comprehensive company view with full location hierarchy
CREATE OR REPLACE VIEW vw_companies_with_locations AS
SELECT 
  c.id,
  c.name,
  c.registration_number,
  c.status,
  c.created_date,
  c.industry,
  c.website,
  c.linkedin_url,
  c.employee_count,
  c.data_quality_score,
  
  -- Location hierarchy
  co.code AS country_code,
  co.name AS country_name,
  s.code AS state_code,
  s.name AS state_name,
  ci.name AS city_name,
  d.name AS district_name,
  
  -- Address
  c.address_line_1,
  c.postal_code,
  
  -- Coordinates
  c.coordinates_lat,
  c.coordinates_lon
FROM companies c
JOIN countries co ON c.country_id = co.id
LEFT JOIN states s ON c.state_id = s.id
LEFT JOIN cities ci ON c.city_id = ci.id
LEFT JOIN districts d ON c.district_id = d.id;

-- Company contacts summary
CREATE OR REPLACE VIEW vw_company_contacts_summary AS
SELECT 
  company_id,
  COUNT(*) AS total_contacts,
  COUNT(CASE WHEN is_primary = true THEN 1 END) AS primary_contacts,
  COUNT(CASE WHEN email_verified = true THEN 1 END) AS verified_emails,
  COUNT(CASE WHEN phone_verified = true THEN 1 END) AS verified_phones,
  COUNT(CASE WHEN linkedin_profile_url IS NOT NULL THEN 1 END) AS linkedin_profiles
FROM contacts
GROUP BY company_id;

-- Recent update activity
CREATE OR REPLACE VIEW vw_recent_updates AS
SELECT 
  ul.id,
  ul.operation_type,
  ul.entity_type,
  ul.data_source,
  ul.status,
  ul.records_succeeded,
  ul.records_failed,
  ul.execution_time_ms,
  ul.created_at
FROM update_log ul
ORDER BY ul.created_at DESC
LIMIT 100;

-- Companies needing verification
CREATE OR REPLACE VIEW vw_companies_needing_verification AS
SELECT 
  c.id,
  c.name,
  c.registration_number,
  c.country_id,
  c.verification_status,
  c.last_verified,
  DATEDIFF(NOW(), c.last_verified) AS days_since_verified
FROM companies c
WHERE c.verification_status = 'needs_update'
  OR c.last_verified IS NULL
  OR DATEDIFF(NOW(), c.last_verified) > 30;

-- ============================================================
-- INITIAL DATA LOAD (Optional)
-- ============================================================

-- Load countries
INSERT INTO countries (code, name, region) VALUES
('GB', 'United Kingdom', 'Europe'),
('US', 'United States', 'North America'),
('DE', 'Germany', 'Europe'),
('FR', 'France', 'Europe'),
('CA', 'Canada', 'North America'),
('AU', 'Australia', 'Oceania'),
('IN', 'India', 'Asia'),
('JP', 'Japan', 'Asia'),
('SG', 'Singapore', 'Asia'),
('AE', 'United Arab Emirates', 'Middle East')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- GRANTS & PERMISSIONS (Customize as needed)
-- ============================================================

-- Create application user (uncomment and modify as needed)
-- CREATE USER app_user WITH PASSWORD 'secure_password';
-- GRANT CONNECT ON DATABASE data_bunker TO app_user;
-- GRANT USAGE ON SCHEMA public TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
