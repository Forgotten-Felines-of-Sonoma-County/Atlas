import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * GET /api/places/[id]/history
 *
 * Returns historical context data for a place:
 * - Legacy colony estimates (KML, parsed notes)
 * - Qualitative signals
 * - Historical notes with attribution
 */

// Staff abbreviation mapping
const STAFF_ABBREVIATIONS: Record<string, string> = {
  'MP': 'MP', // Predecessor
  'JK': 'JK', // Jami
  'HF': 'HF', // Heidi
  'DF': 'DF', // Diane
  // Add more as needed
};

// Words to filter from notes (case-insensitive)
const PROFANITY_FILTER = [
  'fuck', 'shit', 'damn', 'ass', 'bitch', 'crap', 'hell',
  // Add more as needed
];

// Redact phone numbers
function redactPhoneNumbers(text: string): string {
  return text.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]');
}

// Filter profanity (replace with asterisks)
function filterProfanity(text: string): string {
  let filtered = text;
  for (const word of PROFANITY_FILTER) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  }
  return filtered;
}

// Clean notes for display
function cleanNotes(text: string | null): string | null {
  if (!text) return null;
  let cleaned = redactPhoneNumbers(text);
  cleaned = filterProfanity(cleaned);
  return cleaned.trim();
}

// Extract staff initials from notes
function extractAttribution(text: string): string[] {
  const initialsPattern = /\b([A-Z]{2})\b/g;
  const matches = text.match(initialsPattern) || [];
  return [...new Set(matches.filter(m => STAFF_ABBREVIATIONS[m]))];
}

interface HistoricalEstimate {
  estimate_id: string;
  total_cats: number | null;
  altered_count: number | null;
  kitten_count: number | null;
  source_type: string;
  observation_date: string | null;
  notes: string | null;
  created_at: string;
}

interface HistoricalContext {
  place_id: string;
  place_name: string | null;

  // Quasi-quantitative summary
  historical_tnr_total: number | null;
  historical_colony_sizes: number[];
  date_range: {
    earliest: string | null;
    latest: string | null;
  };

  // Qualitative data
  signals: string[];
  notes_summary: Array<{
    date: string | null;
    source: string;
    text: string;
    attribution: string[];
  }>;

  // Raw estimates for detail view
  estimates: HistoricalEstimate[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: placeId } = await params;

  try {
    // Get place info
    const placeResult = await queryRows<{ display_name: string }>(
      `SELECT display_name FROM trapper.places WHERE place_id = $1`,
      [placeId]
    );

    if (placeResult.length === 0) {
      return NextResponse.json({ error: 'Place not found' }, { status: 404 });
    }

    // Get historical estimates (legacy sources)
    const estimates = await queryRows<HistoricalEstimate>(
      `SELECT
        estimate_id,
        total_cats,
        altered_count,
        kitten_count,
        source_type,
        observation_date::TEXT,
        notes,
        created_at::TEXT
      FROM trapper.place_colony_estimates
      WHERE place_id = $1
        AND source_type IN (
          'legacy_mymaps',
          'internal_notes_parse',
          'intake_situation_parse',
          'appointment_notes_parse'
        )
      ORDER BY COALESCE(observation_date, created_at::DATE) DESC
      LIMIT 50`,
      [placeId]
    );

    // Get request notes for this place (for additional context)
    const requestNotes = await queryRows<{
      notes: string | null;
      internal_notes: string | null;
      legacy_notes: string | null;
      source_created_at: string | null;
    }>(
      `SELECT
        notes,
        internal_notes,
        legacy_notes,
        source_created_at::TEXT
      FROM trapper.sot_requests
      WHERE place_id = $1
        AND (notes IS NOT NULL OR internal_notes IS NOT NULL OR legacy_notes IS NOT NULL)
      ORDER BY source_created_at DESC NULLS LAST
      LIMIT 10`,
      [placeId]
    );

    // Build response
    const colonySizes: number[] = [];
    let tnrTotal = 0;
    const signals = new Set<string>();
    const notesSummary: HistoricalContext['notes_summary'] = [];
    let earliestDate: string | null = null;
    let latestDate: string | null = null;

    // Process estimates
    for (const est of estimates) {
      if (est.total_cats) colonySizes.push(est.total_cats);
      if (est.altered_count) tnrTotal += est.altered_count;

      const date = est.observation_date || est.created_at?.split('T')[0];
      if (date) {
        if (!earliestDate || date < earliestDate) earliestDate = date;
        if (!latestDate || date > latestDate) latestDate = date;
      }

      // Extract signals from notes
      if (est.notes) {
        const cleanedNotes = cleanNotes(est.notes);
        if (cleanedNotes) {
          // Parse signals from notes
          const signalPatterns: Record<string, RegExp> = {
            'temperament': /feral|friendly|shy|aggressive|semi-feral/i,
            'relocated': /relocat|moved|gone/i,
            'pregnant': /pregnant|nursing|lactating/i,
            'kittens': /kitten|babies|litter/i,
            'complete': /complete|all fixed|100%/i,
            'mortality': /deceased|died|dead|rip/i,
            'adopted': /adopted|rehomed/i,
          };

          for (const [signal, pattern] of Object.entries(signalPatterns)) {
            if (pattern.test(est.notes)) {
              signals.add(signal);
            }
          }

          // Add to notes summary
          notesSummary.push({
            date,
            source: est.source_type.replace(/_/g, ' '),
            text: cleanedNotes.substring(0, 300) + (cleanedNotes.length > 300 ? '...' : ''),
            attribution: extractAttribution(est.notes),
          });
        }
      }
    }

    // Process request notes
    for (const req of requestNotes) {
      const allNotes = [req.notes, req.internal_notes, req.legacy_notes]
        .filter(Boolean)
        .join(' ');

      if (allNotes) {
        const cleanedNotes = cleanNotes(allNotes);
        if (cleanedNotes && cleanedNotes.length > 20) {
          notesSummary.push({
            date: req.source_created_at?.split('T')[0] || null,
            source: 'request notes',
            text: cleanedNotes.substring(0, 300) + (cleanedNotes.length > 300 ? '...' : ''),
            attribution: extractAttribution(allNotes),
          });
        }
      }
    }

    // Sort notes by date (newest first)
    notesSummary.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    // Limit notes to most recent 10
    const limitedNotes = notesSummary.slice(0, 10);

    const response: HistoricalContext = {
      place_id: placeId,
      place_name: placeResult[0].display_name,
      historical_tnr_total: tnrTotal || null,
      historical_colony_sizes: [...new Set(colonySizes)].sort((a, b) => b - a),
      date_range: {
        earliest: earliestDate,
        latest: latestDate,
      },
      signals: Array.from(signals),
      notes_summary: limitedNotes,
      estimates: estimates.map(e => ({
        ...e,
        notes: cleanNotes(e.notes),
      })),
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching place history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch historical context' },
      { status: 500 }
    );
  }
}
