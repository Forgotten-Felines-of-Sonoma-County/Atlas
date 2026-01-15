#!/usr/bin/env node
/**
 * extract_procedures_from_appointments.mjs
 *
 * After ingesting ClinicHQ appointment data, run this script to:
 * 1. Create sot_appointments from staged_records (if not exists)
 * 2. Create cat_procedures from sot_appointments based on service_type
 *
 * This uses service_type (what the clinic did) NOT is_spay/is_neuter flags
 * (which indicate cat status, not whether surgery was performed).
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/extract_procedures_from_appointments.mjs
 *   node scripts/ingest/extract_procedures_from_appointments.mjs --dry-run
 */

import pg from 'pg';

const { Pool } = pg;

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('\n=== Extract Procedures from Appointments ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Step 1: Create sot_appointments from new staged_records
    console.log('Step 1: Creating sot_appointments from staged_records...');

    const insertAppointmentsSQL = `
      INSERT INTO trapper.sot_appointments (
        cat_id,
        appointment_date,
        appointment_number,
        service_type,
        is_spay,
        is_neuter,
        vet_name,
        technician,
        temperature,
        medical_notes,
        is_lactating,
        is_pregnant,
        is_in_heat,
        data_source,
        source_system,
        source_record_id,
        source_row_hash
      )
      SELECT
        c.cat_id,
        TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') AS appointment_date,
        sr.payload->>'Number' AS appointment_number,
        sr.payload->>'Service / Subsidy' AS service_type,
        sr.payload->>'Spay' = 'Yes' AS is_spay,
        sr.payload->>'Neuter' = 'Yes' AS is_neuter,
        sr.payload->>'Vet Name' AS vet_name,
        sr.payload->>'Technician' AS technician,
        NULLIF(sr.payload->>'Temperature', '')::NUMERIC(4,1) AS temperature,
        sr.payload->>'Internal Medical Notes' AS medical_notes,
        sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes' AS is_lactating,
        sr.payload->>'Pregnant' = 'Yes' AS is_pregnant,
        sr.payload->>'In Heat' = 'Yes' AS is_in_heat,
        'clinichq' AS data_source,
        'clinichq' AS source_system,
        sr.source_row_id,
        sr.row_hash
      FROM trapper.staged_records sr
      LEFT JOIN trapper.cat_identifiers ci ON
        ci.id_type = 'microchip'
        AND ci.id_value = sr.payload->>'Microchip Number'
      LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.payload->>'Date' IS NOT NULL
        AND sr.payload->>'Date' <> ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.sot_appointments a
          WHERE a.appointment_number = sr.payload->>'Number'
        )
      ON CONFLICT DO NOTHING
    `;

    if (dryRun) {
      const countSQL = `
        SELECT COUNT(*) as cnt
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'appointment_info'
          AND sr.payload->>'Date' IS NOT NULL
          AND sr.payload->>'Date' <> ''
          AND NOT EXISTS (
            SELECT 1 FROM trapper.sot_appointments a
            WHERE a.appointment_number = sr.payload->>'Number'
          )
      `;
      const result = await pool.query(countSQL);
      console.log(`  Would create ${result.rows[0].cnt} new appointments`);
    } else {
      const result = await pool.query(insertAppointmentsSQL);
      console.log(`  Created ${result.rowCount} new appointments`);
    }

    // Step 2: Create cat_procedures from appointments with spay service_type
    console.log('\nStep 2: Creating cat_procedures for SPAY appointments...');

    const insertSpaySQL = `
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician,
        is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
        staples_used,
        source_system, source_record_id
      )
      SELECT
        a.cat_id,
        a.appointment_id,
        'spay',
        a.appointment_date,
        'completed'::trapper.procedure_status,
        a.vet_name,
        a.technician,
        TRUE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        'clinichq',
        a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.service_type ILIKE '%spay%'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_procedures cp
          WHERE cp.appointment_id = a.appointment_id
            AND cp.is_spay = TRUE
        )
      ON CONFLICT DO NOTHING
    `;

    if (dryRun) {
      const countSQL = `
        SELECT COUNT(*) as cnt
        FROM trapper.sot_appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.service_type ILIKE '%spay%'
          AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_procedures cp
            WHERE cp.appointment_id = a.appointment_id
              AND cp.is_spay = TRUE
          )
      `;
      const result = await pool.query(countSQL);
      console.log(`  Would create ${result.rows[0].cnt} new spay procedures`);
    } else {
      const result = await pool.query(insertSpaySQL);
      console.log(`  Created ${result.rowCount} new spay procedures`);
    }

    // Step 3: Create cat_procedures from appointments with neuter service_type
    console.log('\nStep 3: Creating cat_procedures for NEUTER appointments...');

    const insertNeuterSQL = `
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician,
        is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
        staples_used,
        source_system, source_record_id
      )
      SELECT
        a.cat_id,
        a.appointment_id,
        'neuter',
        a.appointment_date,
        'completed'::trapper.procedure_status,
        a.vet_name,
        a.technician,
        FALSE,
        TRUE,
        FALSE,
        FALSE,
        FALSE,
        'clinichq',
        a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.service_type ILIKE '%neuter%'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_procedures cp
          WHERE cp.appointment_id = a.appointment_id
            AND cp.is_neuter = TRUE
        )
      ON CONFLICT DO NOTHING
    `;

    if (dryRun) {
      const countSQL = `
        SELECT COUNT(*) as cnt
        FROM trapper.sot_appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.service_type ILIKE '%neuter%'
          AND NOT EXISTS (
            SELECT 1 FROM trapper.cat_procedures cp
            WHERE cp.appointment_id = a.appointment_id
              AND cp.is_neuter = TRUE
          )
      `;
      const result = await pool.query(countSQL);
      console.log(`  Would create ${result.rows[0].cnt} new neuter procedures`);
    } else {
      const result = await pool.query(insertNeuterSQL);
      console.log(`  Created ${result.rowCount} new neuter procedures`);
    }

    // Step 4: Update sot_cats.altered_status
    if (!dryRun) {
      console.log('\nStep 4: Updating sot_cats.altered_status...');

      await pool.query(`
        UPDATE trapper.sot_cats c
        SET altered_status = 'spayed'
        WHERE c.altered_status IS DISTINCT FROM 'spayed'
          AND EXISTS (
            SELECT 1 FROM trapper.cat_procedures cp
            WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE
          )
      `);

      await pool.query(`
        UPDATE trapper.sot_cats c
        SET altered_status = 'neutered'
        WHERE c.altered_status IS DISTINCT FROM 'neutered'
          AND EXISTS (
            SELECT 1 FROM trapper.cat_procedures cp
            WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE
          )
      `);

      console.log('  Updated altered_status for cats with procedures');
    }

    // Summary
    console.log('\n=== Summary ===');
    const summary = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM trapper.sot_appointments) as total_appointments,
        (SELECT COUNT(*) FROM trapper.cat_procedures WHERE is_spay) as total_spays,
        (SELECT COUNT(*) FROM trapper.cat_procedures WHERE is_neuter) as total_neuters
    `);
    console.log(`Total appointments: ${summary.rows[0].total_appointments}`);
    console.log(`Total spay procedures: ${summary.rows[0].total_spays}`);
    console.log(`Total neuter procedures: ${summary.rows[0].total_neuters}`);

  } finally {
    await pool.end();
  }

  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
