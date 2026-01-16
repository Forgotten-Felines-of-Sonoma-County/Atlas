-- MIG_252: Fix enrich_place function to use correct column name and enum values
--
-- Problem: enrich_place uses 'relationship_type' column but table has 'role'
-- and uses invalid enum values like 'cats_location' and 'property_owner'
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_252__fix_enrich_place_role.sql

\echo ''
\echo 'MIG_252: Fix enrich_place function'
\echo '===================================='
\echo ''

-- Fix the enrich_place function to use correct column and valid enum values
CREATE OR REPLACE FUNCTION trapper.enrich_place(
  p_street_address TEXT,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT 'CA',
  p_zip TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL,
  p_person_id UUID DEFAULT NULL,
  p_relationship_type TEXT DEFAULT 'requester'  -- Changed: use valid enum value
)
RETURNS TABLE(
  place_id UUID,
  is_new BOOLEAN,
  matched_by TEXT,
  needs_geocoding BOOLEAN
) AS $$
DECLARE
  v_place_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_matched_by TEXT := NULL;
  v_needs_geocoding BOOLEAN := FALSE;
  v_full_address TEXT;
  v_norm_address TEXT;
  v_role trapper.person_place_role;
BEGIN
  -- Map relationship_type to valid person_place_role enum
  -- Accept various input values and map to valid enum
  v_role := CASE
    WHEN p_relationship_type IN ('cats_location', 'requester', 'request') THEN 'requester'
    WHEN p_relationship_type IN ('property_owner', 'owner') THEN 'owner'
    WHEN p_relationship_type IN ('residence', 'resident', 'home') THEN 'resident'
    WHEN p_relationship_type = 'contact' THEN 'contact'
    ELSE 'requester'  -- Default to requester for intake submissions
  END;

  -- Build full address
  v_full_address := COALESCE(p_street_address, '');
  IF p_city IS NOT NULL AND p_city != '' THEN
    v_full_address := v_full_address || ', ' || p_city;
  END IF;
  IF p_state IS NOT NULL AND p_state != '' THEN
    v_full_address := v_full_address || ', ' || p_state;
  END IF;
  IF p_zip IS NOT NULL AND p_zip != '' THEN
    v_full_address := v_full_address || ' ' || p_zip;
  END IF;

  -- Normalize address for matching
  v_norm_address := lower(trim(regexp_replace(
    regexp_replace(p_street_address, '\s+', ' ', 'g'),
    '[.,#]', '', 'g'
  )));

  -- Skip if no real address
  IF v_norm_address IS NULL OR v_norm_address = '' OR length(v_norm_address) < 5 THEN
    RETURN;
  END IF;

  -- Try to match by normalized address
  SELECT p.place_id INTO v_place_id
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    AND lower(trim(regexp_replace(
        regexp_replace(p.street_address, '\s+', ' ', 'g'),
        '[.,#]', '', 'g'
    ))) = v_norm_address
    AND (p_city IS NULL OR p.city IS NULL OR lower(p.city) = lower(p_city))
  LIMIT 1;

  IF v_place_id IS NOT NULL THEN
    v_matched_by := 'address';
  END IF;

  -- Try to match by formatted address (geocoded)
  IF v_place_id IS NULL THEN
    SELECT p.place_id INTO v_place_id
    FROM trapper.places p
    WHERE p.merged_into_place_id IS NULL
      AND p.formatted_address IS NOT NULL
      AND lower(p.formatted_address) LIKE '%' || v_norm_address || '%'
    LIMIT 1;

    IF v_place_id IS NOT NULL THEN
      v_matched_by := 'formatted_address';
    END IF;
  END IF;

  -- No match - create new place
  IF v_place_id IS NULL THEN
    INSERT INTO trapper.places (
      street_address,
      city,
      state,
      zip,
      county,
      full_address,
      source_system,
      source_record_id,
      geocode_status,
      created_at,
      updated_at
    ) VALUES (
      p_street_address,
      p_city,
      COALESCE(p_state, 'CA'),
      p_zip,
      p_county,
      v_full_address,
      p_source_system,
      p_source_record_id,
      'pending',
      NOW(),
      NOW()
    )
    RETURNING places.place_id INTO v_place_id;

    v_is_new := TRUE;
    v_matched_by := 'new';
    v_needs_geocoding := TRUE;

    -- Add to geocoding queue
    INSERT INTO trapper.geocoding_queue (place_id, priority, source_system)
    VALUES (v_place_id, 5, p_source_system)
    ON CONFLICT (place_id) DO NOTHING;
  ELSE
    -- Check if existing place needs geocoding
    SELECT (p.geocode_status = 'pending' OR p.geocode_status = 'failed')
    INTO v_needs_geocoding
    FROM trapper.places p
    WHERE p.place_id = v_place_id;

    -- Enrich: update missing fields
    UPDATE trapper.places p
    SET
      city = COALESCE(p.city, p_city),
      zip = COALESCE(p.zip, p_zip),
      county = COALESCE(p.county, p_county),
      updated_at = NOW()
    WHERE p.place_id = v_place_id
      AND (p.city IS NULL OR p.zip IS NULL OR p.county IS NULL);
  END IF;

  -- Link to person if provided (FIXED: use 'role' column, not 'relationship_type')
  IF p_person_id IS NOT NULL AND v_place_id IS NOT NULL THEN
    INSERT INTO trapper.person_place_relationships (
      person_id, place_id, role, source_system, created_at
    ) VALUES (
      p_person_id, v_place_id, v_role, p_source_system, NOW()
    )
    ON CONFLICT (person_id, place_id, role) DO UPDATE
    SET created_at = NOW();  -- Just touch the timestamp
  END IF;

  RETURN QUERY SELECT v_place_id, v_is_new, v_matched_by, v_needs_geocoding;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_place IS
'Find or create a place from an address. Handles deduplication and geocoding queue.
Optionally links the place to a person with valid role enum values.
Accepts relationship_type values like cats_location, property_owner and maps to valid enum.';

\echo ''
\echo 'MIG_252 complete!'
\echo '  - enrich_place now uses correct column name (role, not relationship_type)'
\echo '  - Maps input values to valid person_place_role enum values'
\echo ''
