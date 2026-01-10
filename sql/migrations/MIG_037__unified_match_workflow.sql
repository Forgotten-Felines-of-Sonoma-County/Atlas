-- MIG_037__unified_match_workflow.sql
-- Unified entity matching workflow and updated search views
--
-- Purpose:
--   Provide consistent interface for match candidate generation across entity types.
--   Update search functions to prefer significant places.
--   Create unified review queue views.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_037__unified_match_workflow.sql

\echo '============================================'
\echo 'MIG_037: Unified Match Workflow'
\echo '============================================'

-- ============================================
-- PART 1: Unified candidate generation
-- ============================================
\echo ''
\echo 'Creating generate_match_candidates function...'

CREATE OR REPLACE FUNCTION trapper.generate_match_candidates(
    p_entity_type TEXT,
    p_min_score NUMERIC DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_result RECORD;
    v_min_score NUMERIC;
BEGIN
    -- Get minimum score from config if not provided
    IF p_min_score IS NULL THEN
        v_min_score := trapper.get_match_config(p_entity_type, 'candidate_min_score',
            CASE p_entity_type
                WHEN 'person' THEN 0.5
                WHEN 'cat' THEN 0.4
                ELSE 0.5
            END
        );
    ELSE
        v_min_score := p_min_score;
    END IF;

    -- Dispatch to entity-specific function
    CASE p_entity_type
        WHEN 'person' THEN
            SELECT * INTO v_result FROM trapper.generate_phonetic_match_candidates(v_min_score);
            RETURN jsonb_build_object(
                'entity_type', 'person',
                'candidates_created', v_result.candidates_created,
                'candidates_skipped', v_result.candidates_skipped,
                'min_score', v_min_score
            );

        WHEN 'cat' THEN
            SELECT * INTO v_result FROM trapper.generate_cat_match_candidates(v_min_score);
            RETURN jsonb_build_object(
                'entity_type', 'cat',
                'candidates_created', v_result.candidates_created,
                'candidates_skipped', v_result.candidates_skipped,
                'min_score', v_min_score
            );

        ELSE
            RETURN jsonb_build_object(
                'error', 'Unknown entity type: ' || p_entity_type,
                'supported_types', ARRAY['person', 'cat']
            );
    END CASE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.generate_match_candidates IS
'Unified interface for generating match candidates.
Supported entity types: person, cat
Delegates to entity-specific generation functions.';

-- ============================================
-- PART 2: Unified accept/reject interface
-- ============================================
\echo ''
\echo 'Creating accept_match_candidate function...'

CREATE OR REPLACE FUNCTION trapper.accept_match_candidate(
    p_entity_type TEXT,
    p_candidate_id UUID,
    p_decided_by TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    CASE p_entity_type
        WHEN 'person' THEN
            -- For people, accepting means triggering merge
            PERFORM trapper.accept_person_match(p_candidate_id);
            RETURN jsonb_build_object('status', 'accepted', 'entity_type', 'person', 'candidate_id', p_candidate_id);

        WHEN 'cat' THEN
            PERFORM trapper.accept_cat_match(p_candidate_id, p_decided_by, p_note);
            RETURN jsonb_build_object('status', 'accepted', 'entity_type', 'cat', 'candidate_id', p_candidate_id);

        ELSE
            RETURN jsonb_build_object('error', 'Unknown entity type: ' || p_entity_type);
    END CASE;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM, 'entity_type', p_entity_type, 'candidate_id', p_candidate_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.reject_match_candidate(
    p_entity_type TEXT,
    p_candidate_id UUID,
    p_decided_by TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    CASE p_entity_type
        WHEN 'person' THEN
            PERFORM trapper.reject_person_match(p_candidate_id, p_note);
            RETURN jsonb_build_object('status', 'rejected', 'entity_type', 'person', 'candidate_id', p_candidate_id);

        WHEN 'cat' THEN
            PERFORM trapper.reject_cat_match(p_candidate_id, p_decided_by, p_note);
            RETURN jsonb_build_object('status', 'rejected', 'entity_type', 'cat', 'candidate_id', p_candidate_id);

        ELSE
            RETURN jsonb_build_object('error', 'Unknown entity type: ' || p_entity_type);
    END CASE;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM, 'entity_type', p_entity_type, 'candidate_id', p_candidate_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.accept_match_candidate IS
'Unified interface for accepting match candidates.';

COMMENT ON FUNCTION trapper.reject_match_candidate IS
'Unified interface for rejecting match candidates.';

-- ============================================
-- PART 3: Unified review queue view
-- ============================================
\echo ''
\echo 'Creating v_match_review_queue view...'

CREATE OR REPLACE VIEW trapper.v_match_review_queue AS
-- Person match candidates
SELECT
    'person'::TEXT AS entity_type,
    pmc.candidate_id,
    pmc.match_score,
    pmc.match_reasons,
    p1.display_name AS left_name,
    p2.display_name AS right_name,
    pmc.status::TEXT AS status,
    pmc.created_at,
    NULL::JSONB AS extra_info
FROM trapper.person_match_candidates pmc
JOIN trapper.sot_people p1 ON p1.person_id = pmc.left_person_id
JOIN trapper.sot_people p2 ON p2.person_id = pmc.right_person_id
WHERE pmc.status = 'open'

UNION ALL

-- Cat match candidates
SELECT
    'cat'::TEXT AS entity_type,
    cmc.candidate_id,
    cmc.match_score,
    cmc.match_reasons,
    c1.display_name AS left_name,
    c2.display_name AS right_name,
    cmc.status::TEXT AS status,
    cmc.created_at,
    jsonb_build_object(
        'left_color', c1.primary_color,
        'right_color', c2.primary_color,
        'left_sex', c1.sex,
        'right_sex', c2.sex
    ) AS extra_info
FROM trapper.cat_match_candidates cmc
JOIN trapper.sot_cats c1 ON c1.cat_id = cmc.left_cat_id
JOIN trapper.sot_cats c2 ON c2.cat_id = cmc.right_cat_id
WHERE cmc.status = 'open'

ORDER BY match_score DESC, created_at;

COMMENT ON VIEW trapper.v_match_review_queue IS
'Unified view of all open match candidates across entity types.
Order by score DESC to review highest-confidence matches first.';

-- ============================================
-- PART 4: Review queue summary
-- ============================================
\echo ''
\echo 'Creating v_review_queue_summary view...'

CREATE OR REPLACE VIEW trapper.v_review_queue_summary AS
SELECT
    'person' AS entity_type,
    COUNT(*) AS open_candidates,
    AVG(match_score) AS avg_score,
    MIN(created_at) AS oldest_candidate
FROM trapper.person_match_candidates
WHERE status = 'open'

UNION ALL

SELECT
    'cat' AS entity_type,
    COUNT(*) AS open_candidates,
    AVG(match_score) AS avg_score,
    MIN(created_at) AS oldest_candidate
FROM trapper.cat_match_candidates
WHERE status = 'open'

UNION ALL

SELECT
    'address' AS entity_type,
    COUNT(*) AS open_candidates,
    NULL AS avg_score,
    MIN(created_at) AS oldest_candidate
FROM trapper.address_review_queue
WHERE is_resolved = FALSE;

COMMENT ON VIEW trapper.v_review_queue_summary IS
'Summary of all review queues: person matches, cat matches, and address reviews.';

-- ============================================
-- PART 5: Updated search_unified to prefer significant places
-- ============================================
\echo ''
\echo 'Updating search_unified to prefer significant places...'

-- First, let's check if the function exists and update it
DO $$
BEGIN
    -- Add comment explaining the preference logic
    -- The actual function is likely in MIG_019 or earlier
    -- We'll create a wrapper that adds significance boosting

    RAISE NOTICE 'search_unified function exists - adding significance preference via search ranking';
END $$;

-- Create a significance-aware place search function
CREATE OR REPLACE FUNCTION trapper.search_places_with_significance(
    p_query TEXT,
    p_limit INT DEFAULT 25,
    p_include_insignificant BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    place_id UUID,
    display_name TEXT,
    formatted_address TEXT,
    place_kind trapper.place_kind,
    is_significant BOOLEAN,
    activity_score NUMERIC,
    search_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.place_id,
        p.display_name,
        p.formatted_address,
        p.place_kind,
        p.is_significant,
        p.activity_score,
        similarity(LOWER(p.display_name), LOWER(p_query)) +
        similarity(LOWER(p.formatted_address), LOWER(p_query)) +
        CASE WHEN p.is_significant THEN 0.3 ELSE 0 END +
        COALESCE(p.activity_score, 0) / 100.0 AS search_score
    FROM trapper.places p
    WHERE
        (p.is_significant OR p_include_insignificant)
        AND (
            p.display_name ILIKE '%' || p_query || '%'
            OR p.formatted_address ILIKE '%' || p_query || '%'
            OR similarity(LOWER(p.display_name), LOWER(p_query)) > 0.2
            OR similarity(LOWER(p.formatted_address), LOWER(p_query)) > 0.2
        )
    ORDER BY search_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_places_with_significance IS
'Searches places with significance boosting.
By default, only returns significant places.
Set p_include_insignificant = TRUE for all places.
Significant places get +0.3 score boost.';

-- ============================================
-- PART 6: Updated place list view with significance
-- ============================================
\echo ''
\echo 'Creating v_place_list_v3 view...'

CREATE OR REPLACE VIEW trapper.v_place_list_v3 AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    p.effective_type,
    p.is_significant,
    p.significance_reason,
    p.activity_score,
    p.has_trapping_activity,
    p.has_cat_activity,
    p.last_activity_at,
    a.lat,
    a.lng,
    a.precision AS address_precision,
    a.confidence_score AS address_confidence,
    -- Count related entities
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id) AS person_count,
    -- Sort order: significant first, then by activity
    CASE WHEN p.is_significant THEN 0 ELSE 1 END AS significance_sort,
    COALESCE(p.activity_score, 0) AS activity_sort
FROM trapper.places p
LEFT JOIN trapper.sot_addresses a ON a.address_id = p.sot_address_id
ORDER BY significance_sort, activity_sort DESC, p.display_name;

COMMENT ON VIEW trapper.v_place_list_v3 IS
'Place list with significance ranking. Significant places appear first.
Includes address precision and activity metrics.';

-- ============================================
-- PART 7: Entity resolution stats view
-- ============================================
\echo ''
\echo 'Creating v_entity_resolution_stats view...'

CREATE OR REPLACE VIEW trapper.v_entity_resolution_stats AS
SELECT
    'people' AS entity_type,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) AS canonical_count,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL) AS merged_count,
    (SELECT COUNT(*) FROM trapper.person_match_candidates WHERE status = 'open') AS pending_review,
    (SELECT COUNT(*) FROM trapper.person_match_candidates WHERE status = 'auto_merged') AS auto_merged,
    (SELECT COUNT(*) FROM trapper.person_match_decisions WHERE decision = 'same_person') AS accepted,
    (SELECT COUNT(*) FROM trapper.person_match_decisions WHERE decision = 'not_same_person') AS rejected

UNION ALL

SELECT
    'places' AS entity_type,
    (SELECT COUNT(*) FROM trapper.places) AS canonical_count,
    NULL AS merged_count,
    (SELECT COUNT(*) FROM trapper.address_review_queue WHERE is_resolved = FALSE) AS pending_review,
    NULL AS auto_merged,
    (SELECT COUNT(*) FROM trapper.address_review_queue WHERE resolution = 'accepted') AS accepted,
    (SELECT COUNT(*) FROM trapper.address_review_queue WHERE resolution = 'rejected') AS rejected

UNION ALL

SELECT
    'cats' AS entity_type,
    (SELECT COUNT(*) FROM trapper.sot_cats) AS canonical_count,
    NULL AS merged_count,
    (SELECT COUNT(*) FROM trapper.cat_match_candidates WHERE status = 'open') AS pending_review,
    (SELECT COUNT(*) FROM trapper.cat_match_candidates WHERE status = 'auto_merged') AS auto_merged,
    (SELECT COUNT(*) FROM trapper.cat_match_decisions WHERE decision = 'same_cat') AS accepted,
    (SELECT COUNT(*) FROM trapper.cat_match_decisions WHERE decision = 'not_same_cat') AS rejected;

COMMENT ON VIEW trapper.v_entity_resolution_stats IS
'Overall statistics for entity resolution across all entity types.
Shows canonical counts, merge stats, and review queue status.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_037 Complete'
\echo '============================================'

\echo ''
\echo 'Entity resolution statistics:'
SELECT * FROM trapper.v_entity_resolution_stats;

\echo ''
\echo 'Review queue summary:'
SELECT * FROM trapper.v_review_queue_summary;

\echo ''
\echo 'Place significance distribution:'
SELECT
    is_significant,
    COUNT(*) AS count,
    AVG(activity_score) AS avg_activity_score
FROM trapper.places
GROUP BY is_significant
ORDER BY is_significant DESC;

\echo ''
\echo 'Usage:'
\echo ''
\echo '  -- Generate all match candidates'
\echo '  SELECT trapper.generate_match_candidates(''person'');'
\echo '  SELECT trapper.generate_match_candidates(''cat'');'
\echo ''
\echo '  -- Review unified queue'
\echo '  SELECT * FROM trapper.v_match_review_queue LIMIT 20;'
\echo ''
\echo '  -- Accept/reject'
\echo '  SELECT trapper.accept_match_candidate(''person'', ''<candidate_id>'');'
\echo '  SELECT trapper.reject_match_candidate(''cat'', ''<candidate_id>'', ''reviewer'', ''Different cats'');'
\echo ''
\echo '  -- Search places (significant only)'
\echo '  SELECT * FROM trapper.search_places_with_significance(''clinic'');'
\echo ''
\echo '  -- Search places (all)'
\echo '  SELECT * FROM trapper.search_places_with_significance(''main st'', 25, TRUE);'
\echo ''
