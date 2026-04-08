-- Migration 009: Discovery Queue
-- Persistent queue of every populated place for exhaustive automated discovery.
-- Status: pending -> in_progress -> completed | failed | skipped
-- Safe to re-run: all statements use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS discovery_queue (
  queue_id         SERIAL          PRIMARY KEY,
  country          VARCHAR(100)    NOT NULL,
  country_code     VARCHAR(10),
  state_region     VARCHAR(100)    NOT NULL,
  state_code       VARCHAR(20),
  city             VARCHAR(200)    NOT NULL,
  place_type       VARCHAR(50),
    -- city | town | village | suburb | hamlet | locality | neighbourhood
  population       INTEGER         DEFAULT 0,
  latitude         DECIMAL(10,7),
  longitude        DECIMAL(11,7),
  priority         INTEGER         DEFAULT 5,
    -- 1 = large city (pop>100k)   highest priority, processed first
    -- 2 = city / big town (>10k)
    -- 3 = town / village
    -- 4 = suburb / neighbourhood
    -- 5 = hamlet / locality        lowest priority, processed last
  status           VARCHAR(20)     DEFAULT 'pending',
    -- pending | in_progress | completed | failed | skipped
  companies_found  INTEGER         DEFAULT 0,
  started_at       TIMESTAMP,
  completed_at     TIMESTAMP,
  error_message    TEXT,
  CONSTRAINT unique_queue_area UNIQUE (country_code, state_code, city)
);

-- Hot-path index: claim next pending location (priority ASC, large cities first)
CREATE INDEX IF NOT EXISTS idx_dq_status_priority
  ON discovery_queue (status, priority ASC, population DESC);

-- Country/state drill-down index (used by the progress API)
CREATE INDEX IF NOT EXISTS idx_dq_country_state
  ON discovery_queue (country_code, state_code);

CREATE INDEX IF NOT EXISTS idx_dq_status
  ON discovery_queue (status);
