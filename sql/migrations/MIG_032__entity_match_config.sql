-- MIG_032__entity_match_config.sql
-- Configurable entity matching thresholds and weights
--
-- Purpose:
--   Instead of hard-coded thresholds in functions, use config tables.
--   This allows tuning match behavior without code changes.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_032__entity_match_config.sql

\echo '============================================'
\echo 'MIG_032: Entity Match Configuration'
\echo '============================================'

-- ============================================
-- PART 1: Entity Match Config Table
-- ============================================
\echo ''
\echo 'Creating entity_match_config table...'

CREATE TABLE IF NOT EXISTS trapper.entity_match_config (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,  -- 'person', 'cat', 'place'
    config_key TEXT NOT NULL,
    config_value NUMERIC NOT NULL,
    description TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (entity_type, config_key)
);

COMMENT ON TABLE trapper.entity_match_config IS
'Configurable thresholds and weights for entity matching.
Update values here instead of modifying function code.';

-- ============================================
-- PART 2: Default Configuration
-- ============================================
\echo 'Inserting default configuration...'

INSERT INTO trapper.entity_match_config
    (entity_type, config_key, config_value, description)
VALUES
    -- Person matching thresholds
    ('person', 'auto_merge_threshold', 0.97, 'Minimum score for auto-merge (very high confidence)'),
    ('person', 'review_threshold', 0.75, 'Minimum score to add to review queue'),
    ('person', 'name_similarity_min', 0.75, 'Minimum trigram similarity for candidate generation'),

    -- Person matching weights (for future multi-signal scoring)
    ('person', 'weight_phone_match', 1.00, 'Weight for deterministic phone match'),
    ('person', 'weight_email_match', 0.90, 'Weight for deterministic email match'),
    ('person', 'weight_name_similarity', 0.30, 'Weight for fuzzy name similarity'),
    ('person', 'weight_shared_address', 0.20, 'Weight for shared address context'),
    ('person', 'weight_shared_cat', 0.10, 'Weight for shared cat ownership'),

    -- Cat matching thresholds
    ('cat', 'auto_merge_threshold', 0.90, 'Minimum score for cat auto-merge'),
    ('cat', 'review_threshold', 0.70, 'Minimum score for cat review queue'),
    ('cat', 'location_proximity_km', 2.0, 'Maximum km distance for location-based matching'),
    ('cat', 'time_window_days', 30, 'Time window in days for temporal matching'),

    -- Cat matching weights
    ('cat', 'weight_microchip', 1.00, 'Weight for microchip match (deterministic)'),
    ('cat', 'weight_name_similarity', 0.15, 'Weight for cat name similarity (low - names are common)'),
    ('cat', 'weight_sex_match', 0.20, 'Weight for sex match'),
    ('cat', 'weight_color_match', 0.20, 'Weight for color match'),
    ('cat', 'weight_location_proximity', 0.25, 'Weight for location proximity'),

    -- Place/Address thresholds
    ('place', 'geocode_confidence_auto', 0.90, 'Minimum geocode confidence for auto-accept'),
    ('place', 'geocode_confidence_review', 0.70, 'Minimum geocode confidence before review'),
    ('place', 'address_similarity_min', 0.80, 'Minimum address string similarity for fuzzy match')

ON CONFLICT (entity_type, config_key) DO UPDATE
SET
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================
-- PART 3: Helper Function to Get Config
-- ============================================
\echo 'Creating get_match_config function...'

CREATE OR REPLACE FUNCTION trapper.get_match_config(
    p_entity_type TEXT,
    p_config_key TEXT,
    p_default NUMERIC DEFAULT NULL
)
RETURNS NUMERIC AS $$
    SELECT COALESCE(
        (SELECT config_value
         FROM trapper.entity_match_config
         WHERE entity_type = p_entity_type
           AND config_key = p_config_key),
        p_default
    );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_match_config IS
'Gets a match config value by entity type and key.
Returns p_default if not configured.';

-- ============================================
-- PART 4: Update generate_person_match_candidates to use config
-- ============================================
\echo 'Updating generate_person_match_candidates to use config...'

CREATE OR REPLACE FUNCTION trapper.generate_person_match_candidates()
RETURNS TABLE (
    candidates_created INT,
    candidates_skipped INT
) AS $$
DECLARE
    v_created INT := 0;
    v_skipped INT := 0;
    v_min_similarity NUMERIC;
BEGIN
    -- Get minimum similarity from config (default 0.75)
    v_min_similarity := trapper.get_match_config('person', 'name_similarity_min', 0.75);

    -- Insert candidate pairs where:
    -- 1. Same last token (last name)
    -- 2. Both have >= 2 name tokens
    -- 3. Similarity score >= configured threshold
    -- 4. Not already in candidates table
    -- 5. Not blocked by prior decision
    -- 6. Neither person is merged

    INSERT INTO trapper.person_match_candidates (
        left_person_id,
        right_person_id,
        match_score,
        match_reasons
    )
    SELECT
        p1.person_id AS left_person_id,
        p2.person_id AS right_person_id,
        trapper.name_similarity(p1.display_name, p2.display_name) AS match_score,
        ARRAY[
            'name_sim:' || ROUND(trapper.name_similarity(p1.display_name, p2.display_name)::NUMERIC, 3)::TEXT
            || ' (' || p1.display_name || ' ~ ' || p2.display_name || ')'
        ] AS match_reasons
    FROM trapper.sot_people p1
    JOIN trapper.sot_people p2
        ON p1.person_id < p2.person_id  -- Ensure consistent ordering, avoid self-join
    WHERE
        -- Neither is merged
        p1.merged_into_person_id IS NULL
        AND p2.merged_into_person_id IS NULL
        -- Both have valid names (2+ tokens)
        AND trapper.name_token_count(p1.display_name) >= 2
        AND trapper.name_token_count(p2.display_name) >= 2
        -- Same last token (likely last name)
        AND trapper.extract_last_token(p1.display_name) = trapper.extract_last_token(p2.display_name)
        -- Similarity above configured threshold
        AND trapper.name_similarity(p1.display_name, p2.display_name) >= v_min_similarity
        -- Not already a candidate
        AND NOT EXISTS (
            SELECT 1 FROM trapper.person_match_candidates c
            WHERE c.left_person_id = p1.person_id AND c.right_person_id = p2.person_id
        )
        -- Not blocked by prior decision
        AND NOT trapper.is_pair_blocked(p1.person_id, p2.person_id)
    ON CONFLICT (left_person_id, right_person_id) DO NOTHING;

    GET DIAGNOSTICS v_created = ROW_COUNT;

    RETURN QUERY SELECT v_created, v_skipped;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Update apply_automerge_very_confident to use config
-- ============================================
\echo 'Updating apply_automerge_very_confident to use config...'

CREATE OR REPLACE FUNCTION trapper.apply_automerge_very_confident()
RETURNS TABLE (
    merged_count INT,
    skipped_count INT
) AS $$
DECLARE
    v_merged INT := 0;
    v_skipped INT := 0;
    v_auto_threshold NUMERIC;
    rec RECORD;
BEGIN
    -- Get auto-merge threshold from config (default 0.97)
    v_auto_threshold := trapper.get_match_config('person', 'auto_merge_threshold', 0.97);

    -- Process candidates that meet all criteria
    FOR rec IN
        SELECT
            c.candidate_id,
            c.left_person_id,
            c.right_person_id,
            c.match_score
        FROM trapper.person_match_candidates c
        WHERE c.status = 'open'
          AND c.match_score >= v_auto_threshold
        ORDER BY c.match_score DESC
    LOOP
        -- Skip if either person is now merged (might have happened in earlier iteration)
        IF EXISTS (
            SELECT 1 FROM trapper.sot_people
            WHERE person_id IN (rec.left_person_id, rec.right_person_id)
              AND merged_into_person_id IS NOT NULL
        ) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Skip if blocked
        IF trapper.is_pair_blocked(rec.left_person_id, rec.right_person_id) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Skip if conflicting identifiers
        IF trapper.have_conflicting_identifiers(rec.left_person_id, rec.right_person_id) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Skip if no shared address context
        IF NOT trapper.have_shared_address_context(rec.left_person_id, rec.right_person_id) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Perform merge: higher UUID into lower UUID
        IF rec.left_person_id < rec.right_person_id THEN
            PERFORM trapper.merge_people(
                rec.right_person_id,
                rec.left_person_id,
                'auto_merge_very_confident',
                'Auto-merged with score ' || rec.match_score::TEXT
            );
        ELSE
            PERFORM trapper.merge_people(
                rec.left_person_id,
                rec.right_person_id,
                'auto_merge_very_confident',
                'Auto-merged with score ' || rec.match_score::TEXT
            );
        END IF;

        -- Update candidate status
        UPDATE trapper.person_match_candidates
        SET status = 'auto_merged',
            reviewed_at = NOW()
        WHERE candidate_id = rec.candidate_id;

        v_merged := v_merged + 1;
    END LOOP;

    RETURN QUERY SELECT v_merged, v_skipped;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 6: View for config management
-- ============================================
\echo 'Creating v_entity_match_config view...'

CREATE OR REPLACE VIEW trapper.v_entity_match_config AS
SELECT
    entity_type,
    config_key,
    config_value,
    description,
    updated_at
FROM trapper.entity_match_config
ORDER BY entity_type, config_key;

COMMENT ON VIEW trapper.v_entity_match_config IS
'View of all entity match configuration settings.
Use UPDATE on entity_match_config table to change values.';

-- ============================================
-- PART 7: Place significance flag
-- ============================================
\echo 'Adding place significance columns...'

-- Add columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
          AND table_name = 'places'
          AND column_name = 'place_origin'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN place_origin TEXT DEFAULT 'geocoded'
        CHECK (place_origin IN ('geocoded', 'manual', 'atlas'));

        COMMENT ON COLUMN trapper.places.place_origin IS
        'How the place was created: geocoded (auto from address), manual (user entered), atlas (created via Atlas UI)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
          AND table_name = 'places'
          AND column_name = 'is_significant'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN is_significant BOOLEAN DEFAULT FALSE;

        COMMENT ON COLUMN trapper.places.is_significant IS
        'TRUE for places that are meaningful destinations (businesses, colonies, clinics).
FALSE for incidental residential addresses from form submissions.
Significant places appear prominently in search results.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
          AND table_name = 'places'
          AND column_name = 'significance_reason'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN significance_reason TEXT;

        COMMENT ON COLUMN trapper.places.significance_reason IS
        'Why this place is marked significant (e.g., "Known colony site", "Partner clinic")';
    END IF;
END $$;

-- Backfill: Mark non-residential places as significant
UPDATE trapper.places
SET is_significant = TRUE,
    significance_reason = 'Auto: non-residential place type'
WHERE effective_type NOT IN ('residence', 'unknown')
  AND is_significant IS NOT TRUE;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_032 Complete - Current Configuration:'
\echo '============================================'

SELECT * FROM trapper.v_entity_match_config;

\echo ''
\echo 'Place significance summary:'
SELECT
    COALESCE(is_significant::TEXT, 'NULL') AS is_significant,
    COUNT(*) AS count,
    STRING_AGG(DISTINCT effective_type::TEXT, ', ' ORDER BY effective_type::TEXT) AS place_types
FROM trapper.places
GROUP BY is_significant;

\echo ''
\echo 'To adjust person auto-merge threshold:'
\echo ''
\echo '  UPDATE trapper.entity_match_config'
\echo '  SET config_value = 0.95'
\echo '  WHERE entity_type = ''person'''
\echo '    AND config_key = ''auto_merge_threshold'';'
\echo ''
