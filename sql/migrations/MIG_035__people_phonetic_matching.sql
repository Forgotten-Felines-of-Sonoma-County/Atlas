-- MIG_035__people_phonetic_matching.sql
-- Enhanced person matching with phonetic algorithms and context scoring
--
-- Purpose:
--   Add phonetic matching (metaphone/double metaphone) to handle name variations
--   like Susan/Susana, Smith/Smyth. Expand candidate scoring to include context
--   signals (shared address, shared cats) with explainable reason breakdowns.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_035__people_phonetic_matching.sql

\echo '============================================'
\echo 'MIG_035: People Phonetic Matching'
\echo '============================================'

-- ============================================
-- PART 1: Enable fuzzystrmatch extension
-- ============================================
\echo ''
\echo 'Enabling fuzzystrmatch extension...'

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

\echo '  Extension enabled.'

-- ============================================
-- PART 2: Add phonetic columns to person_aliases
-- ============================================
\echo ''
\echo 'Adding phonetic columns to person_aliases...'

-- metaphone_first: Metaphone of first name token
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'person_aliases'
        AND column_name = 'metaphone_first'
    ) THEN
        ALTER TABLE trapper.person_aliases
        ADD COLUMN metaphone_first TEXT;

        COMMENT ON COLUMN trapper.person_aliases.metaphone_first IS
        'Double metaphone encoding of first name token for phonetic matching.';
    END IF;
END $$;

-- metaphone_last: Metaphone of last name token
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'person_aliases'
        AND column_name = 'metaphone_last'
    ) THEN
        ALTER TABLE trapper.person_aliases
        ADD COLUMN metaphone_last TEXT;

        COMMENT ON COLUMN trapper.person_aliases.metaphone_last IS
        'Double metaphone encoding of last name token for phonetic matching.';
    END IF;
END $$;

\echo '  Columns added.'

-- ============================================
-- PART 3: Function to extract and encode name parts
-- ============================================
\echo ''
\echo 'Creating encode_name_phonetic function...'

CREATE OR REPLACE FUNCTION trapper.encode_name_phonetic(p_name TEXT)
RETURNS TABLE (
    first_token TEXT,
    last_token TEXT,
    metaphone_first TEXT,
    metaphone_last TEXT,
    full_metaphone TEXT
) AS $$
DECLARE
    v_tokens TEXT[];
    v_first TEXT;
    v_last TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- Normalize and split into tokens
    v_tokens := STRING_TO_ARRAY(
        REGEXP_REPLACE(LOWER(TRIM(p_name)), '[^a-z\s]', '', 'g'),
        ' '
    );
    v_tokens := ARRAY_REMOVE(v_tokens, '');

    IF array_length(v_tokens, 1) IS NULL OR array_length(v_tokens, 1) < 1 THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    v_first := v_tokens[1];
    v_last := v_tokens[array_length(v_tokens, 1)];

    RETURN QUERY SELECT
        v_first,
        v_last,
        tiger.dmetaphone(v_first),
        tiger.dmetaphone(v_last),
        tiger.dmetaphone(v_first) || '-' || tiger.dmetaphone(v_last);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.encode_name_phonetic IS
'Extracts first/last name tokens and computes double metaphone encodings.
Example: "Susan Smith" → first="susan", last="smith", metaphone_first="SSN", metaphone_last="SM0"';

-- ============================================
-- PART 4: Backfill existing aliases with phonetic codes
-- ============================================
\echo ''
\echo 'Backfilling phonetic codes...'

UPDATE trapper.person_aliases pa
SET
    metaphone_first = enc.metaphone_first,
    metaphone_last = enc.metaphone_last
FROM (
    SELECT
        pa2.alias_id,
        (trapper.encode_name_phonetic(pa2.name_raw)).*
    FROM trapper.person_aliases pa2
    WHERE pa2.metaphone_first IS NULL
) enc
WHERE pa.alias_id = enc.alias_id;

-- ============================================
-- PART 5: Indexes for phonetic lookups
-- ============================================
\echo ''
\echo 'Creating phonetic indexes...'

CREATE INDEX IF NOT EXISTS idx_person_aliases_metaphone_first
ON trapper.person_aliases (metaphone_first)
WHERE metaphone_first IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_aliases_metaphone_last
ON trapper.person_aliases (metaphone_last)
WHERE metaphone_last IS NOT NULL;

-- Composite index for both
CREATE INDEX IF NOT EXISTS idx_person_aliases_metaphone_both
ON trapper.person_aliases (metaphone_first, metaphone_last)
WHERE metaphone_first IS NOT NULL AND metaphone_last IS NOT NULL;

\echo '  Indexes created.'

-- ============================================
-- PART 6: Function to calculate phonetic similarity
-- ============================================
\echo ''
\echo 'Creating phonetic_name_similarity function...'

CREATE OR REPLACE FUNCTION trapper.phonetic_name_similarity(
    p_name1 TEXT,
    p_name2 TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_enc1 RECORD;
    v_enc2 RECORD;
    v_score NUMERIC := 0;
    v_reasons JSONB := '[]'::JSONB;
BEGIN
    SELECT * INTO v_enc1 FROM trapper.encode_name_phonetic(p_name1);
    SELECT * INTO v_enc2 FROM trapper.encode_name_phonetic(p_name2);

    -- Exact first name match
    IF v_enc1.first_token = v_enc2.first_token THEN
        v_score := v_score + 0.25;
        v_reasons := v_reasons || '"first_exact"'::JSONB;
    -- Phonetic first name match
    ELSIF v_enc1.metaphone_first IS NOT NULL
          AND v_enc1.metaphone_first = v_enc2.metaphone_first THEN
        v_score := v_score + 0.20;
        v_reasons := v_reasons || ('"first_phonetic:' || v_enc1.metaphone_first || '"')::JSONB;
    END IF;

    -- Exact last name match
    IF v_enc1.last_token = v_enc2.last_token THEN
        v_score := v_score + 0.30;
        v_reasons := v_reasons || '"last_exact"'::JSONB;
    -- Phonetic last name match
    ELSIF v_enc1.metaphone_last IS NOT NULL
          AND v_enc1.metaphone_last = v_enc2.metaphone_last THEN
        v_score := v_score + 0.25;
        v_reasons := v_reasons || ('"last_phonetic:' || v_enc1.metaphone_last || '"')::JSONB;
    END IF;

    -- Trigram similarity bonus
    DECLARE
        v_trgm_score NUMERIC;
    BEGIN
        v_trgm_score := trapper.name_similarity(p_name1, p_name2);
        IF v_trgm_score >= 0.8 THEN
            v_score := v_score + 0.25;
            v_reasons := v_reasons || ('"trigram:' || ROUND(v_trgm_score, 2)::TEXT || '"')::JSONB;
        ELSIF v_trgm_score >= 0.6 THEN
            v_score := v_score + 0.15;
            v_reasons := v_reasons || ('"trigram:' || ROUND(v_trgm_score, 2)::TEXT || '"')::JSONB;
        ELSIF v_trgm_score >= 0.4 THEN
            v_score := v_score + 0.05;
            v_reasons := v_reasons || ('"trigram:' || ROUND(v_trgm_score, 2)::TEXT || '"')::JSONB;
        END IF;
    END;

    -- Soundex similarity as tiebreaker
    IF tiger.difference(v_enc1.first_token, v_enc2.first_token) = 4 THEN
        v_score := v_score + 0.05;
        v_reasons := v_reasons || '"soundex_first_4"'::JSONB;
    END IF;
    IF tiger.difference(v_enc1.last_token, v_enc2.last_token) = 4 THEN
        v_score := v_score + 0.05;
        v_reasons := v_reasons || '"soundex_last_4"'::JSONB;
    END IF;

    RETURN jsonb_build_object(
        'score', ROUND(LEAST(v_score, 1.0), 3),
        'reasons', v_reasons,
        'name1_enc', v_enc1.full_metaphone,
        'name2_enc', v_enc2.full_metaphone
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.phonetic_name_similarity IS
'Calculates name similarity using multiple methods:
- Exact first/last name match (highest weight)
- Phonetic match via double metaphone
- Trigram similarity
- Soundex similarity (tiebreaker)
Returns JSONB with score (0-1) and detailed reasons.';

-- ============================================
-- PART 7: Context-aware person match scoring
-- ============================================
\echo ''
\echo 'Creating score_person_match_candidate function...'

CREATE OR REPLACE FUNCTION trapper.score_person_match_candidate(
    p_person_id_1 UUID,
    p_person_id_2 UUID
)
RETURNS JSONB AS $$
DECLARE
    v_p1 RECORD;
    v_p2 RECORD;
    v_score NUMERIC := 0;
    v_reasons JSONB := '[]'::JSONB;
    v_breakdown JSONB := '{}'::JSONB;
    v_name_sim JSONB;
    v_shared_phones INT;
    v_shared_emails INT;
    v_shared_addresses INT;
    v_shared_cats INT;
    v_weight_phone NUMERIC;
    v_weight_email NUMERIC;
    v_weight_name NUMERIC;
    v_weight_address NUMERIC;
    v_weight_cat NUMERIC;
BEGIN
    -- Get both people
    SELECT * INTO v_p1 FROM trapper.sot_people WHERE person_id = p_person_id_1 AND merged_into_person_id IS NULL;
    SELECT * INTO v_p2 FROM trapper.sot_people WHERE person_id = p_person_id_2 AND merged_into_person_id IS NULL;

    IF v_p1.person_id IS NULL OR v_p2.person_id IS NULL THEN
        RETURN jsonb_build_object('score', 0, 'error', 'person_not_found_or_merged');
    END IF;

    -- Get weights from config
    v_weight_phone := trapper.get_match_config('person', 'weight_phone_match', 1.0);
    v_weight_email := trapper.get_match_config('person', 'weight_email_match', 0.9);
    v_weight_name := trapper.get_match_config('person', 'weight_name_similarity', 0.3);
    v_weight_address := trapper.get_match_config('person', 'weight_shared_address', 0.2);
    v_weight_cat := trapper.get_match_config('person', 'weight_shared_cat', 0.1);

    -- ========== DETERMINISTIC SIGNALS ==========

    -- Check for shared phone (deterministic - should already be same person)
    SELECT COUNT(*) INTO v_shared_phones
    FROM trapper.person_identifiers i1
    JOIN trapper.person_identifiers i2 ON i1.id_value_norm = i2.id_value_norm AND i1.id_type = i2.id_type
    WHERE i1.person_id = p_person_id_1
      AND i2.person_id = p_person_id_2
      AND i1.id_type = 'phone';

    IF v_shared_phones > 0 THEN
        v_score := v_score + v_weight_phone;
        v_reasons := v_reasons || '"shared_phone"'::JSONB;
        v_breakdown := v_breakdown || jsonb_build_object('phone_match', v_weight_phone);
    END IF;

    -- Check for shared email (deterministic)
    SELECT COUNT(*) INTO v_shared_emails
    FROM trapper.person_identifiers i1
    JOIN trapper.person_identifiers i2 ON i1.id_value_norm = i2.id_value_norm AND i1.id_type = i2.id_type
    WHERE i1.person_id = p_person_id_1
      AND i2.person_id = p_person_id_2
      AND i1.id_type = 'email';

    IF v_shared_emails > 0 THEN
        v_score := v_score + v_weight_email;
        v_reasons := v_reasons || '"shared_email"'::JSONB;
        v_breakdown := v_breakdown || jsonb_build_object('email_match', v_weight_email);
    END IF;

    -- ========== FUZZY NAME SIGNALS ==========

    -- Phonetic name similarity
    v_name_sim := trapper.phonetic_name_similarity(v_p1.display_name, v_p2.display_name);
    DECLARE
        v_name_score NUMERIC;
    BEGIN
        v_name_score := (v_name_sim->>'score')::NUMERIC * v_weight_name;
        IF v_name_score > 0 THEN
            v_score := v_score + v_name_score;
            v_reasons := v_reasons || ('"name_sim:' || ROUND((v_name_sim->>'score')::NUMERIC, 2)::TEXT || '"')::JSONB;
            v_breakdown := v_breakdown || jsonb_build_object(
                'name_similarity', v_name_score,
                'name_details', v_name_sim
            );
        END IF;
    END;

    -- ========== CONTEXTUAL SIGNALS ==========

    -- Shared address context
    SELECT COUNT(DISTINCT a.address_id) INTO v_shared_addresses
    FROM trapper.staged_record_person_link l1
    JOIN trapper.staged_record_address_link a1 ON a1.staged_record_id = l1.staged_record_id
    JOIN trapper.staged_record_person_link l2 ON l2.staged_record_id = a1.staged_record_id
    JOIN trapper.sot_addresses a ON a.address_id = a1.address_id
    WHERE l1.person_id = p_person_id_1
      AND l2.person_id = p_person_id_2
      AND l1.person_id != l2.person_id;

    IF v_shared_addresses > 0 THEN
        v_score := v_score + v_weight_address;
        v_reasons := v_reasons || ('"shared_address:' || v_shared_addresses || '"')::JSONB;
        v_breakdown := v_breakdown || jsonb_build_object('shared_addresses', v_shared_addresses);
    END IF;

    -- Shared cats
    SELECT COUNT(DISTINCT c1.cat_id) INTO v_shared_cats
    FROM trapper.person_cat_relationships c1
    JOIN trapper.person_cat_relationships c2 ON c1.cat_id = c2.cat_id
    WHERE c1.person_id = p_person_id_1
      AND c2.person_id = p_person_id_2
      AND c1.person_id != c2.person_id;

    IF v_shared_cats > 0 THEN
        v_score := v_score + v_weight_cat;
        v_reasons := v_reasons || ('"shared_cats:' || v_shared_cats || '"')::JSONB;
        v_breakdown := v_breakdown || jsonb_build_object('shared_cats', v_shared_cats);
    END IF;

    -- Cap at 1.0
    v_score := LEAST(v_score, 1.0);

    RETURN jsonb_build_object(
        'score', ROUND(v_score, 3),
        'reasons', v_reasons,
        'breakdown', v_breakdown,
        'person_1', jsonb_build_object('id', p_person_id_1, 'name', v_p1.display_name),
        'person_2', jsonb_build_object('id', p_person_id_2, 'name', v_p2.display_name)
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.score_person_match_candidate IS
'Comprehensive person match scoring with explainable results.
Includes:
- Deterministic: shared phone (1.0), shared email (0.9)
- Fuzzy: phonetic name similarity (trigram + metaphone + soundex)
- Context: shared addresses (0.2), shared cats (0.1)
Returns JSONB with score, reasons array, and detailed breakdown.';

-- ============================================
-- PART 8: Enhanced candidate generation with phonetic matching
-- ============================================
\echo ''
\echo 'Creating generate_phonetic_match_candidates function...'

CREATE OR REPLACE FUNCTION trapper.generate_phonetic_match_candidates(
    p_min_score NUMERIC DEFAULT 0.5
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
    -- Find pairs with matching metaphone patterns (but not already candidates)
    FOR rec IN
        SELECT DISTINCT
            LEAST(pa1.person_id, pa2.person_id) AS left_person_id,
            GREATEST(pa1.person_id, pa2.person_id) AS right_person_id
        FROM trapper.person_aliases pa1
        JOIN trapper.person_aliases pa2
            ON pa1.metaphone_last = pa2.metaphone_last  -- Same phonetic last name
            AND pa1.person_id < pa2.person_id           -- Avoid duplicates
        JOIN trapper.sot_people p1 ON p1.person_id = pa1.person_id
            AND p1.merged_into_person_id IS NULL
        JOIN trapper.sot_people p2 ON p2.person_id = pa2.person_id
            AND p2.merged_into_person_id IS NULL
        WHERE pa1.metaphone_last IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM trapper.person_match_candidates c
              WHERE c.left_person_id = LEAST(pa1.person_id, pa2.person_id)
                AND c.right_person_id = GREATEST(pa1.person_id, pa2.person_id)
          )
          AND NOT trapper.is_pair_blocked(pa1.person_id, pa2.person_id)
    LOOP
        -- Score the candidate
        v_score_result := trapper.score_person_match_candidate(rec.left_person_id, rec.right_person_id);

        IF (v_score_result->>'score')::NUMERIC >= p_min_score THEN
            INSERT INTO trapper.person_match_candidates (
                left_person_id,
                right_person_id,
                match_score,
                match_reasons
            )
            VALUES (
                rec.left_person_id,
                rec.right_person_id,
                (v_score_result->>'score')::NUMERIC,
                ARRAY(SELECT jsonb_array_elements_text(v_score_result->'reasons'))
            )
            ON CONFLICT (left_person_id, right_person_id) DO UPDATE
            SET match_score = EXCLUDED.match_score,
                match_reasons = EXCLUDED.match_reasons,
                updated_at = NOW();

            v_created := v_created + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_created, v_skipped;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.generate_phonetic_match_candidates IS
'Generates match candidates based on phonetic similarity (same metaphone last name).
Uses comprehensive scoring including name similarity and context.
Default minimum score is 0.5.';

-- ============================================
-- PART 9: View for reviewing candidates with full scoring
-- ============================================
\echo ''
\echo 'Creating v_person_match_review view...'

CREATE OR REPLACE VIEW trapper.v_person_match_review AS
SELECT
    c.candidate_id,
    c.left_person_id,
    c.right_person_id,
    p1.display_name AS left_name,
    p2.display_name AS right_name,
    c.match_score,
    c.match_reasons,
    c.status,
    c.created_at,
    trapper.score_person_match_candidate(c.left_person_id, c.right_person_id) AS full_score_breakdown,
    -- Conflict indicators
    trapper.have_conflicting_identifiers(c.left_person_id, c.right_person_id) AS has_conflicts,
    trapper.have_shared_address_context(c.left_person_id, c.right_person_id) AS has_shared_address
FROM trapper.person_match_candidates c
JOIN trapper.sot_people p1 ON p1.person_id = c.left_person_id
JOIN trapper.sot_people p2 ON p2.person_id = c.right_person_id
WHERE c.status = 'open'
ORDER BY c.match_score DESC, c.created_at;

COMMENT ON VIEW trapper.v_person_match_review IS
'Enhanced view for reviewing person match candidates.
Includes full score breakdown, conflict indicators, and shared address status.';

-- ============================================
-- PART 10: Trigger to auto-populate phonetic codes on alias insert
-- ============================================
\echo ''
\echo 'Creating trigger for phonetic code population...'

CREATE OR REPLACE FUNCTION trapper.trigger_populate_alias_phonetic()
RETURNS TRIGGER AS $$
DECLARE
    v_enc RECORD;
BEGIN
    IF NEW.metaphone_first IS NULL OR NEW.metaphone_last IS NULL THEN
        SELECT * INTO v_enc FROM trapper.encode_name_phonetic(NEW.name_raw);
        NEW.metaphone_first := v_enc.metaphone_first;
        NEW.metaphone_last := v_enc.metaphone_last;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_person_aliases_phonetic ON trapper.person_aliases;
CREATE TRIGGER trg_person_aliases_phonetic
    BEFORE INSERT OR UPDATE ON trapper.person_aliases
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trigger_populate_alias_phonetic();

\echo '  Trigger created.'

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_035 Complete'
\echo '============================================'

\echo ''
\echo 'Phonetic encodings populated:'
SELECT
    COUNT(*) AS total_aliases,
    COUNT(*) FILTER (WHERE metaphone_first IS NOT NULL) AS with_metaphone_first,
    COUNT(*) FILTER (WHERE metaphone_last IS NOT NULL) AS with_metaphone_last
FROM trapper.person_aliases;

\echo ''
\echo 'Example phonetic similarity test (Susan Smith vs Susana Smyth):'
SELECT * FROM trapper.phonetic_name_similarity('Susan Smith', 'Susana Smyth');

\echo ''
\echo 'Example phonetic similarity test (John Doe vs Jonathan Doe):'
SELECT * FROM trapper.phonetic_name_similarity('John Doe', 'Jonathan Doe');

\echo ''
\echo 'To generate phonetic match candidates:'
\echo ''
\echo '  SELECT * FROM trapper.generate_phonetic_match_candidates(0.5);'
\echo ''
\echo 'To view candidates for review:'
\echo ''
\echo '  SELECT candidate_id, left_name, right_name, match_score, match_reasons'
\echo '  FROM trapper.v_person_match_review'
\echo '  LIMIT 10;'
\echo ''
