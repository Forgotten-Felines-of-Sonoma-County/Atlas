-- MIG_022__owner_addresses_to_candidates.sql
-- ClinicHQ Owner Address Extraction + Linking Pipeline
--
-- Creates:
--   - trapper.v_clinichq_owner_latest: deduplicated owner records
--   - trapper.v_clinichq_owner_address_candidates: addresses needing geocoding
--   - trapper.link_owner_addresses_to_staged_records(): links geocoded addresses to staged records
--
-- Purpose:
--   - Extract owner addresses from ClinicHQ owner_info
--   - Enable geocoding pipeline to process them
--   - Create staged_record_address_link entries for derive_person_place_relationships
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_022__owner_addresses_to_candidates.sql

\echo '============================================'
\echo 'MIG_022: Owner Address Pipeline'
\echo '============================================'

-- ============================================
-- PART 1: Latest Owner Record View
-- ============================================
\echo ''
\echo 'Creating v_clinichq_owner_latest view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_owner_latest AS
WITH ranked_owners AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        sr.payload->>'Number' AS animal_number,
        sr.payload->>'Owner First Name' AS owner_first_name,
        sr.payload->>'Owner Last Name' AS owner_last_name,
        sr.payload->>'Owner Address' AS owner_address,
        sr.payload->>'Owner Email' AS owner_email,
        sr.payload->>'Owner Phone' AS owner_phone,
        sr.payload->>'Owner Cell Phone' AS owner_cell,
        sr.created_at,
        ROW_NUMBER() OVER (
            PARTITION BY sr.payload->>'Number'
            ORDER BY sr.created_at DESC
        ) AS rn
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' IS NOT NULL
      AND TRIM(sr.payload->>'Number') <> ''
)
SELECT
    staged_record_id,
    source_system,
    source_table,
    source_row_id,
    animal_number,
    owner_first_name,
    owner_last_name,
    owner_address,
    owner_email,
    owner_phone,
    owner_cell,
    created_at
FROM ranked_owners
WHERE rn = 1;

COMMENT ON VIEW trapper.v_clinichq_owner_latest IS
'Latest owner record per ClinicHQ animal number.
Deduplicates when multiple owner_info rows exist for same animal.';

-- ============================================
-- PART 2: Owner Address Candidates View
-- ============================================
\echo 'Creating v_clinichq_owner_address_candidates view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_owner_address_candidates AS
SELECT
    ol.staged_record_id,
    ol.animal_number AS source_row_id,
    ol.owner_address AS address_raw,
    'primary' AS address_role,
    ol.created_at
FROM trapper.v_clinichq_owner_latest ol
WHERE ol.owner_address IS NOT NULL
  AND TRIM(ol.owner_address) <> ''
  AND LENGTH(ol.owner_address) >= 10  -- Skip very short addresses
  -- Exclude already-linked records
  AND NOT EXISTS (
      SELECT 1 FROM trapper.staged_record_address_link sral
      WHERE sral.staged_record_id = ol.staged_record_id
  )
  -- Exclude records in review queue
  AND NOT EXISTS (
      SELECT 1 FROM trapper.address_review_queue arq
      WHERE arq.staged_record_id = ol.staged_record_id
  );

COMMENT ON VIEW trapper.v_clinichq_owner_address_candidates IS
'Owner addresses from ClinicHQ that need geocoding.
Excludes already-linked and in-review addresses.';

-- ============================================
-- PART 3: Link Owner Addresses Function
-- ============================================
\echo 'Creating link_owner_addresses_to_staged_records function...'

CREATE OR REPLACE FUNCTION trapper.link_owner_addresses_to_staged_records()
RETURNS TABLE (
    records_linked INT,
    places_created INT
) AS $$
DECLARE
    v_records_linked INT := 0;
    v_places_created INT := 0;
    v_rec RECORD;
    v_address_id UUID;
    v_normalized_address TEXT;
BEGIN
    -- For each owner record with an address that's not yet linked
    FOR v_rec IN
        SELECT
            ol.staged_record_id,
            ol.owner_address,
            ol.animal_number
        FROM trapper.v_clinichq_owner_latest ol
        WHERE ol.owner_address IS NOT NULL
          AND TRIM(ol.owner_address) <> ''
          -- Not already linked
          AND NOT EXISTS (
              SELECT 1 FROM trapper.staged_record_address_link sral
              WHERE sral.staged_record_id = ol.staged_record_id
          )
    LOOP
        -- Try to find a matching sot_address by fuzzy address match
        -- First, normalize the address for matching
        v_normalized_address := LOWER(TRIM(v_rec.owner_address));
        v_normalized_address := REGEXP_REPLACE(v_normalized_address, '\s+', ' ', 'g');
        v_normalized_address := REGEXP_REPLACE(v_normalized_address, '[.,]', '', 'g');

        -- Look for existing sot_address with similar formatted_address
        SELECT sa.address_id INTO v_address_id
        FROM trapper.sot_addresses sa
        WHERE
            -- Exact match on normalized formatted address
            LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(sa.formatted_address, '\s+', ' ', 'g'), '[.,]', '', 'g')))
            = v_normalized_address
        LIMIT 1;

        -- If no exact match, try prefix/contains match
        IF v_address_id IS NULL THEN
            SELECT sa.address_id INTO v_address_id
            FROM trapper.sot_addresses sa
            WHERE
                -- Raw address contains the street number and route from formatted
                v_normalized_address LIKE '%' || LOWER(COALESCE(sa.street_number, '')) || '%'
                AND v_normalized_address LIKE '%' || LOWER(COALESCE(sa.route, '')) || '%'
                AND v_normalized_address LIKE '%' || LOWER(COALESCE(sa.locality, '')) || '%'
            LIMIT 1;
        END IF;

        IF v_address_id IS NOT NULL THEN
            -- Link the staged record to the address
            INSERT INTO trapper.staged_record_address_link (
                staged_record_id,
                address_id,
                address_role,
                confidence_score,
                match_method
            ) VALUES (
                v_rec.staged_record_id,
                v_address_id,
                'primary',
                0.85,
                'owner_address_match'
            )
            ON CONFLICT (staged_record_id, address_role) DO NOTHING;

            IF FOUND THEN
                v_records_linked := v_records_linked + 1;
            END IF;
        END IF;
    END LOOP;

    -- Seed new places from any newly linked addresses
    SELECT trapper.seed_places_from_addresses() INTO v_places_created;

    RETURN QUERY SELECT v_records_linked, v_places_created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_owner_addresses_to_staged_records IS
'Links ClinicHQ owner records to existing sot_addresses by fuzzy matching.
Run after geocoding to create staged_record_address_link entries.';

-- ============================================
-- PART 4: Owner Address Stats View
-- ============================================
\echo 'Creating v_owner_address_stats view...'

CREATE OR REPLACE VIEW trapper.v_owner_address_stats AS
SELECT
    (SELECT COUNT(*) FROM trapper.v_clinichq_owner_latest) AS total_owners,
    (SELECT COUNT(*) FROM trapper.v_clinichq_owner_latest WHERE owner_address IS NOT NULL AND TRIM(owner_address) <> '') AS owners_with_address,
    (SELECT COUNT(*) FROM trapper.v_clinichq_owner_address_candidates) AS candidates_pending,
    (SELECT COUNT(DISTINCT ol.staged_record_id)
     FROM trapper.v_clinichq_owner_latest ol
     JOIN trapper.staged_record_address_link sral ON sral.staged_record_id = ol.staged_record_id
    ) AS owners_linked_to_address,
    (SELECT COUNT(DISTINCT srpl.person_id)
     FROM trapper.v_clinichq_owner_latest ol
     JOIN trapper.staged_record_person_link srpl ON srpl.staged_record_id = ol.staged_record_id
    ) AS owners_linked_to_person;

COMMENT ON VIEW trapper.v_owner_address_stats IS
'Statistics for owner address pipeline progress.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_022 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_clinichq_owner_latest', 'v_clinichq_owner_address_candidates', 'v_owner_address_stats')
ORDER BY table_name;

\echo ''
\echo 'Owner address stats:'
SELECT * FROM trapper.v_owner_address_stats;

\echo ''
\echo 'Next steps:'
\echo '  1. Geocode owner addresses: node scripts/normalize/geocode_candidates.mjs --source owner_info --limit 100'
\echo '  2. Link addresses: SELECT * FROM trapper.link_owner_addresses_to_staged_records();'
\echo '  3. Derive relationships: SELECT trapper.derive_person_place_relationships(''owner_info'');'
\echo '  4. Rerun cat linker: SELECT * FROM trapper.link_cats_to_places();'
\echo ''
