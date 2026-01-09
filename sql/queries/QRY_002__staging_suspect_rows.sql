-- QRY_002__staging_suspect_rows.sql
-- Reports suspect rows in staged_records based on data_issues
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_002__staging_suspect_rows.sql
--
-- Issue types detected:
--   - address_has_attachment: Address contains airtableusercontent URL
--   - case_number_looks_html: Case Number contains HTML tags (<br>, etc.)
--   - map_image_column_drift: Map Image is state code or ZIP (column misalignment)
--   - address_is_junk: Address is ZIP-only, state-only, or too short

\echo '============================================'
\echo 'Staging Suspect Rows Report'
\echo '============================================'

-- ============================================
-- Part 1: Summary by Issue Type
-- ============================================
\echo ''
\echo '1. Issue Summary by Type:'
\echo ''

SELECT
    issue_type,
    severity,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE is_resolved) AS resolved,
    COUNT(*) FILTER (WHERE NOT is_resolved) AS unresolved
FROM trapper.data_issues
WHERE entity_type = 'staged_record'
GROUP BY issue_type, severity
ORDER BY severity DESC, count DESC;

-- ============================================
-- Part 2: Address Has Attachment URLs
-- ============================================
\echo ''
\echo '2. Address Has Attachment (airtableusercontent URLs):'
\echo ''

SELECT
    di.entity_id AS staged_record_id,
    sr.source_row_id,
    di.details->>'message' AS issue_details,
    LEFT(sr.payload->>'Address', 100) AS address_preview
FROM trapper.data_issues di
JOIN trapper.staged_records sr ON sr.id = di.entity_id
WHERE di.entity_type = 'staged_record'
  AND di.issue_type = 'address_has_attachment'
  AND NOT di.is_resolved
ORDER BY di.first_seen_at DESC
LIMIT 10;

-- ============================================
-- Part 3: Case Number Looks Like HTML
-- ============================================
\echo ''
\echo '3. Case Number Contains HTML:'
\echo ''

SELECT
    di.entity_id AS staged_record_id,
    sr.source_row_id,
    LEFT(sr.payload->>'Case Number', 100) AS case_number_preview
FROM trapper.data_issues di
JOIN trapper.staged_records sr ON sr.id = di.entity_id
WHERE di.entity_type = 'staged_record'
  AND di.issue_type = 'case_number_looks_html'
  AND NOT di.is_resolved
ORDER BY di.first_seen_at DESC
LIMIT 10;

-- ============================================
-- Part 4: Map Image Column Drift (State/ZIP)
-- ============================================
\echo ''
\echo '4. Map Image Column Drift (appears to be state or ZIP):'
\echo ''

SELECT
    di.entity_id AS staged_record_id,
    sr.source_row_id,
    sr.payload->>'Map Image' AS map_image_value,
    sr.payload->>'State' AS state_value,
    sr.payload->>'Zip' AS zip_value,
    di.details->>'message' AS issue_details
FROM trapper.data_issues di
JOIN trapper.staged_records sr ON sr.id = di.entity_id
WHERE di.entity_type = 'staged_record'
  AND di.issue_type = 'map_image_column_drift'
  AND NOT di.is_resolved
ORDER BY di.first_seen_at DESC
LIMIT 10;

-- ============================================
-- Part 5: Junk Addresses
-- ============================================
\echo ''
\echo '5. Junk Addresses (ZIP-only, state-only, too short, no digits):'
\echo ''

SELECT
    di.entity_id AS staged_record_id,
    sr.source_row_id,
    sr.payload->>'Address' AS address,
    di.details->>'message' AS issue_details,
    di.severity
FROM trapper.data_issues di
JOIN trapper.staged_records sr ON sr.id = di.entity_id
WHERE di.entity_type = 'staged_record'
  AND di.issue_type = 'address_is_junk'
  AND NOT di.is_resolved
ORDER BY di.severity DESC, di.first_seen_at DESC
LIMIT 20;

-- ============================================
-- Part 6: Rows with Multiple Issues
-- ============================================
\echo ''
\echo '6. Staged Records with Multiple Issues:'
\echo ''

SELECT
    di.entity_id AS staged_record_id,
    sr.source_row_id,
    COUNT(*) AS issue_count,
    ARRAY_AGG(di.issue_type) AS issues
FROM trapper.data_issues di
JOIN trapper.staged_records sr ON sr.id = di.entity_id
WHERE di.entity_type = 'staged_record'
  AND NOT di.is_resolved
GROUP BY di.entity_id, sr.source_row_id
HAVING COUNT(*) > 1
ORDER BY issue_count DESC
LIMIT 10;

-- ============================================
-- Part 7: Impact on Candidate View
-- ============================================
\echo ''
\echo '7. Impact on Geocoding Candidates:'
\echo ''

SELECT
    'Total staged trapping_requests' AS metric,
    COUNT(*)::text AS value
FROM trapper.staged_records
WHERE source_table = 'trapping_requests'

UNION ALL

SELECT
    'Rows with unresolved suspect issues',
    COUNT(DISTINCT entity_id)::text
FROM trapper.data_issues
WHERE entity_type = 'staged_record'
  AND NOT is_resolved
  AND severity >= 2

UNION ALL

SELECT
    'Candidates available for geocoding',
    COUNT(*)::text
FROM trapper.v_candidate_addresses_from_trapping_requests;

-- ============================================
-- Part 8: Latest Ingest Run Stats
-- ============================================
\echo ''
\echo '8. Latest Ingest Run:'
\echo ''

SELECT
    run_id,
    source_file_name,
    row_count,
    rows_inserted,
    rows_linked,
    rows_suspect,
    run_status,
    started_at
FROM trapper.v_latest_ingest_run
WHERE source_table = 'trapping_requests';

\echo ''
\echo 'Report complete.'
\echo ''
\echo 'To resolve issues:'
\echo '  UPDATE trapper.data_issues SET is_resolved = TRUE, resolved_at = NOW() WHERE entity_id = ''<uuid>'';'
\echo ''
