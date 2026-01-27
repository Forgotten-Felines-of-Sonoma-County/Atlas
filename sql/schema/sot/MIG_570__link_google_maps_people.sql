\echo '=== MIG_570: Link Google Maps Entries to Existing People ==='
\echo 'Creates person-place links when Google Maps kml_name matches existing person'
\echo ''
\echo 'IMPORTANT: This does NOT create new person records - only links existing people'

-- ============================================================================
-- BACKGROUND:
-- Google Maps entries have kml_name (usually a person name like "Jose Valencia")
-- These entries are linked to places, but the person isn't linked to that place.
-- Result: Staff sees the place on map but "Jose Valencia" doesn't appear as a person.
--
-- SOLUTION:
-- For each Google Maps entry with a valid kml_name:
--   1. Find existing person with similar display_name
--   2. Create person-place relationship if not exists
--   3. Track source as 'google_maps'
--
-- DOES NOT create new people - only links existing ones.
-- ============================================================================

-- Add column to track if entry's person has been linked
ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS person_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_person_id UUID REFERENCES trapper.sot_people(person_id);

COMMENT ON COLUMN trapper.google_map_entries.person_linked_at IS
'When the kml_name was successfully linked to an existing person';

COMMENT ON COLUMN trapper.google_map_entries.linked_person_id IS
'Person ID linked from kml_name matching (only links to existing people)';

-- Function to link Google Maps entries to existing people
CREATE OR REPLACE FUNCTION trapper.link_google_maps_to_people(
  p_limit INT DEFAULT 500
)
RETURNS TABLE(
  entries_processed INT,
  people_linked INT,
  places_linked INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_processed INT := 0;
  v_people_linked INT := 0;
  v_places_linked INT := 0;
  v_row RECORD;
  v_person_id UUID;
  v_place_id UUID;
BEGIN
  FOR v_row IN
    SELECT
      gme.entry_id,
      gme.kml_name,
      COALESCE(gme.linked_place_id, gme.place_id) AS place_id
    FROM trapper.google_map_entries gme
    WHERE gme.person_linked_at IS NULL  -- Not already processed
      AND gme.kml_name IS NOT NULL
      AND LENGTH(TRIM(gme.kml_name)) >= 3
      -- Exclude entries that look like addresses or emails
      AND gme.kml_name !~ '@'  -- Not an email
      AND gme.kml_name !~ ', CA[ ,]'  -- Not a California address
      AND gme.kml_name !~ '\d{5}'  -- No zip codes
      AND gme.kml_name !~* '^\d+\s+\w+\s+(st|rd|ave|blvd|dr|ln|ct|way|pl)\b'  -- Not a street address
      -- Must have a linked place
      AND COALESCE(gme.linked_place_id, gme.place_id) IS NOT NULL
    ORDER BY gme.imported_at DESC
    LIMIT p_limit
  LOOP
    v_processed := v_processed + 1;
    v_place_id := v_row.place_id;

    -- Try to find existing person by exact or similar name
    -- Use trigram similarity for fuzzy matching
    SELECT p.person_id INTO v_person_id
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND p.display_name IS NOT NULL
      AND (
        -- Exact match (case-insensitive)
        LOWER(TRIM(p.display_name)) = LOWER(TRIM(v_row.kml_name))
        OR
        -- High similarity match (>0.7 trigram similarity)
        SIMILARITY(LOWER(p.display_name), LOWER(v_row.kml_name)) > 0.7
      )
      -- Prioritize exact matches, then highest similarity
    ORDER BY
      CASE WHEN LOWER(TRIM(p.display_name)) = LOWER(TRIM(v_row.kml_name)) THEN 0 ELSE 1 END,
      SIMILARITY(LOWER(p.display_name), LOWER(v_row.kml_name)) DESC
    LIMIT 1;

    -- If we found a matching person
    IF v_person_id IS NOT NULL THEN
      v_people_linked := v_people_linked + 1;

      -- Create person-place relationship if not exists
      INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role, confidence, source_system, source_table
      ) VALUES (
        v_person_id, v_place_id, 'contact', 0.70, 'google_maps', 'google_map_entries'
      )
      ON CONFLICT (person_id, place_id, role) DO NOTHING;

      -- Check if we actually inserted (wasn't a duplicate)
      IF FOUND THEN
        v_places_linked := v_places_linked + 1;
      END IF;

      -- Update entry with linked person
      UPDATE trapper.google_map_entries
      SET
        linked_person_id = v_person_id,
        person_linked_at = NOW()
      WHERE entry_id = v_row.entry_id;
    ELSE
      -- Mark as processed (no match found)
      UPDATE trapper.google_map_entries
      SET person_linked_at = NOW()
      WHERE entry_id = v_row.entry_id;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_people_linked, v_places_linked;
END;
$$;

COMMENT ON FUNCTION trapper.link_google_maps_to_people IS
'Links Google Maps kml_name to existing people. Does NOT create new person records.';

-- Add to entity linking chain for ongoing processing
-- (This will run after each processing batch)

-- View to see linkable entries
CREATE OR REPLACE VIEW trapper.v_google_maps_linkable_people AS
SELECT
  gme.entry_id,
  gme.kml_name,
  COALESCE(gme.linked_place_id, gme.place_id) AS place_id,
  pl.formatted_address,
  gme.person_linked_at,
  gme.linked_person_id,
  -- Show potential matches
  (
    SELECT jsonb_agg(jsonb_build_object(
      'person_id', p.person_id,
      'display_name', p.display_name,
      'similarity', ROUND(SIMILARITY(LOWER(p.display_name), LOWER(gme.kml_name))::NUMERIC, 2)
    ) ORDER BY SIMILARITY(LOWER(p.display_name), LOWER(gme.kml_name)) DESC)
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND SIMILARITY(LOWER(p.display_name), LOWER(gme.kml_name)) > 0.5
    LIMIT 5
  ) AS potential_matches
FROM trapper.google_map_entries gme
LEFT JOIN trapper.places pl ON pl.place_id = COALESCE(gme.linked_place_id, gme.place_id)
WHERE gme.person_linked_at IS NULL
  AND gme.kml_name IS NOT NULL
  AND LENGTH(TRIM(gme.kml_name)) >= 3
  AND gme.kml_name !~ '@'
  AND gme.kml_name !~ ', CA[ ,]'
  AND gme.kml_name !~ '\d{5}'
  AND gme.kml_name !~* '^\d+\s+\w+\s+(st|rd|ave|blvd|dr|ln|ct|way|pl)\b'
  AND COALESCE(gme.linked_place_id, gme.place_id) IS NOT NULL
ORDER BY gme.imported_at DESC;

COMMENT ON VIEW trapper.v_google_maps_linkable_people IS
'Shows Google Maps entries with kml_names that could potentially be linked to existing people.';

\echo ''
\echo '=== MIG_570 Complete ==='
\echo ''
\echo 'To link Google Maps entries to existing people, run:'
\echo '  SELECT * FROM trapper.link_google_maps_to_people(500);'
\echo ''
\echo 'To view entries that could be linked:'
\echo '  SELECT * FROM trapper.v_google_maps_linkable_people LIMIT 20;'
\echo ''
\echo 'NOTE: This only links to EXISTING people - it does NOT create new person records.'
