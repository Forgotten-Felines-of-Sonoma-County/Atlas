-- HOTFIX: Fix create_person_from_intake source_system reference
-- Date: 2026-01-18
-- Problem: Function references v_sub.source_system but web_intake_submissions
--          table doesn't have that column
-- Run with: psql "$DATABASE_URL" -f sql/hotfixes/HOTFIX_2026_01_18__fix_intake_person_source_system.sql

\echo 'Applying hotfix: fix create_person_from_intake source_system reference'

CREATE OR REPLACE FUNCTION trapper.create_person_from_intake(p_submission_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_person_id UUID;
BEGIN
  -- Get the submission
  SELECT * INTO v_sub FROM trapper.web_intake_submissions WHERE submission_id = p_submission_id;

  IF v_sub IS NULL THEN
    RAISE NOTICE 'Submission not found: %', p_submission_id;
    RETURN NULL;
  END IF;

  -- If already matched to a person, return that
  IF v_sub.matched_person_id IS NOT NULL THEN
    RETURN v_sub.matched_person_id;
  END IF;

  -- Use the centralized find_or_create_person function
  v_person_id := trapper.find_or_create_person(
    p_email := v_sub.email,
    p_phone := v_sub.phone,
    p_first_name := v_sub.first_name,
    p_last_name := v_sub.last_name,
    p_address := NULL,
    p_source_system := 'web_intake'  -- Fixed: don't reference non-existent column
  );

  -- Update submission with the person
  IF v_person_id IS NOT NULL THEN
    UPDATE trapper.web_intake_submissions
    SET matched_person_id = v_person_id
    WHERE submission_id = p_submission_id;

    RAISE NOTICE 'Linked person % to submission %', v_person_id, p_submission_id;
  END IF;

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

\echo 'Hotfix applied successfully'
