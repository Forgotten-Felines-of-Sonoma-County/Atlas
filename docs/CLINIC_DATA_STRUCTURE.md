# Clinic Data Structure Rules

## Core Principle

**Clinic data flows directly to Cats, Places, and Appointments - NOT necessarily to People.**

```
┌─────────────┐
│  ClinicHQ   │
│   Export    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Atlas                                    │
│                                                                  │
│   ┌───────┐      ┌───────┐      ┌──────────────┐               │
│   │  Cat  │◄────►│ Place │◄────►│ Appointment  │               │
│   │  🐱   │      │  📍   │      │     📅       │               │
│   └───────┘      └───────┘      └──────────────┘               │
│       ▲              ▲                  ▲                       │
│       │              │                  │                       │
│       └──────────────┴──────────────────┘                       │
│                      │                                          │
│              (DIRECT LINKS via                                  │
│               microchip + address)                              │
│                                                                  │
│   ┌────────┐                                                    │
│   │ Person │  ◄── Only created when email/phone exists          │
│   │   👤   │                                                    │
│   └────────┘                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why This Structure?

1. **Cats are booked under locations, not trappers**
   - Trappers bring cats from various locations
   - The cat's location is what matters for Beacon/colony tracking
   - If we linked cats to trappers, we'd have thousands of cats incorrectly associated

2. **Names alone are unreliable for identity**
   - "Carl Draper" could be the trapper or someone else with the same name
   - Clinic data has messy names (misspellings, variations)
   - Only email/phone provide confident identity

3. **Places are the anchor for ecological data**
   - Colony size estimates are per-place
   - TNR requests are per-place
   - Beacon visualizes data by location

## Data Flow Rules

### ✅ Cats → Places (Direct Link)

```sql
-- Cats link to places via appointments
cat_place_relationships (cat_id, place_id, relationship_type='appointment_site')
```

The cat came from this place. This is derived from:
- Owner address on the appointment
- Coordinates if available

### ✅ Cats → Appointments (Direct Link)

```sql
-- Appointments link to cats via microchip
sot_appointments (cat_id, appointment_date, place_id)
```

Every cat that visits the clinic has a microchip. This is ground truth.

### ✅ Appointments → Places (Direct Link)

```sql
-- Appointments link to places via owner address
sot_appointments (place_id, inferred_place_id)
```

The place is created from the owner address, even if we don't know who the owner is.

### ⚠️ Appointments → People (Conditional)

```sql
-- ONLY when email or phone is provided
sot_appointments (person_id)  -- NULL if no confident identity
```

**Rules:**
- If appointment has email → Find/create person, link
- If appointment has phone → Find/create person, link
- If appointment has ONLY name → DO NOT create person, link to place only

### ❌ Never Create People From Names Alone

```sql
-- The Data Engine rejects this:
data_engine_resolve_identity(
  email := NULL,
  phone := NULL,
  first_name := 'Carl',
  last_name := 'Draper',
  ...
) → Returns NULL, decision_type = 'no_identifiers'
```

## Processing Logic

### When Processing owner_info:

```python
if has_email or has_phone:
    person = find_or_create_person(email, phone, name, address)
    appointment.person_id = person.id
else:
    # No person created
    # Cat links directly to place via address
    appointment.person_id = NULL

# Always create place from address
place = find_or_create_place(address)
appointment.place_id = place.id
```

### When Processing appointment_info:

```python
# Create cat from microchip (ground truth)
cat = find_or_create_cat(microchip)

# Link cat to appointment
appointment.cat_id = cat.id

# Link cat to place (from appointment)
cat_place_relationships.insert(cat_id, place_id)
```

## Cleanup (MIG_570)

The following cleanup was performed to align with this structure:

| Action | Records |
|--------|---------|
| Appointments linked directly to places | 177 |
| Person links removed (no identifiers) | 13,362 |
| Cats linked directly to places | 28 |
| Orphan person records marked | 593 |
| Duplicate people merged | 1,884 |

## Verification Queries

### Check appointments have places (not just people)

```sql
SELECT
    COUNT(*) FILTER (WHERE place_id IS NOT NULL) as has_place,
    COUNT(*) FILTER (WHERE person_id IS NOT NULL) as has_person,
    COUNT(*) FILTER (WHERE place_id IS NULL AND person_id IS NULL) as orphaned
FROM trapper.sot_appointments
WHERE cat_id IS NOT NULL;
```

### Check cats link to places

```sql
SELECT COUNT(DISTINCT cat_id) as cats_with_places
FROM trapper.cat_place_relationships;
```

### Check for orphan people (should be 0 active)

```sql
SELECT COUNT(*) as orphan_people
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND data_quality != 'orphan_no_identifiers'
  AND NOT EXISTS (SELECT 1 FROM trapper.person_identifiers WHERE person_id = sot_people.person_id);
```

## Summary

| Entity | Created When | Links To |
|--------|--------------|----------|
| **Cat** | Microchip exists | Place (via appointment), Appointment |
| **Place** | Address exists | Cats, Appointments, Requests |
| **Appointment** | Clinic visit | Cat (microchip), Place (address), Person (if email/phone) |
| **Person** | Email OR phone exists | Place (resident), Appointments (owner), Requests (requester) |

**Golden Rule:** When in doubt, link to Place. Places are the anchor of the Atlas data model.
