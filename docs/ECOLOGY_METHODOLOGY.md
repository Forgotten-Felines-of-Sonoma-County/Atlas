# Atlas Ecology Methodology Reference

This document describes the scientific methodology used by Atlas for estimating feral cat populations and TNR (Trap-Neuter-Return) progress. All derivations are transparent and based on peer-reviewed research.

## Table of Contents

1. [Overview](#overview)
2. [Population Estimation Methods](#population-estimation-methods)
3. [Alteration Rate Calculation](#alteration-rate-calculation)
4. [Scientific Parameters](#scientific-parameters)
5. [Data Quality Considerations](#data-quality-considerations)
6. [Audit Results (January 2026)](#audit-results-january-2026)

---

## Overview

Atlas uses a multi-method approach to estimate feral cat populations:

| Method | Data Required | When Used | Accuracy |
|--------|--------------|-----------|----------|
| **Chapman Mark-Recapture** | Eartip observations | Best method when data available | High |
| **Max Recent Report** | Colony estimates within 180 days | Fallback when no eartip data | Medium |
| **Verified Only** | Clinic alteration records | When no colony estimates exist | Lower bound only |
| **No Data** | None | Places without cat activity | N/A |

### FFSC Ground Truth Principle

> **FFSC is the ONLY dedicated spay/neuter clinic for community cats in Sonoma County.**

This means FFSC clinic data represents **verified alterations (ground truth)**. External alteration rate is estimated at ~2% (negligible), so all alteration calculations use FFSC clinic records as the numerator.

---

## Population Estimation Methods

### 1. Chapman Mark-Recapture Estimator

The Chapman estimator is a bias-corrected version of the Lincoln-Petersen method, the gold standard for wildlife population estimation.

#### Formula

```
N̂ = ((M + 1)(C + 1) / (R + 1)) - 1
```

**Where:**
- **N̂** = Estimated total population
- **M** = Total marked individuals (FFSC verified alterations = eartipped cats)
- **C** = Total individuals captured/observed in sample
- **R** = Recaptured marked individuals (eartipped cats observed)

#### Example Calculation

```
Colony with:
- M = 10 cats altered by FFSC (all have ear tips)
- C = 15 cats observed at feeding time
- R = 6 eartipped cats seen in the observation

N̂ = ((10 + 1)(15 + 1) / (6 + 1)) - 1
N̂ = (11 × 16 / 7) - 1
N̂ = 25.1 - 1
N̂ = 24 cats (estimated total population)

Alteration Rate = M / N̂ = 10 / 24 = 41.7%
```

#### Key Assumptions

1. **Closed Population**: No births, deaths, immigration, or emigration during the sampling period
2. **Equal Catchability**: All individuals have the same probability of being captured/observed
3. **Marks Not Lost**: Ear tips are permanent and visible
4. **Marks Correctly Recorded**: Observer accurately counts eartipped vs non-eartipped cats

#### When Chapman Is Invalid

The estimator produces NULL when:
- R > C (more eartipped cats than total cats observed - data error)
- M = 0 (no verified alterations)
- C = 0 (no observations)
- R = 0 (no eartipped cats observed - cannot estimate)

#### Scientific References

- Chapman, D.G. (1951). Some properties of the hypergeometric distribution with applications to zoological sample censuses. *University of California Publications in Statistics*, 1(7), 131-160.
- Robson, D.S. & Regier, H.A. (1964). Sample size in Petersen mark-recapture experiments. *Transactions of the American Fisheries Society*, 93(3), 215-226.

---

### 2. Max Recent Report Method

When eartip observation data is unavailable, Atlas uses the maximum colony size reported within the last 180 days.

#### Logic

```sql
n_recent_max = MAX(COALESCE(peak_count, total_cats))
WHERE observation_date >= CURRENT_DATE - INTERVAL '180 days'
```

#### Confidence Factors

Reports are weighted by source reliability:

| Source Type | Base Confidence | Description |
|-------------|-----------------|-------------|
| `verified_cats` | 100% | Clinic records (ground truth) |
| `post_clinic_survey` | 85% | Project 75 surveys |
| `trapper_site_visit` | 80% | Professional assessment |
| `trapping_request` | 60% | Requester report |
| `intake_form` | 55% | Web form submission |
| `ai_parsed` | Variable | AI-extracted from notes |

---

### 3. Verified Only (Lower Bound)

When no colony estimates exist, Atlas reports only verified altered cats (a_known). This is a **lower bound** on the true population.

#### Limitation

**The "100%+ alteration rate" anomaly**: When a place has verified cats but no colony estimate, the alteration rate formula divides by MAX(a_known, n_recent_max). With n_recent_max = 0, this gives a_known / a_known = 100%.

This doesn't mean the colony is 100% altered; it means **we don't have enough data to estimate the unaltered population**.

---

## Alteration Rate Calculation

### Formula (Classification-Aware)

```sql
alteration_rate = a_known_effective / population_estimate

WHERE a_known_effective =
  CASE
    WHEN colony_classification = 'individual_cats'
    THEN a_known_current  -- Only cats with presence_status = 'current'
    ELSE a_known          -- All historical altered cats
  END
```

### TNR Progress Thresholds

Based on scientific literature, the following thresholds are used:

| Threshold | % Altered | Status | Scientific Basis |
|-----------|-----------|--------|------------------|
| Complete | ≥95% | Colony effectively managed | Levy et al. 2003 |
| High | ≥80% | Population stabilizing | Córdoba TNR Study (2025) |
| Medium | ≥50% | Population reduction starting | Various studies |
| Low | <50% | Minimal population impact | Boone et al. 2019 |

#### Why 75-80%?

Research shows:
- **71-94%** sterilization needed for closed population decline (Andersen et al. 2004)
- **75%** target: Population decreases, preventable deaths reduced 30x (Levy collaboration)
- **80%** threshold: Population stabilization (multiple studies)
- **55%** minimum: Can stabilize if truly closed (South African study)

The challenge: **No colony is truly closed**. Immigration from surrounding areas counteracts sterilization efforts unless high-intensity TNR is applied regionally.

---

## Scientific Parameters

Atlas uses parameters from peer-reviewed literature, primarily **Boone et al. 2019** (*Frontiers in Veterinary Science*).

### Survival Rates

| Parameter | Value | Source |
|-----------|-------|--------|
| Adult annual survival | 70% | Boone et al. 2019 (range: 60-80%) |
| Kitten survival (low density) | 50% | Boone et al. 2019 |
| Kitten survival (high density) | 25% | Boone et al. 2019 |

### Reproduction

| Parameter | Value | Source |
|-----------|-------|--------|
| Kittens per litter | 4 | Boone et al. 2019 (range: 3-5) |
| Litters per year | 1.8 | Boone et al. 2019 (range: 1.6-2.0) |
| Female maturity | 6 months | Veterinary consensus |
| Breeding season (CA) | Feb-Nov | California climate |

### Immigration

| Parameter | Value | Context |
|-----------|-------|---------|
| Low immigration | 0.5 cats/6mo | Isolated colonies |
| Default immigration | 1.0 cats/6mo | Typical urban |
| High immigration | 2.0 cats/6mo | Connected urban areas |

### Colony Dynamics

| Parameter | Value | Description |
|-----------|-------|-------------|
| Carrying capacity (default) | 30 cats | Density-dependent mortality threshold |
| Density mortality threshold | 70% | Point where mortality increases |
| TNR high intensity | 75%/6mo | Required for population reduction |
| TNR low intensity | 50%/6mo | Minimal population impact |

---

## Data Quality Considerations

### Presence Status Inference

Historical cats are classified by last observation date:

| Last Seen | Status | Interpretation |
|-----------|--------|----------------|
| < 18 months | Current | Likely still present |
| 18-36 months | Uncertain | May be present, needs confirmation |
| > 36 months | Departed | Likely no longer at location |
| Never | Unknown | No observation data |

### Data Validation Rules

1. **Eartip count ≤ Total cats observed** (R ≤ C)
2. **Colony estimates < max_reasonable_colony_size** (default: 100)
3. **Observation date within reasonable window** (180 days for max_recent)

### Known Limitations

1. **Chapman requires eartip observations** - Only 3% of places have this data
2. **Immigration undermines closed-population assumptions**
3. **Observer variability** - Different feeders may count differently
4. **Seasonal fluctuation** - Populations vary by breeding season

---

## Audit Results (January 2026)

### Data Coverage

| Metric | Count | Percentage |
|--------|-------|------------|
| Total places | 12,627 | 100% |
| Places with linked cats | 8,531 | 68% |
| Places with colony estimates | 2,970 | 24% |
| Places with eartip observations | 422 | 3% |
| Places with valid Chapman estimates | 115 | 0.9% |

### Altered Cats Distribution

| Range | Places | Percentage |
|-------|--------|------------|
| 0 cats | 4,975 | 39.4% |
| 1 cat | 3,226 | 25.6% |
| 2-3 cats | 2,136 | 16.9% |
| 4-6 cats | 1,098 | 8.7% |
| 7-10 cats | 509 | 4.0% |
| 11-20 cats | 397 | 3.1% |
| 20+ cats | 282 | 2.2% |

**Distribution Pattern**: Heavily right-skewed, consistent with wildlife population data.

### Estimation Method Distribution

| Method | Places | Percentage |
|--------|--------|------------|
| verified_only | 7,119 | 56.4% |
| no_data | 4,821 | 38.2% |
| max_recent | 568 | 4.5% |
| mark_resight | 115 | 0.9% |

### Alteration Rate Distribution

| Range | Places | Notes |
|-------|--------|-------|
| No data | 4,821 (38%) | No cats linked |
| 100%+ | 7,463 (59%) | **Anomaly**: No colony estimate, verified cats exist |
| 76-99% | 27 (0.2%) | High alteration |
| 51-75% | 58 (0.5%) | Medium-high |
| 26-50% | 62 (0.5%) | Medium |
| 1-25% | 38 (0.3%) | Low |
| 0% | 154 (1.2%) | No alterations |

**Key Finding**: The 59% showing "100%+" is an artifact of missing colony estimates, not actual 100% alteration.

### Cat Presence Status

| Inferred Status | Count | Percentage |
|-----------------|-------|------------|
| Departed (>36mo) | 24,441 | 60% |
| Current (<18mo) | 8,993 | 22% |
| Uncertain (18-36mo) | 7,059 | 17% |
| Unknown (no date) | 298 | <1% |

**Only 2 cats** have explicit (staff-confirmed) presence status. 8,161 places need reconciliation review.

---

## Zone Priority System (Beacon Field Planning)

Atlas provides a zone-based observation priority system to guide field work for Beacon. This enables data-driven targeting of where site visits are most needed.

### What Is a Site Observation?

A site observation is a **simple field visit** to a feeding location:

1. **Visit during feeding time** (when cats congregate)
2. **Count total cats** visible (C)
3. **Count eartipped cats** visible (R) - ear tips are visible from a distance
4. **Record in Atlas** via the observation form

**That's it.** No scanning, no catching cats, no identifying individuals. A 15-minute visit can unlock Chapman estimation for that site.

We already have **M** (marked cats) from FFSC clinic records. The site visit provides **C** and **R**, completing the Chapman formula.

### Priority Scoring

Places are scored based on urgency of observation need:

| Factor | Score Contribution | Rationale |
|--------|-------------------|-----------|
| Verified cats | +1 per cat | More cats = more valuable data |
| High priority (10+ cats) | +50 | Large sites have biggest impact |
| Medium priority (5-9 cats) | +20 | Moderate impact |
| Active request | +30 per request | Prioritize places being worked |
| No eartip observation | +20 | Never been observed |
| Observation > 1 year old | +15 | Stale data |
| Observation > 6 months old | +10 | Needs refresh |
| Low-income zip | +20% cats | More community cats expected |
| Urban area | +10% cats | Higher density |

### Zone-Level Gap Analysis (January 2026)

| Zone | Places Needing Obs | Cats Needing Obs | High Priority Sites | Gap % |
|------|-------------------|------------------|---------------------|-------|
| Santa Rosa | 3,289 | 13,420 | 221 | 91.3% |
| Petaluma | 969 | 5,649 | 140 | 91.1% |
| West County | 1,070 | 4,047 | 92 | 91.7% |
| North County | 753 | 3,188 | 73 | 90.9% |
| South County | 554 | 2,101 | 51 | 90.8% |
| Sonoma Valley | 154 | 434 | 8 | 95.7% |

**Key Insight**: 91%+ of places with cat activity lack site observation data. ONE site visit (counting total cats + eartipped cats at feeding time) per place would unlock Chapman estimation. No scanning required - ear tips are visible markers.

### Top Priority Zip Codes

| Zip | Zone | Cats Needing Obs | High Priority Sites | Median Income |
|-----|------|------------------|---------------------|---------------|
| 95407 | Santa Rosa | 4,688 | 112 | $82,807 |
| 94952 | Petaluma | 4,279 | 110 | $112,340 |
| 95403 | Santa Rosa | 4,136 | 49 | $98,750 |
| 95472 | West County | 2,044 | 48 | $95,680 |
| 95401 | Santa Rosa | 1,789 | 27 | $75,420 |

**Note**: 95407 (Southwest Santa Rosa/Roseland) has the lowest median income AND highest observation need, consistent with research showing more community cats in lower-income areas.

### Sonoma County Demographics

Population: **485,375** (2023 Census estimate)
- 86% urban/suburban
- 14% rural
- 30% in unincorporated areas

| Zone | Population | Households | Avg Income | Cat Density |
|------|------------|------------|------------|-------------|
| Santa Rosa | 218,495 | 81,150 | $93,938 | 179/1000 HH |
| Petaluma | 59,390 | 22,250 | $120,495 | 271/1000 HH |
| West County | 28,130 | 11,230 | $81,348 | 402/1000 HH |
| North County | 51,810 | 19,150 | $93,905 | 186/1000 HH |
| South County | 54,550 | 20,740 | $106,540 | 121/1000 HH |

**West County has the highest cat density per household** (402 per 1000), suggesting concentrated cat populations despite lower human population.

### API Endpoints

- `GET /api/beacon/priorities?level=zone` - Zone-level priority scores
- `GET /api/beacon/priorities?level=zip` - Zip-level with demographics
- `GET /api/beacon/priorities?level=place&zone=Santa+Rosa&priority=high` - Place-level
- `GET /api/beacon/demographics` - Sonoma County reference data

### Database Views

| View | Purpose |
|------|---------|
| `v_zone_observation_priority` | Zone-level aggregation with priority scores |
| `v_zip_observation_priority` | Zip-level with socioeconomic weighting |
| `v_place_observation_priority` | Individual place priority for route planning |
| `v_beacon_zone_summary` | High-level zone dashboard |

### Scientific Basis for Socioeconomic Weighting

Research supports prioritizing lower-income areas:

- **Feral cat density correlates with socioeconomic factors** (Hand et al. 2019)
- **Unowned cats more prevalent in lower-income neighborhoods** (multiple studies)
- **Urban density increases cat encounters** (Weiss et al. 2018)
- **Renter-occupied housing associated with more community cats** (various)

The priority scoring incorporates a 20% bonus for zip codes with median income below $85,000.

---

## References

1. Boone, J.D. et al. (2019). A Long-Term Lens: Cumulative Impacts of Free-Roaming Cat Management Strategy and Intensity on Preventable Cat Mortalities. *Frontiers in Veterinary Science*, 6:238.

2. Chapman, D.G. (1951). Some properties of the hypergeometric distribution with applications to zoological sample censuses. *University of California Publications in Statistics*, 1(7), 131-160.

3. Levy, J.K. et al. (2003). Evaluation of the effect of a long-term trap-neuter-return and adoption program on a free-roaming cat population. *Journal of the American Veterinary Medical Association*, 222(1), 42-46.

4. Miller, P.S. et al. (2014). Simulating free-roaming cat population management options in open demographic environments. *PLoS ONE*, 9(11), e113553.

5. Nutter, F.B. et al. (2004). Reproductive capacity of free-roaming domestic cats and kitten survival rate. *Journal of the American Veterinary Medical Association*, 225(9), 1399-1402.

6. Hand, B.K. et al. (2019). Estimating feral cat densities using distance sampling in an urban environment. *Ecology and Evolution*, 9(5), 2629-2639.

7. Humane Society of the United States. (2020). Community cats: scientific studies and data. *HumanePro*.

---

## Targeted TNR Methodology

Targeted TNR (Trap-Neuter-Return) is an evidence-based approach to community cat management that prioritizes resources for maximum population impact. Unlike ad-hoc TNR, targeted TNR uses data to identify **where** and **how intensively** to focus efforts.

### Core Principles

Based on peer-reviewed research, effective targeted TNR requires:

| Principle | Threshold | Scientific Basis |
|-----------|-----------|------------------|
| **High Intensity** | ≥70-75% sterilization rate | Population decline only occurs above this threshold |
| **Spatial Contiguity** | Contiguous geographic zones | Prevents immigration from untreated areas |
| **Sustained Effort** | Continuous, multi-year | Compensatory mechanisms require ongoing work |
| **Resource Limitation** | Complement with food source management | Reduces carrying capacity |

### Why Intensity Matters

Research demonstrates that low-intensity TNR has minimal population impact:

| Intensity | Cats Neutered | Population Effect | Source |
|-----------|---------------|-------------------|--------|
| Low | 25%/6mo | Minimal decline | Boone et al. 2019 |
| Moderate | 50%/6mo | Stabilization possible | Boone et al. 2019 |
| High | 75%/6mo | 7% annual decline | PNAS 2022 |
| Very High | >80% | Significant reduction | Córdoba Study 2024 |

> "With sufficient intensity, TNR offers significant advantages in terms of minimizing preventable deaths while also substantially reducing population size. At lower sterilization intensities, the longer-term lifesaving advantages of TNR become much less compelling." — Boone et al. 2019

### Compensatory Effects

Three mechanisms limit TNR effectiveness if not addressed:

1. **Reduced Mortality**: Sterilized cats live longer (fewer road deaths, fighting injuries)
2. **Increased Fertility**: Remaining intact cats reproduce more (kitten-to-queen ratio can increase 2.25x)
3. **Immigration**: Cats migrate into managed areas from untreated zones

**Solution**: High-intensity, spatially contiguous TNR overcomes these compensatory effects.

### Prioritization Criteria for Atlas/Beacon

Atlas prioritizes zones for targeted TNR using these factors:

| Factor | Weight | Rationale |
|--------|--------|-----------|
| **Cat Density** | High | More cats = more impact per intervention |
| **Alteration Rate** | High (inverse) | Low rates = highest intervention need |
| **Geographic Clustering** | High | Enables spatial contiguity |
| **Active Reproduction** | Medium | Kitten births indicate population growth |
| **Socioeconomic Factors** | Medium | Lower-income areas have more community cats |
| **Immigration Potential** | Medium | Connected areas need coordinated effort |

### Priority Levels

Based on alteration rate and cat density:

| Priority | Alteration Rate | Cat Count | Action |
|----------|-----------------|-----------|--------|
| **Critical** | <25% | 10+ cats | Immediate intensive TNR |
| **High** | 25-50% | 5+ cats | Prioritize for next campaign |
| **Medium** | 50-75% | Any | Schedule in regular rotation |
| **Maintenance** | >75% | Any | Monitor, address new arrivals |
| **Managed** | >90% | Any | Observation only |

### Spatial Contiguity Strategy

Atlas groups places into **zones** for coordinated TNR:

```
Zone Example: "Fisher Lane Corridor"
├── 101 Fisher Lane (feeding station, 12 cats, 25% altered) - CRITICAL
├── 103 Fisher Lane (spillover, 4 cats, 50% altered) - HIGH
├── 105 Fisher Lane (spillover, 3 cats, 67% altered) - MEDIUM
└── Strategy: Treat all three simultaneously to prevent immigration
```

The Beacon map visualizes zones with priority colors:
- 🔴 **Red**: Critical priority (<25% altered, high density)
- 🟠 **Orange**: High priority (25-50% altered)
- 🟡 **Yellow**: Medium priority (50-75% altered)
- 🟢 **Green**: Managed (>75% altered)

### Timing Optimization

Research from Beijing (2024) found TNR timing affects efficacy:

| Season | Effectiveness | Optimal Target |
|--------|---------------|----------------|
| **November-December** | Highest | Adult cats |
| **Spring** | Moderate | Pre-breeding females |
| **Summer** | Lower | Competing with kitten season |

Recommendation: Concentrate intensive TNR campaigns in late fall/early winter.

### Success Metrics

Track these metrics to evaluate targeted TNR effectiveness:

| Metric | Measurement | Target |
|--------|-------------|--------|
| Zone Alteration Rate | % of cats sterilized | >75% |
| Population Trend | Chapman estimates over time | Declining or stable |
| Kitten Births | Birth events per zone | Decreasing |
| Immigration Rate | New unaltered cats appearing | <2/year |
| Shelter Intake | Cats from target zone entering shelter | Decreasing |

### Case Study: High-Impact Targeted TNR (Florida)

A study captured 2,366 cats representing 54% of the projected community cat population in a target area. Results:

- **Target area**: 60 cats/1000 residents neutered annually
- **Shelter intake decrease**: 66% in target area vs 12% in non-target areas
- **Duration**: 2 years

This demonstrates that concentrated effort in defined geographic areas produces measurable results.

### Implementation in Atlas

Atlas provides tools for targeted TNR planning:

1. **Beacon Map**: Visualizes priority zones with color-coded markers
2. **Priority Views**: `v_observation_collection_priority`, `v_zone_observation_priority`
3. **Campaign Tracking**: `observation_campaigns` table tracks field efforts
4. **Progress Monitoring**: Alteration rate trends over time

### Scientific References (Targeted TNR)

8. Kreisler, R.E. et al. (2019). High-intensity targeted trap-neuter-return and adoption of community cats. *American Journal of Veterinary Research*, 80(11), 1058-1067.

9. Tan, K. et al. (2024). The Use and Efficacy of Trap-Neuter-Return for Feral Cat Management, Using Beijing, China, as an Example. *National High School Journal of Science*.

10. Hernández-Minguillán, S. et al. (2025). Four Years of Promising Trap–Neuter–Return (TNR) in Córdoba, Spain: A Scalable Model for Urban Feline Management. *Animals*, 15(3), 326.

11. Castillo, D. & Clarke, A.L. (2003). Trap/neuter/release methods ineffective in controlling domestic cat "colonies" on public lands. *Natural Areas Journal*, 23(3), 247-253.

12. Spehar, D.D. & Wolf, P.J. (2022). Reduction of free-roaming cat population requires high-intensity neutering in spatial contiguity to mitigate compensatory effects. *PNAS*, 119(16), e2119000119.

---

*Last Updated: January 2026*
*Document Version: 1.1*
