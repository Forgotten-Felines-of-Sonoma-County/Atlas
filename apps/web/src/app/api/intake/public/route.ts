import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Public API endpoint for embedded intake form submissions
 *
 * This endpoint is designed to receive submissions from:
 * - Website-embedded forms (iframe or JavaScript widget)
 * - External integrations
 * - Third-party form builders
 *
 * Security:
 * - CORS enabled for configured origins
 * - Rate limiting recommended (implement at CDN/proxy level)
 * - Honeypot field for spam detection
 * - Basic validation on all fields
 *
 * Usage:
 *   POST /api/intake/public
 *   Content-Type: application/json
 *
 *   {
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john@example.com",
 *     "phone": "555-123-4567",
 *     "cats_address": "123 Main St",
 *     "cats_city": "Santa Rosa",
 *     "cats_zip": "95401",
 *     "cat_count_estimate": 5,
 *     "has_kittens": true,
 *     ...
 *   }
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Allowed origins for CORS (configure in env)
const ALLOWED_ORIGINS = process.env.INTAKE_ALLOWED_ORIGINS?.split(",") || [
  "https://forgottenfelines.com",
  "https://www.forgottenfelines.com",
  "https://forgottenfelines.org",
  "https://www.forgottenfelines.org",
];

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const isAllowedOrigin = origin && (ALLOWED_ORIGINS.includes(origin) || origin.includes("localhost"));

  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": isAllowedOrigin ? origin : "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
      "Access-Control-Max-Age": "86400",
    },
  });
}

interface PublicIntakeSubmission {
  // Contact (required)
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;

  // Third-party report
  is_third_party_report?: boolean;
  third_party_relationship?: string;
  property_owner_name?: string;
  property_owner_phone?: string;
  property_owner_email?: string;

  // Location (required: cats_address)
  cats_address: string;
  cats_city?: string;
  cats_zip?: string;
  county?: string;

  // Cats (required: ownership_status)
  ownership_status: string;
  cat_count_estimate?: number;
  cat_count_text?: string;
  fixed_status?: string;

  // Kittens (conditional - only if has_kittens is true)
  has_kittens?: boolean;
  kitten_count?: number;
  kitten_age_estimate?: string;
  kitten_mixed_ages_description?: string;
  kitten_behavior?: string;
  kitten_contained?: string;
  mom_present?: string;
  mom_fixed?: string;
  can_bring_in?: string;
  kitten_notes?: string;

  // Situation
  awareness_duration?: string;
  has_medical_concerns?: boolean;
  medical_description?: string;
  is_emergency?: boolean;
  cats_being_fed?: boolean;
  feeder_info?: string;
  has_property_access?: boolean;
  access_notes?: string;
  is_property_owner?: boolean;
  situation_description?: string;
  referral_source?: string;

  // Spam protection
  _honeypot?: string; // Should be empty (hidden field)
  _timestamp?: number; // Form load timestamp (detect bots)

  // Source tracking
  _source_url?: string;
  _source_form?: string;
}

// Validation
function validateSubmission(data: PublicIntakeSubmission): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!data.first_name?.trim()) errors.push("First name is required");
  if (!data.last_name?.trim()) errors.push("Last name is required");
  if (!data.email?.trim()) errors.push("Email is required");
  if (!data.cats_address?.trim()) errors.push("Cat location address is required");
  if (!data.ownership_status) errors.push("Ownership status is required");

  // Email format
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push("Invalid email format");
  }

  // Phone format (optional but validate if provided)
  if (data.phone && data.phone.replace(/\D/g, "").length < 10) {
    errors.push("Phone number must be at least 10 digits");
  }

  // Spam checks
  if (data._honeypot) {
    errors.push("Spam detected");
  }

  // Timestamp check (form loaded < 3 seconds ago is suspicious)
  if (data._timestamp) {
    const elapsed = Date.now() - data._timestamp;
    if (elapsed < 3000) {
      errors.push("Form submitted too quickly");
    }
  }

  return { valid: errors.length === 0, errors };
}

// Determine triage category based on submission
function triageSubmission(data: PublicIntakeSubmission): {
  category: string;
  priority: string;
  flags: string[];
} {
  const flags: string[] = [];
  let priority = "normal";
  let category = "standard";

  // Emergency
  if (data.is_emergency) {
    priority = "urgent";
    category = "emergency";
    flags.push("EMERGENCY");
  }

  // Medical concerns
  if (data.has_medical_concerns) {
    if (priority !== "urgent") priority = "high";
    flags.push("medical_concern");
  }

  // Kittens
  if (data.has_kittens) {
    flags.push("kittens");
    if (data.kitten_age_estimate === "under_4_weeks") {
      priority = "urgent";
      category = "kitten_emergency";
      flags.push("bottle_babies");
    } else if (data.kitten_age_estimate === "4_to_8_weeks") {
      if (priority !== "urgent") priority = "high";
      category = "kitten_intake";
    }
  }

  // Third-party report
  if (data.is_third_party_report) {
    category = "third_party";
    flags.push("third_party_report");
  }

  // Large colony
  if (data.cat_count_estimate && data.cat_count_estimate >= 10) {
    flags.push("large_colony");
  }

  // Out of primary service area
  if (data.county && !["Sonoma", "sonoma"].includes(data.county)) {
    flags.push("out_of_area");
  }

  // Owned cats (lower priority for TNR org)
  if (data.ownership_status === "my_cat") {
    category = "owned_cat";
    flags.push("owned_cat");
  }

  return { category, priority, flags };
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const isAllowedOrigin = origin && (ALLOWED_ORIGINS.includes(origin) || origin.includes("localhost"));

  const corsHeaders = {
    "Access-Control-Allow-Origin": isAllowedOrigin ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  try {
    const data: PublicIntakeSubmission = await request.json();

    // Validate
    const { valid, errors } = validateSubmission(data);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: errors },
        { status: 400, headers: corsHeaders }
      );
    }

    // Triage
    const { category, priority, flags } = triageSubmission(data);

    // Normalize phone
    const phoneNorm = data.phone?.replace(/\D/g, "") || null;

    // Build full address
    const fullAddress = [
      data.cats_address,
      data.cats_city,
      data.cats_zip
    ].filter(Boolean).join(", ");

    // Insert into intake_submissions
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO trapper.intake_submissions (
          -- Contact
          first_name, last_name, email, phone,
          -- Third-party
          is_third_party_report, third_party_relationship,
          property_owner_name, property_owner_phone, property_owner_email,
          -- Location
          cats_address, cats_city, cats_zip, county,
          -- Cats
          ownership_status, cat_count_estimate, cat_count_text, fixed_status,
          -- Kittens
          has_kittens, kitten_count, kitten_age_estimate,
          kitten_mixed_ages_description, kitten_behavior, kitten_contained,
          mom_present, mom_fixed, can_bring_in, kitten_notes,
          -- Situation
          awareness_duration, has_medical_concerns, medical_description,
          is_emergency, cats_being_fed, feeder_info,
          has_property_access, access_notes, is_property_owner,
          situation_description, referral_source,
          -- Triage
          triage_category, priority, triage_flags,
          -- Meta
          intake_source, source_url, source_form, submission_ip
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
          $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
          $39, $40, $41,
          'public_api', $42, $43, $44
        )
        RETURNING submission_id, triage_category, priority
      `, [
        data.first_name.trim(),
        data.last_name.trim(),
        data.email.trim().toLowerCase(),
        phoneNorm,
        data.is_third_party_report || false,
        data.third_party_relationship || null,
        data.property_owner_name || null,
        data.property_owner_phone || null,
        data.property_owner_email || null,
        data.cats_address.trim(),
        data.cats_city || null,
        data.cats_zip || null,
        data.county || null,
        data.ownership_status,
        data.cat_count_estimate || null,
        data.cat_count_text || null,
        data.fixed_status || null,
        data.has_kittens || false,
        data.kitten_count || null,
        data.kitten_age_estimate || null,
        data.kitten_mixed_ages_description || null,
        data.kitten_behavior || null,
        data.kitten_contained || null,
        data.mom_present || null,
        data.mom_fixed || null,
        data.can_bring_in || null,
        data.kitten_notes || null,
        data.awareness_duration || null,
        data.has_medical_concerns || false,
        data.medical_description || null,
        data.is_emergency || false,
        data.cats_being_fed || false,
        data.feeder_info || null,
        data.has_property_access || false,
        data.access_notes || null,
        data.is_property_owner || false,
        data.situation_description || null,
        data.referral_source || null,
        category,
        priority,
        flags,
        data._source_url || origin || null,
        data._source_form || null,
        request.headers.get("x-forwarded-for")?.split(",")[0] ||
          request.headers.get("x-real-ip") ||
          "unknown"
      ]);

      const submissionId = result.rows[0].submission_id;

      // Log the submission
      await client.query(`
        INSERT INTO trapper.data_changes (
          entity_type, entity_key, field_name, new_value, change_source
        ) VALUES ('intake_submission', $1, 'created', $2, 'public_api')
      `, [submissionId, JSON.stringify({ category, priority, flags })]);

      // Return success with submission reference
      return NextResponse.json(
        {
          success: true,
          message: getSuccessMessage(category, priority),
          submission_id: submissionId.substring(0, 8), // Partial ID for reference
          triage_category: category,
          priority: priority,
        },
        { status: 201, headers: corsHeaders }
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Public intake submission error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to process submission. Please try again.",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

function getSuccessMessage(category: string, priority: string): string {
  if (category === "emergency" || priority === "urgent") {
    return "Your emergency request has been received. We will contact you as soon as possible.";
  }
  if (category === "kitten_emergency") {
    return "Your kitten intake request has been flagged as urgent. We will contact you within 24 hours.";
  }
  if (category === "third_party") {
    return "Thank you for reporting. We will follow up with the property owner before scheduling services.";
  }
  return "Thank you for your request! We will review it and contact you within 3-5 business days.";
}
