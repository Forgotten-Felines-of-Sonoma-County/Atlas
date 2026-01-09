-- MIG_010__identity_foundation.sql
-- Identity Resolution Foundation: Extensions + Normalizers
--
-- Creates:
--   - pg_trgm, unaccent extensions (if not already)
--   - trapper.norm_email(text) -> text
--   - trapper.norm_phone_us(text) -> text
--   - trapper.norm_name_key(text) -> text
--   - trapper.name_similarity(a,b) -> float
--
-- Purpose:
--   - Provide consistent normalization for identity matching
--   - Enable fuzzy string matching with pg_trgm
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_010__identity_foundation.sql

\echo '============================================'
\echo 'MIG_010: Identity Foundation (Extensions + Normalizers)'
\echo '============================================'

-- ============================================
-- PART 1: Extensions
-- ============================================
\echo ''
\echo 'Enabling extensions...'

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

\echo '  pg_trgm, unaccent, fuzzystrmatch enabled'

-- ============================================
-- PART 2: Email Normalizer
-- ============================================
\echo ''
\echo 'Creating norm_email function...'

CREATE OR REPLACE FUNCTION trapper.norm_email(p_email TEXT)
RETURNS TEXT AS $$
DECLARE
    v_result TEXT;
    v_local TEXT;
    v_domain TEXT;
BEGIN
    IF p_email IS NULL OR TRIM(p_email) = '' THEN
        RETURN NULL;
    END IF;

    -- Lowercase and trim
    v_result := LOWER(TRIM(p_email));

    -- Must contain @
    IF v_result NOT LIKE '%@%' THEN
        RETURN NULL;
    END IF;

    -- Split into local and domain
    v_local := SPLIT_PART(v_result, '@', 1);
    v_domain := SPLIT_PART(v_result, '@', 2);

    -- Handle Gmail plus addressing (user+tag@gmail.com -> user@gmail.com)
    IF v_domain IN ('gmail.com', 'googlemail.com') THEN
        v_local := SPLIT_PART(v_local, '+', 1);
        -- Gmail ignores dots in local part
        v_local := REPLACE(v_local, '.', '');
        v_domain := 'gmail.com';  -- Normalize googlemail.com
    ELSE
        -- For other providers, just strip +tag
        v_local := SPLIT_PART(v_local, '+', 1);
    END IF;

    RETURN v_local || '@' || v_domain;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.norm_email IS
'Normalizes email addresses:
- Lowercases
- Strips +tags
- Gmail: removes dots, normalizes googlemail.com
Returns NULL for invalid emails.';

-- ============================================
-- PART 3: US Phone Normalizer
-- ============================================
\echo 'Creating norm_phone_us function...'

CREATE OR REPLACE FUNCTION trapper.norm_phone_us(p_phone TEXT)
RETURNS TEXT AS $$
DECLARE
    v_digits TEXT;
BEGIN
    IF p_phone IS NULL OR TRIM(p_phone) = '' THEN
        RETURN NULL;
    END IF;

    -- Extract only digits
    v_digits := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

    -- Handle common US formats
    IF LENGTH(v_digits) = 11 AND v_digits LIKE '1%' THEN
        -- Strip leading 1 for US country code
        v_digits := SUBSTRING(v_digits FROM 2);
    END IF;

    -- Valid US phone is 10 digits
    IF LENGTH(v_digits) != 10 THEN
        RETURN NULL;
    END IF;

    -- Format as 10-digit string (no separators for matching)
    RETURN v_digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.norm_phone_us IS
'Normalizes US phone numbers to 10-digit format.
Strips country code, punctuation, spaces.
Returns NULL if not a valid 10-digit US number.';

-- ============================================
-- PART 4: Name Key Normalizer
-- ============================================
\echo 'Creating norm_name_key function...'

CREATE OR REPLACE FUNCTION trapper.norm_name_key(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_result TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN NULL;
    END IF;

    -- Start with unaccent + lowercase
    v_result := LOWER(unaccent(TRIM(p_name)));

    -- Remove punctuation except spaces and hyphens
    v_result := REGEXP_REPLACE(v_result, '[^a-z0-9\s\-]', '', 'g');

    -- Normalize multiple spaces/hyphens to single space
    v_result := REGEXP_REPLACE(v_result, '[\s\-]+', ' ', 'g');

    -- Trim again
    v_result := TRIM(v_result);

    IF v_result = '' THEN
        RETURN NULL;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.norm_name_key IS
'Normalizes names for matching:
- Removes accents (unaccent)
- Lowercases
- Removes punctuation (keeps letters, numbers, spaces)
- Collapses multiple spaces
Returns NULL for empty/null input.';

-- ============================================
-- PART 5: Name Similarity Function
-- ============================================
\echo 'Creating name_similarity function...'

CREATE OR REPLACE FUNCTION trapper.name_similarity(p_name_a TEXT, p_name_b TEXT)
RETURNS NUMERIC AS $$
DECLARE
    v_key_a TEXT;
    v_key_b TEXT;
BEGIN
    v_key_a := trapper.norm_name_key(p_name_a);
    v_key_b := trapper.norm_name_key(p_name_b);

    IF v_key_a IS NULL OR v_key_b IS NULL THEN
        RETURN 0;
    END IF;

    -- Use pg_trgm similarity (0-1 scale)
    RETURN similarity(v_key_a, v_key_b);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.name_similarity IS
'Returns similarity score (0-1) between two names using pg_trgm.
Normalizes both names first via norm_name_key.
Higher = more similar. 1.0 = identical after normalization.';

-- ============================================
-- PART 6: Helper - Extract Last Token (for last name matching)
-- ============================================
\echo 'Creating extract_last_token function...'

CREATE OR REPLACE FUNCTION trapper.extract_last_token(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_key TEXT;
    v_tokens TEXT[];
BEGIN
    v_key := trapper.norm_name_key(p_name);
    IF v_key IS NULL THEN
        RETURN NULL;
    END IF;

    v_tokens := STRING_TO_ARRAY(v_key, ' ');
    IF ARRAY_LENGTH(v_tokens, 1) < 1 THEN
        RETURN NULL;
    END IF;

    RETURN v_tokens[ARRAY_LENGTH(v_tokens, 1)];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_last_token IS
'Extracts the last space-separated token from a name.
Typically the last name. Uses norm_name_key internally.';

-- ============================================
-- PART 7: Helper - Token Count
-- ============================================
\echo 'Creating name_token_count function...'

CREATE OR REPLACE FUNCTION trapper.name_token_count(p_name TEXT)
RETURNS INT AS $$
DECLARE
    v_key TEXT;
BEGIN
    v_key := trapper.norm_name_key(p_name);
    IF v_key IS NULL THEN
        RETURN 0;
    END IF;

    RETURN ARRAY_LENGTH(STRING_TO_ARRAY(v_key, ' '), 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.name_token_count IS
'Returns number of space-separated tokens in a name after normalization.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_010 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Extensions installed:'
SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent', 'fuzzystrmatch');

\echo ''
\echo 'Testing norm_email:'
SELECT
    'john.doe+test@gmail.com' AS input,
    trapper.norm_email('john.doe+test@gmail.com') AS normalized;

\echo ''
\echo 'Testing norm_phone_us:'
SELECT
    '(707) 555-1234' AS input,
    trapper.norm_phone_us('(707) 555-1234') AS normalized;

\echo ''
\echo 'Testing norm_name_key:'
SELECT
    trapper.norm_name_key('Jenna Folley') AS key1,
    trapper.norm_name_key('Jenna Foley') AS key2;

\echo ''
\echo 'Testing name_similarity:'
SELECT
    'Jenna Folley' AS name_a,
    'Jenna Foley' AS name_b,
    ROUND(trapper.name_similarity('Jenna Folley', 'Jenna Foley')::numeric, 3) AS similarity;

\echo ''
\echo 'Testing extract_last_token:'
SELECT
    'John Michael Smith' AS full_name,
    trapper.extract_last_token('John Michael Smith') AS last_token;

\echo ''
\echo 'MIG_010 ready for MIG_011 (people core tables).'
\echo ''
