#!/usr/bin/env python3
"""
Import UK Companies into Database
Handles CSV parsing and batch inserts
"""

import csv
import psycopg2
from psycopg2.extras import execute_batch
from datetime import datetime
import sys

# Database connection
DB_CONFIG = {
    'dbname': 'databunker',
    'user': 'postgres',
    'password': 'postgres',
    'host': 'localhost',
    'port': 5432
}

CSV_FILE = 'bulk-data/filtered/active.csv'
BATCH_SIZE = 5000

def parse_date(date_str):
    """Parse UK date format DD/MM/YYYY"""
    if not date_str or date_str.strip() == '':
        return None
    try:
        return datetime.strptime(date_str.strip(), '%d/%m/%Y').date()
    except:
        return None

def clean_field(value):
    """Clean and trim field value"""
    if value is None:
        return None
    cleaned = value.strip().strip('"').strip()
    return cleaned if cleaned else None

def normalize_country(country):
    """Normalize country names"""
    if not country:
        return None
    country_lower = country.lower()
    if country_lower == 'england':
        return 'England'
    elif country_lower == 'wales':
        return 'Wales'
    elif country_lower == 'scotland':
        return 'Scotland'
    elif country_lower == 'northern ireland':
        return 'Northern Ireland'
    return country

def import_companies():
    """Import companies from CSV to database"""
    
    print("\n╔" + "═" * 64 + "╗")
    print("║" + "  UK COMPANIES IMPORT".center(64) + "║")
    print("╚" + "═" * 64 + "╝\n")
    
    # Connect to database
    print("🔌 Connecting to database...")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        print("✅ Connected\n")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)
    
    # Count existing companies
    cur.execute("SELECT COUNT(*) FROM companies WHERE jurisdiction = 'gb'")
    existing_count = cur.fetchone()[0]
    print(f"📊 Existing UK companies: {existing_count:,}\n")
    
    # Prepare insert query
    insert_query = """
        INSERT INTO companies (
            company_number, name, legal_name, jurisdiction,
            company_type, status, incorporation_date,
            address_line_1, address_line_2, locality, region,
            postal_code, country, industry, data_source,
            last_updated, created_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (company_number) DO UPDATE SET
            name = EXCLUDED.name,
            legal_name = EXCLUDED.legal_name,
            company_type = EXCLUDED.company_type,
            status = EXCLUDED.status,
            incorporation_date = EXCLUDED.incorporation_date,
            address_line_1 = EXCLUDED.address_line_1,
            address_line_2 = EXCLUDED.address_line_2,
            locality = EXCLUDED.locality,
            region = EXCLUDED.region,
            postal_code = EXCLUDED.postal_code,
            country = EXCLUDED.country,
            industry = EXCLUDED.industry,
            last_updated = CURRENT_TIMESTAMP
    """
    
    # Read and import CSV
    print(f"📖 Reading {CSV_FILE}...")
    imported = 0
    skipped = 0
    batch = []
    
    try:
        with open(CSV_FILE, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                try:
                    company_number = clean_field(row.get('CompanyNumber') or row.get(' CompanyNumber'))
                    company_name = clean_field(row.get('CompanyName'))
                    status = clean_field(row.get('CompanyStatus'))
                    
                    # Skip if no company number or not active
                    if not company_number or status != 'Active':
                        skipped += 1
                        continue
                    
                    # Prepare data tuple
                    data = (
                        company_number,
                        company_name or '',
                        company_name or '',
                        'gb',
                        clean_field(row.get('CompanyCategory')),
                        status,
                        parse_date(row.get('IncorporationDate')),
                        clean_field(row.get('RegAddress.AddressLine1') or row.get(' RegAddress.AddressLine1')),
                        clean_field(row.get('RegAddress.AddressLine2') or row.get(' RegAddress.AddressLine2')),
                        clean_field(row.get('RegAddress.PostTown')),
                        clean_field(row.get('RegAddress.County')),
                        clean_field(row.get('RegAddress.PostCode')),
                        normalize_country(clean_field(row.get('RegAddress.Country'))),
                        clean_field(row.get('SICCode.SicText_1')),
                        'companies_house_bulk',
                        datetime.now(),
                        datetime.now()
                    )
                    
                    batch.append(data)
                    
                    # Execute batch
                    if len(batch) >= BATCH_SIZE:
                        execute_batch(cur, insert_query, batch)
                        conn.commit()
                        imported += len(batch)
                        print(f"✅ Imported: {imported:,} companies (skipped: {skipped:,})", end='\r')
                        batch = []
                
                except Exception as e:
                    print(f"\n⚠️  Error processing row: {e}")
                    skipped += 1
                    continue
            
            # Insert remaining batch
            if batch:
                execute_batch(cur, insert_query, batch)
                conn.commit()
                imported += len(batch)
        
        print(f"\n\n✅ Import Complete!")
        print(f"   - Imported: {imported:,}")
        print(f"   - Skipped: {skipped:,}")
        
        # Final count
        cur.execute("SELECT COUNT(*) FROM companies WHERE jurisdiction = 'gb'")
        final_count = cur.fetchone()[0]
        print(f"   - Total UK companies: {final_count:,}\n")
        
    except Exception as e:
        print(f"\n❌ Import failed: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    import_companies()
