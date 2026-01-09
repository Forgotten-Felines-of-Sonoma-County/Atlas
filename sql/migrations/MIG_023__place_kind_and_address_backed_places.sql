-- MIG_023__place_kind_and_address_backed_places.sql
-- Place Kind Classification + Address-Backed Places
--
-- Creates:
--   - trapper.place_kind enum
--   - places.place_kind column
--   - places.is_address_backed column with constraint
--   - trapper.ensure_address_backed_places() function
--   - v_places_address_backed view
--   - Updated derive_person_place_relationships
--
-- Purpose:
--   - Formalize the rule: places are only created from canonical addresses
--   - Add simple place_kind taxonomy (house, apartment, business, etc.)
--   - Enable future apartment building grouping
--   - Prevent "nonsense" places created from raw strings
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_023__place_kind_and_address_backed_places.sql

\echo '============================================'
\echo 'MIG_023: Place Kind + Address-Backed Places'
\echo '============================================'

-- ============================================
-- PART 1: Place Kind Enum
-- ============================================
\echo ''
\echo 'Creating place_kind enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'place_kind') THEN
        CREATE TYPE trapper.place_kind AS ENUM (
            'unknown',
            'residential_house',
            'apartment_unit',
            'apartment_building',
            'business',
            'clinic',
            'neighborhood',
            'outdoor_site'
        );
    END IF;
END$$;

COMMENT ON TYPE trapper.place_kind IS
'Simple structural classification for places.
- residential_house: Single-family home
- apartment_unit: Individual unit in a building
- apartment_building: Entire multi-unit building (for grouping)
- business: Commercial location
- clinic: Veterinary or animal clinic
- neighborhood: Area (future use)
- outdoor_site: Park, trail, outdoor colony site';

-- ============================================
-- PART 2: Add place_kind Column
-- ============================================
\echo 'Adding place_kind column to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS place_kind trapper.place_kind NOT NULL DEFAULT 'unknown';

-- ============================================
-- PART 3: Add is_address_backed Column
-- ============================================
\echo 'Adding is_address_backed column...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS is_address_backed BOOLEAN NOT NULL DEFAULT true;

-- ============================================
-- PART 4: Add CHECK Constraint
-- ============================================
\echo 'Adding address-backed constraint...'

-- Address-backed places MUST have a canonical address_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_address_backed_has_address'
    ) THEN
        ALTER TABLE trapper.places
        ADD CONSTRAINT chk_address_backed_has_address
        CHECK (is_address_backed = false OR sot_address_id IS NOT NULL);
    END IF;
END$$;

COMMENT ON CONSTRAINT chk_address_backed_has_address ON trapper.places IS
'Enforces: address-backed places must have a canonical sot_address_id.
Non-address-backed places (neighborhoods, manual entries) can have NULL sot_address_id.';

-- ============================================
-- PART 5: Backfill place_kind for Existing Places
-- ============================================
\echo 'Backfilling place_kind for existing places...'

UPDATE trapper.places p
SET place_kind = CASE
    -- If address has a unit, it's an apartment unit
    WHEN sa.unit_normalized IS NOT NULL THEN 'apartment_unit'::trapper.place_kind
    -- Default to residential house for addresses without units
    ELSE 'residential_house'::trapper.place_kind
END
FROM trapper.sot_addresses sa
WHERE p.sot_address_id = sa.address_id
  AND p.place_kind = 'unknown';

-- ============================================
-- PART 6: Ensure Address-Backed Places Function
-- ============================================
\echo 'Creating ensure_address_backed_places function...'

CREATE OR REPLACE FUNCTION trapper.ensure_address_backed_places()
RETURNS TABLE (
    places_created INT,
    places_existing INT
) AS $$
DECLARE
    v_created INT := 0;
    v_existing INT := 0;
BEGIN
    -- Count existing places
    SELECT COUNT(*) INTO v_existing
    FROM trapper.places
    WHERE is_address_backed = true;

    -- Create address-backed places for all canonical addresses that don't have one
    INSERT INTO trapper.places (
        sot_address_id,
        display_name,
        formatted_address,
        location,
        place_kind,
        is_address_backed,
        inferred_type,
        inferred_type_reasons,
        created_at
    )
    SELECT
        sa.address_id,
        -- Display name: street address, locality
        COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', sa.street_number, sa.route)), ''),
            sa.formatted_address
        ) || COALESCE(', ' || sa.locality, ''),
        sa.formatted_address,
        sa.location::geography,
        -- Determine place_kind
        CASE
            WHEN sa.unit_normalized IS NOT NULL THEN 'apartment_unit'::trapper.place_kind
            ELSE 'residential_house'::trapper.place_kind
        END,
        true,  -- is_address_backed
        -- Inferred type (for existing type system)
        CASE
            WHEN sa.unit_normalized IS NOT NULL THEN 'apartment_building'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%park%' THEN 'park'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%trail%' THEN 'trail'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%vet%' OR sa.formatted_address ILIKE '%animal hospital%' THEN 'veterinary'::trapper.place_type
            ELSE 'residence'::trapper.place_type
        END,
        jsonb_build_object(
            'source', 'ensure_address_backed_places',
            'has_unit', sa.unit_normalized IS NOT NULL
        ),
        NOW()
    FROM trapper.sot_addresses sa
    WHERE sa.geocode_status IN ('ok', 'partial', 'success')  -- Accept all valid statuses
      AND NOT EXISTS (
          SELECT 1 FROM trapper.places p
          WHERE p.sot_address_id = sa.address_id
      );

    GET DIAGNOSTICS v_created = ROW_COUNT;

    RETURN QUERY SELECT v_created, v_existing;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.ensure_address_backed_places IS
'Ensures every canonical (geocoded) address has exactly one address-backed place.
Idempotent: safe to rerun. Creates missing places, skips existing ones.
Sets place_kind based on unit presence (apartment_unit vs residential_house).';

-- ============================================
-- PART 7: Update derive_person_place_relationships
-- ============================================
\echo 'Updating derive_person_place_relationships function...'

CREATE OR REPLACE FUNCTION trapper.derive_person_place_relationships(
    p_source_table TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    v_places_result RECORD;
BEGIN
    -- FIRST: Ensure all canonical addresses have address-backed places
    SELECT * INTO v_places_result FROM trapper.ensure_address_backed_places();

    IF v_places_result.places_created > 0 THEN
        RAISE NOTICE 'Created % new address-backed places', v_places_result.places_created;
    END IF;

    -- THEN: Derive requester role from staged records that link both person and address
    -- Only links to address-backed places (via sot_address_id join)
    INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role,
        source_system, source_table, source_row_id, staged_record_id,
        confidence, created_by
    )
    SELECT DISTINCT
        srpl.person_id,
        pl.place_id,
        'requester'::trapper.person_place_role,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        sr.id,
        0.9,
        'derive_person_place'
    FROM trapper.staged_record_person_link srpl
    JOIN trapper.staged_records sr ON sr.id = srpl.staged_record_id
    JOIN trapper.staged_record_address_link sral ON sral.staged_record_id = sr.id
    JOIN trapper.places pl ON pl.sot_address_id = sral.address_id
    WHERE (p_source_table IS NULL OR sr.source_table = p_source_table)
      AND pl.is_address_backed = true  -- Only link to address-backed places
    ON CONFLICT (person_id, place_id, role) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.derive_person_place_relationships IS
'Derives person-place relationships from staged records.
1. First ensures all canonical addresses have address-backed places
2. Then links people to address-backed places via their shared staged record links
3. Never creates places from raw address strings - only uses canonical geocoded addresses';

-- ============================================
-- PART 8: Address-Backed Places View
-- ============================================
\echo 'Creating v_places_address_backed view...'

CREATE OR REPLACE VIEW trapper.v_places_address_backed AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    p.effective_type,
    p.is_address_backed,
    p.has_cat_activity,
    p.has_trapping_activity,
    -- Address details
    sa.street_number,
    sa.route,
    sa.locality,
    sa.admin_area_1 AS state,
    sa.postal_code,
    sa.unit_normalized AS unit,
    -- Counts
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr
     WHERE ppr.place_id = p.place_id) AS person_count,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
     WHERE cpr.place_id = p.place_id) AS cat_count,
    -- Location
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lng
FROM trapper.places p
JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
WHERE p.is_address_backed = true
ORDER BY p.created_at DESC;

COMMENT ON VIEW trapper.v_places_address_backed IS
'All address-backed places with address details and activity counts.
These are the "safe" places anchored to canonical geocoded addresses.';

-- ============================================
-- PART 9: Place Kind Summary View
-- ============================================
\echo 'Creating v_place_kind_summary view...'

CREATE OR REPLACE VIEW trapper.v_place_kind_summary AS
SELECT
    p.place_kind,
    COUNT(*) AS place_count,
    COUNT(*) FILTER (WHERE p.has_cat_activity) AS with_cats,
    SUM((SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id)) AS total_cats,
    SUM((SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id)) AS total_people
FROM trapper.places p
WHERE p.is_address_backed = true
GROUP BY p.place_kind
ORDER BY place_count DESC;

COMMENT ON VIEW trapper.v_place_kind_summary IS
'Summary of places grouped by place_kind with activity counts.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_023 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'New columns added:'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'places'
  AND column_name IN ('place_kind', 'is_address_backed')
ORDER BY column_name;

\echo ''
\echo 'Constraints:'
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'trapper.places'::regclass
  AND conname LIKE '%address_backed%';

\echo ''
\echo 'Place kind distribution:'
SELECT place_kind, COUNT(*) AS count
FROM trapper.places
GROUP BY place_kind
ORDER BY count DESC;

\echo ''
\echo 'Address-backed places:'
SELECT
    is_address_backed,
    COUNT(*) AS count
FROM trapper.places
GROUP BY is_address_backed;

\echo ''
\echo 'Next steps:'
\echo '  1. Ensure all addresses have places: SELECT * FROM trapper.ensure_address_backed_places();'
\echo '  2. Derive relationships: SELECT trapper.derive_person_place_relationships(NULL);'
\echo '  3. Relink cats: ./scripts/post_ingest/atlas_013_link_cats_to_places.sh'
\echo ''
