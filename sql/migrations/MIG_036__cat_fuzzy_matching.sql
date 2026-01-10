-- MIG_036__cat_fuzzy_matching.sql
-- Conservative fuzzy cat matching for review queue
--
-- Purpose:
--   Prepare a fuzzy matching lane for cats without microchips.
--   Uses name + physical attributes + place/time proximity.
--   CONSERVATIVE: Review-queue only, no auto-merge by default.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_036__cat_fuzzy_matching.sql

\echo '============================================'
\echo 'MIG_036: Cat Fuzzy Matching'
\echo '============================================'

-- ============================================
-- PART 1: Cat match candidates table
-- ============================================
\echo ''
\echo 'Creating cat_match_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.cat_match_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    left_cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    right_cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    match_score NUMERIC(4,3) NOT NULL,
    match_reasons TEXT[] NOT NULL DEFAULT '{}',
    score_breakdown JSONB,

    -- Review workflow
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'auto_merged', 'accepted', 'rejected', 'blocked')),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    review_note TEXT,

    -- Ensure consistent ordering (left < right) and no duplicates
    CONSTRAINT cat_match_candidates_ordering CHECK (left_cat_id < right_cat_id),
    CONSTRAINT cat_match_candidates_unique UNIQUE (left_cat_id, right_cat_id)
);

COMMENT ON TABLE trapper.cat_match_candidates IS
'Potential cat matches for review. Conservative approach: review-queue only.
Uses name similarity, physical attributes, and location/time proximity.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cat_match_candidates_status
ON trapper.cat_match_candidates (status) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cat_match_candidates_score
ON trapper.cat_match_candidates (match_score DESC) WHERE status = 'open';

-- ============================================
-- PART 2: Cat match decisions (audit trail)
-- ============================================
\echo ''
\echo 'Creating cat_match_decisions table...'

CREATE TABLE IF NOT EXISTS trapper.cat_match_decisions (
    decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    left_cat_id UUID NOT NULL,
    right_cat_id UUID NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('same_cat', 'not_same_cat')),
    note TEXT,
    decided_by TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT cat_match_decisions_unique UNIQUE (left_cat_id, right_cat_id)
);

COMMENT ON TABLE trapper.cat_match_decisions IS
'Explicit accept/reject decisions for cat matches.
Blocks future auto-candidates for rejected pairs.';

-- ============================================
-- PART 3: Function to check if cat pair is blocked
-- ============================================
\echo ''
\echo 'Creating is_cat_pair_blocked function...'

CREATE OR REPLACE FUNCTION trapper.is_cat_pair_blocked(
    p_cat_id_1 UUID,
    p_cat_id_2 UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM trapper.cat_match_decisions
        WHERE decision = 'not_same_cat'
          AND (
              (left_cat_id = LEAST(p_cat_id_1, p_cat_id_2)
               AND right_cat_id = GREATEST(p_cat_id_1, p_cat_id_2))
          )
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 4: Function to score cat match
-- ============================================
\echo ''
\echo 'Creating score_cat_match_candidate function...'

CREATE OR REPLACE FUNCTION trapper.score_cat_match_candidate(
    p_cat_id_1 UUID,
    p_cat_id_2 UUID
)
RETURNS JSONB AS $$
DECLARE
    v_c1 RECORD;
    v_c2 RECORD;
    v_score NUMERIC := 0;
    v_reasons JSONB := '[]'::JSONB;
    v_breakdown JSONB := '{}'::JSONB;
    v_name_sim NUMERIC;
    v_shared_microchip BOOLEAN := FALSE;
    v_shared_place INT;
    v_shared_owner INT;
    v_distance_meters FLOAT;
BEGIN
    -- Get both cats
    SELECT * INTO v_c1 FROM trapper.sot_cats WHERE cat_id = p_cat_id_1;
    SELECT * INTO v_c2 FROM trapper.sot_cats WHERE cat_id = p_cat_id_2;

    IF v_c1.cat_id IS NULL OR v_c2.cat_id IS NULL THEN
        RETURN jsonb_build_object('score', 0, 'error', 'cat_not_found');
    END IF;

    -- ========== DETERMINISTIC: Microchip ==========
    -- If both have microchip and they match = definite same cat
    -- If both have microchip and they differ = definite different cats
    SELECT EXISTS (
        SELECT 1
        FROM trapper.cat_identifiers i1
        JOIN trapper.cat_identifiers i2 ON i1.id_value = i2.id_value AND i1.id_type = i2.id_type
        WHERE i1.cat_id = p_cat_id_1
          AND i2.cat_id = p_cat_id_2
          AND i1.id_type = 'microchip'
    ) INTO v_shared_microchip;

    IF v_shared_microchip THEN
        -- This shouldn't happen (they'd be the same cat already), but if it does:
        RETURN jsonb_build_object(
            'score', 1.0,
            'reasons', '["shared_microchip"]'::JSONB,
            'note', 'Same microchip - should already be merged'
        );
    END IF;

    -- Check for conflicting microchips (both have one, but different)
    IF EXISTS (
        SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = p_cat_id_1 AND id_type = 'microchip'
    ) AND EXISTS (
        SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = p_cat_id_2 AND id_type = 'microchip'
    ) THEN
        -- Both have microchips but they're different = definitely different cats
        RETURN jsonb_build_object(
            'score', 0,
            'reasons', '["conflicting_microchips"]'::JSONB,
            'note', 'Different microchips - definitely different cats'
        );
    END IF;

    -- ========== PHYSICAL ATTRIBUTES ==========

    -- Sex match (important - a cat can't change sex)
    IF v_c1.sex IS NOT NULL AND v_c2.sex IS NOT NULL THEN
        IF v_c1.sex = v_c2.sex THEN
            v_score := v_score + 0.15;
            v_reasons := v_reasons || '"sex_match"'::JSONB;
        ELSE
            -- Different sex = strong negative signal (but not impossible - could be data error)
            v_score := v_score - 0.3;
            v_reasons := v_reasons || '"sex_mismatch"'::JSONB;
        END IF;
    END IF;

    -- Color match
    IF v_c1.primary_color IS NOT NULL AND v_c2.primary_color IS NOT NULL THEN
        IF LOWER(v_c1.primary_color) = LOWER(v_c2.primary_color) THEN
            v_score := v_score + 0.15;
            v_reasons := v_reasons || ('"color_match:' || v_c1.primary_color || '"')::JSONB;
        ELSE
            v_score := v_score - 0.1;
            v_reasons := v_reasons || '"color_mismatch"'::JSONB;
        END IF;
    END IF;

    -- Breed match (if specified)
    IF v_c1.breed IS NOT NULL AND v_c2.breed IS NOT NULL
       AND LOWER(v_c1.breed) NOT IN ('unknown', 'domestic shorthair', 'domestic longhair', 'domestic mediumhair') THEN
        IF LOWER(v_c1.breed) = LOWER(v_c2.breed) THEN
            v_score := v_score + 0.10;
            v_reasons := v_reasons || ('"breed_match:' || v_c1.breed || '"')::JSONB;
        END IF;
    END IF;

    -- Altered status match
    IF v_c1.altered_status IS NOT NULL AND v_c2.altered_status IS NOT NULL THEN
        IF v_c1.altered_status = v_c2.altered_status THEN
            v_score := v_score + 0.05;
            v_reasons := v_reasons || '"altered_status_match"'::JSONB;
        END IF;
    END IF;

    -- ========== NAME SIMILARITY ==========
    -- Cat names are less reliable than human names (many cats named "Fluffy")
    -- So we weight this lower

    IF v_c1.display_name IS NOT NULL AND v_c2.display_name IS NOT NULL THEN
        v_name_sim := similarity(LOWER(v_c1.display_name), LOWER(v_c2.display_name));

        IF v_name_sim >= 0.9 THEN
            v_score := v_score + 0.15;
            v_reasons := v_reasons || ('"name_sim:' || ROUND(v_name_sim, 2)::TEXT || '"')::JSONB;
        ELSIF v_name_sim >= 0.7 THEN
            v_score := v_score + 0.10;
            v_reasons := v_reasons || ('"name_sim:' || ROUND(v_name_sim, 2)::TEXT || '"')::JSONB;
        ELSIF v_name_sim >= 0.5 THEN
            v_score := v_score + 0.05;
            v_reasons := v_reasons || ('"name_sim:' || ROUND(v_name_sim, 2)::TEXT || '"')::JSONB;
        END IF;
    END IF;

    -- ========== CONTEXTUAL: Shared Owner ==========
    SELECT COUNT(*) INTO v_shared_owner
    FROM trapper.person_cat_relationships r1
    JOIN trapper.person_cat_relationships r2 ON r1.person_id = r2.person_id
    WHERE r1.cat_id = p_cat_id_1
      AND r2.cat_id = p_cat_id_2
      AND r1.cat_id != r2.cat_id;

    IF v_shared_owner > 0 THEN
        v_score := v_score + 0.20;
        v_reasons := v_reasons || '"shared_owner"'::JSONB;
    END IF;

    -- ========== CONTEXTUAL: Location Proximity ==========
    -- Check if cats have been seen at nearby locations
    -- This requires joining through person_place_relationships and staged_records
    -- For now, we'll check shared places directly

    SELECT COUNT(DISTINCT ppr1.place_id) INTO v_shared_place
    FROM trapper.person_cat_relationships pcr1
    JOIN trapper.person_place_relationships ppr1 ON ppr1.person_id = pcr1.person_id
    JOIN trapper.person_cat_relationships pcr2 ON pcr2.person_id = ppr1.person_id
    WHERE pcr1.cat_id = p_cat_id_1
      AND pcr2.cat_id = p_cat_id_2;

    IF v_shared_place > 0 THEN
        v_score := v_score + 0.15;
        v_reasons := v_reasons || ('"shared_place:' || v_shared_place || '"')::JSONB;
    END IF;

    -- Cap at 1.0 and floor at 0
    v_score := GREATEST(0, LEAST(v_score, 1.0));

    v_breakdown := jsonb_build_object(
        'cat_1', jsonb_build_object('id', p_cat_id_1, 'name', v_c1.display_name, 'sex', v_c1.sex, 'color', v_c1.primary_color),
        'cat_2', jsonb_build_object('id', p_cat_id_2, 'name', v_c2.display_name, 'sex', v_c2.sex, 'color', v_c2.primary_color),
        'shared_owner', v_shared_owner,
        'shared_place', v_shared_place
    );

    RETURN jsonb_build_object(
        'score', ROUND(v_score, 3),
        'reasons', v_reasons,
        'breakdown', v_breakdown
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.score_cat_match_candidate IS
'Scores potential cat matches based on:
- Physical attributes: sex, color, breed, altered status
- Name similarity (weighted low - cat names are less unique)
- Context: shared owner, shared place
Returns JSONB with score (0-1), reasons, and breakdown.
NOTE: Conflicting microchips return score=0 immediately.';

-- ============================================
-- PART 5: Generate cat match candidates
-- ============================================
\echo ''
\echo 'Creating generate_cat_match_candidates function...'

CREATE OR REPLACE FUNCTION trapper.generate_cat_match_candidates(
    p_min_score NUMERIC DEFAULT 0.4
)
RETURNS TABLE (
    candidates_created INT,
    candidates_skipped INT
) AS $$
DECLARE
    v_created INT := 0;
    v_skipped INT := 0;
    rec RECORD;
    v_score_result JSONB;
BEGIN
    -- Find cat pairs that might be the same:
    -- 1. Same primary color (basic filter to reduce comparisons)
    -- 2. Neither has been merged (future: when we add merge support)
    -- 3. Not already in candidates
    -- 4. Not blocked by prior decision

    FOR rec IN
        SELECT DISTINCT
            LEAST(c1.cat_id, c2.cat_id) AS left_cat_id,
            GREATEST(c1.cat_id, c2.cat_id) AS right_cat_id
        FROM trapper.sot_cats c1
        JOIN trapper.sot_cats c2
            ON c1.cat_id < c2.cat_id  -- Avoid self-join and duplicates
        WHERE
            -- At least one of: same color, same sex, similar name
            (
                (c1.primary_color IS NOT NULL AND LOWER(c1.primary_color) = LOWER(c2.primary_color))
                OR (c1.sex IS NOT NULL AND c1.sex = c2.sex)
                OR (c1.display_name IS NOT NULL AND c2.display_name IS NOT NULL
                    AND similarity(LOWER(c1.display_name), LOWER(c2.display_name)) >= 0.5)
            )
            -- Not already a candidate
            AND NOT EXISTS (
                SELECT 1 FROM trapper.cat_match_candidates cmc
                WHERE cmc.left_cat_id = LEAST(c1.cat_id, c2.cat_id)
                  AND cmc.right_cat_id = GREATEST(c1.cat_id, c2.cat_id)
            )
            -- Not blocked
            AND NOT trapper.is_cat_pair_blocked(c1.cat_id, c2.cat_id)
        LIMIT 1000  -- Process in batches to avoid timeout
    LOOP
        -- Score the candidate
        v_score_result := trapper.score_cat_match_candidate(rec.left_cat_id, rec.right_cat_id);

        -- Only create candidate if score is above threshold
        IF (v_score_result->>'score')::NUMERIC >= p_min_score THEN
            INSERT INTO trapper.cat_match_candidates (
                left_cat_id,
                right_cat_id,
                match_score,
                match_reasons,
                score_breakdown
            )
            VALUES (
                rec.left_cat_id,
                rec.right_cat_id,
                (v_score_result->>'score')::NUMERIC,
                ARRAY(SELECT jsonb_array_elements_text(v_score_result->'reasons')),
                v_score_result->'breakdown'
            )
            ON CONFLICT (left_cat_id, right_cat_id) DO UPDATE
            SET match_score = EXCLUDED.match_score,
                match_reasons = EXCLUDED.match_reasons,
                score_breakdown = EXCLUDED.score_breakdown,
                updated_at = NOW();

            v_created := v_created + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_created, v_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.generate_cat_match_candidates IS
'Generates potential cat match candidates based on physical attributes and context.
CONSERVATIVE: All candidates go to review queue, no auto-merge.
Default minimum score is 0.4. Processes up to 1000 pairs per call.';

-- ============================================
-- PART 6: Accept/Reject cat match functions
-- ============================================
\echo ''
\echo 'Creating accept/reject cat match functions...'

CREATE OR REPLACE FUNCTION trapper.accept_cat_match(
    p_candidate_id UUID,
    p_decided_by TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_candidate RECORD;
BEGIN
    SELECT * INTO v_candidate
    FROM trapper.cat_match_candidates
    WHERE candidate_id = p_candidate_id
      AND status = 'open';

    IF v_candidate.candidate_id IS NULL THEN
        RAISE EXCEPTION 'Candidate % not found or not open', p_candidate_id;
    END IF;

    -- Record the decision
    INSERT INTO trapper.cat_match_decisions (left_cat_id, right_cat_id, decision, note, decided_by)
    VALUES (v_candidate.left_cat_id, v_candidate.right_cat_id, 'same_cat', p_note, p_decided_by)
    ON CONFLICT (left_cat_id, right_cat_id) DO UPDATE
    SET decision = 'same_cat', note = p_note, decided_by = p_decided_by, decided_at = NOW();

    -- Update candidate status
    UPDATE trapper.cat_match_candidates
    SET status = 'accepted',
        reviewed_at = NOW(),
        reviewed_by = p_decided_by,
        review_note = p_note
    WHERE candidate_id = p_candidate_id;

    -- NOTE: Actual merge would happen here, but we're being conservative
    -- For now, just mark as accepted. Future: call merge_cats() function
    RAISE NOTICE 'Cat match accepted. Manual merge required for cats % and %',
        v_candidate.left_cat_id, v_candidate.right_cat_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.reject_cat_match(
    p_candidate_id UUID,
    p_decided_by TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_candidate RECORD;
BEGIN
    SELECT * INTO v_candidate
    FROM trapper.cat_match_candidates
    WHERE candidate_id = p_candidate_id
      AND status = 'open';

    IF v_candidate.candidate_id IS NULL THEN
        RAISE EXCEPTION 'Candidate % not found or not open', p_candidate_id;
    END IF;

    -- Record the decision (blocks future candidates)
    INSERT INTO trapper.cat_match_decisions (left_cat_id, right_cat_id, decision, note, decided_by)
    VALUES (v_candidate.left_cat_id, v_candidate.right_cat_id, 'not_same_cat', p_note, p_decided_by)
    ON CONFLICT (left_cat_id, right_cat_id) DO UPDATE
    SET decision = 'not_same_cat', note = p_note, decided_by = p_decided_by, decided_at = NOW();

    -- Update candidate status
    UPDATE trapper.cat_match_candidates
    SET status = 'rejected',
        reviewed_at = NOW(),
        reviewed_by = p_decided_by,
        review_note = p_note
    WHERE candidate_id = p_candidate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.accept_cat_match IS
'Accepts a cat match candidate. Records decision and updates status.
NOTE: Does not auto-merge. Manual merge required.';

COMMENT ON FUNCTION trapper.reject_cat_match IS
'Rejects a cat match candidate. Records decision (blocks future matches) and updates status.';

-- ============================================
-- PART 7: View for cat match review
-- ============================================
\echo ''
\echo 'Creating v_cat_match_review view...'

CREATE OR REPLACE VIEW trapper.v_cat_match_review AS
SELECT
    cmc.candidate_id,
    cmc.left_cat_id,
    cmc.right_cat_id,
    c1.display_name AS left_name,
    c2.display_name AS right_name,
    c1.sex AS left_sex,
    c2.sex AS right_sex,
    c1.primary_color AS left_color,
    c2.primary_color AS right_color,
    cmc.match_score,
    cmc.match_reasons,
    cmc.score_breakdown,
    cmc.status,
    cmc.created_at,
    -- Check if either cat has a microchip
    EXISTS (SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = cmc.left_cat_id AND id_type = 'microchip') AS left_has_microchip,
    EXISTS (SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = cmc.right_cat_id AND id_type = 'microchip') AS right_has_microchip
FROM trapper.cat_match_candidates cmc
JOIN trapper.sot_cats c1 ON c1.cat_id = cmc.left_cat_id
JOIN trapper.sot_cats c2 ON c2.cat_id = cmc.right_cat_id
WHERE cmc.status = 'open'
ORDER BY cmc.match_score DESC, cmc.created_at;

COMMENT ON VIEW trapper.v_cat_match_review IS
'Cat match candidates for review. Shows physical attributes and microchip status.
Order by match_score DESC for highest-confidence candidates first.';

-- ============================================
-- PART 8: Cat match config
-- ============================================
\echo ''
\echo 'Adding cat match config settings...'

INSERT INTO trapper.entity_match_config
    (entity_type, config_key, config_value, description)
VALUES
    ('cat', 'enable_auto_merge', 0, 'Set to 1 to enable auto-merge (CONSERVATIVE: keep at 0)'),
    ('cat', 'auto_merge_min_score', 0.95, 'Minimum score for auto-merge (if enabled)'),
    ('cat', 'candidate_min_score', 0.40, 'Minimum score to create a match candidate'),
    ('cat', 'weight_sex_match', 0.15, 'Weight for sex attribute match'),
    ('cat', 'weight_color_match', 0.15, 'Weight for color attribute match'),
    ('cat', 'weight_name_similarity', 0.15, 'Weight for name similarity (low - cat names not unique)'),
    ('cat', 'weight_shared_owner', 0.20, 'Weight for shared owner context'),
    ('cat', 'weight_shared_place', 0.15, 'Weight for shared place context')
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
\echo 'MIG_036 Complete'
\echo '============================================'

\echo ''
\echo 'Cat match config:'
SELECT config_key, config_value, description
FROM trapper.entity_match_config
WHERE entity_type = 'cat'
ORDER BY config_key;

\echo ''
\echo 'To generate cat match candidates (review queue only):'
\echo ''
\echo '  SELECT * FROM trapper.generate_cat_match_candidates(0.4);'
\echo ''
\echo 'To view candidates for review:'
\echo ''
\echo '  SELECT candidate_id, left_name, right_name, left_color, right_color,'
\echo '         match_score, match_reasons'
\echo '  FROM trapper.v_cat_match_review'
\echo '  LIMIT 10;'
\echo ''
\echo 'To accept a match:'
\echo ''
\echo '  SELECT trapper.accept_cat_match(''<candidate_id>'', ''user@example.com'', ''Confirmed same cat'');'
\echo ''
\echo 'NOTE: Auto-merge is DISABLED by default. Set cat.enable_auto_merge = 1 to enable.'
\echo ''
