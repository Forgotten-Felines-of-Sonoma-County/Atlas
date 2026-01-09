-- QRY_005__places_with_active_signals.sql
-- Places with active signals/observations
--
-- Purpose:
--   - Show places that have activity (trapping requests, appointments, etc.)
--   - Useful for identifying "hot spots" or areas needing attention
--   - Basis for future mapping and prioritization
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_005__places_with_active_signals.sql

\echo '============================================'
\echo 'Places with Active Signals Report'
\echo '============================================'

-- ============================================
-- 1. Places Summary
-- ============================================
\echo ''
\echo '1. Places Summary:'

SELECT
    effective_type,
    COUNT(*) AS count,
    SUM(CASE WHEN has_trapping_activity THEN 1 ELSE 0 END) AS with_trapping,
    SUM(CASE WHEN has_appointment_activity THEN 1 ELSE 0 END) AS with_appointments
FROM trapper.places
GROUP BY effective_type
ORDER BY count DESC;

-- ============================================
-- 2. Top 10 Places by Signal Count
-- ============================================
\echo ''
\echo '2. Top 10 Places by Signal Count:'

SELECT
    place_id,
    display_name,
    effective_type,
    signal_count,
    signal_types,
    latest_signal_at::DATE AS last_activity
FROM trapper.v_places_with_active_signals
LIMIT 10;

-- ============================================
-- 3. Places by Type with Activity
-- ============================================
\echo ''
\echo '3. Places by Type with Activity:'

SELECT
    effective_type,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE has_trapping_activity) AS with_trapping,
    COUNT(*) FILTER (WHERE has_appointment_activity) AS with_appointments
FROM trapper.places
GROUP BY effective_type
ORDER BY total_places DESC;

-- ============================================
-- 4. Recent Activity (last 30 days)
-- ============================================
\echo ''
\echo '4. Recently Active Places (within 30 days):'

SELECT
    p.display_name,
    p.effective_type,
    p.last_activity_at::DATE AS last_activity,
    p.has_trapping_activity,
    p.has_appointment_activity
FROM trapper.places p
WHERE p.last_activity_at > NOW() - INTERVAL '30 days'
ORDER BY p.last_activity_at DESC
LIMIT 15;

-- ============================================
-- 5. Apartment Buildings with Activity
-- ============================================
\echo ''
\echo '5. Apartment Buildings with Activity:'

SELECT
    ps.display_name,
    ps.unit_normalized,
    ps.observation_count,
    ps.linked_records_count
FROM trapper.v_places_summary ps
WHERE ps.effective_type = 'apartment_building'
  AND (ps.observation_count > 0 OR ps.linked_records_count > 0)
ORDER BY ps.observation_count DESC
LIMIT 10;

\echo ''
\echo 'Report complete.'
\echo ''
\echo 'For spatial queries (nearby places):'
\echo '  SELECT * FROM trapper.places WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-122.7, 38.4), 4326)::geography, 1000);'
