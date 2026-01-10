-- MIG_034__place_semantics.sql
-- Enhanced place semantics: significance inference and type detection
--
-- Purpose:
--   Make "place vs address" distinction clearer with automatic inference
--   and configurable significance rules. Places with high activity or
--   business-like names should be marked significant for search prioritization.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_034__place_semantics.sql

\echo '============================================'
\echo 'MIG_034: Place Semantics Enhancements'
\echo '============================================'

-- ============================================
-- PART 1: Add columns for better tracking
-- ============================================
\echo ''
\echo 'Adding tracking columns to places...'

-- last_reviewed_at: When a human last reviewed this place
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'places'
        AND column_name = 'last_reviewed_at'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN last_reviewed_at TIMESTAMPTZ;

        COMMENT ON COLUMN trapper.places.last_reviewed_at IS
        'When this place was last manually reviewed for accuracy.';
    END IF;
END $$;

-- last_reviewed_by: Who reviewed it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'places'
        AND column_name = 'last_reviewed_by'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN last_reviewed_by TEXT;

        COMMENT ON COLUMN trapper.places.last_reviewed_by IS
        'User ID who last reviewed this place.';
    END IF;
END $$;

-- activity_score: Computed score based on activity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'places'
        AND column_name = 'activity_score'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN activity_score NUMERIC(5,2) DEFAULT 0;

        COMMENT ON COLUMN trapper.places.activity_score IS
        'Computed activity score based on trapping, appointments, and cat activity.
Higher scores indicate more active/important places.';
    END IF;
END $$;

\echo '  Columns added.'

-- ============================================
-- PART 2: Function to detect business-like names
-- ============================================
\echo ''
\echo 'Creating is_business_like_name function...'

CREATE OR REPLACE FUNCTION trapper.is_business_like_name(p_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN FALSE;
    END IF;

    v_normalized := LOWER(TRIM(p_name));

    -- Business indicators
    IF v_normalized ~ '\b(inc|llc|corp|ltd|co|company|clinic|hospital|vet|veterinary)\b' THEN
        RETURN TRUE;
    END IF;

    IF v_normalized ~ '\b(shelter|rescue|foundation|society|association|center|centre)\b' THEN
        RETURN TRUE;
    END IF;

    IF v_normalized ~ '\b(pet|animal|cat|dog|kitten|puppy|feline|canine)\b.*\b(care|services|hospital|clinic)\b' THEN
        RETURN TRUE;
    END IF;

    IF v_normalized ~ '\b(store|shop|mart|market|supply|supplies)\b' THEN
        RETURN TRUE;
    END IF;

    IF v_normalized ~ '\b(petsmart|petco|banfield|vca)\b' THEN
        RETURN TRUE;
    END IF;

    -- Colony/outdoor indicators
    IF v_normalized ~ '\b(colony|feral|tnr|community cats|outdoor)\b' THEN
        RETURN TRUE;
    END IF;

    -- Park/trail indicators (already detected, but include here)
    IF v_normalized ~ '\b(park|trail|preserve|open space)\b' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_business_like_name IS
'Detects if a name looks like a business, clinic, shelter, colony, or other significant place.
Used to auto-infer place significance.';

-- ============================================
-- PART 3: Function to infer place kind from context
-- ============================================
\echo ''
\echo 'Creating infer_place_kind function...'

CREATE OR REPLACE FUNCTION trapper.infer_place_kind(
    p_display_name TEXT,
    p_formatted_address TEXT,
    p_unit_normalized TEXT DEFAULT NULL
)
RETURNS trapper.place_kind AS $$
DECLARE
    v_name_lower TEXT;
    v_addr_lower TEXT;
BEGIN
    v_name_lower := LOWER(COALESCE(p_display_name, ''));
    v_addr_lower := LOWER(COALESCE(p_formatted_address, ''));

    -- Has unit = apartment
    IF p_unit_normalized IS NOT NULL AND LENGTH(TRIM(p_unit_normalized)) > 0 THEN
        RETURN 'apartment_unit'::trapper.place_kind;
    END IF;

    -- Clinic/hospital
    IF v_name_lower ~ '\b(clinic|hospital|vet|veterinary|animal hospital)\b'
       OR v_addr_lower ~ '\b(clinic|hospital|vet)\b' THEN
        RETURN 'clinic'::trapper.place_kind;
    END IF;

    -- Business
    IF trapper.is_business_like_name(p_display_name) THEN
        RETURN 'business'::trapper.place_kind;
    END IF;

    -- Outdoor site (colony, park, etc.)
    IF v_name_lower ~ '\b(colony|park|trail|preserve|open space|feral|tnr)\b'
       OR v_addr_lower ~ '\b(park|trail|preserve)\b' THEN
        RETURN 'outdoor_site'::trapper.place_kind;
    END IF;

    -- Default to residential
    RETURN 'residential_house'::trapper.place_kind;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.infer_place_kind IS
'Infers place_kind from name and address.
Used during place creation and for backfilling.';

-- ============================================
-- PART 4: Function to calculate activity score
-- ============================================
\echo ''
\echo 'Creating calculate_place_activity_score function...'

CREATE OR REPLACE FUNCTION trapper.calculate_place_activity_score(p_place_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    v_score NUMERIC := 0;
    v_trapping_count INT;
    v_appointment_count INT;
    v_cat_count INT;
    v_recency_bonus NUMERIC;
    v_place RECORD;
BEGIN
    SELECT * INTO v_place FROM trapper.places WHERE place_id = p_place_id;

    IF v_place.place_id IS NULL THEN
        RETURN 0;
    END IF;

    -- Count linked trapping requests
    SELECT COUNT(*) INTO v_trapping_count
    FROM trapper.staged_record_address_link sral
    JOIN trapper.staged_records sr ON sr.id = sral.staged_record_id
    JOIN trapper.sot_addresses a ON a.address_id = sral.address_id
    WHERE a.address_id = v_place.sot_address_id
      AND sr.source_table = 'trapping_requests';

    -- Count linked appointments
    SELECT COUNT(*) INTO v_appointment_count
    FROM trapper.staged_record_address_link sral
    JOIN trapper.staged_records sr ON sr.id = sral.staged_record_id
    JOIN trapper.sot_addresses a ON a.address_id = sral.address_id
    WHERE a.address_id = v_place.sot_address_id
      AND sr.source_table IN ('appointment_requests', 'appointment_info');

    -- Count cats associated with this place (via person relationships)
    SELECT COUNT(DISTINCT pcr.cat_id) INTO v_cat_count
    FROM trapper.person_place_relationships ppr
    JOIN trapper.person_cat_relationships pcr ON pcr.person_id = ppr.person_id
    WHERE ppr.place_id = p_place_id;

    -- Base score from activity counts
    v_score := (v_trapping_count * 10) + (v_appointment_count * 5) + (v_cat_count * 2);

    -- Recency bonus: activity in last 90 days gets 50% boost
    IF v_place.last_activity_at IS NOT NULL
       AND v_place.last_activity_at > NOW() - INTERVAL '90 days' THEN
        v_recency_bonus := 1.5;
    ELSIF v_place.last_activity_at IS NOT NULL
          AND v_place.last_activity_at > NOW() - INTERVAL '180 days' THEN
        v_recency_bonus := 1.2;
    ELSE
        v_recency_bonus := 1.0;
    END IF;

    v_score := v_score * v_recency_bonus;

    -- Place kind bonus
    IF v_place.place_kind IN ('clinic', 'business', 'outdoor_site') THEN
        v_score := v_score + 20;  -- Bonus for known significant types
    END IF;

    RETURN ROUND(v_score, 2);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.calculate_place_activity_score IS
'Calculates an activity score for a place based on:
- Number of trapping requests (×10 points each)
- Number of appointments (×5 points each)
- Number of cats (×2 points each)
- Recency bonus (50% for last 90 days, 20% for last 180 days)
- Place kind bonus (+20 for clinics, businesses, outdoor sites)';

-- ============================================
-- PART 5: Function to infer significance
-- ============================================
\echo ''
\echo 'Creating infer_place_significance function...'

CREATE OR REPLACE FUNCTION trapper.infer_place_significance(p_place_id UUID)
RETURNS TABLE (
    should_be_significant BOOLEAN,
    reasons TEXT[]
) AS $$
DECLARE
    v_place RECORD;
    v_reasons TEXT[] := '{}';
    v_activity_score NUMERIC;
    v_activity_threshold NUMERIC;
BEGIN
    SELECT * INTO v_place FROM trapper.places WHERE place_id = p_place_id;

    IF v_place.place_id IS NULL THEN
        RETURN QUERY SELECT FALSE, ARRAY['place_not_found']::TEXT[];
        RETURN;
    END IF;

    -- Get activity threshold from config
    v_activity_threshold := trapper.get_match_config('place', 'significance_activity_threshold', 30);

    -- Calculate activity score
    v_activity_score := trapper.calculate_place_activity_score(p_place_id);

    -- Rule 1: Non-residential types are significant
    IF v_place.place_kind IN ('clinic', 'business', 'outdoor_site') THEN
        v_reasons := array_append(v_reasons, 'place_kind:' || v_place.place_kind::TEXT);
    END IF;

    -- Rule 2: High activity places are significant
    IF v_activity_score >= v_activity_threshold THEN
        v_reasons := array_append(v_reasons, 'activity_score:' || v_activity_score::TEXT);
    END IF;

    -- Rule 3: Already confirmed type = significant
    IF v_place.confirmed_type IS NOT NULL THEN
        v_reasons := array_append(v_reasons, 'confirmed_type:' || v_place.confirmed_type::TEXT);
    END IF;

    -- Rule 4: Trapping activity flag
    IF v_place.has_trapping_activity THEN
        v_reasons := array_append(v_reasons, 'has_trapping_activity');
    END IF;

    -- Rule 5: Cat activity flag
    IF v_place.has_cat_activity THEN
        v_reasons := array_append(v_reasons, 'has_cat_activity');
    END IF;

    -- Significant if any reasons found
    RETURN QUERY SELECT (array_length(v_reasons, 1) > 0), v_reasons;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.infer_place_significance IS
'Infers whether a place should be marked significant based on:
- Place kind (clinics, businesses, outdoor sites)
- Activity score above threshold
- Confirmed type
- Trapping or cat activity flags
Returns suggested significance and array of reasons.';

-- ============================================
-- PART 6: Batch update significance and activity scores
-- ============================================
\echo ''
\echo 'Creating update_place_significance function...'

CREATE OR REPLACE FUNCTION trapper.update_place_significance(
    p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    places_updated INT,
    places_made_significant INT,
    places_made_not_significant INT
) AS $$
DECLARE
    v_updated INT := 0;
    v_made_significant INT := 0;
    v_made_not_significant INT := 0;
    rec RECORD;
    v_inferred RECORD;
BEGIN
    FOR rec IN SELECT place_id FROM trapper.places
    LOOP
        SELECT * INTO v_inferred FROM trapper.infer_place_significance(rec.place_id);

        IF NOT p_dry_run THEN
            -- Update activity score
            UPDATE trapper.places
            SET activity_score = trapper.calculate_place_activity_score(rec.place_id)
            WHERE place_id = rec.place_id;

            -- Update significance if inference differs from current
            IF v_inferred.should_be_significant AND NOT COALESCE(
                (SELECT is_significant FROM trapper.places WHERE place_id = rec.place_id), FALSE
            ) THEN
                UPDATE trapper.places
                SET is_significant = TRUE,
                    significance_reason = array_to_string(v_inferred.reasons, ', ')
                WHERE place_id = rec.place_id;
                v_made_significant := v_made_significant + 1;
            END IF;

            -- Note: We don't automatically un-mark significant places
            -- That requires manual review

            v_updated := v_updated + 1;
        ELSE
            -- Dry run: just count
            IF v_inferred.should_be_significant THEN
                v_made_significant := v_made_significant + 1;
            END IF;
            v_updated := v_updated + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_updated, v_made_significant, v_made_not_significant;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_place_significance IS
'Batch updates place activity scores and significance.
Use p_dry_run=TRUE to preview changes without applying them.
Note: Does not automatically un-mark significant places (requires manual review).';

-- ============================================
-- PART 7: Config for place significance
-- ============================================
\echo ''
\echo 'Adding place significance config...'

INSERT INTO trapper.entity_match_config
    (entity_type, config_key, config_value, description)
VALUES
    ('place', 'significance_activity_threshold', 30, 'Activity score threshold for auto-marking significant'),
    ('place', 'significance_trapping_count', 3, 'Number of trapping requests to auto-mark significant'),
    ('place', 'significance_cat_count', 5, 'Number of cats to auto-mark significant')
ON CONFLICT (entity_type, config_key) DO UPDATE
SET
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================
-- PART 8: View for place significance review
-- ============================================
\echo ''
\echo 'Creating v_place_significance_candidates view...'

CREATE OR REPLACE VIEW trapper.v_place_significance_candidates AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    p.effective_type,
    p.is_significant,
    p.significance_reason,
    p.activity_score,
    p.has_trapping_activity,
    p.has_cat_activity,
    p.last_activity_at,
    (SELECT s.should_be_significant FROM trapper.infer_place_significance(p.place_id) s) AS inferred_significant,
    (SELECT s.reasons FROM trapper.infer_place_significance(p.place_id) s) AS inferred_reasons
FROM trapper.places p
WHERE p.is_significant IS NOT TRUE  -- Only non-significant places
ORDER BY p.activity_score DESC NULLS LAST, p.last_activity_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_place_significance_candidates IS
'Places that might need to be marked significant.
Shows inference results alongside current status for review.';

-- ============================================
-- PART 9: Run initial significance update
-- ============================================
\echo ''
\echo 'Running initial significance update...'

SELECT * FROM trapper.update_place_significance(FALSE);

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_034 Complete'
\echo '============================================'

\echo ''
\echo 'Place significance summary:'
SELECT
    place_kind,
    is_significant,
    COUNT(*) AS count,
    AVG(activity_score) AS avg_activity_score
FROM trapper.places
GROUP BY place_kind, is_significant
ORDER BY place_kind, is_significant;

\echo ''
\echo 'Places needing significance review:'
SELECT place_id, display_name, activity_score, inferred_significant, inferred_reasons
FROM trapper.v_place_significance_candidates
WHERE inferred_significant = TRUE
LIMIT 10;

\echo ''
\echo 'To mark a place as significant:'
\echo ''
\echo '  UPDATE trapper.places'
\echo '  SET is_significant = TRUE,'
\echo '      significance_reason = ''Known colony site'''
\echo '  WHERE place_id = ''<place_id>'';'
\echo ''
