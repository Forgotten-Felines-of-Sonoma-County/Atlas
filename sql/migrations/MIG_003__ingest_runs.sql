-- MIG_003__ingest_runs.sql
-- Ingest run tracking for staging integrity
--
-- Creates:
--   - trapper.ingest_runs: tracks each ingest execution
--   - trapper.ingest_run_records: links runs to staged records
--
-- Purpose:
--   - Know exactly which CSV produced which staged records
--   - File SHA256 prevents confusion when files are overwritten
--   - Append-only: old runs preserved, views prefer latest
--
-- APPLY MANUALLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_003__ingest_runs.sql

\echo '============================================'
\echo 'MIG_003: Ingest Run Tracking'
\echo '============================================'

-- ============================================
-- PART 1: Ingest Runs Table
-- ============================================
\echo ''
\echo 'Creating ingest_runs table...'

CREATE TABLE IF NOT EXISTS trapper.ingest_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source_system TEXT NOT NULL,           -- 'airtable', 'clinichq'
    source_table TEXT NOT NULL,            -- 'trapping_requests', 'appointment_requests'

    -- File tracking
    source_file_path TEXT NOT NULL,        -- Full path to file
    source_file_name TEXT NOT NULL,        -- Basename only
    source_file_sha256 TEXT NOT NULL,      -- SHA256 of file bytes

    -- Run stats
    row_count INT NOT NULL,                -- Rows in CSV
    rows_inserted INT NOT NULL DEFAULT 0,  -- New staged records
    rows_linked INT NOT NULL DEFAULT 0,    -- Total run_records (incl. existing)
    rows_suspect INT NOT NULL DEFAULT 0,   -- Rows flagged as suspect

    -- Run metadata
    run_status TEXT NOT NULL DEFAULT 'completed',  -- running, completed, failed
    error_message TEXT,
    run_duration_ms INT,

    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding runs by source
CREATE INDEX IF NOT EXISTS idx_ingest_runs_source
    ON trapper.ingest_runs (source_system, source_table, created_at DESC);

-- Index for finding runs by file hash
CREATE INDEX IF NOT EXISTS idx_ingest_runs_file_hash
    ON trapper.ingest_runs (source_file_sha256);

COMMENT ON TABLE trapper.ingest_runs IS
'Tracks each ingest execution. File SHA256 ensures we know exactly which file produced which records.
Append-only: old runs preserved for audit trail.';

-- ============================================
-- PART 2: Ingest Run Records Link Table
-- ============================================
\echo 'Creating ingest_run_records table...'

CREATE TABLE IF NOT EXISTS trapper.ingest_run_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    run_id UUID NOT NULL REFERENCES trapper.ingest_runs(run_id) ON DELETE CASCADE,
    staged_record_id UUID NOT NULL,        -- References staged_records (no FK for flexibility)

    -- Row metadata from this run
    csv_row_number INT,                    -- 1-indexed row in CSV
    was_inserted BOOLEAN NOT NULL,         -- true = new, false = already existed

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Each run can only reference a staged record once
    UNIQUE (run_id, staged_record_id)
);

-- Index for finding records by run
CREATE INDEX IF NOT EXISTS idx_ingest_run_records_run
    ON trapper.ingest_run_records (run_id);

-- Index for finding runs that touched a staged record
CREATE INDEX IF NOT EXISTS idx_ingest_run_records_staged
    ON trapper.ingest_run_records (staged_record_id);

COMMENT ON TABLE trapper.ingest_run_records IS
'Links ingest runs to staged records. Even if a staged record already exists, we record that the run referenced it.
Enables: "show me all records from the latest run" and "show me all runs that touched this record".';

-- ============================================
-- PART 3: View - Latest Run Per Source
-- ============================================
\echo 'Creating v_latest_ingest_run view...'

CREATE OR REPLACE VIEW trapper.v_latest_ingest_run AS
SELECT DISTINCT ON (source_system, source_table)
    run_id,
    source_system,
    source_table,
    source_file_name,
    source_file_sha256,
    row_count,
    rows_inserted,
    rows_linked,
    rows_suspect,
    run_status,
    started_at,
    completed_at
FROM trapper.ingest_runs
WHERE run_status = 'completed'
ORDER BY source_system, source_table, created_at DESC;

COMMENT ON VIEW trapper.v_latest_ingest_run IS
'Returns the most recent completed ingest run for each source_system + source_table combination.';

-- ============================================
-- PART 4: View - Staged Records from Latest Run
-- ============================================
\echo 'Creating v_staged_records_latest_run view...'

CREATE OR REPLACE VIEW trapper.v_staged_records_latest_run AS
SELECT
    sr.*,
    irr.run_id,
    irr.csv_row_number,
    irr.was_inserted,
    lr.source_file_name AS run_file_name,
    lr.started_at AS run_started_at
FROM trapper.staged_records sr
JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
JOIN trapper.v_latest_ingest_run lr ON lr.run_id = irr.run_id
    AND lr.source_system = sr.source_system
    AND lr.source_table = sr.source_table;

COMMENT ON VIEW trapper.v_staged_records_latest_run IS
'Staged records from the latest ingest run only. Use this instead of staged_records directly to get current data.';

-- ============================================
-- PART 5: Suspect Row Detection via data_issues
-- Using existing data_issues table for suspect rows
-- ============================================
\echo 'Adding suspect row issue types documentation...'

-- Document the issue types we'll use for suspect rows
COMMENT ON TABLE trapper.data_issues IS
'Tracks data quality issues. Used for:
- Geocoding failures (entity_type=address)
- Suspect staged rows (entity_type=staged_record):
  - issue_type=address_has_attachment: Address contains airtableusercontent URL
  - issue_type=case_number_looks_html: Case Number contains HTML (<br>, etc.)
  - issue_type=map_image_column_drift: Map Image is state code or ZIP (column misalignment)
  - issue_type=address_is_junk: Address is just "CA", ZIP-only, or garbage
Severity: 1=low (warning), 2=medium (exclude from processing), 3=high (critical data issue)';

-- ============================================
-- PART 6: Update Candidate Addresses View
-- Filter out junk and suspect rows
-- ============================================
\echo 'Updating v_candidate_addresses_from_trapping_requests view...'

CREATE OR REPLACE VIEW trapper.v_candidate_addresses_from_trapping_requests AS
WITH latest_run AS (
    SELECT run_id
    FROM trapper.v_latest_ingest_run
    WHERE source_system = 'airtable' AND source_table = 'trapping_requests'
),
address_fields AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_row_id,
        sr.created_at,
        -- Try multiple possible address field names
        COALESCE(
            sr.payload->>'Address',
            sr.payload->>'address',
            sr.payload->>'Street Address',
            sr.payload->>'street_address',
            sr.payload->>'Cats Address',
            sr.payload->>'cats_address',
            sr.payload->>'Trapping Address',
            sr.payload->>'trapping_address',
            sr.payload->>'Location Address',
            sr.payload->>'location_address'
        ) AS primary_address,
        -- Secondary address field
        COALESCE(
            sr.payload->>'Requester Address',
            sr.payload->>'requester_address',
            sr.payload->>'Mailing Address',
            sr.payload->>'mailing_address'
        ) AS secondary_address,
        -- City for address augmentation
        COALESCE(
            sr.payload->>'City',
            sr.payload->>'city',
            sr.payload->>'Cats City',
            sr.payload->>'cats_city'
        ) AS city,
        -- State
        COALESCE(
            sr.payload->>'State',
            sr.payload->>'state'
        ) AS state,
        -- Zip
        COALESCE(
            sr.payload->>'Zip',
            sr.payload->>'zip',
            sr.payload->>'ZIP',
            sr.payload->>'Postal Code',
            sr.payload->>'postal_code'
        ) AS zip
    FROM trapper.staged_records sr
    -- If we have ingest runs, prefer latest run; otherwise fall back to all records
    LEFT JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    LEFT JOIN latest_run lr ON lr.run_id = irr.run_id
    WHERE sr.source_table = 'trapping_requests'
      AND NOT sr.is_processed
      -- Prefer latest run if available (lr.run_id will be non-null)
      -- If no runs exist yet, include all records (lr.run_id IS NULL means no runs at all)
      AND (lr.run_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM latest_run))
      -- Exclude suspect rows from data_issues
      AND NOT EXISTS (
          SELECT 1 FROM trapper.data_issues di
          WHERE di.entity_type = 'staged_record'
            AND di.entity_id = sr.id
            AND di.severity >= 2
            AND NOT di.is_resolved
      )
),
filtered_addresses AS (
    SELECT
        af.staged_record_id,
        af.source_row_id,
        af.primary_address,
        af.city,
        af.state,
        af.zip,
        af.created_at
    FROM address_fields af
    WHERE af.primary_address IS NOT NULL
      AND TRIM(af.primary_address) != ''
      -- Exclude junk addresses
      AND af.primary_address NOT ILIKE '%airtableusercontent%'  -- attachment URLs
      AND af.primary_address NOT ILIKE '%v5.airtableusercontent%'
      AND TRIM(af.primary_address) !~ '^[0-9]{5}(-[0-9]{4})?$'   -- ZIP-only
      AND UPPER(TRIM(af.primary_address)) NOT IN ('CA', 'CALIFORNIA')  -- State-only
      AND af.primary_address ~ '[0-9]'  -- Must contain at least one digit (street number)
      AND LENGTH(TRIM(af.primary_address)) >= 5  -- Minimum reasonable length
)
-- Primary addresses
SELECT
    fa.staged_record_id,
    fa.source_row_id,
    -- Build full address string
    TRIM(
        COALESCE(fa.primary_address, '') ||
        CASE WHEN fa.city IS NOT NULL AND fa.primary_address NOT ILIKE '%' || fa.city || '%'
             THEN ', ' || fa.city
             ELSE '' END ||
        CASE WHEN fa.state IS NOT NULL AND fa.primary_address NOT ILIKE '%' || fa.state || '%'
             THEN ', ' || fa.state
             ELSE '' END ||
        CASE WHEN fa.zip IS NOT NULL AND fa.primary_address NOT ILIKE '%' || fa.zip || '%'
             THEN ' ' || fa.zip
             ELSE '' END
    ) AS address_raw,
    'primary'::TEXT AS address_role,
    fa.created_at
FROM filtered_addresses fa
-- Exclude already processed
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.staged_record_address_link sral
    WHERE sral.staged_record_id = fa.staged_record_id
      AND sral.address_role = 'primary'
)
-- Exclude already in review queue
AND NOT EXISTS (
    SELECT 1 FROM trapper.address_review_queue arq
    WHERE arq.staged_record_id = fa.staged_record_id
      AND arq.address_role = 'primary'
);

COMMENT ON VIEW trapper.v_candidate_addresses_from_trapping_requests IS
'Address candidates from latest trapping requests ingest run.
Excludes: suspect rows (from data_issues), attachment URLs, ZIP-only, state-only, no digits.
Use for batch geocoding input.';

-- ============================================
-- PART 7: Ingest Run Summary View
-- ============================================
\echo 'Creating v_ingest_run_summary view...'

CREATE OR REPLACE VIEW trapper.v_ingest_run_summary AS
SELECT
    ir.run_id,
    ir.source_system,
    ir.source_table,
    ir.source_file_name,
    ir.row_count,
    ir.rows_inserted,
    ir.rows_linked,
    ir.rows_suspect,
    ir.run_status,
    ir.started_at,
    ir.completed_at,
    ir.run_duration_ms,
    -- Derived stats
    ROUND(100.0 * ir.rows_inserted / NULLIF(ir.row_count, 0), 1) AS insert_rate_pct,
    ROUND(100.0 * ir.rows_suspect / NULLIF(ir.row_count, 0), 1) AS suspect_rate_pct,
    -- Is this the latest run?
    (ir.run_id = (
        SELECT run_id FROM trapper.v_latest_ingest_run lr
        WHERE lr.source_system = ir.source_system
          AND lr.source_table = ir.source_table
    )) AS is_latest
FROM trapper.ingest_runs ir
ORDER BY ir.created_at DESC;

COMMENT ON VIEW trapper.v_ingest_run_summary IS
'Summary of all ingest runs with derived stats. Shows which run is current latest.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_003 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('ingest_runs', 'ingest_run_records')
ORDER BY table_name;

\echo ''
\echo 'Views created/updated:'
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'trapper'
  AND (table_name LIKE 'v_ingest%' OR table_name LIKE 'v_latest%' OR table_name LIKE 'v_staged_records_latest%')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Re-ingest CSV with updated script'
\echo '  2. Check run: SELECT * FROM trapper.v_ingest_run_summary;'
\echo '  3. Check candidates: SELECT COUNT(*) FROM trapper.v_candidate_addresses_from_trapping_requests;'
\echo ''
