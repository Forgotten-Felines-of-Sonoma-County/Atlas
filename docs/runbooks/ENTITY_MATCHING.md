# Entity Matching Runbook

## Overview

Atlas uses a multi-stage entity resolution system to coalesce messy data inputs into canonical entities. This runbook explains how matching works and how to tune it safely.

## Key Concepts

### Address vs Place

| Concept | Definition | Example |
|---------|------------|---------|
| **Address** (`sot_addresses`) | A geocoded physical location with Google Place ID | "123 Main St, Unit 4, Santa Rosa, CA 95401" |
| **Place** (`places`) | A meaningful location with type and significance | "FFSC Clinic" or "Main St Colony" |

**Key points:**
- Every place is backed by an address (1:1 relationship)
- Not every address needs to be a "significant place" in UI/search
- Use `is_significant = TRUE` for places that should appear prominently (businesses, colonies, clinics)
- Residential addresses from form submissions are created as places but marked `is_significant = FALSE`

### Significant Places

Places are marked significant based on:
1. **Place kind**: clinic, business, outdoor_site → auto-significant
2. **Activity score**: High trapping/appointment activity → auto-significant
3. **Manual override**: Confirmed by user → significant

```sql
-- Mark a place as significant manually
UPDATE trapper.places
SET is_significant = TRUE,
    significance_reason = 'Known colony site'
WHERE place_id = '<uuid>';

-- View places that might need to be marked significant
SELECT * FROM trapper.v_place_significance_candidates LIMIT 20;
```

## Match Thresholds

All thresholds are configurable via `entity_match_config`:

```sql
-- View current configuration
SELECT entity_type, config_key, config_value, description
FROM trapper.entity_match_config
ORDER BY entity_type, config_key;

-- Adjust a threshold
UPDATE trapper.entity_match_config
SET config_value = 0.90
WHERE entity_type = 'person' AND config_key = 'auto_merge_threshold';
```

### Person Matching Thresholds

| Config Key | Default | Description |
|------------|---------|-------------|
| `auto_merge_threshold` | 0.97 | Minimum score for automatic merge |
| `review_threshold` | 0.75 | Minimum score to create review candidate |
| `name_similarity_min` | 0.75 | Minimum trigram similarity for candidate |
| `weight_phone_match` | 1.0 | Score weight for shared phone (deterministic) |
| `weight_email_match` | 0.9 | Score weight for shared email (deterministic) |
| `weight_name_similarity` | 0.3 | Score weight for name similarity |
| `weight_shared_address` | 0.2 | Score weight for shared address context |
| `weight_shared_cat` | 0.1 | Score weight for shared cat ownership |

### Cat Matching Thresholds

| Config Key | Default | Description |
|------------|---------|-------------|
| `enable_auto_merge` | 0 | **CONSERVATIVE: Keep at 0** |
| `auto_merge_min_score` | 0.95 | Minimum score for auto-merge (if enabled) |
| `candidate_min_score` | 0.40 | Minimum score to create review candidate |
| `weight_microchip` | 1.0 | Score weight for microchip match (deterministic) |
| `weight_sex_match` | 0.15 | Score weight for sex match |
| `weight_color_match` | 0.15 | Score weight for color match |
| `weight_name_similarity` | 0.15 | Score weight for name (low - cat names not unique) |
| `weight_shared_owner` | 0.20 | Score weight for shared owner |
| `weight_shared_place` | 0.15 | Score weight for shared place |

## Generating Match Candidates

### Unified Interface

```sql
-- Generate person match candidates
SELECT trapper.generate_match_candidates('person');

-- Generate cat match candidates
SELECT trapper.generate_match_candidates('cat');

-- With custom minimum score
SELECT trapper.generate_match_candidates('person', 0.6);
```

### Entity-Specific Functions

```sql
-- Person: Uses phonetic matching (metaphone) + context
SELECT * FROM trapper.generate_phonetic_match_candidates(0.5);

-- Cat: Uses physical attributes + context
SELECT * FROM trapper.generate_cat_match_candidates(0.4);
```

## Review Workflow

### View Review Queue

```sql
-- Unified queue (all entity types)
SELECT * FROM trapper.v_match_review_queue LIMIT 20;

-- Queue summary
SELECT * FROM trapper.v_review_queue_summary;

-- Person-specific review (with full scoring breakdown)
SELECT * FROM trapper.v_person_match_review LIMIT 20;

-- Cat-specific review
SELECT * FROM trapper.v_cat_match_review LIMIT 20;
```

### Accept/Reject Matches

```sql
-- Accept a person match (triggers merge)
SELECT trapper.accept_match_candidate('person', '<candidate_id>');

-- Reject a person match (blocks future auto-match)
SELECT trapper.reject_match_candidate('person', '<candidate_id>', 'reviewer', 'Different people');

-- Accept a cat match (marks for manual merge - no auto-merge)
SELECT trapper.accept_match_candidate('cat', '<candidate_id>');

-- Reject a cat match
SELECT trapper.reject_match_candidate('cat', '<candidate_id>', 'reviewer', 'Different cats - different owners');
```

## Understanding Match Scores

### Person Match Score Breakdown

```sql
-- Get detailed score breakdown for a candidate
SELECT trapper.score_person_match_candidate(
    '<person_id_1>',
    '<person_id_2>'
);
```

Returns JSON with:
- `score`: Overall score (0-1)
- `reasons`: Array of contributing factors
- `breakdown`: Detailed weights and values
- `person_1`, `person_2`: Entity details

### Example Score Analysis

```json
{
  "score": 0.600,
  "reasons": ["first_phonetic:SSN", "last_phonetic:SM0", "trigram:0.44"],
  "breakdown": {
    "name_similarity": 0.18,
    "name_details": {
      "score": 0.600,
      "reasons": ["first_phonetic:SSN", "last_phonetic:SM0", "trigram:0.44"],
      "name1_enc": "SSN-SM0",
      "name2_enc": "SSN-SM0"
    }
  }
}
```

Translation:
- `first_phonetic:SSN` = First names have same phonetic encoding
- `last_phonetic:SM0` = Last names have same phonetic encoding
- `trigram:0.44` = 44% trigram similarity

## Phonetic Matching (People)

Atlas uses **double metaphone** for phonetic matching, which handles:
- Susan / Susana / Suzan → SSN
- Smith / Smyth / Smithe → SM0
- John / Jon / Johann → JN

```sql
-- Test phonetic similarity between names
SELECT trapper.phonetic_name_similarity('Susan Smith', 'Susana Smyth');

-- Get phonetic encoding
SELECT * FROM trapper.encode_name_phonetic('Susan Smith');
-- Returns: first_token='susan', last_token='smith',
--          metaphone_first='SSN', metaphone_last='SM0'
```

## Cat Matching (Conservative)

Cat matching is **review-queue only** by default. No automatic merges.

### Why Conservative?

1. Cat names are not unique ("Fluffy", "Tiger" are common)
2. Physical descriptions can be imprecise
3. Wrong merges are harder to undo than people
4. Microchip is the only reliable deterministic key

### Matching Signals

| Signal | Weight | Notes |
|--------|--------|-------|
| Same microchip | 1.0 | **Deterministic** - should already be merged |
| Different microchip | 0 | **Definite different cats** |
| Same sex | +0.15 | Important - cats don't change sex |
| Different sex | -0.30 | Strong negative signal |
| Same color | +0.15 | Helpful context |
| Different color | -0.10 | Weak negative (could be lighting/description) |
| Similar name (≥0.9) | +0.15 | Low weight - names not unique |
| Shared owner | +0.20 | Strong contextual signal |
| Shared place | +0.15 | Contextual signal |

## ClinicHQ People Pipeline

ClinicHQ owner data is extracted into canonical people through a multi-step pipeline.

### One-Command Population

```bash
# Set environment and run
set -a && source .env && set +a
./scripts/populate_clinichq_people.sh

# Preview mode (no changes)
./scripts/populate_clinichq_people.sh --dry-run

# Skip stuck run repair
./scripts/populate_clinichq_people.sh --no-repair
```

### SQL-Only Population

```sql
-- Preview what would happen
SELECT trapper.populate_clinichq_people(TRUE, TRUE);

-- Actually populate
SELECT trapper.populate_clinichq_people();

-- Or step-by-step:
-- 1. Repair stuck runs
SELECT * FROM trapper.repair_stuck_ingest_runs('clinichq', 30, FALSE);

-- 2. Check for completed run
SELECT trapper.get_latest_completed_run('clinichq', 'owner_info');

-- 3. Populate observations
SELECT trapper.populate_observations_for_latest_run('owner_info');

-- 4. Create canonical people
SELECT * FROM trapper.upsert_people_from_observations('owner_info');

-- 5. Populate aliases
SELECT trapper.populate_aliases_from_name_signals('owner_info');

-- 6. Update display names
SELECT trapper.update_all_person_display_names();
```

### Expected Counts

After a full ClinicHQ ingest:
- Staged records: ~8,500 owner_info rows
- Observations: ~33,000 (phone, email, name signals)
- Canonical people: ~1,900-2,000 unique people
- Aliases: ~8,700 name variants with phonetic codes

```sql
-- Verify counts
SELECT
    (SELECT COUNT(*) FROM trapper.staged_records
     WHERE source_system = 'clinichq' AND source_table = 'owner_info') AS staged,
    (SELECT COUNT(*) FROM trapper.observations
     WHERE source_system = 'clinichq') AS observations,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.person_aliases
     WHERE source_system = 'clinichq') AS people;
```

## Stuck Ingest Runs

Ingest runs can get stuck in "running" state due to script crashes or timeouts.

### Detecting Stuck Runs

```sql
-- View all stuck runs (running > 30 minutes)
SELECT * FROM trapper.v_stuck_ingest_runs;

-- Check specific source
SELECT * FROM trapper.v_stuck_ingest_runs
WHERE source_system = 'clinichq';
```

### Repairing Stuck Runs

```sql
-- Preview repairs (safe - no changes)
SELECT * FROM trapper.repair_stuck_ingest_runs('clinichq', 30, TRUE);

-- Actually repair (use with caution)
SELECT * FROM trapper.repair_stuck_ingest_runs('clinichq', 30, FALSE);

-- Repair all sources
SELECT * FROM trapper.repair_stuck_ingest_runs(NULL, 30, FALSE);
```

### Repair Logic

The repair function uses evidence-based decisions:

| Evidence | Action | Reason |
|----------|--------|--------|
| rows_linked > 0 OR rows_inserted > 0 | Mark `completed` | Data was processed |
| All rows marked suspect | Mark `completed` | Processed with issues |
| No data processed | Mark `failed` | Nothing happened |
| Unclear state | Mark `failed` | Conservative fallback |

All repairs are recorded in `trapper.ingest_run_repairs` for audit:

```sql
-- View repair history
SELECT repair_id, source_system, source_table,
       old_status, new_status, repair_reason, repaired_at
FROM trapper.ingest_run_repairs
ORDER BY repaired_at DESC;
```

## Phonetic Support

Atlas uses double metaphone for phonetic name matching. The implementation is portable across different PostgreSQL configurations.

### Verifying Phonetic Backend

```sql
-- Check backend status
SELECT trapper.phonetic_backend_status();

-- Returns:
-- {
--   "available": true,
--   "schema": "tiger",           -- or "public" or "extensions"
--   "mode": "enabled",
--   "test_dmetaphone": "TST",
--   "message": "Phonetic matching enabled via tiger schema."
-- }
```

### Phonetic Functions

```sql
-- Direct metaphone encoding
SELECT trapper.dmetaphone('Smith');    -- SM0
SELECT trapper.dmetaphone('Smyth');    -- SM0 (same!)

-- Soundex similarity (0-4, 4 = identical)
SELECT trapper.difference('Smith', 'Smyth');  -- 4

-- Full name similarity with breakdown
SELECT trapper.phonetic_name_similarity('Susan Smith', 'Susana Smyth');
```

### Graceful Degradation

If fuzzystrmatch extension is not installed, phonetic matching degrades gracefully:

- `trapper.dmetaphone()` returns NULL
- `trapper.difference()` returns 0
- Name matching still works using trigram similarity only
- Lower accuracy but no errors

```sql
-- Test degradation behavior
SELECT
    trapper.phonetic_backend_status()->>'available' AS phonetics_available,
    trapper.phonetic_name_similarity('John Smith', 'Jon Smyth')->>'phonetics_enabled' AS phonetics_in_matching;
```

### Installing Phonetic Support

If phonetics are unavailable and you want to enable them:

```sql
-- Check if extension is available
SELECT * FROM pg_available_extensions WHERE name = 'fuzzystrmatch';

-- Install (requires superuser)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Verify
SELECT trapper.phonetic_backend_status();
```

## Statistics and Monitoring

```sql
-- Overall entity resolution stats
SELECT * FROM trapper.v_entity_resolution_stats;

-- Address quality by precision level
SELECT * FROM trapper.v_address_quality;

-- Place significance distribution
SELECT is_significant, COUNT(*), AVG(activity_score)
FROM trapper.places
GROUP BY is_significant;
```

## Safe Tuning Guidelines

### DO:
- Start with conservative thresholds (high for auto-merge)
- Monitor false positive rate before lowering thresholds
- Use review queue for uncertain matches
- Keep cat auto-merge disabled until you have UI review

### DON'T:
- Lower `auto_merge_threshold` below 0.90 without testing
- Enable cat auto-merge without review UI
- Ignore conflicting identifiers (different phones/emails)
- Auto-merge without shared context (address/place)

## Troubleshooting

### "Why wasn't this person merged?"

```sql
-- Check if pair was blocked
SELECT trapper.is_pair_blocked('<person_1>', '<person_2>');

-- Check for conflicting identifiers
SELECT trapper.have_conflicting_identifiers('<person_1>', '<person_2>');

-- Check shared address context
SELECT trapper.have_shared_address_context('<person_1>', '<person_2>');

-- Get full score breakdown
SELECT trapper.score_person_match_candidate('<person_1>', '<person_2>');
```

### "Why is this cat a separate entry?"

```sql
-- Check if both have microchips
SELECT cat_id, id_type, id_value
FROM trapper.cat_identifiers
WHERE cat_id IN ('<cat_1>', '<cat_2>');

-- Score the potential match
SELECT trapper.score_cat_match_candidate('<cat_1>', '<cat_2>');
```

### "This place should be significant"

```sql
-- Check current status
SELECT place_id, display_name, is_significant, significance_reason, activity_score
FROM trapper.places
WHERE place_id = '<place_id>';

-- See inference result
SELECT * FROM trapper.infer_place_significance('<place_id>');

-- Mark it significant
UPDATE trapper.places
SET is_significant = TRUE,
    significance_reason = 'Known colony site - manual override'
WHERE place_id = '<place_id>';
```
