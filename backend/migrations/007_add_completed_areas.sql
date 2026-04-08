-- Migration: Add completed_areas table for tracking searched areas
-- This tracks which areas have been fully searched so no company is missed

CREATE TABLE IF NOT EXISTS completed_areas (
    area_id SERIAL PRIMARY KEY,
    country VARCHAR(100) NOT NULL,
    state_region VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    district VARCHAR(100),
    postcode VARCHAR(20),

    -- Discovery stats
    companies_found INTEGER DEFAULT 0,
    contacts_created INTEGER DEFAULT 0,

    -- Discovery metadata
    discovery_date TIMESTAMP DEFAULT NOW(),
    discovery_duration_seconds INTEGER,
    sources_used TEXT[],

    -- Status
    status VARCHAR(20) DEFAULT 'completed',  -- completed, partial, in_progress
    coverage_percent INTEGER DEFAULT 100,

    -- Prevent duplicate area entries
    CONSTRAINT unique_area UNIQUE(country, state_region, city, district, postcode)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_completed_areas_location ON completed_areas(country, state_region, city);
CREATE INDEX IF NOT EXISTS idx_completed_areas_status ON completed_areas(status);
CREATE INDEX IF NOT EXISTS idx_completed_areas_date ON completed_areas(discovery_date DESC);

-- Add comments
COMMENT ON TABLE completed_areas IS 'Tracks areas that have been fully searched for companies';
COMMENT ON COLUMN completed_areas.coverage_percent IS 'Estimated coverage of the area (100 = fully searched)';
COMMENT ON COLUMN completed_areas.sources_used IS 'Array of data sources used for discovery';
