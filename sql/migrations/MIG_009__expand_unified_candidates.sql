-- MIG_009__expand_unified_candidates.sql
-- Expand unified address candidate pipeline to include Project 75
--
-- Updates:
--   - v_candidate_addresses_all_sources: adds project75_survey
--
-- Purpose:
--   - Single entry point for geocoding from any source
--   - Consistent junk filtering across all sources
--   - Support for project75_survey addresses
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_009__expand_unified_candidates.sql

\echo '============================================'
\echo 'MIG_009: Expand Unified Address Candidates'
\echo '============================================'

-- ============================================
-- PART 1: Update Unified Address Candidates View
-- ============================================
\echo ''
\echo 'Updating v_candidate_addresses_all_sources view...'

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
-- Appointment Requests addresses
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
-- Project 75 Survey addresses
project75_survey_addrs AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        'primary'::TEXT AS address_role,
        COALESCE(
            sr.payload->>'Address',
            sr.payload->>'Street Address',
            sr.payload->>'Location',
            sr.payload->>'address',
            sr.payload->>'street_address',
            sr.payload->>'location'
        ) AS primary_address,
        COALESCE(sr.payload->>'City', sr.payload->>'city') AS city,
        COALESCE(sr.payload->>'State', sr.payload->>'state') AS state,
        COALESCE(sr.payload->>'Zip', sr.payload->>'ZIP', sr.payload->>'zip') AS zip
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_table = 'project75_survey'
      AND NOT sr.is_processed
),
-- Combine all sources
all_addrs AS (
    SELECT * FROM trapping_request_addrs
    UNION ALL
    SELECT * FROM appointment_request_addrs
    UNION ALL
    SELECT * FROM project75_survey_addrs
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
'Unified address candidates from all sources:
- trapping_requests (Airtable main)
- appointment_requests (Airtable main)
- project75_survey (Airtable Project 75)
Applies consistent junk filtering. Use for batch geocoding.';

-- ============================================
-- PART 2: Update Stats View
-- ============================================
\echo 'Updating v_address_pipeline_by_source view...'

CREATE OR REPLACE VIEW trapper.v_address_pipeline_by_source AS
SELECT
    source_system,
    source_table,
    COUNT(*) AS candidate_count
FROM trapper.v_candidate_addresses_all_sources
GROUP BY source_system, source_table
ORDER BY source_system, source_table;

COMMENT ON VIEW trapper.v_address_pipeline_by_source IS
'Address candidate counts by source system and table.';

-- ============================================
-- PART 3: Context Surface Function
-- ============================================
\echo 'Creating fn_context_surface function...'

CREATE OR REPLACE FUNCTION trapper.fn_context_surface(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_m INTEGER DEFAULT 1000,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    place_id UUID,
    display_name TEXT,
    effective_type trapper.place_type,
    distance_m INTEGER,
    observation_count BIGINT,
    linked_records_count BIGINT,
    last_seen_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.place_id,
        p.display_name,
        p.effective_type,
        ROUND(ST_Distance(
            p.location,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        ))::INTEGER AS distance_m,
        (SELECT COUNT(*) FROM trapper.observations o
         WHERE o.resolved_address_id = p.sot_address_id) AS observation_count,
        (SELECT COUNT(DISTINCT sral.staged_record_id)
         FROM trapper.staged_record_address_link sral
         WHERE sral.address_id = p.sot_address_id) AS linked_records_count,
        (SELECT MAX(sr.created_at)
         FROM trapper.staged_record_address_link sral
         JOIN trapper.staged_records sr ON sr.id = sral.staged_record_id
         WHERE sral.address_id = p.sot_address_id) AS last_seen_at
    FROM trapper.places p
    WHERE ST_DWithin(
        p.location,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
        p_radius_m
    )
    ORDER BY distance_m ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.fn_context_surface IS
'Returns places within a given radius of a point, with observation and linkage counts.
Usage: SELECT * FROM trapper.fn_context_surface(38.35, -122.70, 2000, 20);
Parameters:
  p_lat: latitude (e.g., 38.35)
  p_lng: longitude (e.g., -122.70)
  p_radius_m: radius in meters (default 1000)
  p_limit: max results (default 50)';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_009 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Address candidates by source:'
SELECT * FROM trapper.v_address_pipeline_by_source;

\echo ''
\echo 'Total candidates:'
SELECT COUNT(*) AS total_candidates FROM trapper.v_candidate_addresses_all_sources;

\echo ''
\echo 'Context surface function created.'
\echo 'Test with: SELECT * FROM trapper.fn_context_surface(38.35, -122.70, 5000, 10);'

\echo ''
\echo 'Next steps:'
\echo '  1. Ingest Project 75 CSV: node scripts/ingest/airtable_project75_survey_csv.mjs --csv ...'
\echo '  2. Geocode all: node scripts/normalize/geocode_candidates.mjs --limit 50'
\echo '  3. Test context surface: psql -f sql/queries/QRY_006__context_surface_sample.sql'
\echo ''
