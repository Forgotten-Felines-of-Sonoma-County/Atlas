-- QRY_007__person_candidate_review.sql
-- Person Match Candidate Review Query
--
-- Purpose:
--   - Review open person match candidates
--   - Show details for manual acceptance/rejection decisions
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_007__person_candidate_review.sql

\echo '============================================'
\echo 'Person Match Candidate Review'
\echo '============================================'

-- ============================================
-- 1. Open Candidates Summary
-- ============================================
\echo ''
\echo '1. Open candidates by score range:'

SELECT
    CASE
        WHEN match_score >= 0.97 THEN '0.97+ (very high)'
        WHEN match_score >= 0.90 THEN '0.90-0.96 (high)'
        WHEN match_score >= 0.80 THEN '0.80-0.89 (medium)'
        ELSE '< 0.80 (low)'
    END AS score_range,
    COUNT(*) AS candidate_count
FROM trapper.person_match_candidates
WHERE status = 'open'
GROUP BY 1
ORDER BY 1 DESC;

-- ============================================
-- 2. Top Open Candidates for Review
-- ============================================
\echo ''
\echo '2. Top 20 open candidates for review:'

SELECT
    c.candidate_id,
    ROUND(c.match_score::numeric, 3) AS score,
    p1.display_name AS left_name,
    p2.display_name AS right_name,
    (SELECT string_agg(DISTINCT id_type || ':' || LEFT(id_value_norm, 15), ', ')
     FROM trapper.person_identifiers WHERE person_id = c.left_person_id) AS left_ids,
    (SELECT string_agg(DISTINCT id_type || ':' || LEFT(id_value_norm, 15), ', ')
     FROM trapper.person_identifiers WHERE person_id = c.right_person_id) AS right_ids,
    CASE WHEN trapper.have_shared_address_context(c.left_person_id, c.right_person_id)
         THEN 'YES' ELSE 'no' END AS shared_addr
FROM trapper.person_match_candidates c
JOIN trapper.sot_people p1 ON p1.person_id = c.left_person_id
JOIN trapper.sot_people p2 ON p2.person_id = c.right_person_id
WHERE c.status = 'open'
ORDER BY c.match_score DESC
LIMIT 20;

-- ============================================
-- 3. Candidate Details (Aliases)
-- ============================================
\echo ''
\echo '3. Alias comparison for top candidate:'

WITH top_candidate AS (
    SELECT left_person_id, right_person_id
    FROM trapper.person_match_candidates
    WHERE status = 'open'
    ORDER BY match_score DESC
    LIMIT 1
)
SELECT
    'LEFT' AS side,
    pa.name_raw,
    pa.name_key,
    pa.source_table
FROM trapper.person_aliases pa
JOIN top_candidate tc ON pa.person_id = tc.left_person_id
UNION ALL
SELECT
    'RIGHT' AS side,
    pa.name_raw,
    pa.name_key,
    pa.source_table
FROM trapper.person_aliases pa
JOIN top_candidate tc ON pa.person_id = tc.right_person_id
ORDER BY side, name_raw;

-- ============================================
-- 4. All Candidates by Status
-- ============================================
\echo ''
\echo '4. All candidates by status:'

SELECT
    status,
    COUNT(*) AS count,
    ROUND(AVG(match_score)::numeric, 3) AS avg_score,
    ROUND(MIN(match_score)::numeric, 3) AS min_score,
    ROUND(MAX(match_score)::numeric, 3) AS max_score
FROM trapper.person_match_candidates
GROUP BY status
ORDER BY status;

\echo ''
\echo 'To accept a match:'
\echo '  -- Review, then manually merge or mark as accepted'
\echo ''
\echo 'To reject a match:'
\echo '  SELECT trapper.reject_person_match(''<left_id>'', ''<right_id>'', ''Reason'', ''reviewer'');'
\echo ''
