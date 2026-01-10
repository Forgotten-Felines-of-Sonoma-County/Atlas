-- MIG_033__address_registry_enhancements.sql
-- Strengthen canonical address registry
--
-- Purpose:
--   Add missing fields for address precision tracking and raw input preservation.
--   Ensure we can always trace back to the original input and understand geocode quality.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_033__address_registry_enhancements.sql

\echo '============================================'
\echo 'MIG_033: Address Registry Enhancements'
\echo '============================================'

-- ============================================
-- PART 1: Add missing columns to sot_addresses
-- ============================================
\echo ''
\echo 'Adding columns to sot_addresses...'

-- last_geocoded_at: When we last called Google for this address
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_addresses'
        AND column_name = 'last_geocoded_at'
    ) THEN
        ALTER TABLE trapper.sot_addresses
        ADD COLUMN last_geocoded_at TIMESTAMPTZ;

        COMMENT ON COLUMN trapper.sot_addresses.last_geocoded_at IS
        'When this address was last geocoded via Google API.
NULL means geocoded before we started tracking this field.';
    END IF;
END $$;

-- precision: Explicit precision level derived from location_type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_addresses'
        AND column_name = 'precision'
    ) THEN
        ALTER TABLE trapper.sot_addresses
        ADD COLUMN precision TEXT
        CHECK (precision IN ('rooftop', 'interpolated', 'centroid', 'approximate', 'unknown'));

        COMMENT ON COLUMN trapper.sot_addresses.precision IS
        'Geocode precision level:
- rooftop: Exact building footprint (best)
- interpolated: Estimated position along street segment
- centroid: Center of a region (neighborhood, ZIP)
- approximate: General area only (worst)
- unknown: No precision data available';
    END IF;
END $$;

-- raw_input: Original address text before any normalization
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_addresses'
        AND column_name = 'raw_input'
    ) THEN
        ALTER TABLE trapper.sot_addresses
        ADD COLUMN raw_input TEXT;

        COMMENT ON COLUMN trapper.sot_addresses.raw_input IS
        'Original address text as submitted before any normalization.
Useful for debugging and understanding geocode discrepancies.';
    END IF;
END $$;

-- input_source: Where the address came from
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'sot_addresses'
        AND column_name = 'input_source'
    ) THEN
        ALTER TABLE trapper.sot_addresses
        ADD COLUMN input_source TEXT;

        COMMENT ON COLUMN trapper.sot_addresses.input_source IS
        'Source system/table that provided this address.
Format: source_system:source_table (e.g., airtable:trapping_requests)';
    END IF;
END $$;

\echo '  Columns added.'

-- ============================================
-- PART 2: Backfill precision from location_type
-- ============================================
\echo ''
\echo 'Backfilling precision from location_type...'

UPDATE trapper.sot_addresses
SET precision = CASE location_type
    WHEN 'ROOFTOP' THEN 'rooftop'
    WHEN 'RANGE_INTERPOLATED' THEN 'interpolated'
    WHEN 'GEOMETRIC_CENTER' THEN 'centroid'
    WHEN 'APPROXIMATE' THEN 'approximate'
    ELSE 'unknown'
END
WHERE precision IS NULL
  AND location_type IS NOT NULL;

-- ============================================
-- PART 3: Function to calculate address match score
-- ============================================
\echo ''
\echo 'Creating address_match_score function...'

CREATE OR REPLACE FUNCTION trapper.address_match_score(
    p_address_id_1 UUID,
    p_address_id_2 UUID
)
RETURNS JSONB AS $$
DECLARE
    v_addr1 RECORD;
    v_addr2 RECORD;
    v_score NUMERIC := 0;
    v_reasons JSONB := '[]'::JSONB;
    v_distance_meters FLOAT;
BEGIN
    -- Get both addresses
    SELECT * INTO v_addr1 FROM trapper.sot_addresses WHERE address_id = p_address_id_1;
    SELECT * INTO v_addr2 FROM trapper.sot_addresses WHERE address_id = p_address_id_2;

    IF v_addr1.address_id IS NULL OR v_addr2.address_id IS NULL THEN
        RETURN jsonb_build_object('score', 0, 'reasons', '["address_not_found"]'::JSONB);
    END IF;

    -- Same Google Place ID = definite match
    IF v_addr1.google_place_id IS NOT NULL
       AND v_addr1.google_place_id = v_addr2.google_place_id THEN
        v_score := 1.0;
        v_reasons := v_reasons || '"same_google_place_id"'::JSONB;
        RETURN jsonb_build_object('score', v_score, 'reasons', v_reasons);
    END IF;

    -- Same formatted address (ignoring unit)
    IF v_addr1.formatted_address = v_addr2.formatted_address THEN
        v_score := v_score + 0.8;
        v_reasons := v_reasons || '"same_formatted_address"'::JSONB;
    END IF;

    -- Calculate distance if both have coordinates
    IF v_addr1.location IS NOT NULL AND v_addr2.location IS NOT NULL THEN
        v_distance_meters := ST_Distance(
            v_addr1.location::geography,
            v_addr2.location::geography
        );

        -- Within 50 meters = very likely same location
        IF v_distance_meters <= 50 THEN
            v_score := v_score + 0.3;
            v_reasons := v_reasons || ('"distance_' || ROUND(v_distance_meters)::TEXT || 'm"')::JSONB;
        -- Within 200 meters = possible same location
        ELSIF v_distance_meters <= 200 THEN
            v_score := v_score + 0.1;
            v_reasons := v_reasons || ('"distance_' || ROUND(v_distance_meters)::TEXT || 'm"')::JSONB;
        END IF;
    END IF;

    -- Same postal code
    IF v_addr1.postal_code IS NOT NULL
       AND v_addr1.postal_code = v_addr2.postal_code THEN
        v_score := v_score + 0.1;
        v_reasons := v_reasons || '"same_postal_code"'::JSONB;
    END IF;

    -- Same street number and route
    IF v_addr1.street_number = v_addr2.street_number
       AND v_addr1.route = v_addr2.route THEN
        v_score := v_score + 0.2;
        v_reasons := v_reasons || '"same_street_address"'::JSONB;
    END IF;

    -- Cap at 1.0
    v_score := LEAST(v_score, 1.0);

    RETURN jsonb_build_object(
        'score', ROUND(v_score::NUMERIC, 3),
        'reasons', v_reasons,
        'distance_meters', v_distance_meters
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.address_match_score IS
'Calculates similarity score between two addresses.
Returns JSONB with score (0-1), reasons array, and distance_meters.
Uses Google Place ID for exact match, then falls back to coordinates and components.';

-- ============================================
-- PART 4: Function to find nearby addresses
-- ============================================
\echo ''
\echo 'Creating find_nearby_addresses function...'

CREATE OR REPLACE FUNCTION trapper.find_nearby_addresses(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_meters INT DEFAULT 100,
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    address_id UUID,
    formatted_address TEXT,
    unit_normalized TEXT,
    distance_meters FLOAT,
    addr_precision TEXT,
    confidence_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.address_id,
        a.formatted_address,
        a.unit_normalized,
        ST_Distance(
            a.location::geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        ) AS distance_meters,
        a.precision AS addr_precision,
        a.confidence_score
    FROM trapper.sot_addresses a
    WHERE a.location IS NOT NULL
      AND ST_DWithin(
          a.location::geography,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_radius_meters
      )
    ORDER BY distance_meters
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_nearby_addresses IS
'Finds addresses within a given radius of a point.
Uses PostGIS spatial indexing for efficient radius queries.
Returns addresses ordered by distance.';

-- ============================================
-- PART 5: View for address quality overview
-- ============================================
\echo ''
\echo 'Creating v_address_quality view...'

CREATE OR REPLACE VIEW trapper.v_address_quality AS
SELECT
    precision,
    geocode_status,
    COUNT(*) AS address_count,
    AVG(confidence_score) AS avg_confidence,
    COUNT(*) FILTER (WHERE unit_normalized IS NOT NULL) AS with_unit,
    COUNT(*) FILTER (WHERE last_geocoded_at IS NOT NULL) AS with_geocode_timestamp
FROM trapper.sot_addresses
GROUP BY precision, geocode_status
ORDER BY
    CASE precision
        WHEN 'rooftop' THEN 1
        WHEN 'interpolated' THEN 2
        WHEN 'centroid' THEN 3
        WHEN 'approximate' THEN 4
        ELSE 5
    END,
    geocode_status;

COMMENT ON VIEW trapper.v_address_quality IS
'Summary of address quality by precision level and geocode status.
Use to monitor geocoding quality and identify areas for improvement.';

-- ============================================
-- PART 6: Index for spatial queries
-- ============================================
\echo ''
\echo 'Ensuring spatial index exists...'

-- This index may already exist from MIG_002, but ensure it's there
CREATE INDEX IF NOT EXISTS idx_sot_addresses_location_gist
ON trapper.sot_addresses USING GIST (location);

-- Index for geocode status (useful for finding addresses needing re-geocoding)
CREATE INDEX IF NOT EXISTS idx_sot_addresses_geocode_status
ON trapper.sot_addresses (geocode_status)
WHERE geocode_status NOT IN ('ok', 'success');

-- Index for precision (useful for quality reporting)
CREATE INDEX IF NOT EXISTS idx_sot_addresses_precision
ON trapper.sot_addresses (precision);

\echo '  Indexes created.'

-- ============================================
-- PART 7: Address Config Settings
-- ============================================
\echo ''
\echo 'Adding address config settings...'

INSERT INTO trapper.entity_match_config
    (entity_type, config_key, config_value, description)
VALUES
    ('address', 'proximity_match_meters', 50, 'Distance in meters for automatic same-location match'),
    ('address', 'proximity_review_meters', 200, 'Distance in meters to flag for review'),
    ('address', 'min_confidence_auto', 0.85, 'Minimum confidence for auto-accept without review'),
    ('address', 'regeocode_days', 365, 'Days before address should be re-geocoded')
ON CONFLICT (entity_type, config_key) DO UPDATE
SET
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_033 Complete'
\echo '============================================'

\echo ''
\echo 'New columns added to sot_addresses:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'sot_addresses'
AND column_name IN ('last_geocoded_at', 'precision', 'raw_input', 'input_source')
ORDER BY column_name;

\echo ''
\echo 'Address quality summary:'
SELECT * FROM trapper.v_address_quality;

\echo ''
\echo 'Address config settings:'
SELECT config_key, config_value, description
FROM trapper.entity_match_config
WHERE entity_type = 'address';

\echo ''
\echo 'To find addresses near a point:'
\echo ''
\echo '  SELECT * FROM trapper.find_nearby_addresses('
\echo '    38.4404,   -- latitude'
\echo '    -122.7141, -- longitude'
\echo '    100        -- radius in meters'
\echo '  );'
\echo ''
