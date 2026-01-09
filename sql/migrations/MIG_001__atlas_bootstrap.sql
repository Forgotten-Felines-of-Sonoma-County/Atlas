-- MIG_001__atlas_bootstrap.sql
-- Atlas Database Bootstrap Migration
-- Creates required extensions, schemas, and core raw tables
--
-- SAFE: Uses IF NOT EXISTS throughout - idempotent re-runs cause no errors
--
-- APPLY MANUALLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_001__atlas_bootstrap.sql

\echo '============================================'
\echo 'MIG_001: Atlas Bootstrap'
\echo '============================================'

-- ============================================
-- PART 1: Extensions
-- ============================================
\echo ''
\echo 'Creating extensions...'

-- PostGIS for geospatial
CREATE EXTENSION IF NOT EXISTS postgis;

-- pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- uuid-ossp for UUID generation (backup to gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PART 2: Schemas
-- ============================================
\echo 'Creating schemas...'

-- Main application schema (keeping 'trapper' name for compatibility with existing migrations)
CREATE SCHEMA IF NOT EXISTS trapper;

-- Grant usage to authenticated role if using Supabase
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT USAGE ON SCHEMA trapper TO authenticated;
        GRANT SELECT ON ALL TABLES IN SCHEMA trapper TO authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA trapper GRANT SELECT ON TABLES TO authenticated;
    END IF;
END $$;

-- ============================================
-- PART 3: Core Raw Table - Generic Staged Records
-- ============================================
\echo 'Creating raw.staged_records table...'

-- Generic raw staging table for any source data
-- Designed for idempotent ingests via (source_system, source_table, row_hash) unique constraint
CREATE TABLE IF NOT EXISTS trapper.staged_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source_system TEXT NOT NULL,           -- e.g., 'airtable', 'clinichq', 'jotform'
    source_table TEXT NOT NULL,            -- e.g., 'trapping_requests', 'appointment_requests'
    source_row_id TEXT,                    -- Original row ID from source (Airtable record ID, etc.)
    source_file TEXT,                      -- File that was ingested (for traceability)

    -- Idempotency key
    row_hash TEXT NOT NULL,                -- Stable hash of canonicalized row fields

    -- Full row data
    payload JSONB NOT NULL,                -- Complete row as JSON for deep search

    -- Processing status
    is_processed BOOLEAN NOT NULL DEFAULT FALSE,  -- Has this been normalized to SoT?
    processed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Idempotency constraint: same source + hash = same record
    CONSTRAINT staged_records_idempotency_key UNIQUE (source_system, source_table, row_hash)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_staged_records_source
    ON trapper.staged_records (source_system, source_table);

CREATE INDEX IF NOT EXISTS idx_staged_records_unprocessed
    ON trapper.staged_records (source_system, source_table)
    WHERE NOT is_processed;

CREATE INDEX IF NOT EXISTS idx_staged_records_source_row_id
    ON trapper.staged_records (source_row_id)
    WHERE source_row_id IS NOT NULL;

-- GIN index for JSONB payload search
CREATE INDEX IF NOT EXISTS idx_staged_records_payload_gin
    ON trapper.staged_records USING GIN (payload);

COMMENT ON TABLE trapper.staged_records IS
'Generic raw staging table. Ingests preserve complete payload; normalization happens later.
Idempotency key: (source_system, source_table, row_hash) prevents duplicates on re-ingest.';

-- ============================================
-- PART 4: Typed Raw Tables (from existing migrations)
-- Included here for single-file bootstrap
-- ============================================
\echo 'Creating typed raw tables...'

-- appointment_requests (Airtable form submissions)
CREATE TABLE IF NOT EXISTS trapper.appointment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Source traceability
    source_file TEXT NOT NULL,
    source_row_hash TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'airtable',
    airtable_record_id TEXT,
    -- Timestamps
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Contact info
    requester_name TEXT,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    -- Address fields
    requester_address TEXT,
    requester_city TEXT,
    requester_zip TEXT,
    cats_address TEXT,
    cats_address_clean TEXT,
    county TEXT,
    -- Request details
    cat_count_estimate INT,
    situation_description TEXT,
    notes TEXT,
    -- Status tracking
    submission_status TEXT,
    appointment_date DATE,
    -- Constraints
    CONSTRAINT appointment_requests_source_row_hash_key UNIQUE (source_row_hash)
);

CREATE INDEX IF NOT EXISTS idx_appointment_requests_submitted_at
    ON trapper.appointment_requests (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_status
    ON trapper.appointment_requests (submission_status);

-- clinichq_upcoming_appointments (scheduled pipeline)
CREATE TABLE IF NOT EXISTS trapper.clinichq_upcoming_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Source traceability
    source_file TEXT NOT NULL,
    source_row_hash TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'clinichq',
    -- Timestamps
    appt_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Client info
    client_first_name TEXT,
    client_last_name TEXT,
    client_address TEXT,
    client_cell_phone TEXT,
    client_phone TEXT,
    client_email TEXT,
    client_type TEXT,
    -- Patient/animal info
    animal_name TEXT,
    ownership_type TEXT,
    appt_number INT,
    -- Constraints
    CONSTRAINT clinichq_upcoming_source_row_hash_key UNIQUE (source_row_hash)
);

CREATE INDEX IF NOT EXISTS idx_clinichq_upcoming_appt_date
    ON trapper.clinichq_upcoming_appointments (appt_date ASC);

-- ============================================
-- PART 5: Data Issues Table (from MIG_100)
-- ============================================
\echo 'Creating data_issues table...'

CREATE TABLE IF NOT EXISTS trapper.data_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    issue_type TEXT NOT NULL,
    severity SMALLINT NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    UNIQUE (entity_type, entity_id, issue_type)
);

COMMENT ON TABLE trapper.data_issues IS
'Tracks data quality issues without cluttering daily ops. Severity: 1=low, 2=medium, 3=high.';

CREATE INDEX IF NOT EXISTS idx_data_issues_type_resolved
    ON trapper.data_issues (issue_type, is_resolved);
CREATE INDEX IF NOT EXISTS idx_data_issues_entity
    ON trapper.data_issues (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_data_issues_severity
    ON trapper.data_issues (severity) WHERE NOT is_resolved;

-- ============================================
-- PART 6: Verification
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_001 Bootstrap Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Extensions installed:'
SELECT extname, extversion FROM pg_extension
WHERE extname IN ('postgis', 'pg_trgm', 'uuid-ossp')
ORDER BY extname;

\echo ''
\echo 'Schemas created:'
SELECT schema_name FROM information_schema.schemata
WHERE schema_name = 'trapper';

\echo ''
\echo 'Tables created:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

\echo ''
\echo 'Row counts (should be 0 for fresh DB):'
SELECT
    'staged_records' AS table_name,
    (SELECT COUNT(*) FROM trapper.staged_records) AS row_count
UNION ALL SELECT
    'appointment_requests',
    (SELECT COUNT(*) FROM trapper.appointment_requests)
UNION ALL SELECT
    'clinichq_upcoming_appointments',
    (SELECT COUNT(*) FROM trapper.clinichq_upcoming_appointments)
UNION ALL SELECT
    'data_issues',
    (SELECT COUNT(*) FROM trapper.data_issues);

\echo ''
\echo 'Bootstrap complete. Next steps:'
\echo '  1. Run smoke test: ./scripts/smoke_db.mjs'
\echo '  2. Ingest first CSV: See docs/runbooks/FIRST_INGEST.md'
\echo ''
