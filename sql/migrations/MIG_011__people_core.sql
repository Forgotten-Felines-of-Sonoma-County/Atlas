-- MIG_011__people_core.sql
-- Canonical People + Strong Identifiers (Dedupe Engine)
--
-- Creates:
--   - trapper.sot_people: canonical person records
--   - trapper.person_identifiers: email/phone/external_id (strong identifiers)
--   - trapper.person_aliases: name variations
--   - trapper.staged_record_person_link: links staged records to people
--   - trapper.canonical_person_id(uuid): follows merge chain
--   - trapper.upsert_people_from_observations: deterministic dedupe
--
-- Purpose:
--   - Deterministic identity resolution via email/phone
--   - Soft merge support (merged_into_person_id)
--   - Evidence-first: every signal contributes even if person is later merged
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_011__people_core.sql

\echo '============================================'
\echo 'MIG_011: People Core (Canonical + Identifiers)'
\echo '============================================'

-- ============================================
-- PART 1: Identifier Type Enum
-- ============================================
\echo ''
\echo 'Creating identifier_type enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'identifier_type') THEN
        CREATE TYPE trapper.identifier_type AS ENUM (
            'email',
            'phone',
            'external_id'
        );
    END IF;
END$$;

-- ============================================
-- PART 2: sot_people Table
-- ============================================
\echo 'Creating sot_people table...'

CREATE TABLE IF NOT EXISTS trapper.sot_people (
    person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT,

    -- Soft merge support
    merged_into_person_id UUID REFERENCES trapper.sot_people(person_id),
    merged_at TIMESTAMPTZ,
    merge_reason TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sot_people_merged_into
    ON trapper.sot_people(merged_into_person_id)
    WHERE merged_into_person_id IS NOT NULL;

COMMENT ON TABLE trapper.sot_people IS
'Source of Truth for people. Supports soft merges via merged_into_person_id.
If merged, follow the chain to find the canonical person.';

-- ============================================
-- PART 3: person_identifiers Table
-- ============================================
\echo 'Creating person_identifiers table...'

CREATE TABLE IF NOT EXISTS trapper.person_identifiers (
    identifier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Identifier
    id_type trapper.identifier_type NOT NULL,
    id_value_norm TEXT NOT NULL,
    id_value_raw TEXT,

    -- Provenance
    source_system TEXT,
    source_table TEXT,
    source_row_id TEXT,
    staged_record_id UUID,

    -- Confidence (1.0 for hard identifiers)
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Hard dedupe: same normalized email/phone = same person
    CONSTRAINT uq_person_identifier_strong
        UNIQUE (id_type, id_value_norm)
);

CREATE INDEX IF NOT EXISTS idx_person_identifiers_person
    ON trapper.person_identifiers(person_id);

CREATE INDEX IF NOT EXISTS idx_person_identifiers_lookup
    ON trapper.person_identifiers(id_type, id_value_norm);

COMMENT ON TABLE trapper.person_identifiers IS
'Strong identifiers (email, phone) for deterministic dedupe.
UNIQUE constraint on (id_type, id_value_norm) ensures same identifier = same person.';

-- ============================================
-- PART 4: person_aliases Table
-- ============================================
\echo 'Creating person_aliases table...'

CREATE TABLE IF NOT EXISTS trapper.person_aliases (
    alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Name variations
    name_raw TEXT NOT NULL,
    name_key TEXT NOT NULL,

    -- Provenance
    source_system TEXT,
    source_table TEXT,
    source_row_id TEXT,
    staged_record_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate aliases for same person from same source
    CONSTRAINT uq_person_alias_source
        UNIQUE (person_id, name_key, staged_record_id)
);

CREATE INDEX IF NOT EXISTS idx_person_aliases_person
    ON trapper.person_aliases(person_id);

CREATE INDEX IF NOT EXISTS idx_person_aliases_name_key
    ON trapper.person_aliases(name_key);

-- GIN index for trigram similarity searches
CREATE INDEX IF NOT EXISTS idx_person_aliases_name_key_trgm
    ON trapper.person_aliases USING gin(name_key gin_trgm_ops);

COMMENT ON TABLE trapper.person_aliases IS
'Name variations for a person. Used for fuzzy matching.
Multiple aliases per person supported (married name, typos, etc).';

-- ============================================
-- PART 5: staged_record_person_link Table
-- ============================================
\echo 'Creating staged_record_person_link table...'

CREATE TABLE IF NOT EXISTS trapper.staged_record_person_link (
    link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staged_record_id UUID NOT NULL,
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- How this link was established
    link_reason TEXT NOT NULL,  -- email_match, phone_match, manual, fuzzy_automerge, fuzzy_manual_accept
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One current person per staged record
    CONSTRAINT uq_staged_record_person
        UNIQUE (staged_record_id)
);

CREATE INDEX IF NOT EXISTS idx_staged_record_person_link_person
    ON trapper.staged_record_person_link(person_id);

COMMENT ON TABLE trapper.staged_record_person_link IS
'Links staged records to people. One person per staged record.
link_reason tracks how the match was made (for audit).';

-- ============================================
-- PART 6: canonical_person_id Function
-- ============================================
\echo 'Creating canonical_person_id function...'

CREATE OR REPLACE FUNCTION trapper.canonical_person_id(p_person_id UUID)
RETURNS UUID AS $$
DECLARE
    v_current UUID := p_person_id;
    v_next UUID;
    v_depth INT := 0;
    v_max_depth INT := 10;  -- Guard against cycles
BEGIN
    IF p_person_id IS NULL THEN
        RETURN NULL;
    END IF;

    LOOP
        SELECT merged_into_person_id INTO v_next
        FROM trapper.sot_people
        WHERE person_id = v_current;

        IF v_next IS NULL THEN
            RETURN v_current;
        END IF;

        v_current := v_next;
        v_depth := v_depth + 1;

        IF v_depth >= v_max_depth THEN
            RAISE WARNING 'canonical_person_id: merge chain exceeded max depth for %', p_person_id;
            RETURN v_current;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.canonical_person_id IS
'Follows merged_into_person_id chain to find canonical person.
Guards against cycles (max 10 hops).';

-- ============================================
-- PART 7: Canonical Link View
-- ============================================
\echo 'Creating v_staged_record_person_link_canonical view...'

CREATE OR REPLACE VIEW trapper.v_staged_record_person_link_canonical AS
SELECT
    srpl.staged_record_id,
    srpl.person_id AS original_person_id,
    trapper.canonical_person_id(srpl.person_id) AS canonical_person_id,
    srpl.link_reason,
    srpl.confidence,
    srpl.created_at
FROM trapper.staged_record_person_link srpl;

COMMENT ON VIEW trapper.v_staged_record_person_link_canonical IS
'Staged record links resolved to canonical person (follows merge chain).';

-- ============================================
-- PART 8: Upsert People from Observations (Deterministic)
-- ============================================
\echo 'Creating upsert_people_from_observations function...'

CREATE OR REPLACE FUNCTION trapper.upsert_people_from_observations(
    p_source_table TEXT,
    p_run_scope TEXT DEFAULT 'latest'
)
RETURNS TABLE (
    people_created INT,
    identifiers_added INT,
    aliases_added INT,
    records_linked INT
) AS $$
DECLARE
    v_people_created INT := 0;
    v_identifiers_added INT := 0;
    v_aliases_added INT := 0;
    v_records_linked INT := 0;

    v_obs RECORD;
    v_person_id UUID;
    v_existing_person_id UUID;
    v_id_norm TEXT;
    v_name_key TEXT;
BEGIN
    -- Process observations from the specified source_table
    FOR v_obs IN
        SELECT
            o.staged_record_id,
            o.source_system,
            o.source_table,
            o.source_row_id,
            o.observation_type,
            o.field_name,
            o.value_text
        FROM trapper.observations o
        WHERE o.source_table = p_source_table
          AND o.observation_type IN ('email_signal', 'phone_signal', 'name_signal')
          -- Only process if not already linked
          AND NOT EXISTS (
              SELECT 1 FROM trapper.staged_record_person_link srpl
              WHERE srpl.staged_record_id = o.staged_record_id
          )
        ORDER BY
            -- Process email first, then phone, then name
            CASE o.observation_type
                WHEN 'email_signal' THEN 1
                WHEN 'phone_signal' THEN 2
                WHEN 'name_signal' THEN 3
            END,
            o.staged_record_id
    LOOP
        -- Skip if this staged record was already linked in this run
        IF EXISTS (
            SELECT 1 FROM trapper.staged_record_person_link
            WHERE staged_record_id = v_obs.staged_record_id
        ) THEN
            CONTINUE;
        END IF;

        v_person_id := NULL;

        -- ============================================
        -- P1: Email Signal -> Deterministic Match
        -- ============================================
        IF v_obs.observation_type = 'email_signal' THEN
            v_id_norm := trapper.norm_email(v_obs.value_text);

            IF v_id_norm IS NOT NULL THEN
                -- Check if identifier exists
                SELECT pi.person_id INTO v_existing_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'email' AND pi.id_value_norm = v_id_norm;

                IF v_existing_person_id IS NOT NULL THEN
                    -- Use existing person (follow canonical chain)
                    v_person_id := trapper.canonical_person_id(v_existing_person_id);
                ELSE
                    -- Create new person
                    INSERT INTO trapper.sot_people (display_name)
                    VALUES (NULL)
                    RETURNING person_id INTO v_person_id;
                    v_people_created := v_people_created + 1;

                    -- Add identifier
                    INSERT INTO trapper.person_identifiers (
                        person_id, id_type, id_value_norm, id_value_raw,
                        source_system, source_table, source_row_id, staged_record_id
                    ) VALUES (
                        v_person_id, 'email', v_id_norm, v_obs.value_text,
                        v_obs.source_system, v_obs.source_table, v_obs.source_row_id, v_obs.staged_record_id
                    );
                    v_identifiers_added := v_identifiers_added + 1;
                END IF;

                -- Link staged record to person
                INSERT INTO trapper.staged_record_person_link (
                    staged_record_id, person_id, link_reason, confidence
                ) VALUES (
                    v_obs.staged_record_id, v_person_id, 'email_match', 1.0
                )
                ON CONFLICT (staged_record_id) DO NOTHING;

                IF FOUND THEN
                    v_records_linked := v_records_linked + 1;
                END IF;
            END IF;

        -- ============================================
        -- P2: Phone Signal -> Deterministic Match (if no email link)
        -- ============================================
        ELSIF v_obs.observation_type = 'phone_signal' THEN
            v_id_norm := trapper.norm_phone_us(v_obs.value_text);

            IF v_id_norm IS NOT NULL THEN
                -- Check if identifier exists
                SELECT pi.person_id INTO v_existing_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_id_norm;

                IF v_existing_person_id IS NOT NULL THEN
                    v_person_id := trapper.canonical_person_id(v_existing_person_id);
                ELSE
                    -- Create new person
                    INSERT INTO trapper.sot_people (display_name)
                    VALUES (NULL)
                    RETURNING person_id INTO v_person_id;
                    v_people_created := v_people_created + 1;

                    -- Add identifier
                    INSERT INTO trapper.person_identifiers (
                        person_id, id_type, id_value_norm, id_value_raw,
                        source_system, source_table, source_row_id, staged_record_id
                    ) VALUES (
                        v_person_id, 'phone', v_id_norm, v_obs.value_text,
                        v_obs.source_system, v_obs.source_table, v_obs.source_row_id, v_obs.staged_record_id
                    );
                    v_identifiers_added := v_identifiers_added + 1;
                END IF;

                -- Link staged record to person
                INSERT INTO trapper.staged_record_person_link (
                    staged_record_id, person_id, link_reason, confidence
                ) VALUES (
                    v_obs.staged_record_id, v_person_id, 'phone_match', 1.0
                )
                ON CONFLICT (staged_record_id) DO NOTHING;

                IF FOUND THEN
                    v_records_linked := v_records_linked + 1;
                END IF;
            END IF;

        -- ============================================
        -- P3: Name Signal -> Add Alias Only (no auto-create person)
        -- ============================================
        ELSIF v_obs.observation_type = 'name_signal' THEN
            v_name_key := trapper.norm_name_key(v_obs.value_text);

            IF v_name_key IS NOT NULL THEN
                -- Check if this staged record is already linked (from email/phone above)
                SELECT srpl.person_id INTO v_person_id
                FROM trapper.staged_record_person_link srpl
                WHERE srpl.staged_record_id = v_obs.staged_record_id;

                IF v_person_id IS NOT NULL THEN
                    -- Add alias to existing person
                    INSERT INTO trapper.person_aliases (
                        person_id, name_raw, name_key,
                        source_system, source_table, source_row_id, staged_record_id
                    ) VALUES (
                        v_person_id, v_obs.value_text, v_name_key,
                        v_obs.source_system, v_obs.source_table, v_obs.source_row_id, v_obs.staged_record_id
                    )
                    ON CONFLICT (person_id, name_key, staged_record_id) DO NOTHING;

                    IF FOUND THEN
                        v_aliases_added := v_aliases_added + 1;
                    END IF;
                END IF;
                -- If no email/phone match, name alone does NOT create a person
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_people_created, v_identifiers_added, v_aliases_added, v_records_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_people_from_observations IS
'Deterministic identity resolution from observations.
Priority: email -> phone -> name (alias only).
Name signals alone do NOT create people; they add aliases to existing people.
Returns counts of created/linked records.';

-- ============================================
-- PART 9: Update Display Name Helper
-- ============================================
\echo 'Creating update_person_display_name function...'

CREATE OR REPLACE FUNCTION trapper.update_person_display_name(p_person_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_display_name TEXT;
BEGIN
    -- Pick the most common alias or the first one
    SELECT pa.name_raw INTO v_display_name
    FROM trapper.person_aliases pa
    WHERE pa.person_id = p_person_id
    GROUP BY pa.name_raw
    ORDER BY COUNT(*) DESC, MIN(pa.created_at)
    LIMIT 1;

    IF v_display_name IS NOT NULL THEN
        UPDATE trapper.sot_people
        SET display_name = v_display_name, updated_at = NOW()
        WHERE person_id = p_person_id;
    END IF;

    RETURN v_display_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_person_display_name IS
'Updates person display_name from most common alias.';

-- ============================================
-- PART 10: Populate Aliases from Name Signals
-- ============================================
\echo 'Creating populate_aliases_from_name_signals function...'

CREATE OR REPLACE FUNCTION trapper.populate_aliases_from_name_signals(p_source_table TEXT)
RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    -- Add aliases for already-linked records from name signals
    INSERT INTO trapper.person_aliases (
        person_id, name_raw, name_key,
        source_system, source_table, source_row_id, staged_record_id
    )
    SELECT
        srpl.person_id,
        o.value_text,
        trapper.norm_name_key(o.value_text),
        o.source_system,
        o.source_table,
        o.source_row_id,
        o.staged_record_id
    FROM trapper.observations o
    JOIN trapper.staged_record_person_link srpl ON srpl.staged_record_id = o.staged_record_id
    WHERE o.observation_type = 'name_signal'
      AND o.source_table = p_source_table
      AND trapper.norm_name_key(o.value_text) IS NOT NULL
    ON CONFLICT (person_id, name_key, staged_record_id) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.populate_aliases_from_name_signals IS
'Populates person_aliases from name_signal observations for linked records.
Run after upsert_people_from_observations to add name variations.';

-- ============================================
-- PART 11: Batch Update Display Names
-- ============================================
\echo 'Creating update_all_person_display_names function...'

CREATE OR REPLACE FUNCTION trapper.update_all_person_display_names()
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    v_person_id UUID;
BEGIN
    FOR v_person_id IN
        SELECT person_id FROM trapper.sot_people
        WHERE display_name IS NULL
          AND merged_into_person_id IS NULL
    LOOP
        PERFORM trapper.update_person_display_name(v_person_id);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 11: Person Stats View
-- ============================================
\echo 'Creating v_people_stats view...'

CREATE OR REPLACE VIEW trapper.v_people_stats AS
SELECT
    COUNT(*) AS total_people,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NOT NULL) AS merged_people,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) AS canonical_people,
    COUNT(*) FILTER (WHERE display_name IS NOT NULL) AS with_display_name
FROM trapper.sot_people;

COMMENT ON VIEW trapper.v_people_stats IS
'Summary stats for people table.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_011 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('sot_people', 'person_identifiers', 'person_aliases', 'staged_record_person_link')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Run: SELECT * FROM trapper.upsert_people_from_observations(''trapping_requests'');'
\echo '  2. Run: SELECT trapper.update_all_person_display_names();'
\echo '  3. Check: SELECT id_type, COUNT(*) FROM trapper.person_identifiers GROUP BY 1;'
\echo '  4. Check: SELECT COUNT(*) FROM trapper.staged_record_person_link;'
\echo ''
