-- MIG_039__ingest_run_repair.sql
-- Safe repair helper for stuck ingest runs
--
-- Purpose:
--   Provide a safe, audited way to repair ingest runs that are stuck in "running"
--   state due to script crashes or timeouts. Only repairs runs that are:
--   - Older than a threshold (default 30 minutes)
--   - Have evidence of data being processed (rows_linked > 0 OR rows_inserted > 0)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_039__ingest_run_repair.sql

\echo '============================================'
\echo 'MIG_039: Ingest Run Repair Helper'
\echo '============================================'

-- ============================================
-- PART 1: Audit table for repairs
-- ============================================
\echo ''
\echo 'Creating ingest_run_repairs audit table...'

CREATE TABLE IF NOT EXISTS trapper.ingest_run_repairs (
    repair_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,

    -- What was repaired
    old_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    run_age_minutes NUMERIC NOT NULL,

    -- Evidence for repair decision
    rows_inserted INT,
    rows_linked INT,
    rows_suspect INT,
    row_count INT,

    -- Audit
    repair_reason TEXT NOT NULL,
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    repaired_by TEXT DEFAULT current_user
);

COMMENT ON TABLE trapper.ingest_run_repairs IS
'Audit trail for ingest run repairs. Records all automatic or manual repairs
of stuck runs for accountability and debugging.';

CREATE INDEX IF NOT EXISTS idx_ingest_run_repairs_run_id
ON trapper.ingest_run_repairs (run_id);

CREATE INDEX IF NOT EXISTS idx_ingest_run_repairs_source
ON trapper.ingest_run_repairs (source_system, source_table);

-- ============================================
-- PART 2: Safe repair function
-- ============================================
\echo ''
\echo 'Creating repair_stuck_ingest_runs function...'

CREATE OR REPLACE FUNCTION trapper.repair_stuck_ingest_runs(
    p_source_system TEXT DEFAULT NULL,
    p_age_minutes INT DEFAULT 30,
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    run_id UUID,
    source_system TEXT,
    source_table TEXT,
    run_age_minutes NUMERIC,
    old_status TEXT,
    new_status TEXT,
    repair_reason TEXT,
    action TEXT
) AS $$
DECLARE
    v_run RECORD;
    v_repair_reason TEXT;
    v_new_status TEXT;
    v_action TEXT;
BEGIN
    FOR v_run IN
        SELECT
            ir.run_id,
            ir.source_system,
            ir.source_table,
            ir.run_status,
            ir.started_at,
            ir.row_count,
            ir.rows_inserted,
            ir.rows_linked,
            ir.rows_suspect,
            EXTRACT(EPOCH FROM (NOW() - ir.started_at)) / 60.0 AS age_minutes
        FROM trapper.ingest_runs ir
        WHERE ir.run_status = 'running'
          AND ir.started_at < NOW() - (p_age_minutes || ' minutes')::INTERVAL
          AND (p_source_system IS NULL OR ir.source_system = p_source_system)
        ORDER BY ir.started_at
    LOOP
        -- Determine repair action based on evidence
        IF v_run.rows_linked > 0 OR v_run.rows_inserted > 0 THEN
            -- Has processed data - mark as completed
            v_new_status := 'completed';
            v_repair_reason := format(
                'Run stuck >%s min with rows_linked=%s, rows_inserted=%s. Marking completed.',
                p_age_minutes, v_run.rows_linked, v_run.rows_inserted
            );
        ELSIF v_run.row_count > 0 AND v_run.rows_suspect = v_run.row_count THEN
            -- All rows are suspect - mark as completed (with issues)
            v_new_status := 'completed';
            v_repair_reason := format(
                'Run stuck >%s min with all %s rows marked suspect. Marking completed.',
                p_age_minutes, v_run.row_count
            );
        ELSIF v_run.row_count = 0 OR (v_run.rows_inserted = 0 AND v_run.rows_linked = 0 AND v_run.rows_suspect = 0) THEN
            -- No data processed - mark as failed
            v_new_status := 'failed';
            v_repair_reason := format(
                'Run stuck >%s min with no data processed. Marking failed.',
                p_age_minutes
            );
        ELSE
            -- Unclear state - mark as failed with note
            v_new_status := 'failed';
            v_repair_reason := format(
                'Run stuck >%s min in unclear state (row_count=%s, inserted=%s, linked=%s, suspect=%s). Marking failed.',
                p_age_minutes, v_run.row_count, v_run.rows_inserted, v_run.rows_linked, v_run.rows_suspect
            );
        END IF;

        IF p_dry_run THEN
            v_action := 'DRY_RUN (no changes made)';
        ELSE
            -- Actually repair the run
            UPDATE trapper.ingest_runs
            SET run_status = v_new_status,
                completed_at = NOW(),
                error_message = CASE
                    WHEN v_new_status = 'failed' THEN 'Auto-repaired: ' || v_repair_reason
                    ELSE error_message
                END
            WHERE ingest_runs.run_id = v_run.run_id;

            -- Record audit entry
            INSERT INTO trapper.ingest_run_repairs (
                run_id, source_system, source_table,
                old_status, new_status, run_age_minutes,
                rows_inserted, rows_linked, rows_suspect, row_count,
                repair_reason
            ) VALUES (
                v_run.run_id, v_run.source_system, v_run.source_table,
                v_run.run_status, v_new_status, v_run.age_minutes,
                v_run.rows_inserted, v_run.rows_linked, v_run.rows_suspect, v_run.row_count,
                v_repair_reason
            );

            v_action := 'REPAIRED';
        END IF;

        RETURN QUERY SELECT
            v_run.run_id,
            v_run.source_system,
            v_run.source_table,
            ROUND(v_run.age_minutes, 1),
            v_run.run_status,
            v_new_status,
            v_repair_reason,
            v_action;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.repair_stuck_ingest_runs IS
'Safely repairs ingest runs stuck in "running" state.

Parameters:
  p_source_system: Optional filter by source (NULL = all sources)
  p_age_minutes: Minimum age in minutes to consider stuck (default 30)
  p_dry_run: If TRUE, shows what would be repaired without making changes (default TRUE)

Repair logic:
  - rows_linked > 0 OR rows_inserted > 0 → mark "completed"
  - no data processed → mark "failed"
  - all rows suspect → mark "completed"
  - unclear state → mark "failed"

All repairs are recorded in trapper.ingest_run_repairs for audit.

Usage:
  -- Preview repairs (safe)
  SELECT * FROM trapper.repair_stuck_ingest_runs(''clinichq'', 30, TRUE);

  -- Actually repair (careful!)
  SELECT * FROM trapper.repair_stuck_ingest_runs(''clinichq'', 30, FALSE);';

-- ============================================
-- PART 3: View for stuck runs
-- ============================================
\echo ''
\echo 'Creating v_stuck_ingest_runs view...'

CREATE OR REPLACE VIEW trapper.v_stuck_ingest_runs AS
SELECT
    ir.run_id,
    ir.source_system,
    ir.source_table,
    ir.run_status,
    ir.started_at,
    ROUND(EXTRACT(EPOCH FROM (NOW() - ir.started_at)) / 60.0, 1) AS age_minutes,
    ir.row_count,
    ir.rows_inserted,
    ir.rows_linked,
    ir.rows_suspect,
    CASE
        WHEN ir.rows_linked > 0 OR ir.rows_inserted > 0 THEN 'can_complete'
        WHEN ir.row_count = 0 OR (ir.rows_inserted = 0 AND ir.rows_linked = 0) THEN 'can_fail'
        ELSE 'unclear'
    END AS suggested_action
FROM trapper.ingest_runs ir
WHERE ir.run_status = 'running'
  AND ir.started_at < NOW() - INTERVAL '30 minutes'
ORDER BY ir.started_at;

COMMENT ON VIEW trapper.v_stuck_ingest_runs IS
'Shows ingest runs that appear to be stuck (running > 30 minutes).
Use repair_stuck_ingest_runs() to fix them.';

-- ============================================
-- PART 4: Function to get latest completed run
-- ============================================
\echo ''
\echo 'Creating get_latest_completed_run function...'

CREATE OR REPLACE FUNCTION trapper.get_latest_completed_run(
    p_source_system TEXT,
    p_source_table TEXT
)
RETURNS UUID AS $$
    SELECT run_id
    FROM trapper.ingest_runs
    WHERE source_system = p_source_system
      AND source_table = p_source_table
      AND run_status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_latest_completed_run IS
'Returns the run_id of the most recent completed ingest run for a source/table.';

-- ============================================
-- PART 5: ClinicHQ people population function
-- ============================================
\echo ''
\echo 'Creating populate_clinichq_people function...'

CREATE OR REPLACE FUNCTION trapper.populate_clinichq_people(
    p_repair_stuck BOOLEAN DEFAULT TRUE,
    p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB := '{}'::JSONB;
    v_repairs_made INT := 0;
    v_obs_count INT := 0;
    v_people_created INT := 0;
    v_aliases_added INT := 0;
    v_display_names INT := 0;
    v_run_id UUID;
    v_repair_record RECORD;
    v_people_record RECORD;
BEGIN
    -- Step 1: Repair stuck runs if requested
    IF p_repair_stuck THEN
        FOR v_repair_record IN
            SELECT * FROM trapper.repair_stuck_ingest_runs('clinichq', 30, p_dry_run)
        LOOP
            v_repairs_made := v_repairs_made + 1;
        END LOOP;
        v_result := v_result || jsonb_build_object('repairs_made', v_repairs_made);
    END IF;

    -- If dry run, stop here
    IF p_dry_run THEN
        v_result := v_result || jsonb_build_object(
            'mode', 'dry_run',
            'message', 'Dry run complete. Use p_dry_run=FALSE to actually process.'
        );
        RETURN v_result;
    END IF;

    -- Step 2: Check for completed run
    v_run_id := trapper.get_latest_completed_run('clinichq', 'owner_info');
    IF v_run_id IS NULL THEN
        v_result := v_result || jsonb_build_object(
            'error', 'No completed clinichq owner_info run found',
            'suggestion', 'Run ingest first or repair stuck runs'
        );
        RETURN v_result;
    END IF;
    v_result := v_result || jsonb_build_object('run_id', v_run_id);

    -- Step 3: Populate observations
    SELECT trapper.populate_observations_for_latest_run('owner_info') INTO v_obs_count;
    v_result := v_result || jsonb_build_object('observations_created', v_obs_count);

    -- Step 4: Create canonical people
    SELECT * INTO v_people_record
    FROM trapper.upsert_people_from_observations('owner_info');
    v_people_created := v_people_record.people_created;
    v_result := v_result || jsonb_build_object(
        'people_created', v_people_record.people_created,
        'identifiers_added', v_people_record.identifiers_added,
        'records_linked', v_people_record.records_linked
    );

    -- Step 5: Populate aliases
    SELECT trapper.populate_aliases_from_name_signals('owner_info') INTO v_aliases_added;
    v_result := v_result || jsonb_build_object('aliases_added', v_aliases_added);

    -- Step 6: Update display names
    SELECT trapper.update_all_person_display_names() INTO v_display_names;
    v_result := v_result || jsonb_build_object('display_names_updated', v_display_names);

    -- Summary
    v_result := v_result || jsonb_build_object(
        'status', 'success',
        'total_canonical_people', (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL)
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.populate_clinichq_people IS
'One-command function to populate canonical people from ClinicHQ owner_info.

Steps:
1. Repairs any stuck ingest runs (if p_repair_stuck=TRUE)
2. Checks for completed owner_info run
3. Populates observations
4. Creates canonical people
5. Populates aliases
6. Updates display names

Parameters:
  p_repair_stuck: Repair stuck runs first (default TRUE)
  p_dry_run: Preview mode - shows what would happen without changes (default FALSE)

Returns JSONB with counts and status.

Usage:
  -- Preview
  SELECT trapper.populate_clinichq_people(TRUE, TRUE);

  -- Actually run
  SELECT trapper.populate_clinichq_people();';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_039 Complete'
\echo '============================================'

\echo ''
\echo 'Current stuck runs (if any):'
SELECT * FROM trapper.v_stuck_ingest_runs;

\echo ''
\echo 'Recent repairs (if any):'
SELECT repair_id, source_system, source_table, old_status, new_status, repair_reason, repaired_at
FROM trapper.ingest_run_repairs
ORDER BY repaired_at DESC
LIMIT 5;

\echo ''
\echo 'Usage:'
\echo ''
\echo '  -- Preview ClinicHQ people population (safe)'
\echo '  SELECT trapper.populate_clinichq_people(TRUE, TRUE);'
\echo ''
\echo '  -- Actually populate ClinicHQ people'
\echo '  SELECT trapper.populate_clinichq_people();'
\echo ''
\echo '  -- Preview stuck run repairs'
\echo '  SELECT * FROM trapper.repair_stuck_ingest_runs(''clinichq'', 30, TRUE);'
\echo ''
\echo '  -- Actually repair stuck runs'
\echo '  SELECT * FROM trapper.repair_stuck_ingest_runs(''clinichq'', 30, FALSE);'
\echo ''
