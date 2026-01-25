-- MIG_614: Fix Colony Estimate Airtable IDs
--
-- Problem: Colony estimates have Airtable record IDs (recXXX) in source_record_id
-- but these should point to Atlas request UUIDs for proper linking in the UI.
--
-- Solution: Map Airtable IDs to Atlas request UUIDs via sot_requests.source_record_id

\echo ''
\echo '=============================================='
\echo 'MIG_614: Fix Colony Estimate Airtable IDs'
\echo '=============================================='
\echo ''

-- Count records before fix
\echo 'Colony estimates with Airtable IDs before fix:'
SELECT COUNT(*) AS count_before
FROM trapper.place_colony_estimates
WHERE source_record_id LIKE 'rec%';

-- Update colony estimates to use Atlas request UUIDs instead of Airtable IDs
\echo ''
\echo 'Updating colony estimates to use Atlas request UUIDs...'

UPDATE trapper.place_colony_estimates ce
SET source_record_id = r.request_id::TEXT
FROM trapper.sot_requests r
WHERE ce.source_record_id = r.source_record_id
  AND ce.source_record_id LIKE 'rec%'
  AND r.source_system = 'airtable';

-- Also update source_entity_id if it has Airtable IDs
UPDATE trapper.place_colony_estimates ce
SET source_entity_id = r.request_id
FROM trapper.sot_requests r
WHERE ce.source_entity_id::TEXT = r.source_record_id
  AND r.source_record_id LIKE 'rec%'
  AND r.source_system = 'airtable';

-- Count records after fix
\echo ''
\echo 'Colony estimates with Airtable IDs after fix:'
SELECT COUNT(*) AS count_after
FROM trapper.place_colony_estimates
WHERE source_record_id LIKE 'rec%';

-- Show sample of fixed records
\echo ''
\echo 'Sample of updated records:'
SELECT
  ce.estimate_id,
  ce.source_record_id,
  ce.source_type,
  ce.total_cats,
  p.formatted_address
FROM trapper.place_colony_estimates ce
JOIN trapper.places p ON p.place_id = ce.place_id
WHERE ce.source_record_id NOT LIKE 'rec%'
  AND ce.source_type = 'trapping_request'
ORDER BY ce.reported_at DESC
LIMIT 5;

\echo ''
\echo '=============================================='
\echo 'MIG_614 Complete!'
\echo '=============================================='
\echo ''
