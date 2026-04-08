-- Database Schema for Data Bunker
-- Run this file to create all necessary tables

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- Companies Table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(500) NOT NULL,
    legal_name VARCHAR(500),
    jurisdiction VARCHAR(10) NOT NULL,
    company_type VARCHAR(100),
    status VARCHAR(50),
    incorporation_date DATE,
    
    -- Address components
    address_line_1 VARCHAR(500),
    address_line_2 VARCHAR(500),
    locality VARCHAR(200),
    region VARCHAR(200),
    postal_code VARCHAR(50),
    country VARCHAR(100),
    
    -- Contact information
    website VARCHAR(500),
    phone VARCHAR(50),
    email VARCHAR(200),
    
    -- Additional data
    description TEXT,
    industry VARCHAR(200),
    employee_count INTEGER,
    annual_revenue DECIMAL(20, 2),
    
    -- Metadata
    data_source VARCHAR(50),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Full text search
    search_vector tsvector
);

-- Officers/Directors Table
CREATE TABLE IF NOT EXISTS officers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(300) NOT NULL,
    role VARCHAR(100),
    appointed_date DATE,
    resigned_date DATE,
    nationality VARCHAR(100),
    date_of_birth DATE,
    occupation VARCHAR(200),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Company Contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    contact_type VARCHAR(50),
    value VARCHAR(500) NOT NULL,
    label VARCHAR(100),
    verified BOOLEAN DEFAULT FALSE,
    source VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, contact_type, value)
);

-- Web Tracking History
CREATE TABLE IF NOT EXISTS tracking_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    url VARCHAR(1000) NOT NULL,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_found JSONB,
    status VARCHAR(50),
    error_message TEXT
);

-- Search Logs
CREATE TABLE IF NOT EXISTS search_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    search_query VARCHAR(500),
    filters JSONB,
    results_count INTEGER,
    user_session VARCHAR(100),
    searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_number ON companies(company_number);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_jurisdiction ON companies(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_companies_locality ON companies(locality);
CREATE INDEX IF NOT EXISTS idx_companies_region ON companies(region);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON companies USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_search ON companies USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_officers_company ON officers(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_tracking_company ON tracking_history(company_id);

-- Function to update search vector
CREATE OR REPLACE FUNCTION update_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.legal_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.industry, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.locality, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.region, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tsvector_update ON companies;
CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE
ON companies FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- View for companies with contacts
CREATE OR REPLACE VIEW companies_with_contacts AS
SELECT 
    c.*,
    COALESCE(
        json_agg(
            json_build_object(
                'type', ct.contact_type,
                'value', ct.value,
                'label', ct.label,
                'verified', ct.verified
            )
        ) FILTER (WHERE ct.id IS NOT NULL),
        '[]'
    ) as contacts
FROM companies c
LEFT JOIN contacts ct ON c.id = ct.company_id
GROUP BY c.id;
