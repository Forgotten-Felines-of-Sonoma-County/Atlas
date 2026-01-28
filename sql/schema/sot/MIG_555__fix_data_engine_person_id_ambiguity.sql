\echo '=== MIG_555: Fix person_id ambiguity in data_engine_resolve_identity ==='

-- The function RETURNS TABLE(person_id uuid, ...) which conflicts with
-- column references in ON CONFLICT clauses. Fix by using table-qualified names.

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'unknown',
    p_staged_record_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL
)
RETURNS TABLE(person_id uuid, decision_type text, confidence_score numeric, household_id uuid, decision_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_first_clean TEXT;
    v_last_clean TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_decision_type TEXT;
    v_decision_reason TEXT;
    v_new_person_id UUID;
    v_household_id UUID;
    v_decision_id UUID;
    v_start_time TIMESTAMPTZ;
    v_email_match RECORD;
    v_name_similarity NUMERIC;
    v_min_name_similarity CONSTANT NUMERIC := 0.3;
BEGIN
    v_start_time := clock_timestamp();
    v_email_norm := trapper.norm_email(p_email);
    v_phone_norm := trapper.norm_phone_us(p_phone);
    v_first_clean := trapper.clean_person_name(p_first_name);
    v_last_clean := trapper.clean_person_name(p_last_name);
    v_display_name := TRIM(CONCAT_WS(' ', NULLIF(v_first_clean, ''), NULLIF(v_last_clean, '')));
    v_address_norm := trapper.normalize_address(COALESCE(p_address, ''));

    -- Reject internal accounts
    IF trapper.is_internal_account(v_display_name) THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'Internal account detected';
        INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, processing_job_id, processing_duration_ms)
        VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 0, v_decision_type, v_decision_reason, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT)
        RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;
        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Reject if no identifiers
    IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
        v_decision_type := 'rejected';
        v_decision_reason := 'No email or phone provided';
        INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, processing_job_id, processing_duration_ms)
        VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 0, v_decision_type, v_decision_reason, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT)
        RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;
        RETURN QUERY SELECT NULL::UUID, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
        RETURN;
    END IF;

    -- Try email match first
    IF v_email_norm IS NOT NULL THEN
        SELECT p.person_id, p.display_name INTO v_email_match
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'email' AND pi.id_value_norm = v_email_norm AND p.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_email_match.person_id IS NOT NULL THEN
            v_name_similarity := similarity(LOWER(COALESCE(v_display_name, '')), LOWER(COALESCE(v_email_match.display_name, '')));

            -- Different names with same email -> review needed
            IF v_name_similarity < v_min_name_similarity
               AND NOT trapper.is_garbage_name(v_display_name)
               AND NOT trapper.is_garbage_name(v_email_match.display_name)
               AND v_display_name IS NOT NULL AND v_display_name != ''
               AND v_email_match.display_name IS NOT NULL AND v_email_match.display_name != 'Unknown' THEN

                v_decision_type := 'review_pending';
                v_decision_reason := 'Email match but names differ: "' || v_display_name || '" vs "' || v_email_match.display_name || '"';

                INSERT INTO trapper.sot_people (display_name, primary_email, primary_phone, data_source)
                VALUES (v_display_name, v_email_norm, v_phone_norm, p_source_system::trapper.data_source)
                RETURNING sot_people.person_id INTO v_new_person_id;

                IF v_phone_norm IS NOT NULL THEN
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                    VALUES (v_new_person_id, 'phone', v_phone_norm, v_phone_norm, p_source_system)
                    ON CONFLICT DO NOTHING;
                END IF;

                INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, resulting_person_id, top_candidate_person_id, top_candidate_score, processing_job_id, processing_duration_ms, review_status)
                VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 1, v_decision_type, v_decision_reason, v_new_person_id, v_email_match.person_id, v_name_similarity, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT, 'pending')
                RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                RETURN QUERY SELECT v_new_person_id, v_decision_type, v_name_similarity, NULL::UUID, v_decision_id;
                RETURN;
            END IF;

            -- Exact email match
            v_decision_type := 'auto_match';
            v_decision_reason := 'Exact email match';

            -- Update garbage name if we have better data
            IF trapper.is_garbage_name(v_email_match.display_name) AND NOT trapper.is_garbage_name(v_display_name) AND v_display_name IS NOT NULL AND v_display_name != '' THEN
                UPDATE trapper.sot_people SET display_name = v_display_name, updated_at = NOW()
                WHERE sot_people.person_id = v_email_match.person_id;
            END IF;

            -- Add phone if provided
            IF v_phone_norm IS NOT NULL THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                VALUES (v_email_match.person_id, 'phone', v_phone_norm, v_phone_norm, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;

            INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, resulting_person_id, top_candidate_score, processing_job_id, processing_duration_ms)
            VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 1, v_decision_type, v_decision_reason, v_email_match.person_id, 1.0, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT)
            RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_email_match.person_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    END IF;

    -- Try phone match
    IF v_phone_norm IS NOT NULL THEN
        SELECT p.person_id, p.display_name INTO v_email_match
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people p ON p.person_id = pi.person_id
        WHERE pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm AND p.merged_into_person_id IS NULL
        LIMIT 1;

        IF v_email_match.person_id IS NOT NULL THEN
            v_name_similarity := similarity(LOWER(COALESCE(v_display_name, '')), LOWER(COALESCE(v_email_match.display_name, '')));

            -- Different names with same phone -> household member
            IF v_name_similarity < v_min_name_similarity
               AND NOT trapper.is_garbage_name(v_display_name)
               AND NOT trapper.is_garbage_name(v_email_match.display_name)
               AND v_display_name IS NOT NULL AND v_display_name != ''
               AND v_email_match.display_name IS NOT NULL AND v_email_match.display_name != 'Unknown' THEN

                v_decision_type := 'household_member';
                v_decision_reason := 'Phone match but different names - likely household';

                INSERT INTO trapper.sot_people (display_name, primary_email, primary_phone, data_source)
                VALUES (v_display_name, v_email_norm, v_phone_norm, p_source_system::trapper.data_source)
                RETURNING sot_people.person_id INTO v_new_person_id;

                IF v_email_norm IS NOT NULL THEN
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                    VALUES (v_new_person_id, 'email', v_email_norm, v_email_norm, p_source_system)
                    ON CONFLICT DO NOTHING;
                END IF;
                IF v_phone_norm IS NOT NULL THEN
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                    VALUES (v_new_person_id, 'phone', v_phone_norm, v_phone_norm, p_source_system)
                    ON CONFLICT DO NOTHING;
                END IF;

                INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, resulting_person_id, top_candidate_person_id, top_candidate_score, processing_job_id, processing_duration_ms)
                VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 1, v_decision_type, v_decision_reason, v_new_person_id, v_email_match.person_id, v_name_similarity, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT)
                RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

                RETURN QUERY SELECT v_new_person_id, v_decision_type, v_name_similarity, NULL::UUID, v_decision_id;
                RETURN;
            END IF;

            -- Exact phone match
            v_decision_type := 'auto_match';
            v_decision_reason := 'Exact phone match';

            -- Update garbage name if we have better data
            IF trapper.is_garbage_name(v_email_match.display_name) AND NOT trapper.is_garbage_name(v_display_name) AND v_display_name IS NOT NULL AND v_display_name != '' THEN
                UPDATE trapper.sot_people SET display_name = v_display_name, updated_at = NOW()
                WHERE sot_people.person_id = v_email_match.person_id;
            END IF;

            -- Add email if provided
            IF v_email_norm IS NOT NULL THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
                VALUES (v_email_match.person_id, 'email', v_email_norm, v_email_norm, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;

            INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, resulting_person_id, top_candidate_score, processing_job_id, processing_duration_ms)
            VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 1, v_decision_type, v_decision_reason, v_email_match.person_id, 1.0, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT)
            RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

            RETURN QUERY SELECT v_email_match.person_id, v_decision_type, 1.0::NUMERIC, NULL::UUID, v_decision_id;
            RETURN;
        END IF;
    END IF;

    -- No match found - create new person
    v_decision_type := 'new_entity';
    v_decision_reason := 'No matching email or phone';

    INSERT INTO trapper.sot_people (display_name, primary_email, primary_phone, data_source)
    VALUES (COALESCE(NULLIF(v_display_name, ''), 'Unknown'), v_email_norm, v_phone_norm, p_source_system::trapper.data_source)
    RETURNING sot_people.person_id INTO v_new_person_id;

    IF v_email_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
        VALUES (v_new_person_id, 'email', v_email_norm, v_email_norm, p_source_system)
        ON CONFLICT DO NOTHING;
    END IF;
    IF v_phone_norm IS NOT NULL THEN
        INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm, id_value_raw, source_system)
        VALUES (v_new_person_id, 'phone', v_phone_norm, v_phone_norm, p_source_system)
        ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO trapper.data_engine_match_decisions (staged_record_id, source_system, incoming_email, incoming_phone, incoming_name, incoming_address, candidates_evaluated, decision_type, decision_reason, resulting_person_id, top_candidate_score, processing_job_id, processing_duration_ms)
    VALUES (p_staged_record_id, p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm, 0, v_decision_type, v_decision_reason, v_new_person_id, 0, p_job_id, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::INT)
    RETURNING data_engine_match_decisions.decision_id INTO v_decision_id;

    RETURN QUERY SELECT v_new_person_id, v_decision_type, 0::NUMERIC, NULL::UUID, v_decision_id;
END;
$$;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity IS 'Identity resolution with fixed person_id column ambiguity (MIG_555)';

\echo '=== MIG_555 complete ==='
