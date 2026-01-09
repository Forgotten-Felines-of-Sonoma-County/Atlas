-- QRY_028__cat_place_coverage.sql
-- Cat-to-place coverage analysis
--
-- Shows how many cats can be linked to places and identifies gaps.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_028__cat_place_coverage.sql

\echo ''
\echo '============================================'
\echo 'Cat-to-Place Coverage Analysis'
\echo '============================================'

\echo ''
\echo 'Overall coverage:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_cats) AS total_cats,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) AS cats_with_place,
    (SELECT COUNT(*) FROM trapper.sot_cats) -
        (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) AS cats_without_place,
    ROUND(100.0 * (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_cats), 0), 1) AS pct_coverage;

\echo ''
\echo 'Cat-place stats view:'
SELECT * FROM trapper.v_cat_place_stats;

\echo ''
\echo 'Coverage breakdown by owner linkage:'
SELECT
    'Cats with owner' AS category,
    COUNT(DISTINCT pcr.cat_id) AS count
FROM trapper.person_cat_relationships pcr
WHERE pcr.relationship_type = 'owner'

UNION ALL

SELECT
    'Owners with person_place_rel',
    COUNT(DISTINCT pcr.cat_id)
FROM trapper.person_cat_relationships pcr
WHERE pcr.relationship_type = 'owner'
  AND EXISTS (
      SELECT 1 FROM trapper.person_place_relationships ppr
      WHERE ppr.person_id = trapper.canonical_person_id(pcr.person_id)
  )

UNION ALL

SELECT
    'Cats linked to place',
    COUNT(DISTINCT cat_id)
FROM trapper.cat_place_relationships;

\echo ''
\echo 'Top places by cat count:'
SELECT
    p.place_id,
    LEFT(p.display_name, 50) AS place_name,
    p.locality,
    COUNT(cpr.cat_id) AS cat_count
FROM trapper.places p
JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
GROUP BY p.place_id, p.display_name, p.locality
ORDER BY cat_count DESC
LIMIT 15;

\echo ''
\echo 'Coverage improvement potential:'
\echo '(Cats whose owners have addresses but no person_place_relationship yet)'
SELECT
    COUNT(DISTINCT pcr.cat_id) AS potential_cats
FROM trapper.person_cat_relationships pcr
JOIN trapper.staged_record_person_link srpl ON srpl.person_id = pcr.person_id
JOIN trapper.staged_records sr ON sr.id = srpl.staged_record_id
WHERE pcr.relationship_type = 'owner'
  AND sr.source_table = 'owner_info'
  AND sr.payload->>'Owner Address' IS NOT NULL
  AND TRIM(sr.payload->>'Owner Address') <> ''
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_place_relationships ppr
      WHERE ppr.person_id = trapper.canonical_person_id(pcr.person_id)
  )
  AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cpr
      WHERE cpr.cat_id = pcr.cat_id
  );
