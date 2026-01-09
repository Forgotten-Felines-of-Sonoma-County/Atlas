-- QRY_026__owner_addresses_stats.sql
-- Owner address pipeline statistics
--
-- Shows the funnel from raw owner records to geocoded addresses.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_026__owner_addresses_stats.sql

\echo ''
\echo '============================================'
\echo 'Owner Address Pipeline Stats'
\echo '============================================'

\echo ''
\echo 'Overall Stats:'
SELECT * FROM trapper.v_owner_address_stats;

\echo ''
\echo 'Owner address breakdown:'
SELECT
    'Total owner records' AS metric,
    COUNT(*) AS count
FROM trapper.v_clinichq_owner_latest

UNION ALL

SELECT
    'With address (non-empty)',
    COUNT(*)
FROM trapper.v_clinichq_owner_latest
WHERE owner_address IS NOT NULL AND TRIM(owner_address) <> ''

UNION ALL

SELECT
    'Address >= 10 chars',
    COUNT(*)
FROM trapper.v_clinichq_owner_latest
WHERE owner_address IS NOT NULL
  AND TRIM(owner_address) <> ''
  AND LENGTH(owner_address) >= 10

UNION ALL

SELECT
    'Pending geocoding',
    COUNT(*)
FROM trapper.v_clinichq_owner_address_candidates

UNION ALL

SELECT
    'Already linked to address',
    COUNT(DISTINCT ol.staged_record_id)
FROM trapper.v_clinichq_owner_latest ol
JOIN trapper.staged_record_address_link sral ON sral.staged_record_id = ol.staged_record_id

UNION ALL

SELECT
    'In review queue',
    COUNT(DISTINCT ol.staged_record_id)
FROM trapper.v_clinichq_owner_latest ol
JOIN trapper.address_review_queue arq ON arq.staged_record_id = ol.staged_record_id;

\echo ''
\echo 'Sample pending candidates (first 10):'
SELECT
    staged_record_id,
    source_row_id,
    LEFT(address_raw, 60) AS address_preview
FROM trapper.v_clinichq_owner_address_candidates
LIMIT 10;
