# Plan: Robust Contact Info Change Handling in Data Engine

## Problem Statement

When a person moves and changes their phone number but keeps the same email, Atlas currently:
- Scores them at ~0.65 (email 40% + name 25%)
- Creates a **new person record** flagged for review
- Does NOT recognize them as the same person

**Real example:** Mirna Chavez → Myrna Chavez
- Same email: `gise0831@yahoo.com` ✓
- Different phone: old → new
- Different address: moved
- Name typo: Mirna ≈ Myrna (similarity ~0.85)

**Current behavior:** Creates duplicate, needs manual merge
**Desired behavior:** Auto-match, add new phone/address as additional identifiers

---

## Industry Standards (MDM/DAMA Best Practices)

1. **Email is the strongest identifier** - People keep personal emails for years
2. **Same email + similar name = same person** with updated contact info
3. **Same email + different name = household member** (couples sharing email)
4. **Version contact info** - Don't replace, add as new with timestamps
5. **Audit trail** - Log all decisions with reasoning

---

## Solution Design

### Core Principle: Two-Tier Email Matching

| Scenario | Email | Name Similarity | Decision |
|----------|-------|-----------------|----------|
| Same person, updated info | Match | ≥ 0.6 | **AUTO_MATCH** + add new identifiers |
| Household member (couple) | Match | < 0.5 | **HOUSEHOLD_MEMBER** |
| Ambiguous | Match | 0.5-0.6 | **REVIEW_PENDING** |

### Name Penalty System for Couples

When email matches but names are clearly different (e.g., Bob vs Jane sharing `bobjane@gmail.com`):

```
name_similarity < 0.5 → Apply 50% penalty to email contribution
                      → Flag as household candidate
                      → Create separate person, link to household
```

This prevents auto-merging couples who share an email address.

---

## Decision Flow (Updated)

```
Input: email, phone, first_name, last_name, address
                    ↓
         Normalize inputs
                    ↓
    ┌─ Exact email match found?
    │
    ├─ YES → Calculate name_similarity with existing person
    │         │
    │         ├─ name_sim >= 0.6 → CONTACT_INFO_UPDATE
    │         │   • Return existing person_id
    │         │   • Add new phone to identifiers (keep old)
    │         │   • Link to new address (keep old link)
    │         │   • Log: "Same person, updated contact info"
    │         │
    │         ├─ name_sim 0.5-0.6 → REVIEW_PENDING
    │         │   • Create new person
    │         │   • Flag for human review
    │         │   • Log: "Email match but ambiguous name"
    │         │
    │         └─ name_sim < 0.5 → HOUSEHOLD_MEMBER
    │             • Create new person
    │             • Add to household at address
    │             • Log: "Different person sharing email (couple/family)"
    │
    └─ NO → Continue with standard weighted scoring
             (phone, name, address - existing logic)
```

---

## Implementation Plan

### Migration: `MIG_564__contact_info_update_matching.sql`

#### Step 1: Add `is_primary` Column to person_identifiers

Track which phone/email is current vs historical:

```sql
ALTER TABLE trapper.person_identifiers
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN trapper.person_identifiers.is_primary IS
'TRUE for current/preferred contact method, FALSE for historical';
```

#### Step 2: Create Helper Function for Adding Identifiers

```sql
CREATE OR REPLACE FUNCTION trapper.add_person_identifier(
    p_person_id UUID,
    p_id_type TEXT,
    p_id_value TEXT,
    p_source_system TEXT,
    p_make_primary BOOLEAN DEFAULT TRUE
) RETURNS UUID
-- Adds identifier, optionally demotes existing to non-primary
-- Returns identifier_id
```

#### Step 3: Update `data_engine_resolve_identity`

Add new logic block at the START of candidate evaluation:

```sql
-- SPECIAL CASE: Exact email match
IF v_email_norm IS NOT NULL THEN
    SELECT p.person_id, p.first_name, p.last_name
    INTO v_email_match
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = v_email_norm
      AND p.merged_into_person_id IS NULL
    LIMIT 1;

    IF v_email_match IS NOT NULL THEN
        -- Calculate name similarity
        v_name_sim := trapper.name_similarity(
            p_first_name || ' ' || p_last_name,
            v_email_match.first_name || ' ' || v_email_match.last_name
        );

        IF v_name_sim >= 0.6 THEN
            -- CONTACT_INFO_UPDATE: Same person with updated info
            -- Add new phone if different
            IF v_phone_norm IS NOT NULL THEN
                PERFORM trapper.add_person_identifier(
                    v_email_match.person_id, 'phone', p_phone, p_source_system, TRUE
                );
            END IF;

            -- Link to new address
            IF p_address IS NOT NULL THEN
                v_place_id := trapper.find_or_create_place_deduped(p_address, ...);
                INSERT INTO trapper.person_place_relationships (...)
                ON CONFLICT DO NOTHING;
            END IF;

            -- Log decision
            INSERT INTO trapper.data_engine_match_decisions (...)
            VALUES (..., 'contact_info_update', 'Same person - email match with similar name');

            RETURN (v_email_match.person_id, 'contact_info_update', ...);

        ELSIF v_name_sim < 0.5 THEN
            -- HOUSEHOLD_MEMBER: Different person sharing email
            -- Continue to create new person but flag as household
            v_is_household_candidate := TRUE;
            v_household_reason := 'shared_email_different_name';
            -- Fall through to standard flow...
        ELSE
            -- AMBIGUOUS: Review needed
            -- Fall through but flag for review...
        END IF;
    END IF;
END IF;

-- Continue with standard weighted scoring for non-email-match cases...
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `sql/schema/sot/MIG_564__contact_info_update_matching.sql` | New migration (all changes) |

The migration will use `CREATE OR REPLACE FUNCTION` to update `data_engine_resolve_identity`, preserving the existing function signature.

---

## Verification Plan

### Test Case 1: Same Person, Updated Info (Mirna → Myrna)
```sql
-- Setup: Mirna Chavez exists with old phone/address
INSERT INTO trapper.sot_people (first_name, last_name, ...)
VALUES ('Mirna', 'Chavez', ...);
INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_norm)
VALUES (..., 'email', 'gise0831@yahoo.com');

-- Test: Same email, similar name (Myrna), new phone, new address
SELECT * FROM trapper.data_engine_resolve_identity(
    'gise0831@yahoo.com',  -- Same email
    '707-206-1094',        -- New phone
    'Myrna', 'Chavez',     -- Similar name
    '3328 Santa Rosa, CA 95407',
    'clinichq'
);

-- Expected:
-- decision_type = 'contact_info_update'
-- person_id = existing Mirna's ID
-- New phone added to person_identifiers
-- New address linked
```

### Test Case 2: Household Member (Couple Sharing Email)
```sql
-- Setup: Bob Smith exists with shared email
-- Test: Same email, clearly different name (Jane Smith)
-- Expected:
-- decision_type = 'household_member'
-- New person created for Jane
-- Linked to same household
```

### Test Case 3: Ambiguous Case
```sql
-- Setup: Mike Johnson exists
-- Test: Same email, ambiguous name "M. Johnson" (similarity ~0.55)
-- Expected:
-- decision_type = 'review_pending'
-- New person created, flagged for review
```

### Manual Verification Steps
1. Run migration on staging database
2. Test with real Mirna/Myrna data
3. Check `data_engine_match_decisions` for correct `decision_type`
4. Verify old phone preserved in `person_identifiers` with `is_primary=FALSE`
5. Verify new phone has `is_primary=TRUE`
6. Verify both addresses linked in `person_place_relationships`

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Over-merging distinct people | Name similarity threshold (0.6) prevents merging different people |
| Under-merging same person | 0.6 threshold catches typos, nicknames (Mirna↔Myrna, Bob↔Robert) |
| Breaking existing matches | New logic only activates for email matches; other paths unchanged |
| Data loss | Never delete old identifiers; add new ones alongside |
| Couples incorrectly merged | Name penalty (<0.5 similarity) routes to household, not merge |

---

## Summary

This plan adds **intelligent email-based matching** that:

1. ✅ **Recognizes returning people** who moved/changed phones (same email + similar name)
2. ✅ **Preserves contact history** by adding new identifiers without deleting old ones
3. ✅ **Handles couples/families** sharing email via name penalty system
4. ✅ **Maintains audit trail** with new `contact_info_update` decision type
5. ✅ **Follows MDM best practices** for identity resolution and golden record management
