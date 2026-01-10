-- MIG_030__fix_person_name_extraction.sql
-- Fix: Combine First Name + Last Name into single full_name signal
--
-- ROOT CAUSE:
--   extract_observations_from_staged treated "First Name" and "Last Name"
--   as SEPARATE name_signal observations. Each single-token value became
--   a person alias, leading to canonical people with names like just "John".
--
-- FIX:
--   1. Smart extraction: Combine First+Last into one full_name signal
--   2. Defensive guard: Reject single-token names at canonicalization
--   3. Source filtering: Exclude E-Tapestry, Shelterluv from canonical people
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_030__fix_person_name_extraction.sql

\echo '============================================'
\echo 'MIG_030: Fix Person Name Extraction'
\echo '============================================'

-- ============================================
-- PART 1: Helper - Combine First + Last Name
-- ============================================
\echo ''
\echo 'Creating combine_first_last_name function...'

CREATE OR REPLACE FUNCTION trapper.combine_first_last_name(
    p_payload JSONB,
    p_first_key TEXT,
    p_last_key TEXT
)
RETURNS TEXT AS $$
DECLARE
    v_first TEXT;
    v_last TEXT;
    v_combined TEXT;
BEGIN
    v_first := TRIM(COALESCE(p_payload->>p_first_key, ''));
    v_last := TRIM(COALESCE(p_payload->>p_last_key, ''));

    -- Both must be present for a valid full name
    IF v_first = '' AND v_last = '' THEN
        RETURN NULL;
    END IF;

    -- If only one is present, still return it (will be filtered by validation later)
    IF v_first = '' THEN
        RETURN v_last;
    ELSIF v_last = '' THEN
        RETURN v_first;
    END IF;

    -- Combine with space
    v_combined := v_first || ' ' || v_last;

    -- Clean up extra whitespace
    v_combined := REGEXP_REPLACE(v_combined, '\s+', ' ', 'g');

    RETURN TRIM(v_combined);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.combine_first_last_name IS
'Combines first and last name fields from a JSONB payload into a single full name.
Returns NULL if both are empty.';

-- ============================================
-- PART 2: Updated extract_observations_from_staged
-- ============================================
\echo ''
\echo 'Updating extract_observations_from_staged function...'

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
    v_source_system TEXT;
    v_field TEXT;
    v_value TEXT;
    v_full_name TEXT;
    v_classification RECORD;
    -- Address fields
    v_addr_fields TEXT[] := ARRAY[
        'Address', 'Requester Address', 'Mailing Address', 'Cats Address',
        'Trapping Address', 'Location Address', 'Location',
        'Owner Address', 'Street', 'Street Address', 'Physical Address'
    ];
    -- Phone fields
    v_phone_fields TEXT[] := ARRAY[
        'Phone', 'Clean Phone', 'Business Phone', 'Mobile', 'Cell',
        'Owner Phone', 'Owner Cell Phone', 'Phone Number', 'Cell Phone',
        'Home Phone', 'Work Phone', 'Cell phone', 'Home phone'
    ];
    -- Email fields
    v_email_fields TEXT[] := ARRAY[
        'Email', 'Clean Email', 'Business Email', 'Owner Email',
        'Email Address', 'Primary Email', 'Email address', 'email'
    ];
    -- Full name fields (already composite, not First+Last pairs)
    v_fullname_fields TEXT[] := ARRAY[
        'Client Name', 'Owner Name', 'Requester Name', 'Contact Name',
        'Name', 'Full Name'
    ];
    v_emitted_name BOOLEAN := FALSE;
BEGIN
    -- Get the payload and source info
    SELECT sr.payload, sr.source_table, sr.source_system
    INTO v_payload, v_source_table, v_source_system
    FROM trapper.staged_records sr
    WHERE sr.id = p_staged_record_id;

    IF v_payload IS NULL THEN
        RETURN;
    END IF;

    -- ============================================
    -- PERSON NAMES: Smart extraction by source
    -- ============================================

    -- Airtable Trapping Requests: Combine First Name + Last Name
    IF v_source_table = 'trapping_requests' THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'First Name', 'Last Name');
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Full Name (First + Last)'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- ClinicHQ: Combine Owner First Name + Owner Last Name
    IF v_source_system = 'clinichq' THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'Owner First Name', 'Owner Last Name');
        IF v_full_name IS NULL THEN
            -- Try alternate field names
            v_full_name := trapper.combine_first_last_name(v_payload, 'owner_first_name', 'owner_last_name');
        END IF;
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Owner Full Name'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- VolunteerHub: Combine First name + Last name (note different casing)
    IF v_source_system ILIKE '%volunteer%' OR v_source_table ILIKE '%volunteer%' THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'First name', 'Last name');
        IF v_full_name IS NULL THEN
            v_full_name := trapper.combine_first_last_name(v_payload, 'First Name', 'Last Name');
        END IF;
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Volunteer Full Name'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Shelterluv/PetLink: Combine Firstname + Lastname
    IF v_source_system ILIKE '%shelterluv%' OR v_source_system ILIKE '%petlink%' THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'Firstname', 'Lastname');
        IF v_full_name IS NULL THEN
            v_full_name := trapper.combine_first_last_name(v_payload, 'FirstName', 'LastName');
        END IF;
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Person Full Name'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                -- Lower confidence for Shelterluv/PetLink (not canonical for now)
                0.4::NUMERIC(3,2);
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Generic First/Last combination (fallback for other sources)
    IF NOT v_emitted_name THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'First Name', 'Last Name');
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Full Name (First + Last)'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Also check composite name fields (Owner Name, Client Name, etc.)
    -- But only if we haven't already emitted a name from First+Last
    IF NOT v_emitted_name THEN
        FOREACH v_field IN ARRAY v_fullname_fields LOOP
            v_value := v_payload->>v_field;
            IF v_value IS NOT NULL AND TRIM(v_value) <> '' THEN
                SELECT * INTO v_classification FROM trapper.classify_name(v_value);
                RETURN QUERY SELECT
                    'name_signal'::trapper.observation_type,
                    v_field,
                    v_value,
                    to_jsonb(v_classification),
                    v_classification.confidence;
                v_emitted_name := TRUE;
                EXIT;  -- Only emit first valid composite name
            END IF;
        END LOOP;
    END IF;

    -- ============================================
    -- ADDRESS SIGNALS
    -- ============================================
    FOREACH v_field IN ARRAY v_addr_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' AND LENGTH(TRIM(v_value)) > 3 THEN
            RETURN QUERY SELECT
                'address_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.8::NUMERIC(3,2);
        END IF;
    END LOOP;

    -- ============================================
    -- PHONE SIGNALS
    -- ============================================
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

    -- ============================================
    -- EMAIL SIGNALS
    -- ============================================
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

COMMENT ON FUNCTION trapper.extract_observations_from_staged IS
'Extract observations (signals) from a staged record payload.
FIXED in MIG_030: Combines First+Last names into single full_name signal.
Does NOT emit separate First Name / Last Name signals.';

-- ============================================
-- PART 3: Defensive Guard - Validate Name Before Creating Person
-- ============================================
\echo ''
\echo 'Creating is_valid_person_name_for_canonical function...'

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
BEGIN
    -- NULL or empty -> invalid
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN FALSE;
    END IF;

    -- Source filtering: Exclude E-Tapestry from canonical people entirely
    IF p_source_system ILIKE '%etapestry%' OR p_source_table ILIKE '%etapestry%' THEN
        RETURN FALSE;
    END IF;

    -- Source filtering: Exclude Shelterluv from canonical people (deep search only)
    IF p_source_system ILIKE '%shelterluv%' OR p_source_table ILIKE '%shelterluv%' THEN
        RETURN FALSE;
    END IF;

    -- Source filtering: Exclude Appointment Requests from canonical (messy names)
    IF p_source_table ILIKE '%appointment_request%' THEN
        RETURN FALSE;
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

    -- Reject cat-like identifiers (e.g., "#123/456", "FFSC-2024-001", "A12345")
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

    -- CRITICAL: Require at least 2 tokens (first + last name)
    IF v_token_count < 2 THEN
        RETURN FALSE;
    END IF;

    -- Each token should have at least 2 characters (reject "J Smith")
    -- Allow single-char tokens if there are 3+ tokens total (middle initials)
    IF v_token_count = 2 THEN
        IF LENGTH(v_tokens[1]) < 2 OR LENGTH(v_tokens[2]) < 2 THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- Reject excessively long names (likely garbage)
    IF LENGTH(p_name) > 100 THEN
        RETURN FALSE;
    END IF;

    -- Reject if more than 30% digits in original
    IF (LENGTH(REGEXP_REPLACE(p_name, '[^0-9]', '', 'g'))::FLOAT / GREATEST(LENGTH(p_name), 1)) > 0.3 THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_valid_person_name_for_canonical IS
'Validates if a name is acceptable for canonical person creation.
Rejects: single-token names, HTML, URLs, cat identifiers, excluded sources.
Use at canonicalization time to prevent bad entries.';

-- ============================================
-- PART 4: Updated upsert_people_from_observations (with guards)
-- ============================================
\echo ''
\echo 'Updating upsert_people_from_observations with validation guards...'

CREATE OR REPLACE FUNCTION trapper.upsert_people_from_observations(
    p_source_table TEXT,
    p_run_scope TEXT DEFAULT 'latest'
)
RETURNS TABLE (
    people_created INT,
    identifiers_added INT,
    aliases_added INT,
    records_linked INT,
    names_rejected INT
) AS $$
DECLARE
    v_people_created INT := 0;
    v_identifiers_added INT := 0;
    v_aliases_added INT := 0;
    v_records_linked INT := 0;
    v_names_rejected INT := 0;

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
        -- P2: Phone Signal -> Deterministic Match
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
        -- P3: Name Signal -> Add Alias (ONLY if valid)
        -- ============================================
        ELSIF v_obs.observation_type = 'name_signal' THEN
            -- GUARD: Validate name before using it
            IF NOT trapper.is_valid_person_name_for_canonical(
                v_obs.value_text,
                v_obs.source_system,
                v_obs.source_table
            ) THEN
                v_names_rejected := v_names_rejected + 1;
                CONTINUE;
            END IF;

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

    RETURN QUERY SELECT v_people_created, v_identifiers_added, v_aliases_added, v_records_linked, v_names_rejected;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_people_from_observations IS
'Deterministic identity resolution from observations.
Priority: email -> phone -> name (alias only).
FIXED in MIG_030: Validates names before adding as aliases.
Rejects single-token names, HTML, excluded sources.
Returns counts including rejected names.';

-- ============================================
-- PART 5: Updated update_person_display_name (with validation)
-- ============================================
\echo ''
\echo 'Updating update_person_display_name with validation...'

CREATE OR REPLACE FUNCTION trapper.update_person_display_name(p_person_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_display_name TEXT;
BEGIN
    -- Pick the most common VALID alias
    SELECT pa.name_raw INTO v_display_name
    FROM trapper.person_aliases pa
    WHERE pa.person_id = p_person_id
      -- Only consider valid names for display
      AND trapper.is_valid_person_name(pa.name_raw) = TRUE
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
'Updates person display_name from most common VALID alias.
FIXED in MIG_030: Only considers names that pass is_valid_person_name.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_030 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Testing combine_first_last_name:'
SELECT
    trapper.combine_first_last_name('{"First Name": "John", "Last Name": "Smith"}'::jsonb, 'First Name', 'Last Name') AS full_name;

\echo ''
\echo 'Testing is_valid_person_name_for_canonical:'
SELECT
    'John Smith' AS name, trapper.is_valid_person_name_for_canonical('John Smith') AS valid
UNION ALL
SELECT
    'John' AS name, trapper.is_valid_person_name_for_canonical('John') AS valid
UNION ALL
SELECT
    '<img src=...>' AS name, trapper.is_valid_person_name_for_canonical('<img src=...>') AS valid;

\echo ''
\echo 'MIG_030 applied. Next steps:'
\echo '  1. Clear derived people tables (see rebuild commands below)'
\echo '  2. Re-run ingests with new extraction logic'
\echo '  3. Verify with acceptance tests'
\echo ''
\echo 'REBUILD COMMANDS (Option 2 - in-place):'
\echo '  -- Clear derived tables (preserves staged_records and raw data)'
\echo '  TRUNCATE trapper.staged_record_person_link CASCADE;'
\echo '  TRUNCATE trapper.person_aliases CASCADE;'
\echo '  TRUNCATE trapper.person_identifiers CASCADE;'
\echo '  TRUNCATE trapper.person_cat_relationships CASCADE;'
\echo '  TRUNCATE trapper.person_place_relationships CASCADE;'
\echo '  DELETE FROM trapper.sot_people;'
\echo '  TRUNCATE trapper.observations;'
\echo ''
\echo '  -- Then re-run observation population and person derivation'
\echo ''
