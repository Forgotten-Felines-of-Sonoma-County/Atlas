-- MIG_004__source_registry.sql
-- Source registry for multi-source intake
--
-- Creates:
--   - trapper.source_systems: known data sources
--   - trapper.source_tables: logical tables within sources
--
-- Purpose:
--   - Standardize naming across Airtable, ClinicHQ, Project 75, VolunteerHub
--   - Document expected ID field patterns per source
--   - Enable source-agnostic queries and views
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_004__source_registry.sql

\echo '============================================'
\echo 'MIG_004: Source Registry'
\echo '============================================'

-- ============================================
-- PART 1: Source Systems
-- ============================================
\echo ''
\echo 'Creating source_systems table...'

CREATE TABLE IF NOT EXISTS trapper.source_systems (
    system_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.source_systems IS
'Registry of data source systems (Airtable, ClinicHQ, etc).
Used for standardized naming and documentation.';

-- Seed known systems
INSERT INTO trapper.source_systems (system_id, display_name, description) VALUES
    ('airtable', 'Airtable (Main)', 'Primary FFSC Airtable base'),
    ('airtable_project75', 'Airtable (Project 75)', 'Project 75 after-clinic survey base'),
    ('clinichq', 'ClinicHQ', 'ClinicHQ exports (cats/owners/appointments)'),
    ('volunteerhub', 'VolunteerHub', 'VolunteerHub volunteer management exports')
ON CONFLICT (system_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description;

-- ============================================
-- PART 2: Source Tables
-- ============================================
\echo 'Creating source_tables table...'

CREATE TABLE IF NOT EXISTS trapper.source_tables (
    id SERIAL PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES trapper.source_systems(system_id),
    table_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,

    -- Expected ID field patterns (for auto-detection)
    id_field_candidates TEXT[] NOT NULL DEFAULT '{}',

    -- CSV location pattern (for auto-discovery)
    csv_path_pattern TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (system_id, table_id)
);

COMMENT ON TABLE trapper.source_tables IS
'Registry of logical tables within each source system.
Documents expected ID fields and CSV location patterns.';

-- Seed known tables
INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates, csv_path_pattern) VALUES
    ('airtable', 'trapping_requests', 'Trapping Requests',
     'Community trapping request submissions',
     ARRAY['Record ID', 'Airtable Record ID', 'LookupRecordIDPrimaryReq'],
     'airtable/trapping_requests/*.csv'),

    ('airtable', 'appointment_requests', 'Appointment Requests',
     'Spay/neuter appointment requests',
     ARRAY['Record ID', 'Airtable Record ID'],
     'airtable/appointment_requests/*.csv'),

    ('airtable', 'trapper_cats', 'Trapper Cats',
     'Cats in trapper tracking',
     ARRAY['Record ID', 'Airtable Record ID'],
     'airtable/trapper_cats/*.csv'),

    ('airtable', 'trapper_reports', 'Trapper Reports',
     'Reports submitted by trappers',
     ARRAY['Record ID', 'Airtable Record ID'],
     'airtable/trapper_reports/*.csv'),

    ('airtable', 'fosters', 'Fosters',
     'Foster volunteer records',
     ARRAY['Record ID', 'Airtable Record ID'],
     'airtable/fosters/*.csv'),

    ('airtable_project75', 'survey_submissions', 'Survey Submissions',
     'Project 75 after-clinic survey responses',
     ARRAY['Record ID', 'Airtable Record ID'],
     'airtable_project75/survey_submissions/*.csv'),

    ('clinichq', 'cats', 'Cats',
     'ClinicHQ cat records',
     ARRAY['id', 'cat_id', 'ID'],
     'clinichq/cats/*.csv'),

    ('clinichq', 'owners', 'Owners',
     'ClinicHQ owner/client records',
     ARRAY['id', 'owner_id', 'client_id', 'ID'],
     'clinichq/owners/*.csv'),

    ('clinichq', 'appointments', 'Appointments',
     'ClinicHQ appointment records',
     ARRAY['id', 'appointment_id', 'ID'],
     'clinichq/appointments/*.csv'),

    ('volunteerhub', 'volunteers', 'Volunteers',
     'VolunteerHub volunteer records',
     ARRAY['id', 'volunteer_id', 'ID'],
     'volunteerhub/volunteers/*.csv')
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates,
    csv_path_pattern = EXCLUDED.csv_path_pattern;

-- ============================================
-- PART 3: View for source discovery
-- ============================================
\echo 'Creating v_source_registry view...'

CREATE OR REPLACE VIEW trapper.v_source_registry AS
SELECT
    st.system_id,
    ss.display_name AS system_name,
    st.table_id,
    st.display_name AS table_name,
    st.description,
    st.id_field_candidates,
    st.csv_path_pattern,
    st.is_active,
    -- Stats from staged_records
    (SELECT COUNT(*) FROM trapper.staged_records sr
     WHERE sr.source_system = st.system_id AND sr.source_table = st.table_id) AS staged_count,
    -- Latest run info
    (SELECT row_count FROM trapper.v_latest_ingest_run lr
     WHERE lr.source_system = st.system_id AND lr.source_table = st.table_id) AS latest_run_rows
FROM trapper.source_tables st
JOIN trapper.source_systems ss ON ss.system_id = st.system_id
WHERE st.is_active AND ss.is_active
ORDER BY st.system_id, st.table_id;

COMMENT ON VIEW trapper.v_source_registry IS
'Registry of all active sources with current ingestion stats.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_004 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Source systems:'
SELECT system_id, display_name FROM trapper.source_systems WHERE is_active ORDER BY system_id;

\echo ''
\echo 'Source tables:'
SELECT system_id, table_id, display_name FROM trapper.source_tables WHERE is_active ORDER BY system_id, table_id;

\echo ''
\echo 'Next steps:'
\echo '  1. Use shared ingest libs for new sources'
\echo '  2. Check registry: SELECT * FROM trapper.v_source_registry;'
\echo ''
