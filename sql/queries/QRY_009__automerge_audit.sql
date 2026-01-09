-- QRY_009__automerge_audit.sql
-- Auto-Merge Audit Query
--
-- Purpose:
--   - Review all person merges (auto and manual)
--   - Check revert status
--   - Audit merge decisions
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_009__automerge_audit.sql

\echo '============================================'
\echo 'Auto-Merge Audit'
\echo '============================================'

-- ============================================
-- 1. Merge Summary
-- ============================================
\echo ''
\echo '1. Merge summary:'

SELECT
    merge_rule,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE is_reverted = FALSE) AS active,
    COUNT(*) FILTER (WHERE is_reverted = TRUE) AS reverted,
    ROUND(AVG(match_score)::numeric, 3) AS avg_score
FROM trapper.person_merges
GROUP BY merge_rule
ORDER BY merge_rule;

-- ============================================
-- 2. Recent Merges
-- ============================================
\echo ''
\echo '2. Recent merges (last 20):'

SELECT
    pm.merge_id,
    pm.from_display_name,
    pm.into_display_name,
    pm.merge_rule,
    ROUND(pm.match_score::numeric, 3) AS score,
    CASE WHEN pm.is_reverted THEN 'REVERTED' ELSE 'active' END AS status,
    pm.created_at::date AS merged_date,
    pm.created_by
FROM trapper.v_person_merges_audit pm
ORDER BY pm.created_at DESC
LIMIT 20;

-- ============================================
-- 3. Reverted Merges
-- ============================================
\echo ''
\echo '3. Reverted merges:'

SELECT
    pm.merge_id,
    p_from.display_name AS from_display_name,
    p_into.display_name AS into_display_name,
    pm.merge_rule,
    pm.reverted_at::date AS reverted_date,
    pm.reverted_by,
    COALESCE(pm.revert_note, '-') AS reason
FROM trapper.person_merges pm
LEFT JOIN trapper.sot_people p_from ON p_from.person_id = pm.from_person_id
LEFT JOIN trapper.sot_people p_into ON p_into.person_id = pm.into_person_id
WHERE pm.is_reverted = TRUE
ORDER BY pm.reverted_at DESC;

-- ============================================
-- 4. Match Decisions
-- ============================================
\echo ''
\echo '4. Recent match decisions:'

SELECT
    d.decision_id,
    d.left_display_name,
    d.right_display_name,
    d.decision,
    COALESCE(d.note, '-') AS note,
    d.decided_by,
    d.created_at::date AS decision_date
FROM trapper.v_recent_person_decisions d
ORDER BY d.created_at DESC
LIMIT 20;

-- ============================================
-- 5. High-Score Open Candidates (potential issues)
-- ============================================
\echo ''
\echo '5. High-score candidates still open (may need review):'

SELECT
    c.candidate_id,
    ROUND(c.match_score::numeric, 3) AS score,
    p1.display_name AS left_name,
    p2.display_name AS right_name,
    CASE WHEN trapper.have_conflicting_identifiers(c.left_person_id, c.right_person_id)
         THEN 'CONFLICT' ELSE 'ok' END AS id_status,
    CASE WHEN trapper.have_shared_address_context(c.left_person_id, c.right_person_id)
         THEN 'YES' ELSE 'no' END AS shared_addr,
    c.created_at::date AS found_date
FROM trapper.person_match_candidates c
JOIN trapper.sot_people p1 ON p1.person_id = c.left_person_id
JOIN trapper.sot_people p2 ON p2.person_id = c.right_person_id
WHERE c.status = 'open'
  AND c.match_score >= 0.90
ORDER BY c.match_score DESC
LIMIT 10;

-- ============================================
-- 6. Candidate Status Distribution
-- ============================================
\echo ''
\echo '6. Candidate status distribution:'

SELECT
    status,
    COUNT(*) AS count
FROM trapper.person_match_candidates
GROUP BY status
ORDER BY
    CASE status
        WHEN 'open' THEN 1
        WHEN 'auto_merged' THEN 2
        WHEN 'accepted' THEN 3
        WHEN 'rejected' THEN 4
        WHEN 'blocked' THEN 5
    END;

\echo ''
\echo 'To undo a merge:'
\echo '  SELECT trapper.undo_person_merge(''<merge_id>'', ''reviewer'', ''Reason'');'
\echo ''
\echo 'To reject a pair (prevent future auto-merge):'
\echo '  SELECT trapper.reject_person_match(''<left_id>'', ''<right_id>'', ''Reason'', ''reviewer'');'
\echo ''
