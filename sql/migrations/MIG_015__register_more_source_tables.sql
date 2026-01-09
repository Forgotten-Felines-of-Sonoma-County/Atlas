-- MIG_015__register_more_source_tables.sql
-- Register additional source systems and tables for ATLAS_009
--
-- Adds:
--   - clinichq: appointment_info, cat_info, owner_info
--   - volunteerhub: users
--   - shelterluv: animals, people, outcomes
--   - petlink: pets, owners
--   - etapestry: mailchimp_export
--   - airtable: appointment_requests, project75_survey, trappers (if missing)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_015__register_more_source_tables.sql

\echo '============================================'
\echo 'MIG_015: Register More Source Tables'
\echo '============================================'

-- ============================================
-- PART 1: Source Systems
-- ============================================
\echo ''
\echo 'Registering source systems...'

INSERT INTO trapper.source_systems (system_id, display_name, description) VALUES
    ('clinichq', 'ClinicHQ', 'ClinicHQ clinic management exports'),
    ('volunteerhub', 'VolunteerHub', 'VolunteerHub volunteer management exports'),
    ('shelterluv', 'Shelterluv', 'Shelterluv animal/people/outcomes exports'),
    ('petlink', 'PetLink', 'PetLink microchip registry exports'),
    ('etapestry', 'E-Tapestry', 'E-Tapestry donor/contact exports')
ON CONFLICT (system_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description;

-- ============================================
-- PART 2: ClinicHQ Tables
-- ============================================
\echo 'Registering ClinicHQ tables...'

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('clinichq', 'appointment_info', 'Appointment Info', 'ClinicHQ appointment records', ARRAY['Appointment ID', 'appointment_id', 'ID']),
    ('clinichq', 'cat_info', 'Cat Info', 'ClinicHQ cat/animal records', ARRAY['Pet ID', 'Animal ID', 'Microchip', 'pet_id', 'ID']),
    ('clinichq', 'owner_info', 'Owner Info', 'ClinicHQ owner/client records', ARRAY['Owner ID', 'Client ID', 'owner_id', 'ID'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- ============================================
-- PART 3: VolunteerHub Tables
-- ============================================
\echo 'Registering VolunteerHub tables...'

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('volunteerhub', 'users', 'Users', 'VolunteerHub volunteer records', ARRAY['User ID', 'Volunteer ID', 'user_id', 'Email'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- ============================================
-- PART 4: Shelterluv Tables
-- ============================================
\echo 'Registering Shelterluv tables...'

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('shelterluv', 'animals', 'Animals', 'Shelterluv animal records', ARRAY['Internal-ID', 'Animal ID', 'ID']),
    ('shelterluv', 'people', 'People', 'Shelterluv people/contact records', ARRAY['Internal-ID', 'Person ID', 'ID']),
    ('shelterluv', 'outcomes', 'Outcomes', 'Shelterluv outcome events', ARRAY['Internal-ID', 'Outcome ID', 'ID'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- ============================================
-- PART 5: PetLink Tables
-- ============================================
\echo 'Registering PetLink tables...'

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('petlink', 'pets', 'Pets', 'PetLink pet/microchip records', ARRAY['Microchip Number', 'Pet ID', 'microchip', 'ID']),
    ('petlink', 'owners', 'Owners', 'PetLink owner records', ARRAY['Owner ID', 'Account ID', 'owner_id', 'ID'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- ============================================
-- PART 6: E-Tapestry Tables
-- ============================================
\echo 'Registering E-Tapestry tables...'

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('etapestry', 'mailchimp_export', 'Mailchimp Export', 'E-Tapestry Mailchimp export (donors/contacts)', ARRAY['Account Number', 'Constituent ID', 'Email', 'ID'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- ============================================
-- PART 7: Additional Airtable Tables
-- ============================================
\echo 'Registering additional Airtable tables...'

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('airtable', 'appointment_requests', 'Appointment Requests', 'Airtable appointment request records', ARRAY['Record ID', 'Airtable Record ID', 'record_id', 'ID']),
    ('airtable', 'trappers', 'Trappers', 'Airtable trapper volunteer records', ARRAY['Record ID', 'Airtable Record ID', 'record_id', 'ID'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- Also register airtable_project75 if not exists
INSERT INTO trapper.source_systems (system_id, display_name, description) VALUES
    ('airtable_project75', 'Airtable Project 75', 'Airtable Project 75 base')
ON CONFLICT (system_id) DO NOTHING;

INSERT INTO trapper.source_tables (system_id, table_id, display_name, description, id_field_candidates) VALUES
    ('airtable_project75', 'project75_survey', 'Project 75 Survey', 'Project 75 after-clinic survey', ARRAY['Record ID', 'Airtable Record ID', 'record_id', 'ID'])
ON CONFLICT (system_id, table_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    id_field_candidates = EXCLUDED.id_field_candidates;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_015 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Source systems:'
SELECT system_id, display_name FROM trapper.source_systems ORDER BY system_id;

\echo ''
\echo 'Source tables by system:'
SELECT system_id, table_id FROM trapper.source_tables ORDER BY system_id, table_id;

\echo ''
\echo 'MIG_015 ready for ingest scripts.'
\echo ''
