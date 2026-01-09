-- MIG_007__unified_candidate_addresses.sql
-- Unified address candidate pipeline for all sources
--
-- Creates:
--   - v_candidate_addresses_all_sources: unified view across all tables
--
-- Purpose:
--   - Single entry point for geocoding from any source
--   - Consistent junk filtering across all sources
--   - Support for source-specific address field mappings
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_007__unified_candidate_addresses.sql

\echo '============================================'
\echo 'MIG_007: Unified Address Candidate Pipeline'
\echo '============================================'

-- ============================================
-- PART 1: Address Quality Check Function
-- ============================================
\echo ''
\echo 'Creating is_valid_address_candidate function...'

CREATE OR REPLACE FUNCTION trapper.is_valid_address_candidate(address TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    trimmed TEXT := TRIM(COALESCE(address, ''));
BEGIN
    -- Empty
    IF trimmed = '' THEN
        RETURN FALSE;
    END IF;

    -- Too short
    IF LENGTH(trimmed) < 5 THEN
        RETURN FALSE;
    END IF;

    -- Attachment URLs
    IF trimmed ILIKE '%airtableusercontent%' OR
       trimmed ILIKE '%v5.airtableusercontent%' THEN
        RETURN FALSE;
    END IF;

    -- HTML content
    IF trimmed LIKE '%<%>%' OR trimmed LIKE '%</%' OR
       trimmed LIKE '%<br%' OR trimmed LIKE '%<div%' THEN
        RETURN FALSE;
    END IF;

    -- ZIP-only
    IF trimmed ~ '^[0-9]{5}(-[0-9]{4})?$' THEN
        RETURN FALSE;
    END IF;

    -- State-only
    IF UPPER(trimmed) IN ('CA', 'CALIFORNIA', 'USA', 'US') THEN
        RETURN FALSE;
    END IF;

    -- Must contain at least one digit (street number)
    IF trimmed !~ '[0-9]' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_valid_address_candidate IS
'Returns TRUE if address passes basic quality checks for geocoding.
Filters out: empty, too short, attachment URLs, HTML, ZIP-only, state-only, no digits.';

-- ============================================
-- PART 2: Unified Address Candidates View
-- ============================================
\echo 'Creating v_candidate_addresses_all_sources view...'

CREATE OR REPLACE VIEW trapper.v_candidate_addresses_all_sources AS
WITH latest_runs AS (
    SELECT run_id, source_system, source_table
    FROM trapper.v_latest_ingest_run
),
-- Trapping Requests addresses
trapping_request_addrs AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        'primary'::TEXT AS address_role,
        COALESCE(
            sr.payload->>'Address',
            sr.payload->>'address'
        ) AS primary_address,
        sr.payload->>'City' AS city,
        sr.payload->>'State' AS state,
        COALESCE(sr.payload->>'Zip', sr.payload->>'ZIP') AS zip
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_table = 'trapping_requests'
      AND NOT sr.is_processed
),
-- Appointment Requests addresses (when they exist)
appointment_request_addrs AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        'primary'::TEXT AS address_role,
        COALESCE(
            sr.payload->>'Address',
            sr.payload->>'Requester Address',
            sr.payload->>'address'
        ) AS primary_address,
        sr.payload->>'City' AS city,
        sr.payload->>'State' AS state,
        COALESCE(sr.payload->>'Zip', sr.payload->>'ZIP') AS zip
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_table = 'appointment_requests'
      AND NOT sr.is_processed
),
-- Combine all sources
all_addrs AS (
    SELECT * FROM trapping_request_addrs
    UNION ALL
    SELECT * FROM appointment_request_addrs
),
-- Filter and build full address
filtered_addrs AS (
    SELECT
        a.staged_record_id,
        a.source_system,
        a.source_table,
        a.source_row_id,
        a.address_role,
        -- Build full address string
        TRIM(
            COALESCE(a.primary_address, '') ||
            CASE WHEN a.city IS NOT NULL AND a.primary_address NOT ILIKE '%' || a.city || '%'
                 THEN ', ' || a.city
                 ELSE '' END ||
            CASE WHEN a.state IS NOT NULL AND a.primary_address NOT ILIKE '%' || a.state || '%'
                 THEN ', ' || a.state
                 ELSE '' END ||
            CASE WHEN a.zip IS NOT NULL AND a.primary_address NOT ILIKE '%' || a.zip || '%'
                 THEN ' ' || a.zip
                 ELSE '' END
        ) AS address_raw
    FROM all_addrs a
    WHERE a.primary_address IS NOT NULL
      AND trapper.is_valid_address_candidate(a.primary_address)
)
SELECT
    fa.staged_record_id,
    fa.source_system,
    fa.source_table,
    fa.source_row_id,
    fa.address_role,
    fa.address_raw
FROM filtered_addrs fa
-- Exclude already processed
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.staged_record_address_link sral
    WHERE sral.staged_record_id = fa.staged_record_id
      AND sral.address_role = fa.address_role
)
-- Exclude already in review queue
AND NOT EXISTS (
    SELECT 1 FROM trapper.address_review_queue arq
    WHERE arq.staged_record_id = fa.staged_record_id
      AND arq.address_role = fa.address_role
);

COMMENT ON VIEW trapper.v_candidate_addresses_all_sources IS
'Unified address candidates from all sources (trapping_requests, appointment_requests, etc).
Applies consistent junk filtering. Use for batch geocoding.';

-- ============================================
-- PART 3: Stats View
-- ============================================
\echo 'Creating v_address_pipeline_by_source view...'

CREATE OR REPLACE VIEW trapper.v_address_pipeline_by_source AS
SELECT
    source_table,
    COUNT(*) AS candidate_count
FROM trapper.v_candidate_addresses_all_sources
GROUP BY source_table
ORDER BY source_table;

COMMENT ON VIEW trapper.v_address_pipeline_by_source IS
'Address candidate counts by source table.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_007 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Address candidates by source:'
SELECT * FROM trapper.v_address_pipeline_by_source;

\echo ''
\echo 'Sample candidates:'
SELECT source_table, address_role, LEFT(address_raw, 60) AS address_preview
FROM trapper.v_candidate_addresses_all_sources
LIMIT 5;

\echo ''
\echo 'Next steps:'
\echo '  1. Geocode: node scripts/normalize/geocode_candidates.mjs --limit 25 --verbose'
\echo '  2. Review: SELECT * FROM trapper.address_review_queue WHERE NOT is_resolved;'
\echo ''
