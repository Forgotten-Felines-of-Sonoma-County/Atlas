-- MIG_013__undo_and_split.sql
-- Reversible Workflows: Reject, Undo Merge, and Split
--
-- Creates:
--   - trapper.reject_person_match(): mark pair as not_same_person
--   - trapper.undo_person_merge(): revert a merge
--   - trapper.split_person_create_new(): create new person and migrate evidence
--
-- Purpose:
--   - Support human review corrections
--   - Make auto-merges fully reversible
--   - Maintain audit trail for all decisions
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_013__undo_and_split.sql

\echo '============================================'
\echo 'MIG_013: Undo and Split Workflows'
\echo '============================================'

-- ============================================
-- PART 1: Reject Person Match
-- ============================================
\echo ''
\echo 'Creating reject_person_match function...'

CREATE OR REPLACE FUNCTION trapper.reject_person_match(
    p_left_person_id UUID,
    p_right_person_id UUID,
    p_note TEXT DEFAULT NULL,
    p_decided_by TEXT DEFAULT 'system'
)
RETURNS VOID AS $$
DECLARE
    v_left UUID;
    v_right UUID;
BEGIN
    -- Normalize pair ordering
    IF p_left_person_id < p_right_person_id THEN
        v_left := p_left_person_id;
        v_right := p_right_person_id;
    ELSE
        v_left := p_right_person_id;
        v_right := p_left_person_id;
    END IF;

    -- Upsert decision as not_same_person
    INSERT INTO trapper.person_match_decisions (
        left_person_id, right_person_id, decision, note, decided_by
    ) VALUES (
        v_left, v_right, 'not_same_person', p_note, p_decided_by
    )
    ON CONFLICT (left_person_id, right_person_id)
    DO UPDATE SET
        decision = 'not_same_person',
        note = COALESCE(EXCLUDED.note, trapper.person_match_decisions.note),
        decided_by = EXCLUDED.decided_by,
        created_at = NOW();

    -- Mark any open candidates as rejected/blocked
    UPDATE trapper.person_match_candidates
    SET status = 'rejected',
        decided_at = NOW(),
        decided_by = p_decided_by
    WHERE left_person_id = v_left
      AND right_person_id = v_right
      AND status = 'open';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.reject_person_match IS
'Marks a person pair as not_same_person, blocking future auto-merges.
Also rejects any open candidates for this pair.';

-- ============================================
-- PART 2: Undo Person Merge
-- ============================================
\echo 'Creating undo_person_merge function...'

CREATE OR REPLACE FUNCTION trapper.undo_person_merge(
    p_merge_id UUID,
    p_decided_by TEXT DEFAULT 'system',
    p_note TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_merge RECORD;
BEGIN
    -- Get the merge record
    SELECT * INTO v_merge
    FROM trapper.person_merges
    WHERE merge_id = p_merge_id;

    IF v_merge IS NULL THEN
        RAISE EXCEPTION 'Merge not found: %', p_merge_id;
    END IF;

    IF v_merge.is_reverted THEN
        RAISE NOTICE 'Merge % already reverted', p_merge_id;
        RETURN;
    END IF;

    -- Mark merge as reverted
    UPDATE trapper.person_merges
    SET is_reverted = TRUE,
        reverted_at = NOW(),
        reverted_by = p_decided_by,
        revert_note = p_note
    WHERE merge_id = p_merge_id;

    -- Restore from_person (only if still pointing to into_person)
    UPDATE trapper.sot_people
    SET merged_into_person_id = NULL,
        merged_at = NULL,
        merge_reason = NULL,
        updated_at = NOW()
    WHERE person_id = v_merge.from_person_id
      AND merged_into_person_id = v_merge.into_person_id;

    -- Note: We do NOT automatically redistribute evidence (staged_record_person_link).
    -- The split_person_create_new function handles that explicitly.
    -- After undo, staged_record_person_link still points to into_person.
    -- Use split_person_create_new to move specific records to the restored person.

    -- Block future auto-merges for this pair
    PERFORM trapper.reject_person_match(
        v_merge.from_person_id,
        v_merge.into_person_id,
        COALESCE(p_note, 'Merge reverted'),
        p_decided_by
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.undo_person_merge IS
'Reverts a merge by:
1. Marking merge as reverted
2. Clearing merged_into_person_id on from_person
3. Blocking future auto-merges for this pair
NOTE: Does not redistribute evidence. Use split_person_create_new for that.';

-- ============================================
-- PART 3: Split Person - Create New
-- ============================================
\echo 'Creating split_person_create_new function...'

CREATE OR REPLACE FUNCTION trapper.split_person_create_new(
    p_from_person_id UUID,
    p_new_display_name TEXT,
    p_staged_record_ids UUID[],
    p_decided_by TEXT DEFAULT 'system',
    p_note TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_new_person_id UUID;
    v_records_moved INT;
    v_aliases_copied INT;
BEGIN
    -- Validate from_person exists and is canonical
    IF NOT EXISTS (
        SELECT 1 FROM trapper.sot_people
        WHERE person_id = p_from_person_id
    ) THEN
        RAISE EXCEPTION 'Person not found: %', p_from_person_id;
    END IF;

    -- Create new person
    INSERT INTO trapper.sot_people (display_name)
    VALUES (p_new_display_name)
    RETURNING person_id INTO v_new_person_id;

    -- Move staged_record_person_link for specified records
    UPDATE trapper.staged_record_person_link
    SET person_id = v_new_person_id
    WHERE staged_record_id = ANY(p_staged_record_ids)
      AND person_id = p_from_person_id;

    GET DIAGNOSTICS v_records_moved = ROW_COUNT;

    -- Copy aliases connected to those staged records to the new person
    INSERT INTO trapper.person_aliases (
        person_id, name_raw, name_key,
        source_system, source_table, source_row_id, staged_record_id
    )
    SELECT
        v_new_person_id,
        pa.name_raw,
        pa.name_key,
        pa.source_system,
        pa.source_table,
        pa.source_row_id,
        pa.staged_record_id
    FROM trapper.person_aliases pa
    WHERE pa.staged_record_id = ANY(p_staged_record_ids)
      AND pa.person_id = p_from_person_id
    ON CONFLICT (person_id, name_key, staged_record_id) DO NOTHING;

    GET DIAGNOSTICS v_aliases_copied = ROW_COUNT;

    -- Copy identifiers connected to those staged records to the new person
    -- (Use INSERT ON CONFLICT since identifiers are unique per type+value)
    INSERT INTO trapper.person_identifiers (
        person_id, id_type, id_value_norm, id_value_raw,
        source_system, source_table, source_row_id, staged_record_id, confidence
    )
    SELECT
        v_new_person_id,
        pi.id_type,
        pi.id_value_norm,
        pi.id_value_raw,
        pi.source_system,
        pi.source_table,
        pi.source_row_id,
        pi.staged_record_id,
        pi.confidence
    FROM trapper.person_identifiers pi
    WHERE pi.staged_record_id = ANY(p_staged_record_ids)
      AND pi.person_id = p_from_person_id
    ON CONFLICT (id_type, id_value_norm) DO NOTHING;

    -- Block future auto-merges between from_person and new_person
    PERFORM trapper.reject_person_match(
        p_from_person_id,
        v_new_person_id,
        COALESCE(p_note, 'Created via split'),
        p_decided_by
    );

    RAISE NOTICE 'Split complete: new_person=%, records_moved=%, aliases_copied=%',
        v_new_person_id, v_records_moved, v_aliases_copied;

    RETURN v_new_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.split_person_create_new IS
'Creates a new person and migrates specific evidence from an existing person.
1. Creates new sot_people record with given display_name
2. Moves staged_record_person_link for specified staged_record_ids
3. Copies aliases connected to those staged records
4. Copies identifiers connected to those staged records
5. Blocks future auto-merges between the pair
Returns the new person_id.';

-- ============================================
-- PART 4: Helper - Rebuild Person Display Name
-- ============================================
\echo 'Creating rebuild_person_after_split function...'

CREATE OR REPLACE FUNCTION trapper.rebuild_person_after_split(p_person_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Update display name based on remaining aliases
    PERFORM trapper.update_person_display_name(p_person_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.rebuild_person_after_split IS
'Rebuilds derived data for a person after a split.
Currently updates display_name. Can be extended for other derivations.';

-- ============================================
-- PART 5: View - Recent Decisions
-- ============================================
\echo 'Creating v_recent_person_decisions view...'

CREATE OR REPLACE VIEW trapper.v_recent_person_decisions AS
SELECT
    d.decision_id,
    d.left_person_id,
    p_left.display_name AS left_display_name,
    d.right_person_id,
    p_right.display_name AS right_display_name,
    d.decision,
    d.note,
    d.decided_by,
    d.created_at
FROM trapper.person_match_decisions d
LEFT JOIN trapper.sot_people p_left ON p_left.person_id = d.left_person_id
LEFT JOIN trapper.sot_people p_right ON p_right.person_id = d.right_person_id
ORDER BY d.created_at DESC;

COMMENT ON VIEW trapper.v_recent_person_decisions IS
'Recent person match decisions with display names.';

-- ============================================
-- PART 6: View - People with Evidence Summary
-- ============================================
\echo 'Creating v_people_with_evidence view...'

CREATE OR REPLACE VIEW trapper.v_people_with_evidence AS
SELECT
    p.person_id,
    p.display_name,
    p.merged_into_person_id,
    p.merge_reason,
    COUNT(DISTINCT srpl.staged_record_id) AS linked_records,
    COUNT(DISTINCT pa.alias_id) AS alias_count,
    COUNT(DISTINCT pi.identifier_id) AS identifier_count,
    ARRAY_AGG(DISTINCT pi.id_type || ':' || pi.id_value_norm) FILTER (WHERE pi.id_value_norm IS NOT NULL) AS identifiers
FROM trapper.sot_people p
LEFT JOIN trapper.staged_record_person_link srpl ON srpl.person_id = p.person_id
LEFT JOIN trapper.person_aliases pa ON pa.person_id = p.person_id
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
GROUP BY p.person_id, p.display_name, p.merged_into_person_id, p.merge_reason;

COMMENT ON VIEW trapper.v_people_with_evidence IS
'People with counts of linked records, aliases, and identifiers.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_013 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Functions created:'
SELECT proname FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper')
  AND proname IN ('reject_person_match', 'undo_person_merge', 'split_person_create_new', 'rebuild_person_after_split')
ORDER BY proname;

\echo ''
\echo 'Manual test workflow:'
\echo '  -- To reject a match (blocks future auto-merge):'
\echo '  SELECT trapper.reject_person_match(''uuid-a'', ''uuid-b'', ''Not same person'', ''reviewer'');'
\echo ''
\echo '  -- To undo a merge:'
\echo '  SELECT trapper.undo_person_merge(''merge-uuid'', ''reviewer'', ''Incorrectly merged'');'
\echo ''
\echo '  -- To split and create new person with specific records:'
\echo '  SELECT trapper.split_person_create_new('
\echo '    ''from-person-uuid''::uuid,'
\echo '    ''New Person Name''::text,'
\echo '    ARRAY[''staged-record-1''::uuid, ''staged-record-2''::uuid],'
\echo '    ''reviewer''::text,'
\echo '    ''Split reason''::text'
\echo '  );'
\echo ''
