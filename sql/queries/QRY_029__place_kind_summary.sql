-- QRY_029__place_kind_summary.sql
-- Place kind distribution and activity summary
--
-- Shows breakdown of places by place_kind with activity metrics.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_029__place_kind_summary.sql

\echo ''
\echo '============================================'
\echo 'Place Kind Summary'
\echo '============================================'

\echo ''
\echo 'Place kind distribution:'
SELECT * FROM trapper.v_place_kind_summary;

\echo ''
\echo 'Address-backed vs non-address-backed:'
SELECT
    is_address_backed,
    COUNT(*) AS place_count,
    COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) AS with_address,
    COUNT(*) FILTER (WHERE has_cat_activity) AS with_cats
FROM trapper.places
GROUP BY is_address_backed
ORDER BY is_address_backed DESC;

\echo ''
\echo 'Places by place_kind with examples:'
SELECT
    p.place_kind,
    COUNT(*) AS count,
    MIN(p.display_name) AS example_place
FROM trapper.places p
WHERE p.is_address_backed = true
GROUP BY p.place_kind
ORDER BY count DESC;

\echo ''
\echo 'Top localities by place count:'
SELECT
    sa.locality,
    COUNT(*) AS places,
    COUNT(*) FILTER (WHERE p.has_cat_activity) AS with_cats,
    SUM((SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id)) AS total_cats
FROM trapper.places p
JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
WHERE p.is_address_backed = true
  AND sa.locality IS NOT NULL
GROUP BY sa.locality
ORDER BY places DESC
LIMIT 15;

\echo ''
\echo 'Address-backed places coverage:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_addresses WHERE geocode_status IN ('ok', 'partial', 'success')) AS canonical_addresses,
    (SELECT COUNT(*) FROM trapper.places WHERE is_address_backed = true) AS address_backed_places,
    CASE
        WHEN (SELECT COUNT(*) FROM trapper.sot_addresses WHERE geocode_status IN ('ok', 'partial', 'success')) = 0 THEN 0
        ELSE ROUND(100.0 *
            (SELECT COUNT(*) FROM trapper.places WHERE is_address_backed = true) /
            (SELECT COUNT(*) FROM trapper.sot_addresses WHERE geocode_status IN ('ok', 'partial', 'success')), 1)
    END AS pct_coverage;
