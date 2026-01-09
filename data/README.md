# Data Directory

**This directory is for LOCAL data only. Nothing here is committed to git.**

## Purpose

Place data exports here for local ingest testing. The `.gitignore` ensures nothing in this directory is ever committed.

## Ben's Local Export Location

Primary export location: `/Users/benmisdiaz/Desktop/AI_Ingest`

Typical structure:
```
AI_Ingest/
├── airtable/
│   ├── appointment_requests/
│   │   └── Appointment Requests-All Submissions.csv
│   └── trapping_requests/
│       └── Trapping Requests-Grid view.csv
├── clinichq/
│   ├── upcoming/
│   │   └── clinichq_upcoming_appts_2026-01-01_to_2026-01-30.xlsx
│   └── historical/
│       └── clinichq_appts_2025-08-01_2026-02-28__pending.xlsx
└── forms/
    └── jotform_submissions.csv
```

## Ingest Workflow

1. Export data from source (Airtable, ClinicHQ, etc.)
2. Place in `/Users/benmisdiaz/Desktop/AI_Ingest/` (or symlink here)
3. Run appropriate ingest script: `python scripts/ingest/ingest_airtable.py`
4. Verify in database

## Safety Reminders

- **Never commit data exports** — Contains PII and client information
- **Check `.gitignore`** — Ensure new file patterns are covered
- **Run `git status`** — Before any commit, verify no data files are staged

---

*This README is the only file in data/ that should be committed.*
