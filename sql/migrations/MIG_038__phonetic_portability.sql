-- MIG_038__phonetic_portability.sql
-- Portable phonetic function wrappers
--
-- Purpose:
--   Remove tiger-schema fragility by creating wrapper functions that:
--   1. Find fuzzystrmatch functions in any schema (public, tiger, extensions)
--   2. Gracefully degrade if phonetics not available
--   3. Enable matching to work (with reduced accuracy) without phonetics
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_038__phonetic_portability.sql

\echo '============================================'
\echo 'MIG_038: Phonetic Portability'
\echo '============================================'

-- ============================================
-- PART 1: Detect available phonetic backend
-- ============================================
\echo ''
\echo 'Detecting phonetic backend...'

-- Create a helper to detect which schema has the functions
CREATE OR REPLACE FUNCTION trapper.detect_phonetic_schema()
RETURNS TEXT AS $$
DECLARE
    v_schema TEXT;
BEGIN
    -- Check public schema first (standard location)
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'dmetaphone'
    ) THEN
        RETURN 'public';
    END IF;

    -- Check tiger schema (PostGIS geocoder includes fuzzystrmatch)
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tiger' AND p.proname = 'dmetaphone'
    ) THEN
        RETURN 'tiger';
    END IF;

    -- Check extensions schema
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'extensions' AND p.proname = 'dmetaphone'
    ) THEN
        RETURN 'extensions';
    END IF;

    -- Not found
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.detect_phonetic_schema IS
'Detects which schema contains fuzzystrmatch functions.
Returns: public, tiger, extensions, or NULL if not found.';

-- ============================================
-- PART 2: Portable dmetaphone wrapper
-- ============================================
\echo ''
\echo 'Creating trapper.dmetaphone wrapper...'

CREATE OR REPLACE FUNCTION trapper.dmetaphone(p_text TEXT)
RETURNS TEXT AS $$
DECLARE
    v_schema TEXT;
    v_result TEXT;
BEGIN
    -- Handle NULL/empty input
    IF p_text IS NULL OR TRIM(p_text) = '' THEN
        RETURN NULL;
    END IF;

    -- Detect backend schema
    v_schema := trapper.detect_phonetic_schema();

    IF v_schema IS NULL THEN
        -- No phonetic backend available - return NULL (graceful degradation)
        RETURN NULL;
    END IF;

    -- Call the appropriate backend
    CASE v_schema
        WHEN 'public' THEN
            EXECUTE 'SELECT public.dmetaphone($1)' INTO v_result USING p_text;
        WHEN 'tiger' THEN
            EXECUTE 'SELECT tiger.dmetaphone($1)' INTO v_result USING p_text;
        WHEN 'extensions' THEN
            EXECUTE 'SELECT extensions.dmetaphone($1)' INTO v_result USING p_text;
        ELSE
            RETURN NULL;
    END CASE;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- If anything goes wrong, gracefully return NULL
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.dmetaphone IS
'Portable double metaphone wrapper. Finds fuzzystrmatch in any schema.
Returns NULL if phonetics not available (graceful degradation).';

-- ============================================
-- PART 3: Portable difference wrapper
-- ============================================
\echo ''
\echo 'Creating trapper.difference wrapper...'

CREATE OR REPLACE FUNCTION trapper.difference(p_text1 TEXT, p_text2 TEXT)
RETURNS INT AS $$
DECLARE
    v_schema TEXT;
    v_result INT;
BEGIN
    -- Handle NULL/empty input
    IF p_text1 IS NULL OR p_text2 IS NULL
       OR TRIM(p_text1) = '' OR TRIM(p_text2) = '' THEN
        RETURN 0;
    END IF;

    -- Detect backend schema
    v_schema := trapper.detect_phonetic_schema();

    IF v_schema IS NULL THEN
        -- No phonetic backend available - return 0 (no contribution to score)
        RETURN 0;
    END IF;

    -- Call the appropriate backend
    CASE v_schema
        WHEN 'public' THEN
            EXECUTE 'SELECT public.difference($1, $2)' INTO v_result USING p_text1, p_text2;
        WHEN 'tiger' THEN
            EXECUTE 'SELECT tiger.difference($1, $2)' INTO v_result USING p_text1, p_text2;
        WHEN 'extensions' THEN
            EXECUTE 'SELECT extensions.difference($1, $2)' INTO v_result USING p_text1, p_text2;
        ELSE
            RETURN 0;
    END CASE;

    RETURN COALESCE(v_result, 0);

EXCEPTION WHEN OTHERS THEN
    -- If anything goes wrong, gracefully return 0
    RETURN 0;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.difference IS
'Portable soundex difference wrapper. Finds fuzzystrmatch in any schema.
Returns 0 if phonetics not available (graceful degradation).';

-- ============================================
-- PART 4: Portable soundex wrapper (for completeness)
-- ============================================
\echo ''
\echo 'Creating trapper.soundex wrapper...'

CREATE OR REPLACE FUNCTION trapper.soundex(p_text TEXT)
RETURNS TEXT AS $$
DECLARE
    v_schema TEXT;
    v_result TEXT;
BEGIN
    IF p_text IS NULL OR TRIM(p_text) = '' THEN
        RETURN NULL;
    END IF;

    v_schema := trapper.detect_phonetic_schema();

    IF v_schema IS NULL THEN
        RETURN NULL;
    END IF;

    CASE v_schema
        WHEN 'public' THEN
            EXECUTE 'SELECT public.soundex($1)' INTO v_result USING p_text;
        WHEN 'tiger' THEN
            EXECUTE 'SELECT tiger.soundex($1)' INTO v_result USING p_text;
        WHEN 'extensions' THEN
            EXECUTE 'SELECT extensions.soundex($1)' INTO v_result USING p_text;
        ELSE
            RETURN NULL;
    END CASE;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.soundex IS
'Portable soundex wrapper. Finds fuzzystrmatch in any schema.';

-- ============================================
-- PART 5: Phonetic availability check
-- ============================================
\echo ''
\echo 'Creating phonetic availability check...'

CREATE OR REPLACE FUNCTION trapper.phonetic_backend_status()
RETURNS JSONB AS $$
DECLARE
    v_schema TEXT;
    v_test_result TEXT;
BEGIN
    v_schema := trapper.detect_phonetic_schema();

    IF v_schema IS NULL THEN
        RETURN jsonb_build_object(
            'available', FALSE,
            'schema', NULL,
            'mode', 'disabled',
            'message', 'No fuzzystrmatch extension found. Phonetic matching disabled.'
        );
    END IF;

    -- Test the functions
    v_test_result := trapper.dmetaphone('test');

    RETURN jsonb_build_object(
        'available', TRUE,
        'schema', v_schema,
        'mode', 'enabled',
        'test_dmetaphone', v_test_result,
        'message', 'Phonetic matching enabled via ' || v_schema || ' schema.'
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.phonetic_backend_status IS
'Returns JSON status of phonetic backend availability.
Use to verify phonetic matching is working.';

-- ============================================
-- PART 6: Update encode_name_phonetic to use wrappers
-- ============================================
\echo ''
\echo 'Updating encode_name_phonetic to use portable wrappers...'

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

    -- Use portable wrappers (will return NULL if phonetics unavailable)
    RETURN QUERY SELECT
        v_first,
        v_last,
        trapper.dmetaphone(v_first),
        trapper.dmetaphone(v_last),
        CASE
            WHEN trapper.dmetaphone(v_first) IS NOT NULL AND trapper.dmetaphone(v_last) IS NOT NULL
            THEN trapper.dmetaphone(v_first) || '-' || trapper.dmetaphone(v_last)
            ELSE NULL
        END;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 7: Update phonetic_name_similarity to use wrappers
-- ============================================
\echo ''
\echo 'Updating phonetic_name_similarity to use portable wrappers...'

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
    v_phonetics_available BOOLEAN;
BEGIN
    SELECT * INTO v_enc1 FROM trapper.encode_name_phonetic(p_name1);
    SELECT * INTO v_enc2 FROM trapper.encode_name_phonetic(p_name2);

    -- Check if phonetics are available
    v_phonetics_available := (v_enc1.metaphone_first IS NOT NULL);

    -- Exact first name match
    IF v_enc1.first_token = v_enc2.first_token THEN
        v_score := v_score + 0.25;
        v_reasons := v_reasons || '"first_exact"'::JSONB;
    -- Phonetic first name match (only if phonetics available)
    ELSIF v_phonetics_available
          AND v_enc1.metaphone_first IS NOT NULL
          AND v_enc1.metaphone_first = v_enc2.metaphone_first THEN
        v_score := v_score + 0.20;
        v_reasons := v_reasons || ('"first_phonetic:' || v_enc1.metaphone_first || '"')::JSONB;
    END IF;

    -- Exact last name match
    IF v_enc1.last_token = v_enc2.last_token THEN
        v_score := v_score + 0.30;
        v_reasons := v_reasons || '"last_exact"'::JSONB;
    -- Phonetic last name match (only if phonetics available)
    ELSIF v_phonetics_available
          AND v_enc1.metaphone_last IS NOT NULL
          AND v_enc1.metaphone_last = v_enc2.metaphone_last THEN
        v_score := v_score + 0.25;
        v_reasons := v_reasons || ('"last_phonetic:' || v_enc1.metaphone_last || '"')::JSONB;
    END IF;

    -- Trigram similarity bonus (always available via pg_trgm)
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

    -- Soundex similarity as tiebreaker (uses portable wrapper)
    IF trapper.difference(v_enc1.first_token, v_enc2.first_token) = 4 THEN
        v_score := v_score + 0.05;
        v_reasons := v_reasons || '"soundex_first_4"'::JSONB;
    END IF;
    IF trapper.difference(v_enc1.last_token, v_enc2.last_token) = 4 THEN
        v_score := v_score + 0.05;
        v_reasons := v_reasons || '"soundex_last_4"'::JSONB;
    END IF;

    RETURN jsonb_build_object(
        'score', ROUND(LEAST(v_score, 1.0), 3),
        'reasons', v_reasons,
        'name1_enc', v_enc1.full_metaphone,
        'name2_enc', v_enc2.full_metaphone,
        'phonetics_enabled', v_phonetics_available
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 8: Update trigger to use wrapper
-- ============================================
\echo ''
\echo 'Updating alias trigger to use portable wrappers...'

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

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_038 Complete'
\echo '============================================'

\echo ''
\echo 'Phonetic backend status:'
SELECT trapper.phonetic_backend_status();

\echo ''
\echo 'Wrapper function test:'
SELECT
    trapper.dmetaphone('Smith') AS smith_metaphone,
    trapper.dmetaphone('Smyth') AS smyth_metaphone,
    trapper.difference('Smith', 'Smyth') AS smith_smyth_diff;

\echo ''
\echo 'Phonetic similarity test (should still work):'
SELECT trapper.phonetic_name_similarity('Susan Smith', 'Susana Smyth');

\echo ''
\echo 'Wrapper functions are now portable and schema-agnostic.'
\echo 'If phonetics are unavailable, matching will use trigram + exact only.'
\echo ''
