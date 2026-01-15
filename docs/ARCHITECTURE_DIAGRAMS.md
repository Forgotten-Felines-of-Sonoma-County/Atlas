# Atlas Architecture Diagrams

Visual overview of the Atlas system for quick reference.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ATLAS SYSTEM                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│  │   PEOPLE    │   │    CATS     │   │   PLACES    │   │  REQUESTS   │    │
│  │   ~15,000   │   │   ~8,000    │   │   ~3,000    │   │   ~2,500    │    │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘    │
│         │                 │                 │                 │            │
│         └─────────────────┴─────────────────┴─────────────────┘            │
│                                    │                                        │
│                          ┌─────────▼─────────┐                             │
│                          │  RELATIONSHIPS    │                             │
│                          │  person↔cat       │                             │
│                          │  person↔place     │                             │
│                          │  cat↔place        │                             │
│                          │  request↔place    │                             │
│                          └───────────────────┘                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Architecture

```
                    DATA SOURCES
                        │
    ┌───────────────────┼───────────────────┐
    │                   │                   │
    ▼                   ▼                   ▼
┌────────┐        ┌────────┐         ┌────────────┐
│ClinicHQ│        │Airtable│         │Public Form │
│ XLSX   │        │  API   │         │    API     │
└───┬────┘        └───┬────┘         └─────┬──────┘
    │                 │                    │
    └─────────────────┼────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │    STAGED_RECORDS      │  ← Layer 1: Raw Data
         │  (immutable audit)     │    Never modified
         └───────────┬────────────┘
                     │
                     ▼
         ┌────────────────────────┐
         │  IDENTITY RESOLUTION   │  ← Layer 2: Matching
         │  find_or_create_*()    │    Phone/Email/Microchip
         └───────────┬────────────┘
                     │
                     ▼
         ┌────────────────────────┐
         │   SOURCE OF TRUTH      │  ← Layer 3: Canonical
         │  sot_people, sot_cats  │    Deduplicated entities
         │  places, sot_requests  │
         └───────────┬────────────┘
                     │
                     ▼
         ┌────────────────────────┐
         │      ATLAS WEB UI      │
         │   Next.js Application  │
         └────────────────────────┘
```

---

## Entity Relationships

```
                    ┌─────────────┐
                    │   PERSON    │
                    │ sot_people  │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │    CAT     │  │   PLACE    │  │  REQUEST   │
    │  sot_cats  │  │   places   │  │sot_requests│
    └─────┬──────┘  └──────┬─────┘  └──────┬─────┘
          │                │               │
          │                │               │
          └────────────────┼───────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │   PLACE    │
                    │  (shared)  │
                    └────────────┘


Relationship Types:
  Person → Cat:   owner, caretaker, brought_by, former_*
  Person → Place: residence, requester, trapper_assigned
  Cat → Place:    residence, trapped_at, seen_at
  Request → Place: location of cats
```

---

## Database Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CORE TABLES                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐                      │
│  │    sot_people       │      │     sot_cats        │                      │
│  ├─────────────────────┤      ├─────────────────────┤                      │
│  │ person_id (PK)      │      │ cat_id (PK)         │                      │
│  │ display_name        │      │ display_name        │                      │
│  │ entity_type         │      │ sex                 │                      │
│  │ merged_into_person  │      │ altered_status      │                      │
│  │ data_source         │      │ data_source         │                      │
│  └─────────────────────┘      └─────────────────────┘                      │
│                                                                             │
│  ┌─────────────────────┐      ┌─────────────────────┐                      │
│  │      places         │      │    sot_requests     │                      │
│  ├─────────────────────┤      ├─────────────────────┤                      │
│  │ place_id (PK)       │      │ request_id (PK)     │                      │
│  │ display_name        │      │ status              │                      │
│  │ formatted_address   │      │ priority            │                      │
│  │ latitude/longitude  │      │ place_id (FK)       │                      │
│  │ place_kind          │      │ requester_person_id │                      │
│  └─────────────────────┘      └─────────────────────┘                      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                        RELATIONSHIP TABLES                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │person_cat_relationships │  │person_place_relationships│                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ person_id (FK)          │  │ person_id (FK)          │                  │
│  │ cat_id (FK)             │  │ place_id (FK)           │                  │
│  │ relationship_type       │  │ role                    │                  │
│  │ confidence              │  │ confidence              │                  │
│  └─────────────────────────┘  └─────────────────────────┘                  │
│                                                                             │
│  ┌─────────────────────────┐                                               │
│  │ cat_place_relationships │                                               │
│  ├─────────────────────────┤                                               │
│  │ cat_id (FK)             │                                               │
│  │ place_id (FK)           │                                               │
│  │ relationship_type       │                                               │
│  └─────────────────────────┘                                               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                         IDENTITY TABLES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │   person_identifiers    │  │    cat_identifiers      │                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ person_id (FK)          │  │ cat_id (FK)             │                  │
│  │ id_type (email/phone)   │  │ id_type (microchip)     │                  │
│  │ id_value_raw            │  │ id_value                │                  │
│  │ id_value_norm           │  │ source_system           │                  │
│  └─────────────────────────┘  └─────────────────────────┘                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           AUDIT TABLES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                  │
│  │     staged_records      │  │     entity_edits        │                  │
│  ├─────────────────────────┤  ├─────────────────────────┤                  │
│  │ source_system           │  │ entity_type             │                  │
│  │ source_table            │  │ entity_id               │                  │
│  │ row_hash                │  │ edit_type               │                  │
│  │ payload (JSONB)         │  │ old_value / new_value   │                  │
│  │ created_at              │  │ edited_by               │                  │
│  └─────────────────────────┘  └─────────────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Route Structure

```
/api
├── /cats
│   └── /[id]               GET, PATCH - Cat details
├── /people
│   ├── /[id]               GET, PATCH - Person details
│   │   ├── /address        PATCH, DELETE - Address management
│   │   └── /identifiers    PATCH - Phone/email updates
│   ├── /search             GET - Search people
│   └── /check-email        GET - Email lookup
├── /places
│   ├── /[id]               GET, PATCH - Place details
│   ├── /autocomplete       GET - Google autocomplete
│   ├── /details            GET - Google place details
│   ├── /nearby             GET - Find nearby places
│   └── /check-duplicate    GET - Duplicate detection
├── /requests
│   ├── /[id]               GET, PATCH - Request details
│   │   ├── /media          GET, POST - Photo management
│   │   └── /map            GET - Map data
│   └── (root)              GET, POST - List/create requests
├── /intake
│   ├── /public             POST - Public intake form (CORS)
│   ├── /queue              GET - Intake queue
│   └── /queue/[id]         GET, PATCH - Queue item
├── /entities
│   └── /[type]/[id]
│       ├── /edit           GET, POST, PATCH, DELETE - Edit with lock
│       └── /history        GET - Edit history
├── /search                 GET - Universal search
└── /journal                GET, POST - Journal entries
```

---

## Identity Resolution Flow

```
                    Incoming Record
                    (email, phone, name)
                          │
                          ▼
              ┌──────────────────────┐
              │ Is email provided?   │
              └──────────┬───────────┘
                    yes  │  no
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌────────────────────┐        ┌────────────────────┐
│ Search by email    │        │ Is phone provided? │
│ in person_identif. │        └─────────┬──────────┘
└────────┬───────────┘              yes │  no
         │                              │
    found│ not found                    │
         │                              ▼
         │               ┌─────────────────────────┐
         │               │ Search by phone (last   │
         │               │ 10 digits) in identif.  │
         │               └──────────┬──────────────┘
         │                     found│ not found
         │                          │
         └──────────┬───────────────┘
                    │
                    ▼
         ┌──────────────────┐
         │ Match found?     │
         └────────┬─────────┘
             yes  │  no
                  │
    ┌─────────────┴─────────────┐
    ▼                           ▼
┌────────────┐           ┌─────────────┐
│Return      │           │Create new   │
│existing ID │           │person record│
└────────────┘           └─────────────┘
```

---

## Request Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    REQUEST LIFECYCLE                            │
└─────────────────────────────────────────────────────────────────┘

    [NEW] ──► [TRIAGED] ──► [SCHEDULED] ──► [IN_PROGRESS] ──► [COMPLETED]
      │           │              │               │                │
      │           │              │               │                │
      ▼           ▼              ▼               ▼                ▼
  Submitted   Assessed      Trapper         Trapping         Cats
  via form    for need     assigned          done           returned
              │              │
              │              │
              ▼              ▼
          [ON_HOLD]    [CANCELLED]
              │
              │
              ▼
          Waiting on
          permission,
          weather, etc.


Status Transitions:
  new → triaged, on_hold, cancelled
  triaged → scheduled, on_hold, cancelled
  scheduled → in_progress, on_hold, cancelled
  in_progress → completed, on_hold
  on_hold → triaged, scheduled, cancelled
```

---

## Files Quick Reference

```
Repository Structure:

Atlas/
├── apps/web/                     # Next.js Application
│   ├── src/app/                  # App Router
│   │   ├── api/                  # API Routes
│   │   │   ├── cats/             # Cat endpoints
│   │   │   ├── people/           # Person endpoints
│   │   │   ├── places/           # Place endpoints
│   │   │   ├── requests/         # Request endpoints
│   │   │   ├── intake/           # Intake endpoints
│   │   │   └── entities/         # Generic entity ops
│   │   ├── cats/[id]/            # Cat detail page
│   │   ├── people/[id]/          # Person detail page
│   │   ├── places/[id]/          # Place detail page
│   │   └── requests/[id]/        # Request detail page
│   └── src/components/           # React components
│
├── scripts/                      # Data Scripts
│   ├── rebuild_all.sh            # ⭐ Master rebuild
│   └── ingest/                   # Ingestion scripts
│       ├── _lib/                 # Shared utilities
│       ├── clinichq_*.mjs        # ClinicHQ imports
│       ├── airtable_*.mjs        # Airtable syncs
│       └── petlink_*.mjs         # PetLink imports
│
├── sql/schema/sot/               # SQL Migrations
│   ├── MIG_130-160               # Core schema
│   ├── MIG_161-180               # Entity resolution
│   └── MIG_181-205               # Features & cleanup
│
└── docs/                         # Documentation
    ├── DEVELOPER_GUIDE.md        # ⭐ Start here
    ├── DATA_INGESTION_RULES.md   # ⭐ Ingestion rules
    ├── SECURITY_REVIEW.md        # Security checklist
    └── ARCHITECTURE_DIAGRAMS.md  # This file
```
