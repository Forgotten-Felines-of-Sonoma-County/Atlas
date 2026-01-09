-- MIG_006__observations.sql
-- Observations table for evidence-first data linking
--
-- Creates:
--   - trapper.observations: links staged records to signals
--
-- Purpose:
--   - Never lose evidence: even nonsense names contribute address signals
--   - Bridge between raw staged data and canonical entities
--   - Support progressive entity building
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_006__observations.sql

\echo '============================================'
\echo 'MIG_006: Observations (Evidence Links)'
\echo '============================================'

-- ============================================
-- PART 1: Observation Types Enum
-- ============================================
\echo ''
\echo 'Creating observation_type enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'observation_type') THEN
        CREATE TYPE trapper.observation_type AS ENUM (
            'address_signal',      -- Raw address value from a field
            'name_signal',         -- Raw name value from a field
            'cat_signal',          -- Cat identifier/description
            'appointment_signal',  -- Appointment reference
            'phone_signal',        -- Phone number
            'email_signal',        -- Email address
            'date_signal',         -- Date/time reference
            'location_signal',     -- Geographic coordinate or area
            'note_signal'          -- Free-text observation
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Observations Table
-- ============================================
\echo 'Creating observations table...'

CREATE TABLE IF NOT EXISTS trapper.observations (
    observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source linkage (always required)
    staged_record_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_row_id TEXT,

    -- Observation type and content
    observation_type trapper.observation_type NOT NULL,
    field_name TEXT,                    -- Which field this came from
    value_text TEXT,                    -- Raw text value
    value_json JSONB,                   -- Structured data if available

    -- Classification/confidence (optional)
    confidence NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    classification JSONB,               -- e.g., {"kind": "person", "reasons": [...]}

    -- Resolved entity links (populated later)
    resolved_address_id UUID,           -- FK to sot_addresses
    resolved_person_id UUID,            -- FK to future persons table
    resolved_place_id UUID,             -- FK to places table
    resolved_cat_id UUID,               -- FK to future cats table

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate observations
    UNIQUE (staged_record_id, observation_type, field_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_observations_staged ON trapper.observations (staged_record_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON trapper.observations (observation_type);
CREATE INDEX IF NOT EXISTS idx_observations_source ON trapper.observations (source_system, source_table);
CREATE INDEX IF NOT EXISTS idx_observations_resolved_addr ON trapper.observations (resolved_address_id) WHERE resolved_address_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_resolved_place ON trapper.observations (resolved_place_id) WHERE resolved_place_id IS NOT NULL;

COMMENT ON TABLE trapper.observations IS
'Evidence links between staged records and signals/entities.
Evidence-first: every relevant signal is recorded even if the source record is junk.
A nonsense name still contributes address_signal if it has an address field.';

-- ============================================
-- PART 3: Function to Extract Observations
-- ============================================
\echo 'Creating extract_observations_from_staged function...'

CREATE OR REPLACE FUNCTION trapper.extract_observations_from_staged(
    p_staged_record_id UUID
)
RETURNS TABLE (
    observation_type trapper.observation_type,
    field_name TEXT,
    value_text TEXT,
    value_json JSONB,
    confidence NUMERIC(3,2)
) AS $$
DECLARE
    v_payload JSONB;
    v_source_table TEXT;
    v_field TEXT;
    v_value TEXT;
    v_classification RECORD;  -- Store classify_name result to avoid column name ambiguity
    v_addr_fields TEXT[] := ARRAY['Address', 'Requester Address', 'Mailing Address', 'Cats Address', 'Trapping Address', 'Location Address'];
    v_name_fields TEXT[] := ARRAY['First Name', 'Last Name', 'Client Name', 'Owner Name', 'Requester Name', 'Contact Name', 'Name'];
    v_phone_fields TEXT[] := ARRAY['Phone', 'Clean Phone', 'Business Phone', 'Mobile', 'Cell'];
    v_email_fields TEXT[] := ARRAY['Email', 'Clean Email', 'Business Email'];
BEGIN
    -- Get the payload (use table alias to avoid ambiguity)
    SELECT sr.payload, sr.source_table INTO v_payload, v_source_table
    FROM trapper.staged_records sr
    WHERE sr.id = p_staged_record_id;

    IF v_payload IS NULL THEN
        RETURN;
    END IF;

    -- Extract address signals
    FOREACH v_field IN ARRAY v_addr_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' THEN
            RETURN QUERY SELECT
                'address_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.8::NUMERIC(3,2);
        END IF;
    END LOOP;

    -- Extract name signals (use RECORD to avoid column name collision)
    FOREACH v_field IN ARRAY v_name_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_value);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                v_field,
                v_value,
                to_jsonb(v_classification),
                v_classification.confidence;
        END IF;
    END LOOP;

    -- Extract phone signals
    FOREACH v_field IN ARRAY v_phone_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' AND v_value ~ '[0-9]' THEN
            RETURN QUERY SELECT
                'phone_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.9::NUMERIC(3,2);
        END IF;
    END LOOP;

    -- Extract email signals
    FOREACH v_field IN ARRAY v_email_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND v_value LIKE '%@%' THEN
            RETURN QUERY SELECT
                'email_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.95::NUMERIC(3,2);
        END IF;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 4: View to show pending observations
-- ============================================
\echo 'Creating v_pending_observations view...'

CREATE OR REPLACE VIEW trapper.v_pending_observations AS
WITH latest_run AS (
    SELECT run_id, source_system, source_table
    FROM trapper.v_latest_ingest_run
),
staged_from_latest AS (
    SELECT sr.id, sr.source_system, sr.source_table, sr.source_row_id
    FROM trapper.staged_records sr
    JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
    JOIN latest_run lr ON lr.run_id = irr.run_id
        AND lr.source_system = sr.source_system
        AND lr.source_table = sr.source_table
)
SELECT
    sfl.id AS staged_record_id,
    sfl.source_system,
    sfl.source_table,
    sfl.source_row_id,
    obs.*
FROM staged_from_latest sfl
CROSS JOIN LATERAL trapper.extract_observations_from_staged(sfl.id) obs
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.observations o
    WHERE o.staged_record_id = sfl.id
      AND o.observation_type = obs.observation_type
      AND o.field_name = obs.field_name
);

COMMENT ON VIEW trapper.v_pending_observations IS
'Observations not yet recorded from the latest ingest runs.
Use to batch-populate the observations table.';

-- ============================================
-- PART 5: Populate helper function
-- ============================================
\echo 'Creating populate_observations function...'

CREATE OR REPLACE FUNCTION trapper.populate_observations_for_staged(
    p_staged_record_id UUID
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    v_source_system TEXT;
    v_source_table TEXT;
    v_source_row_id TEXT;
BEGIN
    -- Get source info
    SELECT source_system, source_table, source_row_id
    INTO v_source_system, v_source_table, v_source_row_id
    FROM trapper.staged_records
    WHERE id = p_staged_record_id;

    -- Insert observations
    INSERT INTO trapper.observations (
        staged_record_id, source_system, source_table, source_row_id,
        observation_type, field_name, value_text, value_json, confidence
    )
    SELECT
        p_staged_record_id, v_source_system, v_source_table, v_source_row_id,
        obs.observation_type, obs.field_name, obs.value_text, obs.value_json, obs.confidence
    FROM trapper.extract_observations_from_staged(p_staged_record_id) obs
    ON CONFLICT (staged_record_id, observation_type, field_name) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 6: Populate all observations for latest run
-- ============================================
\echo 'Creating populate_observations_for_latest_run function...'

CREATE OR REPLACE FUNCTION trapper.populate_observations_for_latest_run(p_source_table TEXT)
RETURNS INT AS $$
DECLARE
    v_total INT := 0;
    v_count INT;
    v_staged_id UUID;
BEGIN
    FOR v_staged_id IN
        SELECT sr.id
        FROM trapper.staged_records sr
        JOIN trapper.ingest_run_records irr ON irr.staged_record_id = sr.id
        JOIN trapper.v_latest_ingest_run lr ON lr.run_id = irr.run_id
            AND lr.source_system = sr.source_system
            AND lr.source_table = sr.source_table
        WHERE sr.source_table = p_source_table
    LOOP
        SELECT trapper.populate_observations_for_staged(v_staged_id) INTO v_count;
        v_total := v_total + v_count;
    END LOOP;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.populate_observations_for_latest_run IS
'Populates observations for all staged records from the latest ingest run of the given source_table.
Usage: SELECT trapper.populate_observations_for_latest_run(''trapping_requests'');';

-- ============================================
-- PART 7: View to show observation stats
-- ============================================
\echo 'Creating v_observation_stats view...'

CREATE OR REPLACE VIEW trapper.v_observation_stats AS
SELECT
    source_table,
    observation_type,
    COUNT(*) AS count,
    COUNT(resolved_address_id) AS resolved_addresses,
    COUNT(resolved_place_id) AS resolved_places,
    COUNT(resolved_person_id) AS resolved_persons
FROM trapper.observations
GROUP BY source_table, observation_type
ORDER BY source_table, observation_type;

COMMENT ON VIEW trapper.v_observation_stats IS
'Summary of observations by source and type with resolution counts.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_006 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper' AND table_name = 'observations';

\echo ''
\echo 'Next steps:'
\echo '  1. Populate: SELECT trapper.populate_observations_for_staged(id) FROM trapper.staged_records WHERE source_table = ''trapping_requests'';'
\echo '  2. Review: SELECT * FROM trapper.v_observation_stats;'
\echo ''
