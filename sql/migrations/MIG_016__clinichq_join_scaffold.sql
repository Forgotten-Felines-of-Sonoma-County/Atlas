-- MIG_016__clinichq_join_scaffold.sql
-- ClinicHQ Join Scaffold: Views to join appointment/cat/owner data
--
-- Creates:
--   - trapper.v_clinichq_cat_owner_appt_join: joined view of all ClinicHQ data
--   - Updates v_candidate_addresses_all_sources to include ClinicHQ owner addresses
--
-- Purpose:
--   - Enable querying ClinicHQ data as a cohesive unit
--   - Join on Number (internal ID) and Microchip Number
--   - Feed owner addresses into geocoding pipeline
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_016__clinichq_join_scaffold.sql

\echo '============================================'
\echo 'MIG_016: ClinicHQ Join Scaffold'
\echo '============================================'

-- ============================================
-- PART 1: ClinicHQ Cat-Owner-Appointment Join View
-- ============================================
\echo ''
\echo 'Creating v_clinichq_cat_owner_appt_join view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_cat_owner_appt_join AS
WITH
-- Get latest ingest runs for each ClinicHQ table
latest_runs AS (
    SELECT run_id, source_system, source_table
    FROM trapper.v_latest_ingest_run
    WHERE source_system = 'clinichq'
),
-- Cat info from latest run
cat_info AS (
    SELECT
        sr.id AS cat_staged_record_id,
        sr.source_row_id AS cat_source_row_id,
        sr.payload->>'Number' AS animal_number,
        sr.payload->>'Microchip Number' AS microchip,
        sr.payload->>'Animal Name' AS animal_name,
        sr.payload->>'Breed' AS breed,
        sr.payload->>'Sex' AS sex,
        sr.payload->>'Spay Neuter Status' AS spay_neuter_status,
        sr.payload->>'Age Months' AS age_months,
        sr.payload->>'Age Years' AS age_years,
        sr.payload->>'Weight' AS weight,
        sr.payload AS cat_payload
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
),
-- Owner info from latest run
owner_info AS (
    SELECT
        sr.id AS owner_staged_record_id,
        sr.source_row_id AS owner_source_row_id,
        sr.payload->>'Number' AS animal_number,
        sr.payload->>'Microchip Number' AS microchip,
        sr.payload->>'Owner First Name' AS owner_first_name,
        sr.payload->>'Owner Last Name' AS owner_last_name,
        sr.payload->>'Owner Address' AS owner_address,
        sr.payload->>'Owner Cell Phone' AS owner_cell_phone,
        sr.payload->>'Owner Phone' AS owner_phone,
        sr.payload->>'Owner Email' AS owner_email,
        sr.payload->>'Ownership' AS ownership_type,
        sr.payload->>'ClientType' AS client_type,
        sr.payload AS owner_payload
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
),
-- Appointment info from latest run (sample - may be very large)
appt_info AS (
    SELECT
        sr.id AS appt_staged_record_id,
        sr.source_row_id AS appt_source_row_id,
        sr.payload->>'Number' AS animal_number,
        sr.payload->>'Microchip Number' AS microchip,
        sr.payload->>'Date' AS appt_date,
        sr.payload->>'Vet Name' AS vet_name,
        sr.payload AS appt_payload
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
)
-- Join on animal_number (primary) and microchip (secondary fallback)
SELECT
    -- Cat info
    c.cat_staged_record_id,
    c.animal_number,
    c.microchip,
    c.animal_name,
    c.breed,
    c.sex,
    c.spay_neuter_status,
    c.age_months,
    c.age_years,
    c.weight,

    -- Owner info
    o.owner_staged_record_id,
    o.owner_first_name,
    o.owner_last_name,
    TRIM(COALESCE(o.owner_first_name, '') || ' ' || COALESCE(o.owner_last_name, '')) AS owner_full_name,
    o.owner_address,
    o.owner_cell_phone,
    o.owner_phone,
    o.owner_email,
    o.ownership_type,
    o.client_type,

    -- Appointment info (most recent)
    a.appt_staged_record_id,
    a.appt_date,
    a.vet_name

FROM cat_info c
LEFT JOIN owner_info o ON (
    -- Primary join: animal number
    (c.animal_number IS NOT NULL AND c.animal_number = o.animal_number)
    -- Secondary join: microchip
    OR (c.microchip IS NOT NULL AND c.microchip <> '' AND c.microchip = o.microchip)
)
LEFT JOIN LATERAL (
    -- Get most recent appointment for this animal
    SELECT appt_staged_record_id, appt_date, vet_name
    FROM appt_info
    WHERE (animal_number = c.animal_number)
       OR (microchip IS NOT NULL AND microchip <> '' AND microchip = c.microchip)
    ORDER BY appt_date DESC NULLS LAST
    LIMIT 1
) a ON TRUE;

COMMENT ON VIEW trapper.v_clinichq_cat_owner_appt_join IS
'Joined view of ClinicHQ cat, owner, and appointment data.
Join keys: animal Number (primary), Microchip Number (secondary).
Includes most recent appointment per animal.';

-- ============================================
-- PART 2: ClinicHQ Stats View
-- ============================================
\echo 'Creating v_clinichq_stats view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_stats AS
SELECT
    source_table,
    COUNT(*) AS staged_records
FROM trapper.staged_records
WHERE source_system = 'clinichq'
GROUP BY source_table
ORDER BY source_table;

COMMENT ON VIEW trapper.v_clinichq_stats IS
'Count of staged records by ClinicHQ table.';

-- ============================================
-- PART 3: Update Unified Address Candidates to Include ClinicHQ
-- ============================================
\echo 'Updating v_candidate_addresses_all_sources to include ClinicHQ...'

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
-- ClinicHQ Owner addresses
clinichq_owner_addrs AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        'primary'::TEXT AS address_role,
        sr.payload->>'Owner Address' AS primary_address,
        NULL::TEXT AS city,
        NULL::TEXT AS state,
        NULL::TEXT AS zip
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_runs lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND NOT sr.is_processed
      AND sr.payload->>'Owner Address' IS NOT NULL
      AND TRIM(sr.payload->>'Owner Address') <> ''
),
-- Combine all sources
all_addrs AS (
    SELECT * FROM trapping_request_addrs
    UNION ALL
    SELECT * FROM appointment_request_addrs
    UNION ALL
    SELECT * FROM project75_survey_addrs
    UNION ALL
    SELECT * FROM clinichq_owner_addrs
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
- owner_info (ClinicHQ)
Applies consistent junk filtering. Use for batch geocoding.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_016 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'ClinicHQ stats:'
SELECT * FROM trapper.v_clinichq_stats;

\echo ''
\echo 'Address candidates by source (top 10):'
SELECT source_system, source_table, COUNT(*) AS candidates
FROM trapper.v_candidate_addresses_all_sources
GROUP BY source_system, source_table
ORDER BY candidates DESC
LIMIT 10;

\echo ''
\echo 'To view joined ClinicHQ data:'
\echo '  SELECT * FROM trapper.v_clinichq_cat_owner_appt_join LIMIT 10;'
\echo ''
