#!/bin/bash
# Deploy Migrations MIG_288 through MIG_299
#
# These migrations add:
#   - MIG_288: Vortex population parameters (configurable ecology)
#   - MIG_289: Cat birth events table
#   - MIG_290: Cat mortality events table
#   - MIG_291: Seasonal analysis views
#   - MIG_292: Fix intake person function
#   - MIG_293: Beacon data verification
#   - MIG_294: Intake queue cleanup
#   - MIG_295: Auto-linking improvements
#   - MIG_296: Intake duplicate detection
#   - MIG_297: find_or_create_request function
#   - MIG_298: Trapper onboarding workflow
#   - MIG_299: Out-of-county automation
#
# Usage:
#   source .env && ./scripts/deploy_migrations_288_299.sh
#
# Or for dry-run (just shows what would run):
#   DRY_RUN=1 ./scripts/deploy_migrations_288_299.sh

set -e

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable not set"
    echo "Run: source .env && ./scripts/deploy_migrations_288_299.sh"
    exit 1
fi

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=========================================="
echo "  Atlas Migration Deployment"
echo "  MIG_288 through MIG_299"
echo "=========================================="
echo ""

# Migration files in order
MIGRATIONS=(
    "sql/schema/sot/MIG_288__vortex_population_parameters.sql"
    "sql/schema/sot/MIG_289__cat_birth_events.sql"
    "sql/schema/sot/MIG_290__cat_mortality_events.sql"
    "sql/schema/sot/MIG_291__seasonal_analysis_views.sql"
    "sql/schema/sot/MIG_292__fix_intake_person_function.sql"
    "sql/schema/sot/MIG_293__add_verification_to_beacon_data.sql"
    "sql/schema/sot/MIG_294__intake_queue_cleanup.sql"
    "sql/schema/sot/MIG_295__auto_linking_improvements.sql"
    "sql/schema/sot/MIG_296__intake_duplicate_detection.sql"
    "sql/schema/sot/MIG_297__find_or_create_request.sql"
    "sql/schema/sot/MIG_298__trapper_onboarding_workflow.sql"
    "sql/schema/sot/MIG_299__out_of_county_automation.sql"
)

# Check all files exist
echo "Checking migration files..."
for mig in "${MIGRATIONS[@]}"; do
    if [ ! -f "$mig" ]; then
        echo -e "${RED}ERROR: Migration file not found: $mig${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} $mig"
done
echo ""

# Dry run mode
if [ "$DRY_RUN" = "1" ]; then
    echo -e "${YELLOW}DRY RUN MODE - No changes will be made${NC}"
    echo ""
    echo "Would apply these migrations:"
    for mig in "${MIGRATIONS[@]}"; do
        echo "  - $mig"
    done
    echo ""
    exit 0
fi

# Confirm before proceeding
echo -e "${YELLOW}This will apply ${#MIGRATIONS[@]} migrations to the database.${NC}"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "Applying migrations..."
echo ""

# Apply each migration
FAILED=0
for mig in "${MIGRATIONS[@]}"; do
    echo "----------------------------------------"
    echo "Applying: $mig"
    echo "----------------------------------------"

    if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$mig"; then
        echo -e "${GREEN}✓ Success${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED=1
        break
    fi
    echo ""
done

echo ""
echo "=========================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All migrations applied successfully!${NC}"
    echo ""
    echo "New capabilities available:"
    echo "  - cat_birth_events table"
    echo "  - cat_mortality_events table"
    echo "  - v_seasonal_breeding_patterns view"
    echo "  - trapper_onboarding table + functions"
    echo "  - email_templates + sent_emails tables"
    echo "  - find_or_create_request() function"
    echo "  - run_all_entity_linking() function"
else
    echo -e "${RED}Migration failed! Check errors above.${NC}"
    echo "The database may be in a partial state."
    exit 1
fi
echo "=========================================="
echo ""
