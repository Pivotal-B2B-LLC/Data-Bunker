CREATE TABLE IF NOT EXISTS accounts (
    account_id SERIAL PRIMARY KEY,
    company_name VARCHAR(500) NOT NULL,
    industry VARCHAR(200),
    company_size VARCHAR(100),
    country VARCHAR(100),
    state_region VARCHAR(200),
    city VARCHAR(200),
    address TEXT,
    website VARCHAR(500),
    phone_number VARCHAR(50),
    email_format VARCHAR(200),
    revenue VARCHAR(100),
    linkedin_url VARCHAR(500),
    company_category VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
    contact_id SERIAL PRIMARY KEY,
    first_name VARCHAR(200) NOT NULL,
    last_name VARCHAR(200) NOT NULL,
    job_title VARCHAR(300),
    email VARCHAR(300),
    phone_number VARCHAR(50),
    country VARCHAR(100),
    city VARCHAR(200),
    linked_account_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_account FOREIGN KEY (linked_account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX idx_accounts_country ON accounts(country);
CREATE INDEX idx_accounts_state_region ON accounts(state_region);
CREATE INDEX idx_accounts_industry ON accounts(industry);
CREATE INDEX idx_contacts_linked_account ON contacts(linked_account_id);
CREATE INDEX idx_contacts_job_title ON contacts(job_title);

INSERT INTO accounts (company_name, country, state_region, address, website, phone_number, created_at)
SELECT company_name,
       CASE WHEN jurisdiction = 'gb' THEN 'United Kingdom' WHEN jurisdiction LIKE 'us_%' THEN 'United States' END,
       CASE WHEN jurisdiction = 'us_ny' THEN 'New York' WHEN jurisdiction = 'us_ca' THEN 'California' END,
       address_line_1, website, phone, incorporation_date
FROM companies WHERE company_name IS NOT NULL
ON CONFLICT DO NOTHING;
