-- MIG_031__source_canonical_config.sql
-- Configurable source settings for canonical person creation
--
-- Purpose:
--   Instead of hard-coded IF statements, use a config table to control
--   which sources are enabled for canonical person creation.
--   This allows "turning on" sources later without code changes.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_031__source_canonical_config.sql

\echo '============================================'
\echo 'MIG_031: Source Canonical Configuration'
\echo '============================================'

-- ============================================
-- PART 1: Configuration Table
-- ============================================
\echo ''
\echo 'Creating source_canonical_config table...'

CREATE TABLE IF NOT EXISTS trapper.source_canonical_config (
    id SERIAL PRIMARY KEY,
    source_system TEXT NOT NULL,
    source_table TEXT,  -- NULL means applies to all tables from this system

    -- Canonical person settings
    allow_canonical_people BOOLEAN NOT NULL DEFAULT FALSE,
    min_name_tokens INT NOT NULL DEFAULT 2,  -- Minimum name parts required
    confidence_threshold NUMERIC(3,2) DEFAULT 0.7,

    -- Notes
    notes TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (source_system, source_table)
);

COMMENT ON TABLE trapper.source_canonical_config IS
'Configuration for which sources can create canonical people.
Set allow_canonical_people = TRUE to enable a source.
NULL source_table means the setting applies to all tables from that source_system.';

-- ============================================
-- PART 2: Default Configuration (Current Policy)
-- ============================================
\echo 'Inserting default configuration...'

INSERT INTO trapper.source_canonical_config
    (source_system, source_table, allow_canonical_people, notes)
VALUES
    -- ENABLED for canonical people
    ('airtable', 'trapping_requests', TRUE, 'Primary source - has First+Last names'),
    ('clinichq', NULL, TRUE, 'ClinicHQ owners - trusted source'),
    ('volunteerhub', NULL, TRUE, 'Volunteers with valid names'),

    -- DISABLED for now (deep search only)
    ('shelterluv', NULL, FALSE, 'Adopters - enable later for adoption tracking'),
    ('petlink', NULL, FALSE, 'Pet registration - may enable later'),
    ('etapestry', NULL, FALSE, 'Donor data - names may be partial/messy'),
    ('airtable', 'appointment_requests', FALSE, 'Messy public submissions - deep search only')
ON CONFLICT (source_system, source_table) DO UPDATE
SET
    allow_canonical_people = EXCLUDED.allow_canonical_people,
    notes = EXCLUDED.notes,
    updated_at = NOW();

-- ============================================
-- PART 3: Helper Function to Check Config
-- ============================================
\echo 'Creating source_allows_canonical_people function...'

CREATE OR REPLACE FUNCTION trapper.source_allows_canonical_people(
    p_source_system TEXT,
    p_source_table TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_allowed BOOLEAN;
BEGIN
    -- Check for exact match first (source_system + source_table)
    SELECT allow_canonical_people INTO v_allowed
    FROM trapper.source_canonical_config
    WHERE source_system = p_source_system
      AND source_table = p_source_table;

    IF FOUND THEN
        RETURN v_allowed;
    END IF;

    -- Check for system-wide setting (source_table IS NULL)
    SELECT allow_canonical_people INTO v_allowed
    FROM trapper.source_canonical_config
    WHERE source_system = p_source_system
      AND source_table IS NULL;

    IF FOUND THEN
        RETURN v_allowed;
    END IF;

    -- Default: not configured = not allowed
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.source_allows_canonical_people IS
'Checks if a source is configured to create canonical people.
Uses source_canonical_config table. Returns FALSE if not configured.';

-- ============================================
-- PART 4: Update is_valid_person_name_for_canonical to use config
-- ============================================
\echo 'Updating is_valid_person_name_for_canonical to use config...'

CREATE OR REPLACE FUNCTION trapper.is_valid_person_name_for_canonical(
    p_name TEXT,
    p_source_system TEXT DEFAULT NULL,
    p_source_table TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_normalized TEXT;
    v_tokens TEXT[];
    v_token_count INT;
    v_min_tokens INT := 2;
BEGIN
    -- NULL or empty -> invalid
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN FALSE;
    END IF;

    -- Check source configuration (if source info provided)
    IF p_source_system IS NOT NULL THEN
        IF NOT trapper.source_allows_canonical_people(p_source_system, p_source_table) THEN
            RETURN FALSE;
        END IF;

        -- Get min_name_tokens from config if available
        SELECT COALESCE(c.min_name_tokens, 2) INTO v_min_tokens
        FROM trapper.source_canonical_config c
        WHERE (c.source_system = p_source_system AND c.source_table = p_source_table)
           OR (c.source_system = p_source_system AND c.source_table IS NULL)
        ORDER BY c.source_table NULLS LAST
        LIMIT 1;
    END IF;

    -- Reject HTML-like content
    IF p_name ~ '<[^>]+>' THEN
        RETURN FALSE;
    END IF;

    -- Reject airtable/image URLs
    IF p_name ILIKE '%airtableusercontent%'
       OR p_name ILIKE '%http://%'
       OR p_name ILIKE '%https://%'
       OR p_name ILIKE '%.jpg%'
       OR p_name ILIKE '%.png%'
       OR p_name ILIKE '%.gif%'
    THEN
        RETURN FALSE;
    END IF;

    -- Reject if it looks like an img tag remnant
    IF p_name ILIKE '%<img%' OR p_name ILIKE '%src=%' THEN
        RETURN FALSE;
    END IF;

    -- Reject cat-like identifiers
    IF p_name ~ '^\s*#?\d+[/-]' THEN
        RETURN FALSE;
    END IF;
    IF p_name ~ '^FFSC-\d+' THEN
        RETURN FALSE;
    END IF;
    IF p_name ~ '^[A-Z]\d{4,}$' THEN
        RETURN FALSE;
    END IF;

    -- Reject "(adopted)", "(deceased)", etc. as primary name
    IF p_name ~ '^\s*\([^)]+\)\s*$' THEN
        RETURN FALSE;
    END IF;

    -- Normalize for token analysis
    v_normalized := LOWER(TRIM(p_name));
    v_normalized := REGEXP_REPLACE(v_normalized, '[^a-z\s]', '', 'g');
    v_normalized := REGEXP_REPLACE(v_normalized, '\s+', ' ', 'g');
    v_normalized := TRIM(v_normalized);

    -- After stripping non-alpha, must have content
    IF v_normalized = '' THEN
        RETURN FALSE;
    END IF;

    -- Split into tokens
    v_tokens := STRING_TO_ARRAY(v_normalized, ' ');
    v_token_count := COALESCE(ARRAY_LENGTH(v_tokens, 1), 0);

    -- Require minimum tokens (from config, default 2)
    IF v_token_count < v_min_tokens THEN
        RETURN FALSE;
    END IF;

    -- Each token should have at least 2 characters (for 2-token names)
    IF v_token_count = 2 THEN
        IF LENGTH(v_tokens[1]) < 2 OR LENGTH(v_tokens[2]) < 2 THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- Reject excessively long names
    IF LENGTH(p_name) > 100 THEN
        RETURN FALSE;
    END IF;

    -- Reject if more than 30% digits
    IF (LENGTH(REGEXP_REPLACE(p_name, '[^0-9]', '', 'g'))::FLOAT / GREATEST(LENGTH(p_name), 1)) > 0.3 THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;  -- Changed from IMMUTABLE since it now reads config table

COMMENT ON FUNCTION trapper.is_valid_person_name_for_canonical IS
'Validates if a name is acceptable for canonical person creation.
Now uses source_canonical_config table instead of hard-coded exclusions.
To enable a source, update the config table.';

-- ============================================
-- PART 5: View for easy configuration management
-- ============================================
\echo 'Creating v_source_config view...'

CREATE OR REPLACE VIEW trapper.v_source_config AS
SELECT
    COALESCE(c.source_system, sr.source_system) AS source_system,
    COALESCE(c.source_table, sr.source_table) AS source_table,
    sr.record_count,
    COALESCE(c.allow_canonical_people, FALSE) AS allow_canonical_people,
    COALESCE(c.min_name_tokens, 2) AS min_name_tokens,
    c.notes
FROM (
    SELECT source_system, source_table, COUNT(*) AS record_count
    FROM trapper.staged_records
    GROUP BY source_system, source_table
) sr
LEFT JOIN trapper.source_canonical_config c
    ON c.source_system = sr.source_system
    AND (c.source_table = sr.source_table OR c.source_table IS NULL)
ORDER BY sr.source_system, sr.source_table;

COMMENT ON VIEW trapper.v_source_config IS
'Shows all sources with their canonical people configuration.
Use to see which sources are enabled and which have data waiting.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_031 Complete - Current Configuration:'
\echo '============================================'

SELECT * FROM trapper.v_source_config;

\echo ''
\echo 'To enable Shelterluv for canonical people later, run:'
\echo ''
\echo '  UPDATE trapper.source_canonical_config'
\echo '  SET allow_canonical_people = TRUE,'
\echo '      notes = ''Enabled for adopter tracking'''
\echo '  WHERE source_system = ''shelterluv'';'
\echo ''
\echo '  -- Then re-run observation extraction and person creation:'
\echo '  SELECT trapper.populate_observations_for_latest_run(''animals'');'
\echo '  SELECT trapper.populate_observations_for_latest_run(''people'');'
\echo '  SELECT * FROM trapper.upsert_people_from_observations(''animals'');'
\echo '  SELECT * FROM trapper.upsert_people_from_observations(''people'');'
\echo '  SELECT trapper.update_all_person_display_names();'
\echo ''
