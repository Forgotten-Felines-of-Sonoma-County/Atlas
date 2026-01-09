-- MIG_005__name_candidates_and_kind.sql
-- Name classification system for identity resolution
--
-- Creates:
--   - name_kind enum: person, place, unknown, nonsense
--   - trapper.name_candidates: tracks name values with classification
--
-- Purpose:
--   - Classify names as person vs place vs nonsense before creating entities
--   - Transparent heuristics that can be reviewed and overridden
--   - Evidence-first: even nonsense names are tracked, not discarded
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_005__name_candidates_and_kind.sql

\echo '============================================'
\echo 'MIG_005: Name Candidates and Kind Classification'
\echo '============================================'

-- ============================================
-- PART 1: Name Kind Enum
-- ============================================
\echo ''
\echo 'Creating name_kind enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'name_kind') THEN
        CREATE TYPE trapper.name_kind AS ENUM ('person', 'place', 'unknown', 'nonsense');
    END IF;
END$$;

-- ============================================
-- PART 2: Name Candidates Table
-- ============================================
\echo 'Creating name_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.name_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source linkage
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_row_id TEXT,
    staged_record_id UUID,  -- FK to staged_records if available

    -- Raw and normalized values
    raw_name TEXT NOT NULL,
    normalized_name TEXT,
    field_name TEXT NOT NULL,  -- Which field this came from (e.g., 'Requester Name')

    -- Classification
    name_kind_suggested trapper.name_kind NOT NULL DEFAULT 'unknown',
    confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    reasons JSONB NOT NULL DEFAULT '[]',

    -- Review status
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'overridden')),
    overridden_kind trapper.name_kind,
    reviewer_notes TEXT,

    -- Resolved entity (once linked)
    resolved_person_id UUID,
    resolved_place_id UUID,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate candidates for same source/field combination
    UNIQUE (source_system, source_table, source_row_id, field_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_name_candidates_status ON trapper.name_candidates (status);
CREATE INDEX IF NOT EXISTS idx_name_candidates_kind ON trapper.name_candidates (name_kind_suggested);
CREATE INDEX IF NOT EXISTS idx_name_candidates_staged ON trapper.name_candidates (staged_record_id);
CREATE INDEX IF NOT EXISTS idx_name_candidates_source ON trapper.name_candidates (source_system, source_table);

COMMENT ON TABLE trapper.name_candidates IS
'Name values extracted from staged records with suggested classification.
Evidence-first: even nonsense names are tracked for audit trail.
Status workflow: open -> approved/rejected/overridden -> (optionally) linked to person/place.';

COMMENT ON COLUMN trapper.name_candidates.reasons IS
'JSONB array of reason codes explaining the classification.
Example: ["has_two_tokens", "no_business_keywords", "common_name_pattern"]';

-- ============================================
-- PART 3: Name Classification Functions
-- ============================================
\echo 'Creating classification functions...'

-- Business/venue keywords that suggest a place
CREATE OR REPLACE FUNCTION trapper.is_place_keyword(token TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN UPPER(token) IN (
        -- Business entities
        'LLC', 'INC', 'CO', 'CORP', 'CORPORATION', 'LTD',
        -- Housing
        'APARTMENTS', 'APTS', 'APT', 'APARTMENT', 'CONDOS', 'CONDO',
        'TOWNHOMES', 'TOWNHOUSE', 'MOBILE', 'PARK', 'ESTATES',
        'MANOR', 'COURT', 'VILLAGE', 'VILLAS', 'GARDENS',
        -- Hospitality
        'HOTEL', 'MOTEL', 'INN', 'LODGE', 'RESORT',
        -- Food/Retail
        'CAFE', 'RESTAURANT', 'BAR', 'GRILL', 'PIZZA', 'MARKET',
        'STORE', 'SHOP', 'CENTER', 'CENTRE', 'PLAZA', 'MALL',
        -- Institutions
        'CHURCH', 'SCHOOL', 'COLLEGE', 'UNIVERSITY', 'HOSPITAL',
        'CLINIC', 'MEDICAL', 'DENTAL', 'VET', 'VETERINARY',
        'LIBRARY', 'MUSEUM', 'SHELTER', 'RESCUE',
        -- Places
        'PARK', 'TRAIL', 'BEACH', 'LAKE', 'CREEK', 'RIVER',
        -- Organizations
        'HOA', 'ASSOCIATION', 'CLUB', 'FOUNDATION', 'SOCIETY',
        -- Location indicators
        'BUILDING', 'BLDG', 'UNIT', 'SUITE', 'STE', 'FLOOR',
        'NEAR', 'BEHIND', 'NEXT'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Check if string looks like nonsense (attachment, html, garbage)
CREATE OR REPLACE FUNCTION trapper.is_nonsense_name(name TEXT)
RETURNS TABLE (is_nonsense BOOLEAN, reason TEXT) AS $$
DECLARE
    trimmed TEXT := TRIM(name);
BEGIN
    -- Attachment URLs
    IF trimmed ILIKE '%airtableusercontent%' OR
       trimmed ILIKE '%.png%' OR trimmed ILIKE '%.jpg%' OR
       trimmed ILIKE '%.jpeg%' OR trimmed ILIKE '%.pdf%' OR
       trimmed ILIKE '%.mp4%' OR trimmed ILIKE '%.mov%' THEN
        RETURN QUERY SELECT TRUE, 'attachment_url';
        RETURN;
    END IF;

    -- HTML content
    IF trimmed LIKE '%<%>%' OR trimmed LIKE '%</%' OR
       trimmed LIKE '%<br%' OR trimmed LIKE '%<div%' THEN
        RETURN QUERY SELECT TRUE, 'html_content';
        RETURN;
    END IF;

    -- Date/number patterns that look like logs
    IF trimmed ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}' OR
       trimmed ~ '^Cat [0-9]+' OR trimmed ~ '^Kitten' OR
       trimmed ~ '^IMG_[0-9]+' THEN
        RETURN QUERY SELECT TRUE, 'log_entry';
        RETURN;
    END IF;

    -- Too short generic
    IF LENGTH(trimmed) < 2 OR
       UPPER(trimmed) IN ('CA', 'USA', 'N/A', 'NA', 'NONE', 'UNKNOWN', '-', '?') THEN
        RETURN QUERY SELECT TRUE, 'too_short_or_generic';
        RETURN;
    END IF;

    -- ZIP-only
    IF trimmed ~ '^[0-9]{5}(-[0-9]{4})?$' THEN
        RETURN QUERY SELECT TRUE, 'zip_only';
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Classify a name value
CREATE OR REPLACE FUNCTION trapper.classify_name(raw_name TEXT)
RETURNS TABLE (
    kind trapper.name_kind,
    confidence NUMERIC(3,2),
    reasons JSONB
) AS $$
DECLARE
    trimmed TEXT := TRIM(COALESCE(raw_name, ''));
    tokens TEXT[];
    token TEXT;
    reason_arr TEXT[] := '{}';
    has_place_keyword BOOLEAN := FALSE;
    token_count INT;
    letter_ratio NUMERIC;
    total_chars INT;
    letter_chars INT;
BEGIN
    -- Empty check
    IF trimmed = '' THEN
        RETURN QUERY SELECT 'nonsense'::trapper.name_kind, 1.0::NUMERIC(3,2), '["empty"]'::JSONB;
        RETURN;
    END IF;

    -- Check for nonsense first
    FOR has_place_keyword, token IN SELECT * FROM trapper.is_nonsense_name(trimmed) LOOP
        IF has_place_keyword THEN
            RETURN QUERY SELECT 'nonsense'::trapper.name_kind, 0.95::NUMERIC(3,2),
                jsonb_build_array(token);
            RETURN;
        END IF;
    END LOOP;

    -- Tokenize
    tokens := string_to_array(regexp_replace(trimmed, '[^a-zA-Z0-9'' -]', ' ', 'g'), ' ');
    tokens := array_remove(tokens, '');
    token_count := array_length(tokens, 1);

    IF token_count IS NULL OR token_count = 0 THEN
        RETURN QUERY SELECT 'nonsense'::trapper.name_kind, 0.9::NUMERIC(3,2), '["no_valid_tokens"]'::JSONB;
        RETURN;
    END IF;

    -- Check for place keywords
    FOREACH token IN ARRAY tokens LOOP
        IF trapper.is_place_keyword(token) THEN
            has_place_keyword := TRUE;
            reason_arr := array_append(reason_arr, 'has_place_keyword:' || token);
        END IF;
    END LOOP;

    -- Calculate letter ratio
    total_chars := LENGTH(regexp_replace(trimmed, '\s', '', 'g'));
    letter_chars := LENGTH(regexp_replace(trimmed, '[^a-zA-Z]', '', 'g'));
    IF total_chars > 0 THEN
        letter_ratio := letter_chars::NUMERIC / total_chars;
    ELSE
        letter_ratio := 0;
    END IF;

    -- Place-like patterns
    IF has_place_keyword THEN
        RETURN QUERY SELECT 'place'::trapper.name_kind, 0.85::NUMERIC(3,2),
            to_jsonb(reason_arr);
        RETURN;
    END IF;

    -- Contains @ or "at" location pattern
    IF trimmed ILIKE '%@%' OR trimmed ~* '\bat\s+\d' OR trimmed ~* '\bat\s+the\s' THEN
        reason_arr := array_append(reason_arr, 'at_location_pattern');
        RETURN QUERY SELECT 'place'::trapper.name_kind, 0.75::NUMERIC(3,2),
            to_jsonb(reason_arr);
        RETURN;
    END IF;

    -- Intersection pattern (X & Y, X and Y Street)
    IF trimmed ~* '\s+&\s+' OR trimmed ~* '\s+and\s+.*\s+(st|street|ave|avenue|rd|road|blvd|dr|drive)' THEN
        reason_arr := array_append(reason_arr, 'intersection_pattern');
        RETURN QUERY SELECT 'place'::trapper.name_kind, 0.80::NUMERIC(3,2),
            to_jsonb(reason_arr);
        RETURN;
    END IF;

    -- Person-like: 2-4 tokens, mostly letters, common name pattern
    IF token_count BETWEEN 2 AND 4 AND letter_ratio > 0.85 THEN
        reason_arr := array_append(reason_arr, 'person_token_count');
        reason_arr := array_append(reason_arr, 'high_letter_ratio');

        -- Extra confidence if first token looks like a first name (capitalized, 2-15 chars)
        IF tokens[1] ~ '^[A-Z][a-z]{1,14}$' THEN
            reason_arr := array_append(reason_arr, 'capitalized_first_token');
            RETURN QUERY SELECT 'person'::trapper.name_kind, 0.80::NUMERIC(3,2),
                to_jsonb(reason_arr);
            RETURN;
        END IF;

        RETURN QUERY SELECT 'person'::trapper.name_kind, 0.65::NUMERIC(3,2),
            to_jsonb(reason_arr);
        RETURN;
    END IF;

    -- Single token that's capitalized and reasonable length could be a last name only
    IF token_count = 1 AND letter_ratio > 0.9 AND LENGTH(trimmed) BETWEEN 2 AND 20 THEN
        reason_arr := array_append(reason_arr, 'single_token_name');
        RETURN QUERY SELECT 'person'::trapper.name_kind, 0.45::NUMERIC(3,2),
            to_jsonb(reason_arr);
        RETURN;
    END IF;

    -- Default: unknown
    reason_arr := array_append(reason_arr, 'no_strong_signals');
    RETURN QUERY SELECT 'unknown'::trapper.name_kind, 0.50::NUMERIC(3,2),
        to_jsonb(reason_arr);

END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- PART 4: View to Extract Name Candidates from Trapping Requests
-- ============================================
\echo 'Creating v_name_candidates_from_trapping_requests view...'

CREATE OR REPLACE VIEW trapper.v_name_candidates_from_trapping_requests AS
WITH latest_run AS (
    SELECT run_id
    FROM trapper.v_latest_ingest_run
    WHERE source_system = 'airtable' AND source_table = 'trapping_requests'
),
base_records AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        sr.payload
    FROM trapper.staged_records sr
    LEFT JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    LEFT JOIN latest_run lr ON lr.run_id = irr.run_id
    WHERE sr.source_table = 'trapping_requests'
      AND (lr.run_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM latest_run))
),
name_fields AS (
    -- Combined First + Last Name (actual Airtable fields)
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Full Name' AS field_name,
           TRIM(COALESCE(payload->>'First Name', '') || ' ' || COALESCE(payload->>'Last Name', '')) AS raw_name
    FROM base_records
    WHERE (payload->>'First Name' IS NOT NULL OR payload->>'Last Name' IS NOT NULL)
    UNION ALL
    -- Client Name
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Client Name' AS field_name, payload->>'Client Name' AS raw_name
    FROM base_records
    UNION ALL
    -- Request Place Name (for place classification)
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Request Place Name' AS field_name, payload->>'Request Place Name' AS raw_name
    FROM base_records
    UNION ALL
    -- Relevant Names field (sometimes contains multiple names)
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Relevant Names' AS field_name, payload->>'Relevant Names' AS raw_name
    FROM base_records
),
extracted AS (
    SELECT DISTINCT ON (nf.staged_record_id, nf.field_name)
        nf.staged_record_id,
        nf.source_system,
        nf.source_table,
        nf.source_row_id,
        nf.field_name,
        nf.raw_name
    FROM name_fields nf
    WHERE nf.raw_name IS NOT NULL AND TRIM(nf.raw_name) <> ''
)
SELECT
    e.staged_record_id,
    e.source_system,
    e.source_table,
    e.source_row_id,
    e.field_name,
    e.raw_name,
    LOWER(TRIM(e.raw_name)) AS normalized_name,
    (trapper.classify_name(e.raw_name)).*
FROM extracted e
WHERE NOT EXISTS (
    -- Don't include if already in name_candidates
    SELECT 1 FROM trapper.name_candidates nc
    WHERE nc.staged_record_id = e.staged_record_id
      AND nc.field_name = e.field_name
);

COMMENT ON VIEW trapper.v_name_candidates_from_trapping_requests IS
'Extracts name values from trapping requests with automatic classification.
Uses actual Airtable field names: First Name, Last Name, Client Name, Request Place Name.';

-- ============================================
-- PART 5: View to Extract Name Candidates from Appointment Requests
-- ============================================
\echo 'Creating v_name_candidates_from_appointment_requests view...'

CREATE OR REPLACE VIEW trapper.v_name_candidates_from_appointment_requests AS
WITH latest_run AS (
    SELECT run_id
    FROM trapper.v_latest_ingest_run
    WHERE source_system = 'airtable' AND source_table = 'appointment_requests'
),
base_records AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_system,
        sr.source_table,
        sr.source_row_id,
        sr.payload
    FROM trapper.staged_records sr
    LEFT JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    LEFT JOIN latest_run lr ON lr.run_id = irr.run_id
    WHERE sr.source_table = 'appointment_requests'
      AND (lr.run_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM latest_run))
),
name_fields AS (
    -- Combined First + Last Name (if fields exist)
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Full Name' AS field_name,
           TRIM(COALESCE(payload->>'First Name', '') || ' ' || COALESCE(payload->>'Last Name', '')) AS raw_name
    FROM base_records
    WHERE (payload->>'First Name' IS NOT NULL OR payload->>'Last Name' IS NOT NULL)
    UNION ALL
    -- Client Name
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Client Name' AS field_name, payload->>'Client Name' AS raw_name
    FROM base_records
    UNION ALL
    -- Owner Name
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Owner Name' AS field_name, payload->>'Owner Name' AS raw_name
    FROM base_records
    UNION ALL
    -- Requester Name (fallback)
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Requester Name' AS field_name, payload->>'Requester Name' AS raw_name
    FROM base_records
    UNION ALL
    -- Contact Name (fallback)
    SELECT staged_record_id, source_system, source_table, source_row_id,
           'Contact Name' AS field_name, payload->>'Contact Name' AS raw_name
    FROM base_records
),
extracted AS (
    SELECT DISTINCT ON (nf.staged_record_id, nf.field_name)
        nf.staged_record_id,
        nf.source_system,
        nf.source_table,
        nf.source_row_id,
        nf.field_name,
        nf.raw_name
    FROM name_fields nf
    WHERE nf.raw_name IS NOT NULL AND TRIM(nf.raw_name) <> ''
)
SELECT
    e.staged_record_id,
    e.source_system,
    e.source_table,
    e.source_row_id,
    e.field_name,
    e.raw_name,
    LOWER(TRIM(e.raw_name)) AS normalized_name,
    (trapper.classify_name(e.raw_name)).*
FROM extracted e
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.name_candidates nc
    WHERE nc.staged_record_id = e.staged_record_id
      AND nc.field_name = e.field_name
);

COMMENT ON VIEW trapper.v_name_candidates_from_appointment_requests IS
'Extracts name values from appointment requests with automatic classification.
Tries multiple field names to accommodate different Airtable schemas.';

-- ============================================
-- PART 6: Populate Helper Function
-- ============================================
\echo 'Creating populate_name_candidates function...'

CREATE OR REPLACE FUNCTION trapper.populate_name_candidates_from_view(p_source_table TEXT)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    IF p_source_table = 'trapping_requests' THEN
        INSERT INTO trapper.name_candidates (
            source_system, source_table, source_row_id, staged_record_id,
            raw_name, normalized_name, field_name,
            name_kind_suggested, confidence, reasons
        )
        SELECT
            source_system, source_table, source_row_id, staged_record_id,
            raw_name, normalized_name, field_name,
            kind, confidence, reasons
        FROM trapper.v_name_candidates_from_trapping_requests
        ON CONFLICT (source_system, source_table, source_row_id, field_name) DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;

    ELSIF p_source_table = 'appointment_requests' THEN
        INSERT INTO trapper.name_candidates (
            source_system, source_table, source_row_id, staged_record_id,
            raw_name, normalized_name, field_name,
            name_kind_suggested, confidence, reasons
        )
        SELECT
            source_system, source_table, source_row_id, staged_record_id,
            raw_name, normalized_name, field_name,
            kind, confidence, reasons
        FROM trapper.v_name_candidates_from_appointment_requests
        ON CONFLICT (source_system, source_table, source_row_id, field_name) DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;
    ELSE
        RAISE EXCEPTION 'Unknown source_table: %. Expected: trapping_requests, appointment_requests', p_source_table;
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.populate_name_candidates_from_view IS
'Populates name_candidates from extraction views. Idempotent via ON CONFLICT DO NOTHING.
Usage: SELECT trapper.populate_name_candidates_from_view(''trapping_requests'');';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_005 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Classification function test:'
SELECT * FROM trapper.classify_name('John Smith');
SELECT * FROM trapper.classify_name('Sunset Apartments LLC');
SELECT * FROM trapper.classify_name('image.png (https://airtableusercontent...)');
SELECT * FROM trapper.classify_name('CA');

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper' AND table_name = 'name_candidates';

\echo ''
\echo 'Next steps:'
\echo '  1. Populate: SELECT trapper.populate_name_candidates_from_view(''trapping_requests'');'
\echo '  2. Review: SELECT name_kind_suggested, COUNT(*) FROM trapper.name_candidates GROUP BY 1;'
\echo ''
