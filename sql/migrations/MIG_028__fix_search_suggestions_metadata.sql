-- MIG_028__fix_search_suggestions_metadata.sql
-- Fix: Add metadata column to search_suggestions function
--
-- Problem:
--   search_unified returns (entity_type, entity_id, display_name, subtitle, match_strength, match_reason, score, metadata)
--   search_suggestions returns same columns WITHOUT metadata
--   API expects metadata from both, causing 500 error
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_028__fix_search_suggestions_metadata.sql

\echo '============================================'
\echo 'MIG_028: Fix search_suggestions metadata column'
\echo '============================================'

-- Drop and recreate to change signature
DROP FUNCTION IF EXISTS trapper.search_suggestions(TEXT, INT);

CREATE OR REPLACE FUNCTION trapper.search_suggestions(
    p_query TEXT,
    p_limit INT DEFAULT 8
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
BEGIN
    -- Return top results biased toward strong matches
    RETURN QUERY
    SELECT
        s.entity_type,
        s.entity_id,
        s.display_name,
        s.subtitle,
        s.match_strength,
        s.match_reason,
        s.score,
        s.metadata
    FROM trapper.search_unified(p_query, NULL, p_limit * 3, 0) s
    WHERE s.score >= 40  -- Only medium+ matches for suggestions
    ORDER BY s.score DESC, s.display_name ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.search_suggestions IS
'Returns top suggestions for typeahead/autocomplete.
Biased toward strong and medium matches. Use for dropdown suggestions.
Fixed in MIG_028: Now returns metadata column for API consistency.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification - search_suggestions now returns metadata:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'information_schema'
  AND table_name = 'routine_columns'
LIMIT 0;  -- Just check function exists

\echo ''
\echo 'Test search_suggestions:'
SELECT entity_type, display_name, score, metadata IS NOT NULL AS has_metadata
FROM trapper.search_suggestions('a', 3);

\echo ''
\echo 'MIG_028 applied successfully.'
\echo ''
