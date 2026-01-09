-- MIG_008__places_seed_and_type_scaffold.sql
-- Place seeding and type tagging scaffold
--
-- Creates:
--   - place_type enum
--   - trapper.places table
--   - place seeding from sot_addresses
--
-- Purpose:
--   - Create canonical place entities from geocoded addresses
--   - Lightweight type tagging (not required to fill out)
--   - Support for future enrichment from Google Places, manual review
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_008__places_seed_and_type_scaffold.sql

\echo '============================================'
\echo 'MIG_008: Places Seed and Type Scaffold'
\echo '============================================'

-- ============================================
-- PART 1: Place Type Enum
-- ============================================
\echo ''
\echo 'Creating place_type enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'place_type') THEN
        CREATE TYPE trapper.place_type AS ENUM (
            'residence',
            'apartment_building',
            'business',
            'park',
            'trail',
            'school',
            'church',
            'shelter',
            'veterinary',
            'public_space',
            'unknown'
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Places Table
-- ============================================
\echo 'Creating places table...'

CREATE TABLE IF NOT EXISTS trapper.places (
    place_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Canonical address linkage
    sot_address_id UUID UNIQUE REFERENCES trapper.sot_addresses(address_id),

    -- Display info (denormalized from sot_address for convenience)
    display_name TEXT,
    formatted_address TEXT,
    location GEOGRAPHY(Point, 4326),

    -- Type classification
    inferred_type trapper.place_type,           -- System suggestion
    inferred_type_reasons JSONB,                -- Why we think this type
    inferred_type_confidence NUMERIC(3,2),      -- 0-1

    confirmed_type trapper.place_type,          -- Manual override
    confirmed_at TIMESTAMPTZ,
    confirmed_by TEXT,

    -- Effective type (use this in queries)
    -- Populated by trigger or computed column
    effective_type trapper.place_type GENERATED ALWAYS AS (
        COALESCE(confirmed_type, inferred_type, 'unknown')
    ) STORED,

    -- Activity flags (updated by triggers or batch jobs)
    has_trapping_activity BOOLEAN NOT NULL DEFAULT FALSE,
    has_appointment_activity BOOLEAN NOT NULL DEFAULT FALSE,
    has_cat_activity BOOLEAN NOT NULL DEFAULT FALSE,
    last_activity_at TIMESTAMPTZ,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for location queries
CREATE INDEX IF NOT EXISTS idx_places_location ON trapper.places USING GIST (location);

-- Index for type queries
CREATE INDEX IF NOT EXISTS idx_places_effective_type ON trapper.places (effective_type);

-- Index for activity queries
CREATE INDEX IF NOT EXISTS idx_places_activity ON trapper.places (last_activity_at DESC NULLS LAST)
    WHERE has_trapping_activity OR has_appointment_activity OR has_cat_activity;

COMMENT ON TABLE trapper.places IS
'Canonical place entities derived from geocoded addresses.
Type tagging is incremental and non-invasive.
effective_type = COALESCE(confirmed_type, inferred_type, ''unknown'').';

-- ============================================
-- PART 3: Place Seeding Function
-- ============================================
\echo 'Creating seed_places_from_addresses function...'

CREATE OR REPLACE FUNCTION trapper.seed_places_from_addresses()
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    INSERT INTO trapper.places (
        sot_address_id,
        display_name,
        formatted_address,
        location,
        inferred_type,
        inferred_type_reasons,
        created_at
    )
    SELECT
        sa.address_id,
        sa.formatted_address,
        sa.formatted_address,
        sa.location,
        -- Infer type from address components
        CASE
            WHEN sa.unit_normalized IS NOT NULL THEN 'apartment_building'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%park%' THEN 'park'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%trail%' THEN 'trail'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%school%' THEN 'school'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%church%' THEN 'church'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%shelter%' OR sa.formatted_address ILIKE '%rescue%' THEN 'shelter'::trapper.place_type
            WHEN sa.formatted_address ILIKE '%vet%' OR sa.formatted_address ILIKE '%animal hospital%' THEN 'veterinary'::trapper.place_type
            ELSE 'unknown'::trapper.place_type
        END,
        jsonb_build_object(
            'source', 'address_pattern',
            'has_unit', sa.unit_normalized IS NOT NULL
        ),
        NOW()
    FROM trapper.sot_addresses sa
    WHERE NOT EXISTS (
        SELECT 1 FROM trapper.places p WHERE p.sot_address_id = sa.address_id
    );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.seed_places_from_addresses IS
'Creates place records for all sot_addresses that don''t already have one.
Infers basic type from address patterns (apartment, park, etc).';

-- ============================================
-- PART 4: Update Place Activity Function
-- ============================================
\echo 'Creating update_place_activity function...'

CREATE OR REPLACE FUNCTION trapper.update_place_activity()
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Update activity flags based on observations
    UPDATE trapper.places p
    SET
        has_trapping_activity = EXISTS (
            SELECT 1 FROM trapper.observations o
            WHERE o.resolved_address_id = p.sot_address_id
              AND o.source_table = 'trapping_requests'
        ),
        has_appointment_activity = EXISTS (
            SELECT 1 FROM trapper.observations o
            WHERE o.resolved_address_id = p.sot_address_id
              AND o.source_table = 'appointment_requests'
        ),
        last_activity_at = (
            SELECT MAX(o.created_at) FROM trapper.observations o
            WHERE o.resolved_address_id = p.sot_address_id
        ),
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Places Summary View
-- ============================================
\echo 'Creating v_places_summary view...'

CREATE OR REPLACE VIEW trapper.v_places_summary AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.effective_type,
    p.has_trapping_activity,
    p.has_appointment_activity,
    p.has_cat_activity,
    p.last_activity_at,
    -- Observation counts
    (SELECT COUNT(*) FROM trapper.observations o
     WHERE o.resolved_address_id = p.sot_address_id) AS observation_count,
    -- Linked staged records count
    (SELECT COUNT(DISTINCT sral.staged_record_id) FROM trapper.staged_record_address_link sral
     WHERE sral.address_id = p.sot_address_id) AS linked_records_count,
    -- Unit info
    sa.unit_normalized,
    -- Location for mapping
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lng
FROM trapper.places p
JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id;

COMMENT ON VIEW trapper.v_places_summary IS
'Summary of places with activity counts and location data.';

-- ============================================
-- PART 6: Query for places with active signals
-- ============================================
\echo 'Creating QRY_005 (places with active signals) as a saved view...'

CREATE OR REPLACE VIEW trapper.v_places_with_active_signals AS
SELECT
    p.place_id,
    p.display_name,
    p.effective_type,
    p.has_trapping_activity,
    p.has_appointment_activity,
    COUNT(DISTINCT o.staged_record_id) AS signal_count,
    array_agg(DISTINCT o.observation_type::TEXT) AS signal_types,
    MAX(o.created_at) AS latest_signal_at
FROM trapper.places p
LEFT JOIN trapper.observations o ON o.resolved_address_id = p.sot_address_id
GROUP BY p.place_id, p.display_name, p.effective_type, p.has_trapping_activity, p.has_appointment_activity
HAVING COUNT(o.observation_id) > 0
ORDER BY COUNT(DISTINCT o.staged_record_id) DESC;

COMMENT ON VIEW trapper.v_places_with_active_signals IS
'Places that have at least one observation signal, ranked by activity.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_008 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper' AND table_name = 'places';

\echo ''
\echo 'Current sot_addresses count (for seeding):'
SELECT COUNT(*) AS sot_addresses_count FROM trapper.sot_addresses;

\echo ''
\echo 'To seed places:'
\echo '  SELECT trapper.seed_places_from_addresses();'
\echo ''
\echo 'To check places with signals:'
\echo '  SELECT * FROM trapper.v_places_with_active_signals LIMIT 10;'
\echo ''
