-- QRY_006__context_surface_sample.sql
-- Context surface sample query
--
-- Purpose:
--   - Demonstrate the context surface function
--   - Show nearby places with activity counts
--   - Use a known place as the center point
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_006__context_surface_sample.sql

\echo '============================================'
\echo 'Context Surface Sample Query'
\echo '============================================'

-- ============================================
-- 1. Get a known place to use as center point
-- ============================================
\echo ''
\echo '1. Finding a known place to use as center point...'

WITH sample_place AS (
    SELECT
        place_id,
        display_name,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
    FROM trapper.places
    WHERE location IS NOT NULL
    LIMIT 1
)
SELECT
    display_name AS "Center Point",
    ROUND(lat::numeric, 4) AS lat,
    ROUND(lng::numeric, 4) AS lng
FROM sample_place;

-- ============================================
-- 2. Run context surface query (5km radius)
-- ============================================
\echo ''
\echo '2. Context surface (5km radius from first place):'

WITH sample_place AS (
    SELECT
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
    FROM trapper.places
    WHERE location IS NOT NULL
    LIMIT 1
)
SELECT
    cs.display_name,
    cs.effective_type AS type,
    cs.distance_m AS "dist(m)",
    cs.observation_count AS obs,
    cs.linked_records_count AS linked,
    cs.last_seen_at::date AS last_seen
FROM sample_place sp
CROSS JOIN LATERAL trapper.fn_context_surface(sp.lat, sp.lng, 5000, 15) cs
ORDER BY cs.distance_m;

-- ============================================
-- 3. Summary stats
-- ============================================
\echo ''
\echo '3. Summary of context surface results:'

WITH sample_place AS (
    SELECT
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
    FROM trapper.places
    WHERE location IS NOT NULL
    LIMIT 1
)
SELECT
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE cs.observation_count > 0) AS with_observations,
    COUNT(*) FILTER (WHERE cs.linked_records_count > 0) AS with_links,
    MIN(cs.distance_m) AS min_distance_m,
    MAX(cs.distance_m) AS max_distance_m
FROM sample_place sp
CROSS JOIN LATERAL trapper.fn_context_surface(sp.lat, sp.lng, 5000, 50) cs;

-- ============================================
-- 4. Alternative: Santa Rosa center
-- ============================================
\echo ''
\echo '4. Context surface centered on Santa Rosa (38.44, -122.71):'

SELECT
    display_name,
    effective_type AS type,
    distance_m AS "dist(m)",
    observation_count AS obs,
    linked_records_count AS linked
FROM trapper.fn_context_surface(38.44, -122.71, 10000, 15);

\echo ''
\echo 'Context surface query complete.'
\echo ''
\echo 'Try your own location:'
\echo '  SELECT * FROM trapper.fn_context_surface(<lat>, <lng>, <radius_m>, <limit>);'
