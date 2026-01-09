-- QRY_004__name_candidate_review.sql
-- Name candidate analysis and review queries
--
-- Purpose:
--   - Summarize name candidates by classification
--   - Find top offenders (most common nonsense patterns)
--   - Provide examples for each category
--   - Support manual review workflow
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_004__name_candidate_review.sql

\echo '============================================'
\echo 'Name Candidate Review Report'
\echo '============================================'

-- ============================================
-- 1. Summary by Kind and Status
-- ============================================
\echo ''
\echo '1. Summary by Kind and Status:'

SELECT
    name_kind_suggested AS kind,
    status,
    COUNT(*) AS count,
    ROUND(AVG(confidence), 2) AS avg_confidence
FROM trapper.name_candidates
GROUP BY name_kind_suggested, status
ORDER BY name_kind_suggested, status;

-- ============================================
-- 2. Summary by Source Table
-- ============================================
\echo ''
\echo '2. Summary by Source Table:'

SELECT
    source_table,
    name_kind_suggested AS kind,
    COUNT(*) AS count
FROM trapper.name_candidates
GROUP BY source_table, name_kind_suggested
ORDER BY source_table, name_kind_suggested;

-- ============================================
-- 3. Most Common Reasons
-- ============================================
\echo ''
\echo '3. Most Common Classification Reasons:'

SELECT
    reason_element AS reason,
    COUNT(*) AS occurrences
FROM trapper.name_candidates,
     jsonb_array_elements_text(reasons) AS reason_element
GROUP BY reason_element
ORDER BY occurrences DESC
LIMIT 15;

-- ============================================
-- 4. Person-like Examples (high confidence)
-- ============================================
\echo ''
\echo '4. Person-like Examples (top 10 by confidence):'

SELECT
    raw_name,
    confidence,
    reasons,
    source_table,
    field_name
FROM trapper.name_candidates
WHERE name_kind_suggested = 'person'
  AND status = 'open'
ORDER BY confidence DESC
LIMIT 10;

-- ============================================
-- 5. Place-like Examples
-- ============================================
\echo ''
\echo '5. Place-like Examples (top 10):'

SELECT
    raw_name,
    confidence,
    reasons,
    source_table,
    field_name
FROM trapper.name_candidates
WHERE name_kind_suggested = 'place'
  AND status = 'open'
ORDER BY confidence DESC
LIMIT 10;

-- ============================================
-- 6. Nonsense Examples (proof we kept evidence)
-- ============================================
\echo ''
\echo '6. Nonsense Examples (evidence preserved):'

SELECT
    raw_name,
    confidence,
    reasons,
    source_row_id,
    source_table
FROM trapper.name_candidates
WHERE name_kind_suggested = 'nonsense'
  AND status = 'open'
ORDER BY confidence DESC
LIMIT 10;

-- ============================================
-- 7. Unknown (needs review)
-- ============================================
\echo ''
\echo '7. Unknown Names Needing Review (top 15):'

SELECT
    raw_name,
    confidence,
    reasons,
    source_table,
    field_name
FROM trapper.name_candidates
WHERE name_kind_suggested = 'unknown'
  AND status = 'open'
ORDER BY confidence DESC
LIMIT 15;

-- ============================================
-- 8. Low Confidence Candidates (edge cases)
-- ============================================
\echo ''
\echo '8. Low Confidence Candidates (edge cases, < 0.6):'

SELECT
    raw_name,
    name_kind_suggested AS kind,
    confidence,
    reasons
FROM trapper.name_candidates
WHERE confidence < 0.6
  AND status = 'open'
ORDER BY confidence
LIMIT 15;

-- ============================================
-- 9. Overridden Classifications
-- ============================================
\echo ''
\echo '9. Overridden Classifications (manual corrections):'

SELECT
    raw_name,
    name_kind_suggested AS original_kind,
    overridden_kind,
    reviewer_notes,
    updated_at
FROM trapper.name_candidates
WHERE status = 'overridden'
ORDER BY updated_at DESC
LIMIT 10;

-- ============================================
-- 10. Duplicate Names Across Sources
-- ============================================
\echo ''
\echo '10. Names Appearing Multiple Times:'

SELECT
    normalized_name,
    COUNT(*) AS occurrences,
    array_agg(DISTINCT source_table) AS source_tables,
    MAX(name_kind_suggested::TEXT) AS suggested_kind
FROM trapper.name_candidates
WHERE normalized_name IS NOT NULL
GROUP BY normalized_name
HAVING COUNT(*) > 1
ORDER BY occurrences DESC
LIMIT 15;

\echo ''
\echo 'Report complete.'
\echo ''
\echo 'To approve a candidate:'
\echo '  UPDATE trapper.name_candidates SET status = ''approved'' WHERE candidate_id = ''<uuid>'';'
\echo ''
\echo 'To override classification:'
\echo '  UPDATE trapper.name_candidates SET status = ''overridden'', overridden_kind = ''person'', reviewer_notes = ''Manual review'' WHERE candidate_id = ''<uuid>'';'
