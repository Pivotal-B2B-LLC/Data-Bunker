# Enrichment Workflow (Local, Public Web Only)

## Schema and Indexes
- Required columns: website (TEXT), phone (TEXT), email (TEXT), linkedin (TEXT), industry (TEXT), last_enriched (TIMESTAMP), plus twitter/facebook optional extras already used by the service.
- Required indexes: name, company_number (registration_number equivalent), website, last_enriched, enrichment_status.
- Apply the migration: `psql "$DATABASE_URL" -f backend/migrations/003_enrichment_schema.sql`.
- If running manually, ensure `companies_needing_enrichment` view, `enrichment_logs`, and `enrichment_queue` exist for queue-based processing.

## Enrichment Flow
1. **Select targets**: rows from `companies_needing_enrichment` (never enriched, stale >90d, or failed with attempts <3).
2. **Website discovery**: search the public web (company name + location) and pick domains matching company tokens, ignoring aggregators/social sites.
3. **Polite scraping**: check `robots.txt`; skip if disallowed. Fetch main page and a discovered contact page (e.g., /contact, /contact-us).
4. **Extraction**: phones, generic emails (info/contact/support/sales), LinkedIn/Twitter/Facebook links, light industry inference from meta descriptions.
5. **Validation**: prefer emails on the same domain or generic mailboxes; prefer the longest phone number.
6. **Update rules**: only fill empty company fields; do not overwrite existing non-null values. Always bump `last_enriched` and `enrichment_attempts`; status becomes `success`, `partial`, or `no_data`.
7. **Logging**: insert into `enrichment_logs` with fields updated, sources used, and processing time. Failures set `enrichment_status = 'failed'` and persist the error.

## Running Enrichment (local DB)
- **Single company**: `POST /api/enrichment/enrich/:companyId`.
- **Batch on demand**: `POST /api/enrichment/batch { "limit": 10 }` (pulls from `companies_needing_enrichment`).
- **Queue specific IDs**: `POST /api/enrichment/queue { "companyIds": ["..."], "priority": 1 }` then `POST /api/enrichment/queue/process { "limit": 10 }`.
- **Queue all needing enrichment**: `POST /api/enrichment/queue-all-pending { "limit": 1000 }`.
- **Scheduled**: set `AUTO_ENRICHMENT_SCHEDULE=true` and optional `ENRICHMENT_CRON="0 * * * *"`, `ENRICHMENT_BATCH_LIMIT=10` to let the server run queue processing hourly via `node-cron`; or hit `/api/enrichment/queue/process` from your own cron.

## Reporting
- **Stats**: `GET /api/enrichment/stats` returns counts of companies enriched, per-field coverage, and pending count.
- **Report**: `GET /api/enrichment/report` summarizes totals, per-status breakdown, data availability percentages, and recent activity.
- **History**: `GET /api/enrichment/history/:companyId` shows the last 20 attempts; `GET /api/enrichment/recent` lists latest log entries.

## Safety and Scope
- Only public pages are scraped; no authentication or paid APIs are used.
- Respect `robots.txt`; skip domains that disallow crawling.
- Keep traffic low: batch size defaults to 10 with polite delays between chunks.
- All operations target the local PostgreSQL database defined by env vars in `backend/src/db/connection.js`.
