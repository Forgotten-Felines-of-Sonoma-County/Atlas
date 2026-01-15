import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryRows } from "@/lib/db";
import { readFile } from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import { createHash } from "crypto";

interface FileUpload {
  upload_id: string;
  original_filename: string;
  stored_filename: string;
  source_system: string;
  source_table: string;
  status: string;
}

// Parse XLSX or CSV file
function parseFile(buffer: Buffer, filename: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    // Parse CSV
    const text = buffer.toString('utf-8');
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });
    return { headers, rows };
  } else {
    // Parse XLSX
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    return { headers, rows: data };
  }
}

// Get ID field for a source/table combo
function getIdField(sourceSystem: string, sourceTable: string): string[] {
  const configs: Record<string, Record<string, string[]>> = {
    clinichq: {
      cat_info: ['Microchip Number', 'Number'],
      owner_info: ['Owner ID', 'Number'],
      appointment_info: ['Number', 'Appointment ID'],
    },
    airtable: {
      trapping_requests: ['Record ID', 'Request ID'],
      appointment_requests: ['Record ID'],
    },
  };

  return configs[sourceSystem]?.[sourceTable] || ['ID', 'id', 'Number'];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: uploadId } = await params;

  if (!uploadId) {
    return NextResponse.json(
      { error: "Upload ID is required" },
      { status: 400 }
    );
  }

  try {
    // Get upload record
    const upload = await queryOne<FileUpload>(
      `SELECT upload_id, original_filename, stored_filename, source_system, source_table, status
       FROM trapper.file_uploads WHERE upload_id = $1`,
      [uploadId]
    );

    if (!upload) {
      return NextResponse.json(
        { error: "Upload not found" },
        { status: 404 }
      );
    }

    if (upload.status === 'processing') {
      return NextResponse.json(
        { error: "Upload is already being processed" },
        { status: 409 }
      );
    }

    // Mark as processing
    await query(
      `UPDATE trapper.file_uploads SET status = 'processing' WHERE upload_id = $1`,
      [uploadId]
    );

    // Read file
    const uploadDir = path.join(process.cwd(), "uploads", "ingest");
    const filePath = path.join(uploadDir, upload.stored_filename);
    const buffer = await readFile(filePath);

    // Parse file
    const { rows } = parseFile(buffer, upload.stored_filename);
    const idFieldCandidates = getIdField(upload.source_system, upload.source_table);

    // Process rows into staged_records
    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const row of rows) {
      // Find ID field
      let sourceRowId = null;
      for (const field of idFieldCandidates) {
        if (row[field]) {
          sourceRowId = String(row[field]);
          break;
        }
      }

      if (!sourceRowId) {
        sourceRowId = `row_${rows.indexOf(row)}`;
      }

      // Calculate row hash
      const rowHash = createHash('sha256')
        .update(JSON.stringify(row))
        .digest('hex')
        .substring(0, 16);

      // Check if exists
      const existing = await queryOne<{ staged_record_id: string; row_hash: string }>(
        `SELECT staged_record_id, row_hash FROM trapper.staged_records
         WHERE source_system = $1 AND source_table = $2 AND source_row_id = $3`,
        [upload.source_system, upload.source_table, sourceRowId]
      );

      if (existing) {
        if (existing.row_hash !== rowHash) {
          // Update existing record
          await query(
            `UPDATE trapper.staged_records
             SET payload = $1, row_hash = $2, updated_at = NOW()
             WHERE staged_record_id = $3`,
            [JSON.stringify(row), rowHash, existing.staged_record_id]
          );
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Insert new record
        await query(
          `INSERT INTO trapper.staged_records
           (source_system, source_table, source_row_id, payload, row_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [upload.source_system, upload.source_table, sourceRowId, JSON.stringify(row), rowHash]
        );
        inserted++;
      }
    }

    // Run post-processing for ClinicHQ
    let postProcessingResults = null;
    if (upload.source_system === 'clinichq') {
      postProcessingResults = await runClinicHQPostProcessing(upload.source_table);
    }

    // Mark as completed
    await query(
      `UPDATE trapper.file_uploads
       SET status = 'completed', processed_at = NOW(),
           rows_total = $2, rows_inserted = $3, rows_updated = $4, rows_skipped = $5
       WHERE upload_id = $1`,
      [uploadId, rows.length, inserted, updated, skipped]
    );

    return NextResponse.json({
      success: true,
      upload_id: uploadId,
      rows_total: rows.length,
      rows_inserted: inserted,
      rows_updated: updated,
      rows_skipped: skipped,
      post_processing: postProcessingResults,
    });

  } catch (error) {
    console.error("Processing error:", error);

    // Mark as failed
    await query(
      `UPDATE trapper.file_uploads
       SET status = 'failed', error_message = $2
       WHERE upload_id = $1`,
      [uploadId, error instanceof Error ? error.message : "Unknown error"]
    );

    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 }
    );
  }
}

// Post-processing for ClinicHQ data
async function runClinicHQPostProcessing(sourceTable: string): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  if (sourceTable === 'cat_info') {
    // Update sot_cats.sex from new cat_info records
    const sexUpdates = await query(`
      UPDATE trapper.sot_cats c
      SET sex = sr.payload->>'Sex'
      FROM trapper.staged_records sr
      JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE ci.cat_id = c.cat_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'cat_info'
        AND sr.payload->>'Sex' IS NOT NULL
        AND sr.payload->>'Sex' != ''
        AND LOWER(c.sex) IS DISTINCT FROM LOWER(sr.payload->>'Sex')
    `);
    results.sex_updates = sexUpdates.rowCount || 0;
  }

  if (sourceTable === 'owner_info') {
    // Create/update people from owner_info
    // First, find people by email match or create new
    const peopleUpdates = await query(`
      WITH owner_data AS (
        SELECT DISTINCT ON (LOWER(TRIM(payload->>'Owner Email')))
          payload->>'Owner First Name' as first_name,
          payload->>'Owner Last Name' as last_name,
          LOWER(TRIM(payload->>'Owner Email')) as email,
          payload->>'Owner Phone' as phone,
          payload->>'Owner Cell Phone' as cell_phone,
          payload->>'Owner Address' as address,
          payload->>'Microchip Number' as microchip
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'owner_info'
          AND payload->>'Owner Email' IS NOT NULL
          AND TRIM(payload->>'Owner Email') != ''
        ORDER BY LOWER(TRIM(payload->>'Owner Email')), payload->>'Date' DESC
      )
      UPDATE trapper.sot_people p
      SET
        phone = COALESCE(NULLIF(od.cell_phone, ''), NULLIF(od.phone, ''), p.phone),
        updated_at = NOW()
      FROM owner_data od
      WHERE LOWER(TRIM(p.email)) = od.email
        AND od.email IS NOT NULL
      RETURNING p.person_id
    `);
    results.people_updated = peopleUpdates.rowCount || 0;

    // Link people to appointments via microchip
    const personLinks = await query(`
      UPDATE trapper.sot_appointments a
      SET person_id = p.person_id
      FROM trapper.staged_records sr
      JOIN trapper.sot_people p ON LOWER(TRIM(p.email)) = LOWER(TRIM(sr.payload->>'Owner Email'))
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND a.appointment_number = sr.payload->>'Number'
        AND a.person_id IS NULL
        AND sr.payload->>'Owner Email' IS NOT NULL
        AND TRIM(sr.payload->>'Owner Email') != ''
    `);
    results.appointments_linked_to_people = personLinks.rowCount || 0;

    // Link cats to people via appointments
    const catPersonLinks = await query(`
      INSERT INTO trapper.cat_person_relationships (cat_id, person_id, relationship_type, confidence, source_system, source_table)
      SELECT DISTINCT
        a.cat_id,
        a.person_id,
        'caretaker',
        'high',
        'clinichq',
        'owner_info'
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.person_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_person_relationships cpr
          WHERE cpr.cat_id = a.cat_id AND cpr.person_id = a.person_id
        )
      ON CONFLICT DO NOTHING
    `);
    results.cat_person_links = catPersonLinks.rowCount || 0;
  }

  if (sourceTable === 'appointment_info') {
    // Create sot_appointments from staged_records
    // Uses get_canonical_cat_id to handle merged cats
    const newAppointments = await query(`
      INSERT INTO trapper.sot_appointments (
        cat_id, appointment_date, appointment_number, service_type,
        is_spay, is_neuter, vet_name, technician, temperature, medical_notes,
        is_lactating, is_pregnant, is_in_heat,
        data_source, source_system, source_record_id, source_row_hash
      )
      SELECT
        trapper.get_canonical_cat_id(c.cat_id),
        TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'),
        sr.payload->>'Number',
        sr.payload->>'Service / Subsidy',
        sr.payload->>'Spay' = 'Yes',
        sr.payload->>'Neuter' = 'Yes',
        sr.payload->>'Vet Name',
        sr.payload->>'Technician',
        NULLIF(sr.payload->>'Temperature', '')::NUMERIC(4,1),
        sr.payload->>'Internal Medical Notes',
        sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes',
        sr.payload->>'Pregnant' = 'Yes',
        sr.payload->>'In Heat' = 'Yes',
        'clinichq', 'clinichq', sr.source_row_id, sr.row_hash
      FROM trapper.staged_records sr
      LEFT JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
        AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
        AND NOT EXISTS (
          SELECT 1 FROM trapper.sot_appointments a
          WHERE a.appointment_number = sr.payload->>'Number'
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_appointments = newAppointments.rowCount || 0;

    // Create cat_procedures from appointments with spay service_type
    const newSpays = await query(`
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician, is_spay, is_neuter,
        source_system, source_record_id
      )
      SELECT
        a.cat_id, a.appointment_id, 'spay', a.appointment_date,
        'completed'::trapper.procedure_status,
        a.vet_name, a.technician, TRUE, FALSE,
        'clinichq', a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.service_type ILIKE '%spay%'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_procedures cp
          WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_spays = newSpays.rowCount || 0;

    // Create cat_procedures for neuter service_type
    const newNeuters = await query(`
      INSERT INTO trapper.cat_procedures (
        cat_id, appointment_id, procedure_type, procedure_date, status,
        performed_by, technician, is_spay, is_neuter,
        source_system, source_record_id
      )
      SELECT
        a.cat_id, a.appointment_id, 'neuter', a.appointment_date,
        'completed'::trapper.procedure_status,
        a.vet_name, a.technician, FALSE, TRUE,
        'clinichq', a.appointment_number
      FROM trapper.sot_appointments a
      WHERE a.cat_id IS NOT NULL
        AND a.service_type ILIKE '%neuter%'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_procedures cp
          WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE
        )
      ON CONFLICT DO NOTHING
    `);
    results.new_neuters = newNeuters.rowCount || 0;

    // Fix procedures based on cat sex
    const fixedMales = await query(`
      UPDATE trapper.cat_procedures cp
      SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
      FROM trapper.sot_cats c
      WHERE cp.cat_id = c.cat_id
        AND cp.is_spay = TRUE
        AND LOWER(c.sex) = 'male'
    `);
    results.fixed_males = fixedMales.rowCount || 0;

    const fixedFemales = await query(`
      UPDATE trapper.cat_procedures cp
      SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
      FROM trapper.sot_cats c
      WHERE cp.cat_id = c.cat_id
        AND cp.is_neuter = TRUE
        AND LOWER(c.sex) = 'female'
    `);
    results.fixed_females = fixedFemales.rowCount || 0;

    // Auto-link cats to places via appointments
    const linkedViaAppts = await query(`
      INSERT INTO trapper.cat_place_relationships (
        cat_id, place_id, relationship_type, confidence, source_system, source_table
      )
      SELECT DISTINCT
        a.cat_id, ppr.place_id, 'appointment_site', 'high', 'auto_link', 'ingest_ui'
      FROM trapper.sot_appointments a
      JOIN trapper.person_place_relationships ppr ON ppr.person_id = a.person_id
      WHERE a.cat_id IS NOT NULL AND ppr.place_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr
          WHERE cpr.cat_id = a.cat_id AND cpr.place_id = ppr.place_id
        )
      ON CONFLICT DO NOTHING
    `);
    results.linked_cats_via_appointments = linkedViaAppts.rowCount || 0;

    // Auto-link cats to places via person relationships (catches cats without appointments)
    const linkedViaPerson = await query(`
      INSERT INTO trapper.cat_place_relationships (
        cat_id, place_id, relationship_type, confidence, source_system, source_table
      )
      SELECT DISTINCT
        pcr.cat_id, ppr.place_id, 'owner_relationship', 'medium', 'auto_link', 'ingest_ui'
      FROM trapper.person_cat_relationships pcr
      JOIN trapper.person_place_relationships ppr ON ppr.person_id = pcr.person_id
      WHERE pcr.cat_id IS NOT NULL AND ppr.place_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr
          WHERE cpr.cat_id = pcr.cat_id AND cpr.place_id = ppr.place_id
        )
      ON CONFLICT DO NOTHING
    `);
    results.linked_cats_via_person = linkedViaPerson.rowCount || 0;

    // Update altered_status
    await query(`
      UPDATE trapper.sot_cats c SET altered_status = 'spayed'
      WHERE c.altered_status IS DISTINCT FROM 'spayed'
        AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE)
    `);
    await query(`
      UPDATE trapper.sot_cats c SET altered_status = 'neutered'
      WHERE c.altered_status IS DISTINCT FROM 'neutered'
        AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE)
    `);
  }

  return results;
}
