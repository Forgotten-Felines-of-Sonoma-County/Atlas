-- MIG_012__fuzzy_matching_and_merges.sql
-- Fuzzy Matching Candidates + Very-Confident Auto-Merge + Audit
--
-- Creates:
--   - trapper.person_match_candidates: potential matches for review
--   - trapper.person_match_decisions: explicit accept/reject decisions
--   - trapper.person_merges: audit trail of all merges
--   - trapper.generate_person_match_candidates(): finds potential duplicates
--   - trapper.apply_automerge_very_confident(): auto-merges high-confidence matches
--
-- Purpose:
--   - Find potential duplicate people via fuzzy name matching
--   - Auto-merge only when extremely confident (C0 rule)
--   - Maintain full audit trail for reversibility
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_012__fuzzy_matching_and_merges.sql

\echo '============================================'
\echo 'MIG_012: Fuzzy Matching + Very-Confident Auto-Merge'
\echo '============================================'

-- ============================================
-- PART 1: Candidate Status Enum
-- ============================================
\echo ''
\echo 'Creating candidate_status enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candidate_status') THEN
        CREATE TYPE trapper.candidate_status AS ENUM (
            'open',
            'auto_merged',
            'accepted',
            'rejected',
            'blocked'
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Match Decision Enum
-- ============================================
\echo 'Creating match_decision enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_decision') THEN
        CREATE TYPE trapper.match_decision AS ENUM (
            'same_person',
            'not_same_person'
        );
    END IF;
END$$;

-- ============================================
-- PART 3: person_match_candidates Table
-- ============================================
\echo 'Creating person_match_candidates table...'

CREATE TABLE IF NOT EXISTS trapper.person_match_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The pair (always stored as left < right for consistency)
    left_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    right_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Match quality
    match_score NUMERIC(4,3) NOT NULL,  -- 0.000 to 1.000
    match_reasons TEXT[] NOT NULL DEFAULT '{}',

    -- Status
    status trapper.candidate_status NOT NULL DEFAULT 'open',
    decided_at TIMESTAMPTZ,
    decided_by TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure consistent pair ordering and uniqueness
    CONSTRAINT uq_person_match_candidate_pair
        UNIQUE (left_person_id, right_person_id),
    CONSTRAINT chk_person_match_candidate_order
        CHECK (left_person_id < right_person_id)
);

CREATE INDEX IF NOT EXISTS idx_person_match_candidates_status
    ON trapper.person_match_candidates(status);

CREATE INDEX IF NOT EXISTS idx_person_match_candidates_score
    ON trapper.person_match_candidates(match_score DESC)
    WHERE status = 'open';

COMMENT ON TABLE trapper.person_match_candidates IS
'Potential duplicate person matches for review or auto-merge.
Pairs stored with left_id < right_id for consistency.';

-- ============================================
-- PART 4: person_match_decisions Table
-- ============================================
\echo 'Creating person_match_decisions table...'

CREATE TABLE IF NOT EXISTS trapper.person_match_decisions (
    decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The pair (always stored as LEAST/GREATEST for consistency)
    left_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    right_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Decision
    decision trapper.match_decision NOT NULL,
    note TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by TEXT,

    -- One decision per pair (use stable key)
    CONSTRAINT uq_person_match_decision_pair
        UNIQUE (left_person_id, right_person_id),
    CONSTRAINT chk_person_match_decision_order
        CHECK (left_person_id < right_person_id)
);

COMMENT ON TABLE trapper.person_match_decisions IS
'Explicit decisions about person pairs: same_person or not_same_person.
not_same_person blocks future auto-merges for this pair.';

-- ============================================
-- PART 5: person_merges Table
-- ============================================
\echo 'Creating person_merges table...'

CREATE TABLE IF NOT EXISTS trapper.person_merges (
    merge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The merge: from -> into
    from_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
    into_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- How it happened
    merge_rule TEXT NOT NULL,  -- e.g., 'C0_VERY_CONFIDENT', 'manual'
    match_score NUMERIC(4,3),
    candidate_id UUID REFERENCES trapper.person_match_candidates(candidate_id),

    -- Revert support
    is_reverted BOOLEAN NOT NULL DEFAULT FALSE,
    reverted_at TIMESTAMPTZ,
    reverted_by TEXT,
    revert_note TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_person_merges_from
    ON trapper.person_merges(from_person_id);

CREATE INDEX IF NOT EXISTS idx_person_merges_into
    ON trapper.person_merges(into_person_id);

CREATE INDEX IF NOT EXISTS idx_person_merges_active
    ON trapper.person_merges(is_reverted)
    WHERE is_reverted = FALSE;

COMMENT ON TABLE trapper.person_merges IS
'Audit trail of all person merges. Supports revert via is_reverted flag.';

-- ============================================
-- PART 6: Helper - Check if Pair is Blocked
-- ============================================
\echo 'Creating is_pair_blocked function...'

CREATE OR REPLACE FUNCTION trapper.is_pair_blocked(p_person_a UUID, p_person_b UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_left UUID;
    v_right UUID;
BEGIN
    -- Normalize pair ordering
    IF p_person_a < p_person_b THEN
        v_left := p_person_a;
        v_right := p_person_b;
    ELSE
        v_left := p_person_b;
        v_right := p_person_a;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM trapper.person_match_decisions
        WHERE left_person_id = v_left
          AND right_person_id = v_right
          AND decision = 'not_same_person'
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- PART 7: Helper - Check for Conflicting Identifiers
-- ============================================
\echo 'Creating have_conflicting_identifiers function...'

CREATE OR REPLACE FUNCTION trapper.have_conflicting_identifiers(p_person_a UUID, p_person_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if both have email but different
    IF EXISTS (
        SELECT 1
        FROM trapper.person_identifiers a
        JOIN trapper.person_identifiers b ON b.person_id = p_person_b
        WHERE a.person_id = p_person_a
          AND a.id_type = 'email'
          AND b.id_type = 'email'
          AND a.id_value_norm <> b.id_value_norm
    ) THEN
        RETURN TRUE;
    END IF;

    -- Check if both have phone but different
    IF EXISTS (
        SELECT 1
        FROM trapper.person_identifiers a
        JOIN trapper.person_identifiers b ON b.person_id = p_person_b
        WHERE a.person_id = p_person_a
          AND a.id_type = 'phone'
          AND b.id_type = 'phone'
          AND a.id_value_norm <> b.id_value_norm
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.have_conflicting_identifiers IS
'Returns TRUE if two people have different emails or different phones.
Used to block auto-merge when strong identifiers conflict.';

-- ============================================
-- PART 8: Helper - Check for Shared Address Context
-- ============================================
\echo 'Creating have_shared_address_context function...'

CREATE OR REPLACE FUNCTION trapper.have_shared_address_context(p_person_a UUID, p_person_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if they share a resolved address via staged_record_address_link
    RETURN EXISTS (
        SELECT 1
        FROM trapper.staged_record_person_link spa
        JOIN trapper.staged_record_address_link srala ON srala.staged_record_id = spa.staged_record_id
        JOIN trapper.staged_record_person_link spb ON spb.person_id = p_person_b
        JOIN trapper.staged_record_address_link sralb ON sralb.staged_record_id = spb.staged_record_id
        WHERE spa.person_id = p_person_a
          AND srala.address_id = sralb.address_id
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.have_shared_address_context IS
'Returns TRUE if two people have staged records linked to the same sot_address.
Part of the context requirement for very-confident auto-merge.';

-- ============================================
-- PART 9: Generate Person Match Candidates
-- ============================================
\echo 'Creating generate_person_match_candidates function...'

CREATE OR REPLACE FUNCTION trapper.generate_person_match_candidates(
    p_source_table TEXT DEFAULT NULL,
    p_limit INT DEFAULT 1000
)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Find potential matches based on name similarity
    INSERT INTO trapper.person_match_candidates (
        left_person_id, right_person_id, match_score, match_reasons
    )
    SELECT
        LEAST(a.person_id, b.person_id) AS left_person_id,
        GREATEST(a.person_id, b.person_id) AS right_person_id,
        MAX(trapper.name_similarity(a.name_raw, b.name_raw)) AS match_score,
        ARRAY_AGG(DISTINCT
            'name_sim:' || ROUND(trapper.name_similarity(a.name_raw, b.name_raw)::numeric, 2)::text ||
            ' (' || a.name_raw || ' ~ ' || b.name_raw || ')'
        ) AS match_reasons
    FROM trapper.person_aliases a
    JOIN trapper.person_aliases b ON a.person_id < b.person_id
    -- Filter: different people
    WHERE a.person_id <> b.person_id
      -- Filter: both canonical (not merged)
      AND NOT EXISTS (SELECT 1 FROM trapper.sot_people WHERE person_id = a.person_id AND merged_into_person_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM trapper.sot_people WHERE person_id = b.person_id AND merged_into_person_id IS NOT NULL)
      -- Filter: same last token (last name)
      AND trapper.extract_last_token(a.name_raw) = trapper.extract_last_token(b.name_raw)
      -- Filter: at least 2 tokens each (first + last name)
      AND trapper.name_token_count(a.name_raw) >= 2
      AND trapper.name_token_count(b.name_raw) >= 2
      -- Filter: similarity threshold
      AND trapper.name_similarity(a.name_raw, b.name_raw) >= 0.75
      -- Filter: not blocked
      AND NOT trapper.is_pair_blocked(a.person_id, b.person_id)
      -- Optional: filter by source_table
      AND (p_source_table IS NULL OR a.source_table = p_source_table OR b.source_table = p_source_table)
    GROUP BY LEAST(a.person_id, b.person_id), GREATEST(a.person_id, b.person_id)
    HAVING MAX(trapper.name_similarity(a.name_raw, b.name_raw)) >= 0.75
    ORDER BY MAX(trapper.name_similarity(a.name_raw, b.name_raw)) DESC
    LIMIT p_limit
    ON CONFLICT (left_person_id, right_person_id)
    DO UPDATE SET
        match_score = GREATEST(trapper.person_match_candidates.match_score, EXCLUDED.match_score),
        match_reasons = EXCLUDED.match_reasons;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.generate_person_match_candidates IS
'Generates potential person match candidates based on name similarity.
Filters: same last token, >= 2 tokens each, similarity >= 0.75, not blocked.';

-- ============================================
-- PART 10: Apply Very-Confident Auto-Merge (C0)
-- ============================================
\echo 'Creating apply_automerge_very_confident function...'

CREATE OR REPLACE FUNCTION trapper.apply_automerge_very_confident(
    p_limit INT DEFAULT 200
)
RETURNS TABLE (
    merges_applied INT,
    candidates_processed INT
) AS $$
DECLARE
    v_merges_applied INT := 0;
    v_candidates_processed INT := 0;
    v_candidate RECORD;
    v_from_person_id UUID;
    v_into_person_id UUID;
    v_merge_id UUID;
BEGIN
    -- Process open candidates that meet C0 criteria
    FOR v_candidate IN
        SELECT
            c.candidate_id,
            c.left_person_id,
            c.right_person_id,
            c.match_score
        FROM trapper.person_match_candidates c
        WHERE c.status = 'open'
          AND c.match_score >= 0.97  -- Very high similarity
        ORDER BY c.match_score DESC
        LIMIT p_limit
    LOOP
        v_candidates_processed := v_candidates_processed + 1;

        -- Skip if pair is now blocked (decision made since candidate created)
        IF trapper.is_pair_blocked(v_candidate.left_person_id, v_candidate.right_person_id) THEN
            UPDATE trapper.person_match_candidates
            SET status = 'blocked', decided_at = NOW(), decided_by = 'automerge_c0'
            WHERE candidate_id = v_candidate.candidate_id;
            CONTINUE;
        END IF;

        -- Skip if either person is already merged
        IF EXISTS (
            SELECT 1 FROM trapper.sot_people
            WHERE person_id IN (v_candidate.left_person_id, v_candidate.right_person_id)
              AND merged_into_person_id IS NOT NULL
        ) THEN
            UPDATE trapper.person_match_candidates
            SET status = 'blocked', decided_at = NOW(), decided_by = 'automerge_c0'
            WHERE candidate_id = v_candidate.candidate_id;
            CONTINUE;
        END IF;

        -- Skip if conflicting identifiers (different email or different phone)
        IF trapper.have_conflicting_identifiers(v_candidate.left_person_id, v_candidate.right_person_id) THEN
            UPDATE trapper.person_match_candidates
            SET status = 'blocked', decided_at = NOW(), decided_by = 'automerge_c0_conflict'
            WHERE candidate_id = v_candidate.candidate_id;
            CONTINUE;
        END IF;

        -- Skip if no shared address context
        IF NOT trapper.have_shared_address_context(v_candidate.left_person_id, v_candidate.right_person_id) THEN
            -- Leave as open for manual review (might be same person, just no address proof)
            CONTINUE;
        END IF;

        -- All C0 criteria met - perform merge
        -- Convention: merge the higher ID into the lower ID
        v_into_person_id := v_candidate.left_person_id;
        v_from_person_id := v_candidate.right_person_id;

        -- Create merge record
        INSERT INTO trapper.person_merges (
            from_person_id, into_person_id, merge_rule, match_score, candidate_id, created_by
        ) VALUES (
            v_from_person_id, v_into_person_id, 'C0_VERY_CONFIDENT',
            v_candidate.match_score, v_candidate.candidate_id, 'automerge_c0'
        )
        RETURNING merge_id INTO v_merge_id;

        -- Soft-merge: update from_person to point to into_person
        UPDATE trapper.sot_people
        SET merged_into_person_id = v_into_person_id,
            merged_at = NOW(),
            merge_reason = 'fuzzy_automerge'
        WHERE person_id = v_from_person_id;

        -- Optionally: repoint staged_record_person_link to canonical
        -- (This makes queries simpler but is reversible via merge record)
        UPDATE trapper.staged_record_person_link
        SET person_id = v_into_person_id
        WHERE person_id = v_from_person_id;

        -- Mark candidate as auto_merged
        UPDATE trapper.person_match_candidates
        SET status = 'auto_merged', decided_at = NOW(), decided_by = 'automerge_c0'
        WHERE candidate_id = v_candidate.candidate_id;

        v_merges_applied := v_merges_applied + 1;
    END LOOP;

    RETURN QUERY SELECT v_merges_applied, v_candidates_processed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.apply_automerge_very_confident IS
'Auto-merges person pairs meeting C0 (very confident) criteria:
- match_score >= 0.97
- Same last name token, >= 2 name tokens each
- NOT blocked by prior decision
- NO conflicting strong identifiers (email/phone)
- MUST share address context (same sot_address on linked records)
Creates audit trail in person_merges. Safe to re-run.';

-- ============================================
-- PART 11: View - Merge Audit
-- ============================================
\echo 'Creating v_person_merges_audit view...'

CREATE OR REPLACE VIEW trapper.v_person_merges_audit AS
SELECT
    pm.merge_id,
    pm.from_person_id,
    p_from.display_name AS from_display_name,
    pm.into_person_id,
    p_into.display_name AS into_display_name,
    pm.merge_rule,
    pm.match_score,
    pm.is_reverted,
    pm.reverted_at,
    pm.reverted_by,
    pm.created_at,
    pm.created_by
FROM trapper.person_merges pm
LEFT JOIN trapper.sot_people p_from ON p_from.person_id = pm.from_person_id
LEFT JOIN trapper.sot_people p_into ON p_into.person_id = pm.into_person_id
ORDER BY pm.created_at DESC;

COMMENT ON VIEW trapper.v_person_merges_audit IS
'Audit view of person merges with display names.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_012 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('person_match_candidates', 'person_match_decisions', 'person_merges')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Generate candidates: SELECT trapper.generate_person_match_candidates(''trapping_requests'');'
\echo '  2. Review: SELECT * FROM trapper.person_match_candidates WHERE status = ''open'' ORDER BY match_score DESC LIMIT 20;'
\echo '  3. Auto-merge: SELECT * FROM trapper.apply_automerge_very_confident();'
\echo '  4. Audit: SELECT * FROM trapper.v_person_merges_audit;'
\echo ''
