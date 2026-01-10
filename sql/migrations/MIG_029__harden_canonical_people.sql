-- MIG_029__harden_canonical_people.sql
-- Harden Canonical People: Quality Gates and Filtered Views
--
-- Problem:
--   sot_people contains junk entries:
--   - Single-token names (first name only)
--   - HTML blobs from Airtable rich text fields
--   - Image URLs from airtableusercontent
--   - Cat identifiers misinterpreted as names
--   - Very short/long strings that aren't real names
--
-- Solution (NON-DESTRUCTIVE):
--   1. Create is_valid_person_name(text) function to validate names
--   2. Create v_canonical_people view that filters to valid entries
--   3. Create v_person_list_v2 and v_person_detail_v2 using the filter
--   4. Update search_unified to use filtered people
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_029__harden_canonical_people.sql

\echo '============================================'
\echo 'MIG_029: Harden Canonical People'
\echo '============================================'

-- ============================================
-- PART 1: Name Validation Function
-- ============================================
\echo ''
\echo 'Creating is_valid_person_name function...'

CREATE OR REPLACE FUNCTION trapper.is_valid_person_name(p_name TEXT)
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

    -- Reject cat-like identifiers (e.g., "#123/456", "FFSC-2024-001")
    IF p_name ~ '^\s*#?\d+[/-]' THEN
        RETURN FALSE;
    END IF;
    IF p_name ~ '^FFSC-\d+' THEN
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

    -- Require at least 2 tokens (first + last name)
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

    -- Reject if more than 50% digits in original
    IF (LENGTH(REGEXP_REPLACE(p_name, '[^0-9]', '', 'g'))::FLOAT / GREATEST(LENGTH(p_name), 1)) > 0.3 THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_valid_person_name IS
'Validates if a string is a plausible person name.
Returns FALSE for:
- NULL/empty
- HTML content
- URLs/image links
- Cat identifiers
- Single-token names (first name only)
- Very long strings
- High digit ratio';

-- ============================================
-- PART 2: Source Quality Classification
-- ============================================
\echo 'Creating get_person_source_quality function...'

CREATE OR REPLACE FUNCTION trapper.get_person_source_quality(p_person_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_has_clinichq BOOLEAN;
    v_has_trapping_req BOOLEAN;
    v_has_volunteerhub BOOLEAN;
BEGIN
    -- Check sources via identifiers and aliases
    SELECT
        EXISTS (SELECT 1 FROM trapper.person_identifiers pi
                WHERE pi.person_id = p_person_id
                  AND pi.source_system ILIKE '%clinichq%'),
        EXISTS (SELECT 1 FROM trapper.person_aliases pa
                WHERE pa.person_id = p_person_id
                  AND (pa.source_system ILIKE '%trapping%'
                       OR pa.source_table ILIKE '%trapping%')),
        EXISTS (SELECT 1 FROM trapper.person_aliases pa
                WHERE pa.person_id = p_person_id
                  AND (pa.source_system ILIKE '%volunteer%'))
    INTO v_has_clinichq, v_has_trapping_req, v_has_volunteerhub;

    -- Priority: clinichq > trapping_requests > volunteerhub > unknown
    IF v_has_clinichq THEN
        RETURN 'clinichq';
    ELSIF v_has_trapping_req THEN
        RETURN 'trapping_requests';
    ELSIF v_has_volunteerhub THEN
        RETURN 'volunteerhub';
    ELSE
        RETURN 'unknown';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_person_source_quality IS
'Returns the highest-quality source that contributed to a person.
Used to prioritize which canonical people are trustworthy.';

-- ============================================
-- PART 3: Canonical People View (Filtered)
-- ============================================
\echo 'Creating v_canonical_people view...'

CREATE OR REPLACE VIEW trapper.v_canonical_people AS
SELECT
    p.person_id,
    p.display_name,
    p.merged_into_person_id,
    p.created_at,
    p.updated_at,
    trapper.is_valid_person_name(p.display_name) AS is_valid_name,
    trapper.get_person_source_quality(p.person_id) AS source_quality,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count,
    -- Flag for trusted sources
    CASE
        WHEN trapper.get_person_source_quality(p.person_id) IN ('clinichq', 'trapping_requests') THEN TRUE
        ELSE FALSE
    END AS is_trusted_source
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_canonical_people IS
'All canonical people with quality flags.
Use is_valid_name = TRUE for filtered lists.
source_quality indicates data origin.';

-- ============================================
-- PART 4: Person List V2 (Filtered)
-- ============================================
\echo 'Creating v_person_list_v2 view...'

CREATE OR REPLACE VIEW trapper.v_person_list_v2 AS
SELECT
    p.person_id,
    p.display_name,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count,
    (SELECT string_agg(DISTINCT c.display_name, ', ' ORDER BY c.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
     WHERE pcr.person_id = p.person_id
     LIMIT 3) AS cat_names,
    (SELECT pl.display_name
     FROM trapper.person_place_relationships ppr
     JOIN trapper.places pl ON pl.place_id = ppr.place_id
     WHERE ppr.person_id = p.person_id
     ORDER BY ppr.created_at DESC
     LIMIT 1) AS primary_place,
    p.created_at,
    trapper.get_person_source_quality(p.person_id) AS source_quality
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND trapper.is_valid_person_name(p.display_name) = TRUE;

COMMENT ON VIEW trapper.v_person_list_v2 IS
'Person list view with quality filter applied.
Only shows people with valid names (2+ tokens, no HTML, etc).
Use this instead of v_person_list for UI.';

-- ============================================
-- PART 5: Person Detail V2 (Filtered)
-- ============================================
\echo 'Creating v_person_detail_v2 view...'

CREATE OR REPLACE VIEW trapper.v_person_detail_v2 AS
SELECT
    p.person_id,
    p.display_name,
    p.merged_into_person_id,
    p.created_at,
    p.updated_at,
    trapper.is_valid_person_name(p.display_name) AS is_valid_name,
    trapper.get_person_source_quality(p.person_id) AS source_quality,
    -- Cat relationships
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', pcr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', pcr.relationship_type,
        'confidence', pcr.confidence,
        'source_system', pcr.source_system
    ) ORDER BY pcr.relationship_type, c.display_name)
     FROM trapper.person_cat_relationships pcr
     JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
     WHERE pcr.person_id = p.person_id) AS cats,
    -- Place relationships
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', ppr.place_id,
        'place_name', pl.display_name,
        'formatted_address', pl.formatted_address,
        'place_kind', pl.place_kind,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY ppr.role, pl.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.places pl ON pl.place_id = ppr.place_id
     WHERE ppr.person_id = p.person_id) AS places,
    -- Person relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', CASE WHEN ppe.person_id_a = p.person_id THEN ppe.person_id_b ELSE ppe.person_id_a END,
        'person_name', CASE WHEN ppe.person_id_a = p.person_id THEN p2.display_name ELSE p1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label,
        'confidence', ppe.confidence
    ) ORDER BY rt.label)
     FROM trapper.person_person_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.sot_people p1 ON p1.person_id = ppe.person_id_a
     LEFT JOIN trapper.sot_people p2 ON p2.person_id = ppe.person_id_b
     WHERE ppe.person_id_a = p.person_id OR ppe.person_id_b = p.person_id) AS person_relationships,
    -- Stats
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) AS place_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND trapper.is_valid_person_name(p.display_name) = TRUE;

COMMENT ON VIEW trapper.v_person_detail_v2 IS
'Person detail view with quality filter.
Only includes people with valid names.
Use for detail pages after validation.';

-- ============================================
-- PART 6: Update Search to Use Filtered People
-- ============================================
\echo ''
\echo 'Updating search_unified to use filtered people...'

CREATE OR REPLACE FUNCTION trapper.search_unified(
    p_query TEXT,
    p_type TEXT DEFAULT NULL,
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    entity_type TEXT,
    entity_id TEXT,
    display_name TEXT,
    subtitle TEXT,
    match_strength TEXT,
    match_reason TEXT,
    score NUMERIC,
    metadata JSONB
) AS $$
DECLARE
    v_query_lower TEXT := LOWER(TRIM(p_query));
    v_query_pattern TEXT := '%' || v_query_lower || '%';
    v_query_prefix TEXT := v_query_lower || '%';
    v_tokens TEXT[];
BEGIN
    -- Parse query into tokens for token matching
    v_tokens := regexp_split_to_array(v_query_lower, '\s+');

    RETURN QUERY
    WITH ranked_results AS (
        -- ========== CATS ==========
        SELECT
            'cat'::TEXT AS entity_type,
            c.cat_id::TEXT AS entity_id,
            c.display_name,
            COALESCE(
                (SELECT 'Microchip: ' || ci.id_value
                 FROM trapper.cat_identifiers ci
                 WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
                 LIMIT 1),
                TRIM(COALESCE(c.sex, '') || ' ' || COALESCE(c.altered_status, '') || ' ' || COALESCE(c.breed, ''))
            ) AS subtitle,
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 100
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 95
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 98
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 90
                WHEN (
                    SELECT bool_and(LOWER(c.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 60 + (similarity(c.display_name, p_query) * 30)::INT
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 40
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 35
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(c.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(c.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) = v_query_lower
                ) THEN 'exact_microchip'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_prefix
                ) THEN 'prefix_microchip'
                WHEN similarity(c.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(c.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN EXISTS (
                    SELECT 1 FROM trapper.cat_identifiers ci
                    WHERE ci.cat_id = c.cat_id AND LOWER(ci.id_value) LIKE v_query_pattern
                ) THEN 'contains_identifier'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'sex', c.sex,
                'altered_status', c.altered_status,
                'breed', c.breed,
                'has_place', EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id),
                'owner_count', (SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
                                FROM trapper.person_cat_relationships pcr
                                WHERE pcr.cat_id = c.cat_id AND pcr.relationship_type = 'owner')
            ) AS metadata
        FROM trapper.sot_cats c
        WHERE (p_type IS NULL OR p_type = 'cat')
          AND (
              LOWER(c.display_name) LIKE v_query_pattern
              OR similarity(c.display_name, p_query) >= 0.3
              OR EXISTS (
                  SELECT 1 FROM trapper.cat_identifiers ci
                  WHERE ci.cat_id = c.cat_id
                    AND (LOWER(ci.id_value) LIKE v_query_pattern
                         OR similarity(ci.id_value, p_query) >= 0.4)
              )
          )

        UNION ALL

        -- ========== PEOPLE (FILTERED) ==========
        SELECT
            'person'::TEXT AS entity_type,
            p.person_id::TEXT AS entity_id,
            p.display_name,
            COALESCE(
                (SELECT 'Cats: ' || COUNT(*)::TEXT
                 FROM trapper.person_cat_relationships pcr
                 WHERE pcr.person_id = p.person_id),
                ''
            ) AS subtitle,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 100
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 95
                WHEN (
                    SELECT bool_and(LOWER(p.display_name) LIKE '%' || token || '%')
                    FROM unnest(v_tokens) AS token WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 60 + (similarity(p.display_name, p_query) * 30)::INT
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 40
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(p.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(p.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN similarity(p.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN LOWER(p.display_name) LIKE v_query_pattern THEN 'contains_name'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'cat_count', (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id),
                'place_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id),
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'source_quality', trapper.get_person_source_quality(p.person_id)
            ) AS metadata
        FROM trapper.sot_people p
        WHERE p.merged_into_person_id IS NULL
          AND trapper.is_valid_person_name(p.display_name) = TRUE  -- FILTER: only valid names
          AND (p_type IS NULL OR p_type = 'person')
          AND (
              LOWER(p.display_name) LIKE v_query_pattern
              OR similarity(p.display_name, p_query) >= 0.3
          )

        UNION ALL

        -- ========== PLACES ==========
        SELECT
            'place'::TEXT AS entity_type,
            pl.place_id::TEXT AS entity_id,
            pl.display_name,
            COALESCE(pl.place_kind::TEXT, 'place') || ' • ' || COALESCE(sa.locality, '') AS subtitle,
            CASE
                WHEN LOWER(pl.display_name) = v_query_lower THEN 100
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 99
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 95
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 92
                WHEN (
                    SELECT bool_and(
                        LOWER(COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.formatted_address, '')) LIKE '%' || token || '%'
                    )
                    FROM unnest(v_tokens) AS token WHERE LENGTH(token) >= 2
                ) THEN 75
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 60 + (similarity(pl.display_name, p_query) * 30)::INT
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 55 + (similarity(pl.formatted_address, p_query) * 30)::INT
                WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 40
                WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 35
                WHEN LOWER(sa.locality) LIKE v_query_pattern THEN 30
                ELSE 0
            END AS score,
            CASE
                WHEN LOWER(pl.display_name) = v_query_lower THEN 'exact_name'
                WHEN LOWER(pl.formatted_address) = v_query_lower THEN 'exact_address'
                WHEN LOWER(pl.display_name) LIKE v_query_prefix THEN 'prefix_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_prefix THEN 'prefix_address'
                WHEN similarity(pl.display_name, p_query) >= 0.5 THEN 'similar_name'
                WHEN similarity(pl.formatted_address, p_query) >= 0.5 THEN 'similar_address'
                WHEN LOWER(pl.display_name) LIKE v_query_pattern THEN 'contains_name'
                WHEN LOWER(pl.formatted_address) LIKE v_query_pattern THEN 'contains_address'
                WHEN LOWER(sa.locality) LIKE v_query_pattern THEN 'contains_locality'
                ELSE 'trigram'
            END AS match_reason,
            jsonb_build_object(
                'place_kind', pl.place_kind,
                'locality', sa.locality,
                'postal_code', sa.postal_code,
                'cat_count', (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id),
                'person_count', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = pl.place_id),
                'is_address_backed', pl.is_address_backed
            ) AS metadata
        FROM trapper.places pl
        LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
        WHERE pl.is_address_backed = true
          AND (p_type IS NULL OR p_type = 'place')
          AND (
              LOWER(pl.display_name) LIKE v_query_pattern
              OR LOWER(pl.formatted_address) LIKE v_query_pattern
              OR LOWER(sa.locality) LIKE v_query_pattern
              OR similarity(pl.display_name, p_query) >= 0.3
              OR similarity(pl.formatted_address, p_query) >= 0.3
          )
    )
    SELECT
        r.entity_type,
        r.entity_id,
        r.display_name,
        r.subtitle,
        CASE
            WHEN r.score >= 90 THEN 'strong'
            WHEN r.score >= 50 THEN 'medium'
            ELSE 'weak'
        END AS match_strength,
        r.match_reason,
        r.score::NUMERIC,
        r.metadata
    FROM ranked_results r
    WHERE r.score > 0
    ORDER BY r.score DESC, r.display_name ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_unified IS
'Google-like search across cats, people, and places.
People are filtered to only include valid names (2+ tokens, no HTML).
Returns ranked results with match strength and reason.';

-- ============================================
-- PART 7: Place Detail V2 (Filtered People in Relationships)
-- ============================================
\echo ''
\echo 'Creating v_place_detail_v2 view...'

CREATE OR REPLACE VIEW trapper.v_place_detail_v2 AS
SELECT
    pl.place_id,
    pl.display_name,
    pl.formatted_address,
    pl.place_kind,
    pl.is_address_backed,
    pl.has_cat_activity,
    sa.locality,
    sa.postal_code,
    sa.admin_area_1 AS state_province,
    CASE WHEN pl.location IS NOT NULL THEN
        jsonb_build_object(
            'lat', ST_Y(pl.location::geometry),
            'lng', ST_X(pl.location::geometry)
        )
    ELSE NULL END AS coordinates,
    pl.created_at,
    pl.updated_at,
    -- Cats at this place
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', cpr.cat_id,
        'cat_name', c.display_name,
        'relationship_type', cpr.relationship_type,
        'confidence', cpr.confidence
    ) ORDER BY c.display_name)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE cpr.place_id = pl.place_id) AS cats,
    -- People at this place (FILTERED to valid names only)
    (SELECT jsonb_agg(jsonb_build_object(
        'person_id', ppr.person_id,
        'person_name', p.display_name,
        'role', ppr.role,
        'confidence', ppr.confidence
    ) ORDER BY p.display_name)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL
       AND trapper.is_valid_person_name(p.display_name) = TRUE) AS people,
    -- Place relationships (from edges)
    (SELECT jsonb_agg(jsonb_build_object(
        'place_id', CASE WHEN ppe.place_id_a = pl.place_id THEN ppe.place_id_b ELSE ppe.place_id_a END,
        'place_name', CASE WHEN ppe.place_id_a = pl.place_id THEN pl2.display_name ELSE pl1.display_name END,
        'relationship_type', rt.code,
        'relationship_label', rt.label
    ) ORDER BY rt.label)
     FROM trapper.place_place_edges ppe
     JOIN trapper.relationship_types rt ON rt.id = ppe.relationship_type_id
     LEFT JOIN trapper.places pl1 ON pl1.place_id = ppe.place_id_a
     LEFT JOIN trapper.places pl2 ON pl2.place_id = ppe.place_id_b
     WHERE ppe.place_id_a = pl.place_id OR ppe.place_id_b = pl.place_id) AS place_relationships,
    -- Stats (filtered)
    (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pl.place_id) AS cat_count,
    (SELECT COUNT(*)
     FROM trapper.person_place_relationships ppr
     JOIN trapper.sot_people p ON p.person_id = ppr.person_id
     WHERE ppr.place_id = pl.place_id
       AND p.merged_into_person_id IS NULL
       AND trapper.is_valid_person_name(p.display_name) = TRUE) AS person_count
FROM trapper.places pl
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = pl.sot_address_id
WHERE pl.is_address_backed = true;

COMMENT ON VIEW trapper.v_place_detail_v2 IS
'Full place detail for API including cats, people (filtered to valid names), and place relationships.
Use this instead of v_place_detail for UI display.';

-- ============================================
-- PART 8: Audit Queries
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_029 Complete - Audit Results:'
\echo '============================================'

\echo ''
\echo 'Total people in sot_people:'
SELECT COUNT(*) AS total_people FROM trapper.sot_people WHERE merged_into_person_id IS NULL;

\echo ''
\echo 'People with valid names:'
SELECT COUNT(*) AS valid_name_count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND trapper.is_valid_person_name(display_name) = TRUE;

\echo ''
\echo 'People with INVALID names (filtered out):'
SELECT COUNT(*) AS invalid_name_count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND trapper.is_valid_person_name(display_name) = FALSE;

\echo ''
\echo 'Sample of invalid names (first 20):'
SELECT display_name,
       trapper.is_valid_person_name(display_name) AS is_valid,
       LENGTH(display_name) AS len,
       trapper.name_token_count(display_name) AS tokens
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND trapper.is_valid_person_name(display_name) = FALSE
LIMIT 20;

\echo ''
\echo 'People by source quality:'
SELECT
    trapper.get_person_source_quality(person_id) AS source,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE trapper.is_valid_person_name(display_name)) AS valid_count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY 1
ORDER BY count DESC;

\echo ''
\echo 'v_person_list_v2 row count:'
SELECT COUNT(*) AS filtered_list_count FROM trapper.v_person_list_v2;

\echo ''
\echo 'MIG_029 applied successfully.'
\echo 'API should now use v_person_list_v2 instead of v_person_list.'
\echo ''
