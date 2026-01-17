# Atlas Mission Contract

**Version:** 1.1
**Last Updated:** 2026-01-17
**Status:** Active

---

## Recent Updates (v1.1)

### Beacon Data Gaps - ADDRESSED

| Gap | Status | Migration |
|-----|--------|-----------|
| Kitten Birth Tracking | ✅ READY | MIG_289 - `cat_birth_events` table |
| Mortality Tracking | ✅ READY | MIG_290 - `cat_mortality_events` table |
| Seasonal Analysis | ✅ READY | MIG_291 - `v_seasonal_breeding_patterns` view |
| Vortex Parameters | ✅ READY | MIG_288 - Configurable ecology parameters |
| Data Verification | ✅ READY | MIG_293 - Beacon data verification |

### Operational Workflows - NEW

| Workflow | Status | Component |
|----------|--------|-----------|
| Trapper Onboarding | ✅ DESIGNED | MIG_298 - Full onboarding pipeline |
| Out-of-County Auto-Response | ✅ DESIGNED | MIG_299 - Email templates + tracking |
| Intake Queue Simplification | ✅ READY | MIG_294 - Unified status workflow |
| Entity Auto-Linking | ✅ READY | MIG_295 + cron endpoint |
| Centralized Request Creation | ✅ READY | MIG_297 - `find_or_create_request()` |

### Airtable Integration Analysis - COMPLETE

Comprehensive analysis of 3 Airtable bases completed:
- **Forgotten Felines Center Base** - 17,000+ lines, full workflow mapping
- **Atlas Sync Base** - JotForm integration patterns
- **Project 75** - Post-clinic survey structure

---

## Purpose Statement

Atlas is the **operational data collection and management layer** for Forgotten Felines of Sonoma County's (FFSC) TNR (Trap-Neuter-Return) program. Its primary mission is to collect, organize, and maintain the high-quality data that will power **Beacon** - FFSC's revolutionary predictive analytics system for strategic cat population management.

> "Data is useless if you can't make decisions with it. The power of Beacon is in allowing us to see patterns, forecast outcomes, and strategically target our resources."
> — Beacon Vision Statement

---

## Beacon Overview

### What is Beacon?

Beacon is a data-driven decision support system designed to transform FFSC from reactive TNR operations to **strategic population management**. Inspired by the Vortex simulation model (Boone et al. 2019), Beacon provides:

1. **TRACK** - Real-time visibility into colony populations across Sonoma County
2. **FORECAST** - Predictive modeling of population trends under different scenarios
3. **TARGET** - Strategic resource allocation to maximize population reduction

### Ground Truth Principle: FFSC Clinic Data

**FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.**

Other organizations may perform small quantities of TNR, but FFSC handles mass quantities (4,000+ cats/year). This means:

| Metric | Source | Reliability |
|--------|--------|-------------|
| Cats altered at a location | FFSC ClinicHQ data | **100% verified** |
| External alterations | Other orgs | **~2% (negligible)** |
| Ear-tipped cats observed | Trapper observations | Field estimate |
| Colony size | Surveys, intake forms | Variable confidence |

**Implication:** When calculating alteration rates:
```
Alteration Rate = FFSC_altered / Population_estimate
```
We do NOT need to guess at external alterations - FFSC clinic records ARE the ground truth.

### Scientific Foundation: Vortex Model (Boone et al. 2019)

The Beacon approach is grounded in peer-reviewed research on cat population dynamics.

#### Key Equations

**1. Chapman Mark-Recapture Estimator (Population Size)**
```
N̂ = ((M + 1)(C + 1) / (R + 1)) - 1

Where:
  N̂ = Estimated population
  M = Marked cats (FFSC verified alterations - ground truth)
  C = Total cats observed in sample
  R = Recaptured marked (ear-tipped cats observed)
```

**2. Alteration Rate**
```
p = A / N

Where:
  p = Alteration rate (proportion fixed)
  A = Cats altered by FFSC (verified clinic records)
  N = Estimated population
```

**3. Population Growth Model**
```
N(t+1) = N(t) + Births - Deaths + Immigration - Emigration

Births = F_intact × litters_per_year × kittens_per_litter × survival

Where:
  F_intact = Females × (1 - alteration_rate) × 0.5
  survival = density-dependent (25-50% based on population density)
```

**4. Density-Dependent Kitten Survival**
```
S_kitten = S_max - (S_max - S_min) × (N / K)

Where:
  S_max = 50% survival at low density
  S_min = 25% survival at high density
  N = Current population
  K = Carrying capacity
```

**5. Time to Colony Completion**
```
T = (N × (1 - p)) / (TNR_rate × capacity_per_cycle)

Where:
  T = Estimated 6-month cycles to completion
  N = Current population
  p = Current alteration rate
  TNR_rate = Target intensity (0.75 for high-intensity)
```

#### Configurable Parameters (Admin Panel)

All parameters are configurable via `/admin/ecology-config` with scientific defaults:

| Parameter | Default | Range | Source |
|-----------|---------|-------|--------|
| **Reproduction** ||||
| Litters/year | 1.8 | 1.0-3.0 | Boone 2019 |
| Kittens/litter | 4 | 2-6 | Veterinary literature |
| Breeding season | Feb-Nov | - | California climate |
| Female maturity | 6 mo | 4-12 | Veterinary consensus |
| Male maturity | 8 mo | 6-15 | Veterinary consensus |
| **Survival** ||||
| Kitten survival (low density) | 50% | 25-90% | Boone 2019 |
| Kitten survival (high density) | 25% | 10-50% | Boone 2019 |
| Adult survival (annual) | 70% | 50-90% | Boone 2019 |
| Cat lifespan | 15 yr | 5-20 | MIG_220 default |
| **TNR Intensity** ||||
| High-intensity threshold | 75% | 50-95% | Boone 2019 |
| Low-intensity threshold | 50% | 30-70% | Boone 2019 |
| Time step | 6 mo | 3-12 | Vortex model |
| **Immigration** ||||
| Low immigration rate | 0.5 cats/6mo | 0-2 | Boone 2019 |
| High immigration rate | 2.0 cats/6mo | 0.5-5 | Boone 2019 |
| Default rate | 1.0 cats/6mo | 0.5-2 | Midpoint |
| **FFSC-Specific** ||||
| FFSC is primary clinic | Yes | - | Operational reality |
| External alteration rate | 2% | 0-20% | Estimate |

**Critical Finding from Research:**
- High-intensity TNR (75% of intact cats per 6-month cycle) can reduce populations by 70% in 6 years
- Low-intensity TNR (50%) leads to minimal reduction
- Without immigration control, even 75% TNR only reduces by 50%

### What Beacon Needs from Atlas

**Core Data Requirements:**

| Requirement | Atlas Status | Tables/Views |
|-------------|--------------|--------------|
| Colony size estimates | ✅ READY | `place_colony_estimates`, `v_place_colony_status` |
| Alteration rates (% fixed) | ✅ READY | `v_place_ecology_stats` (Chapman estimator) |
| Cat movement tracking | ✅ READY | `cat_movement_events`, `v_cat_movement_patterns` |
| Geographic clustering | ✅ READY | `places` with PostGIS, `place_place_edges` |
| Time-series observations | ✅ READY | `place_colony_estimates.observation_date` |
| Kitten birth tracking | ✅ READY | `cat_birth_events` (MIG_289) |
| Mortality/death tracking | ✅ READY | `cat_mortality_events` (MIG_290) |
| Seasonal breeding patterns | ✅ READY | `v_seasonal_breeding_patterns` (MIG_291) |
| Mother-kitten relationships | ✅ READY | `cat_birth_events.mother_cat_id`, `litter_id` |
| Vortex model parameters | ✅ READY | `vortex_parameters` (MIG_288) |
| Immigration tracking | ⚠️ PARTIAL | Need `arrival_type` on relationships |

---

## Atlas Operational Workflows

Beyond Beacon data collection, Atlas manages FFSC's operational workflows:

### Intake Queue Management (MIG_294)

**Unified submission status workflow:**
```
new → in_progress → scheduled → complete
                 ↘ archived
```

**Features:**
- Single `submission_status` field (replacing 3+ legacy fields)
- Priority override with auto-triage score
- Communication log via journal system
- All submitted answers editable with audit trail

### Trapper Onboarding Pipeline (MIG_298)

**Status flow:**
```
interested → contacted → orientation_complete →
training_complete → contract_sent → contract_signed → approved
```

**Tables:**
- `trapper_onboarding` - Tracks pipeline progress with milestone dates
- `person_roles` - Final trapper status after approval

**Functions:**
- `create_trapper_interest()` - New interest with deduplication
- `advance_trapper_onboarding()` - Move through pipeline stages

### Out-of-County Automation (MIG_299)

**Automated response for non-Sonoma County requests:**
- `is_out_of_county` flag on submissions
- `email_templates` table for customizable messages
- `sent_emails` log for audit trail
- `v_pending_out_of_county_emails` view for queue

**Requires:** Email provider integration (Resend) - pending setup

### Entity Auto-Linking (MIG_295)

**Periodic cron job links:**
- Cats to places via appointment owner contact info
- Appointments to trappers via email/phone matching
- Intake submissions to places via geocoding
- Requesters to their places

**Cron endpoint:** `/api/cron/entity-linking` (runs daily at 7:30 AM)

### Centralized Request Creation (MIG_297)

**Function:** `find_or_create_request()`

All request creation must go through this function:
- Deduplicates by `source_system` + `source_record_id`
- Auto-creates places from raw addresses
- Auto-creates people from contact info
- Proper audit logging to `entity_edits`

---

## Atlas Architecture Principles

### Three-Layer Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                    RAW LAYER (Audit Trail)                   │
├─────────────────────────────────────────────────────────────┤
│  staged_records - Immutable record of all ingested data      │
│  ingest_runs - Track each sync operation                     │
│  entity_edits - All changes to canonical data                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  IDENTITY RESOLUTION LAYER                   │
├─────────────────────────────────────────────────────────────┤
│  person_identifiers - Email/phone matching                   │
│  cat_identifiers - Microchip matching                        │
│  potential_person_duplicates - Flagged for review            │
│  Centralized functions handle deduplication                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│               SOURCE OF TRUTH LAYER (sot_*)                  │
├─────────────────────────────────────────────────────────────┤
│  sot_people - All persons (requesters, trappers, owners)     │
│  sot_cats - All cats with unique identifiers                 │
│  sot_requests - All service requests                         │
│  sot_appointments - All clinic visits                        │
│  places - All geographic locations                           │
└─────────────────────────────────────────────────────────────┘
```

### Centralized Functions (MANDATORY)

**NEVER create entities directly. Always use these functions:**

| Entity | Function | Why |
|--------|----------|-----|
| Person | `find_or_create_person(email, phone, first, last, addr, source)` | Identity matching, deduplication, merge chain |
| Place | `find_or_create_place_deduped(address, name, lat, lng, source)` | Address normalization, geocoding queue |
| Cat | `find_or_create_cat_by_microchip(chip, name, sex, ...)` | Microchip is gold standard, enriches existing |
| Request | `find_or_create_request(source, record_id, ...)` (MIG_297) | Auto-creates people/places, audit trail |
| Trapper Interest | `create_trapper_interest(first, last, email, ...)` (MIG_298) | Uses find_or_create_person, creates onboarding |

### Source System Values

Use **exactly** these values for `source_system`:
- `'airtable'` - All Airtable data (legacy, not 'airtable_staff' or variants)
- `'clinichq'` - All ClinicHQ clinic data
- `'web_intake'` - Web intake form submissions
- `'atlas_ui'` - Manual staff entry via Atlas UI

---

## Current Capabilities for Beacon

### Colony Size Estimation (READY)

**Table:** `trapper.place_colony_estimates`

Multiple data sources feed colony estimates with weighted confidence:

| Source Type | Base Confidence | Description |
|-------------|-----------------|-------------|
| `verified_cats` | 100% | Ground truth from clinic records |
| `post_clinic_survey` | 85% | Project 75 post-clinic surveys |
| `trapper_site_visit` | 80% | Trapper field observations |
| `trapping_request` | 60% | Request-based estimates |
| `intake_form` | 55% | Intake form self-reports |
| `internal_notes_parse` | 40% | Extracted from notes |
| `legacy_mymaps` | 50% | Historical KML data |

**View:** `v_place_colony_status` aggregates with recency-weighted confidence.

### Alteration Rate Calculation (READY)

**View:** `v_place_ecology_stats`

Implements Chapman mark-recapture estimator:
```
N̂ = ((M+1)(C+1)/(R+1)) - 1

Where:
  M = Marked cats (altered at clinic - verified ground truth)
  C = Total cats observed at site
  R = Ear-tipped cats observed at site
```

Provides:
- `a_known` - Verified altered cats (from clinic data)
- `n_hat_chapman` - Population estimate when observation data available
- `p_hat_chapman_pct` - Alteration percentage
- `estimated_work_remaining` - Cats still needing TNR

**Critical Gap:** Only 422 places have observation data for Chapman. 7,000+ rely on lower-bound estimates.

### Cat Movement Tracking (READY)

**Table:** `trapper.cat_movement_events`

| Column | Purpose |
|--------|---------|
| `from_place_id` | Origin location |
| `to_place_id` | Destination location |
| `movement_type` | relocation, escape, migration, adoption |
| `recorded_at` | When movement occurred |

**View:** `v_cat_movement_patterns` classifies cats as:
- `stationary` - Single location
- `roamer` - 2-3 locations
- `mobile` - 4+ locations

### Multi-Parcel Site Aggregation (READY)

**Table:** `trapper.place_place_edges`

Links related addresses (e.g., dairy farms with multiple parcels):
- `same_colony_site` - Single colony spanning addresses
- `adjacent_to` - Nearby locations
- `nearby_cluster` - Geographic grouping

**View:** `v_site_aggregate_stats` de-duplicates cats across linked sites.

### Attribution Windows (READY)

**View:** `v_request_alteration_stats`

Rolling attribution windows for TNR counting:
- Legacy (before May 2025): Fixed ±6 months from `source_created_at`
- Active requests: Rolling NOW() + 6 months
- Resolved requests: 3 months after `resolved_at`

---

## Beacon Data Gaps - Status

### ✅ Gap 1: Kitten Birth Tracking - IMPLEMENTED (MIG_289)

**Table:** `trapper.cat_birth_events`

Tracks kitten births with:
- `litter_id` - Groups siblings
- `mother_cat_id` - Links to mother
- `birth_date` + `birth_date_precision` - Flexible dating
- `place_id` - Location of birth
- `kitten_count_in_litter`, `survived_to_weaning` - Litter outcomes

**Beacon Value:** Enables birth rate modeling for population growth forecasting.

### ✅ Gap 2: Mortality Tracking - IMPLEMENTED (MIG_290)

**Table:** `trapper.cat_mortality_events`

Tracks cat deaths with:
- `death_date`, `death_cause` - When and why
- `death_age_months` - Age at death for survival curves
- `place_id` - Location for geographic mortality patterns

**Beacon Value:** Completes population equation (births - deaths + immigration).

### ✅ Gap 3: Seasonal Breeding Patterns - IMPLEMENTED (MIG_291)

**View:** `trapper.v_seasonal_breeding_patterns`

Analyzes from appointment data:
- Monthly kitten counts and pregnancy rates
- "Kitten season" flagging (Feb-Oct in California)
- Year-over-year trend comparisons

**Beacon Value:** Enables proactive resource planning for kitten surges.

### ⚠️ Gap 4: Colony Immigration vs Local Births - PARTIAL

**Current State:**
- `cat_movement_events` tracks relocation
- `cat_birth_events` now identifies locally-born cats
- No explicit `arrival_type` field yet

**Remaining Work:**
- Add `arrival_type` to `cat_place_relationships`
- Inference rules: first seen as adult = immigrated, seen as kitten = born locally

---

## Current Priority Order

Based on what's been completed and what remains, here is the current priority:

### ✅ COMPLETED: Kitten/Reproduction Tracking (MIG_289)

`cat_birth_events` table deployed with litter tracking, mother relationships, and survival outcomes.

### ✅ COMPLETED: Mortality Tracking (MIG_290)

`cat_mortality_events` table deployed with death cause categorization and location tracking.

### ✅ COMPLETED: Seasonal Analysis (MIG_291)

`v_seasonal_breeding_patterns` view deployed analyzing appointment patterns by month.

### Priority 1: Observation Data Capture (HIGH IMPACT)

**Goal:** Increase Chapman estimator coverage from 422 to 2,000+ places

**Actions:**
1. Deploy observation UI to all trappers
2. Integrate observation prompt into trapping workflow
3. Backfill eartip data from Project 75 surveys
4. Add observation to request completion workflow

**Beacon Value:** Chapman estimates are 10x more accurate than lower-bound estimates

### Priority 2: Immigration Tracking

**Goal:** Distinguish new arrivals from local births

**Actions:**
1. Add `arrival_type` to cat-place relationships
2. Infer from first observation characteristics
3. Track neighboring colony relationships

**Beacon Value:** Enables immigration rate modeling per Vortex

### Priority 3: Email Automation

**Goal:** Enable automated responses (out-of-county, confirmations)

**Actions:**
1. Set up Resend email provider integration
2. Create `/api/emails/send` endpoint
3. Add cron for pending out-of-county emails
4. Create additional email templates

### Priority 4: UI for New Workflows

**Goal:** Staff interfaces for new capabilities

**Actions:**
1. Trapper onboarding dashboard
2. Birth/mortality data entry forms
3. Observation capture during trapping workflow
4. Education materials distribution

---

## Validation Checklist

Before any new Atlas feature goes live, verify against this checklist:

### Data Integrity
- [ ] Uses centralized `find_or_create_*` functions
- [ ] Includes `source_system` and `source_record_id`
- [ ] Handles merged entities (follows canonical chain)
- [ ] Has appropriate foreign key constraints

### Beacon Compatibility
- [ ] Data feeds into existing or planned Beacon views
- [ ] Time-series data includes proper timestamps
- [ ] Geographic data includes place_id linkage
- [ ] Confidence/quality indicators included

### Audit Trail
- [ ] Raw data staged in `staged_records` if from external source
- [ ] Changes logged to `entity_edits` or appropriate audit table
- [ ] Source provenance preserved

---

## Key Views for Beacon

| View | Purpose | Beacon Use |
|------|---------|------------|
| `v_place_colony_status` | Colony size estimates | Population input |
| `v_place_ecology_stats` | Chapman estimator results | Alteration rate |
| `v_request_alteration_stats` | TNR attribution windows | Intervention tracking |
| `v_site_aggregate_stats` | Multi-parcel aggregation | Large site analysis |
| `v_cat_movement_patterns` | Immigration/relocation | Movement modeling |
| `v_trapper_full_stats` | Resource capacity | Capacity planning |

---

## Atlas → Beacon Data Flow

```
                    DATA COLLECTION (Atlas)
┌─────────────────────────────────────────────────────────────┐
│  Intake Forms    → place_colony_estimates (intake_form)     │
│  Project 75      → place_colony_estimates (post_clinic)     │
│  Trappers        → place_colony_estimates (site_visit)      │
│  ClinicHQ        → sot_cats + sot_appointments              │
│  Observations    → place_colony_estimates (trapper_visit)   │
│  Notes Parsing   → place_colony_estimates (notes_parse)     │
│  Historical KML  → place_colony_estimates (legacy_mymaps)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    ANALYTICS (Atlas Views)
┌─────────────────────────────────────────────────────────────┐
│  v_place_ecology_stats:                                     │
│    - a_known: Verified altered (ground truth)               │
│    - n_hat_chapman: Population estimate                     │
│    - p_hat_chapman_pct: Alteration %                        │
│    - estimated_work_remaining: Cats needing TNR             │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    BEACON ANALYTICS (Future)
┌─────────────────────────────────────────────────────────────┐
│  Population Modeling:                                       │
│    - Vortex-inspired stochastic simulation                  │
│    - 6-month time steps                                     │
│    - Scenario comparison (75% vs 50% TNR)                   │
│                                                             │
│  Resource Optimization:                                     │
│    - Target highest-impact colonies                         │
│    - Predict completion timelines                           │
│    - Optimize trapper assignments                           │
└─────────────────────────────────────────────────────────────┘
```

---

## References

1. **Boone, J.D. et al. (2019)** - "A Long-Term Lens: Cumulative Impacts of Free-Roaming Cat Management Strategy and Intensity on Preventable Cat Mortalities" - Frontiers in Veterinary Science 6:238
   - Source for Vortex model parameters
   - Demonstrates high-intensity TNR effectiveness

2. **Project Beacon Overview** - FFSC internal document
   - Vision for Track → Forecast → Target system

3. **FFSC 35th Anniversary Update** - Executive Director communication
   - Beacon launching in 2025
   - Focus on data-driven decision making

---

## Contract Maintenance

This document should be reviewed and updated when:
- New data sources are added to Atlas
- Beacon requirements change
- Schema changes affect core tables
- New scientific research informs the model

**Owner:** Development Team
**Review Cadence:** Quarterly or on major changes
