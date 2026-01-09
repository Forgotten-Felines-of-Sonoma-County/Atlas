-- QRY_030__cats_by_place_kind.sql
-- Cat distribution by place kind
--
-- Shows how cats are distributed across different place kinds.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_030__cats_by_place_kind.sql

\echo ''
\echo '============================================'
\echo 'Cats by Place Kind'
\echo '============================================'

\echo ''
\echo 'Cat-place relationships by place_kind:'
SELECT
    p.place_kind,
    COUNT(DISTINCT cpr.cat_id) AS unique_cats,
    COUNT(*) AS total_links,
    COUNT(DISTINCT cpr.place_id) AS unique_places
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p ON p.place_id = cpr.place_id
GROUP BY p.place_kind
ORDER BY unique_cats DESC;

\echo ''
\echo 'Cat coverage by place_kind:'
SELECT
    p.place_kind,
    COUNT(DISTINCT cpr.cat_id) AS cats_at_kind,
    (SELECT COUNT(*) FROM trapper.sot_cats) AS total_cats,
    ROUND(100.0 * COUNT(DISTINCT cpr.cat_id) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_cats), 0), 1) AS pct_coverage
FROM trapper.places p
JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
GROUP BY p.place_kind
ORDER BY cats_at_kind DESC;

\echo ''
\echo 'Places with most cats (by place_kind):'
SELECT
    p.place_kind,
    p.display_name,
    sa.locality,
    COUNT(cpr.cat_id) AS cat_count
FROM trapper.places p
JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
GROUP BY p.place_kind, p.place_id, p.display_name, sa.locality
ORDER BY cat_count DESC
LIMIT 20;

\echo ''
\echo 'Apartment units vs houses - cat distribution:'
SELECT
    CASE
        WHEN p.place_kind = 'apartment_unit' THEN 'Apartments'
        WHEN p.place_kind = 'residential_house' THEN 'Houses'
        ELSE 'Other'
    END AS category,
    COUNT(DISTINCT cpr.place_id) AS places,
    COUNT(DISTINCT cpr.cat_id) AS cats,
    ROUND(AVG(cat_count), 1) AS avg_cats_per_place
FROM trapper.places p
JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
JOIN LATERAL (
    SELECT COUNT(*) AS cat_count
    FROM trapper.cat_place_relationships cpr2
    WHERE cpr2.place_id = p.place_id
) counts ON true
GROUP BY 1
ORDER BY cats DESC;

\echo ''
\echo 'Cats without place link (for reference):'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_cats) AS total_cats,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) AS cats_with_place,
    (SELECT COUNT(*) FROM trapper.sot_cats) -
        (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) AS cats_without_place;
