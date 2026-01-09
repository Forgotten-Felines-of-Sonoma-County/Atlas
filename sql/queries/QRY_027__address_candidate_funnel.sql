-- QRY_027__address_candidate_funnel.sql
-- Address candidate funnel across all sources
--
-- Shows how addresses flow through the pipeline from raw to geocoded.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_027__address_candidate_funnel.sql

\echo ''
\echo '============================================'
\echo 'Address Candidate Funnel'
\echo '============================================'

\echo ''
\echo 'Staged records with addresses by source:'
SELECT
    sr.source_table,
    COUNT(*) AS total_records,
    COUNT(DISTINCT sral.staged_record_id) AS linked_to_address,
    ROUND(100.0 * COUNT(DISTINCT sral.staged_record_id) / NULLIF(COUNT(*), 0), 1) AS pct_linked
FROM trapper.staged_records sr
LEFT JOIN trapper.staged_record_address_link sral ON sral.staged_record_id = sr.id
WHERE sr.source_system = 'clinichq'
GROUP BY sr.source_table
ORDER BY total_records DESC;

\echo ''
\echo 'Address quality by source:'
SELECT
    sr.source_table,
    COUNT(*) AS total_addresses,
    COUNT(*) FILTER (WHERE sa.geocode_status = 'success') AS geocoded,
    COUNT(*) FILTER (WHERE sa.geocode_status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE sa.geocode_status IS NULL) AS pending,
    ROUND(100.0 * COUNT(*) FILTER (WHERE sa.geocode_status = 'success') / NULLIF(COUNT(*), 0), 1) AS pct_success
FROM trapper.staged_record_address_link sral
JOIN trapper.staged_records sr ON sr.id = sral.staged_record_id
JOIN trapper.sot_addresses sa ON sa.address_id = sral.address_id
GROUP BY sr.source_table
ORDER BY total_addresses DESC;

\echo ''
\echo 'Review queue by source:'
SELECT
    sr.source_table,
    arq.review_reason,
    COUNT(*) AS count
FROM trapper.address_review_queue arq
JOIN trapper.staged_records sr ON sr.id = arq.staged_record_id
GROUP BY sr.source_table, arq.review_reason
ORDER BY sr.source_table, count DESC;

\echo ''
\echo 'Person-place relationships by source:'
SELECT
    source_table,
    COUNT(*) AS relationships,
    COUNT(DISTINCT person_id) AS unique_people,
    COUNT(DISTINCT place_id) AS unique_places
FROM trapper.person_place_relationships
GROUP BY source_table
ORDER BY relationships DESC;
