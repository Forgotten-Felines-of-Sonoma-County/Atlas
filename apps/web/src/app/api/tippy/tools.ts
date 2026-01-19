import { queryOne, queryRows } from "@/lib/db";

/**
 * Tippy Database Query Tools
 *
 * These tools allow Tippy to query the Atlas database to answer
 * questions about cats, places, people, and requests.
 *
 * All queries are READ-ONLY for security.
 */

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Tool definitions for Claude's tool use feature
 */
export const TIPPY_TOOLS = [
  {
    name: "query_cats_at_place",
    description:
      "Get count and details of cats at a specific address or place. Use when user asks about cats at a location.",
    input_schema: {
      type: "object" as const,
      properties: {
        address_search: {
          type: "string",
          description: "Address or place name to search for (e.g., 'Selvage Rd', '123 Main St')",
        },
      },
      required: ["address_search"],
    },
  },
  {
    name: "query_place_colony_status",
    description:
      "Get colony size estimate, alteration rate, and FFR progress for a place. Use for questions about colony health or TNR/FFR progress.",
    input_schema: {
      type: "object" as const,
      properties: {
        address_search: {
          type: "string",
          description: "Address or place name to search for",
        },
      },
      required: ["address_search"],
    },
  },
  {
    name: "query_request_stats",
    description:
      "Get statistics about requests - counts by status, recent activity, or area breakdown.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter_type: {
          type: "string",
          enum: ["recent", "by_status", "by_area", "pending"],
          description: "Type of statistics to retrieve",
        },
        area: {
          type: "string",
          description: "Optional area/city to filter by",
        },
      },
      required: ["filter_type"],
    },
  },
  {
    name: "query_ffr_impact",
    description:
      "Get FFR (Find Fix Return) impact metrics - total cats helped, alteration rates, requests completed. Use for impact questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        area: {
          type: "string",
          description: "Optional area to filter by (leave empty for overall stats)",
        },
        time_period: {
          type: "string",
          enum: ["all_time", "this_year", "last_30_days"],
          description: "Time period for stats",
        },
      },
      required: [],
    },
  },
  {
    name: "query_cats_altered_in_area",
    description:
      "Get count of cats that have been spayed/neutered in a specific city or area. Use when user asks 'how many cats have we altered/fixed/spayed/neutered in [city]?' or similar area-based alteration questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        area: {
          type: "string",
          description: "City or area name to search for (e.g., 'Novato', 'Santa Rosa', 'Petaluma')",
        },
      },
      required: ["area"],
    },
  },
  {
    name: "query_person_history",
    description:
      "Get summary of a person's history with FFSC - their requests, cats helped, role.",
    input_schema: {
      type: "object" as const,
      properties: {
        name_search: {
          type: "string",
          description: "Person's name to search for",
        },
      },
      required: ["name_search"],
    },
  },
  {
    name: "query_knowledge_base",
    description:
      "Search the FFSC knowledge base for procedures, training materials, FAQs, talking points, and policies. Use this when staff ask about how to do something, policies, objection handling, or need guidance on FFSC operations.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query - what the user is asking about (e.g., 'how to set traps', 'objection handling', 'training requirements')",
        },
        category: {
          type: "string",
          enum: ["procedures", "training", "faq", "troubleshooting", "talking_points", "equipment", "policy"],
          description: "Optional category filter to narrow results",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "log_field_event",
    description:
      "Log a field event that just happened. Use when staff say things like 'I just caught 2 cats at Oak St' or 'We trapped 3 cats today' or 'Saw 5 cats at the feeding station'. This records the observation for tracking.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_type: {
          type: "string",
          enum: ["observation", "trapping", "feeding", "sighting", "other"],
          description: "Type of event being logged",
        },
        location: {
          type: "string",
          description: "Address or place name where the event occurred",
        },
        cat_count: {
          type: "number",
          description: "Number of cats involved (seen, trapped, etc.)",
        },
        eartipped_count: {
          type: "number",
          description: "Number of cats that had ear tips (already altered)",
        },
        notes: {
          type: "string",
          description: "Additional details about the event",
        },
      },
      required: ["event_type", "location"],
    },
  },
  {
    name: "lookup_cat_appointment",
    description:
      "Look up a specific cat's clinic appointment history by microchip number, cat name, or owner name. Searches both verified Atlas records AND raw ClinicHQ data. Use when staff ask about a specific cat's visit, microchip lookup, or appointment history. Reports discrepancies between raw and processed data.",
    input_schema: {
      type: "object" as const,
      properties: {
        microchip: {
          type: "string",
          description: "Microchip number to search for (e.g., '985112012345678')",
        },
        cat_name: {
          type: "string",
          description: "Cat's name to search for",
        },
        owner_name: {
          type: "string",
          description: "Owner's name to search for",
        },
        owner_phone: {
          type: "string",
          description: "Owner's phone number to search for",
        },
      },
      required: [],
    },
  },
];

/**
 * Execute a tool call and return results
 */
export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "query_cats_at_place":
        return await queryCatsAtPlace(toolInput.address_search as string);

      case "query_place_colony_status":
        return await queryPlaceColonyStatus(toolInput.address_search as string);

      case "query_request_stats":
        return await queryRequestStats(
          toolInput.filter_type as string,
          toolInput.area as string | undefined
        );

      case "query_ffr_impact":
        return await queryFfrImpact(
          toolInput.area as string | undefined,
          toolInput.time_period as string | undefined
        );

      case "query_cats_altered_in_area":
        return await queryCatsAlteredInArea(toolInput.area as string);

      case "query_person_history":
        return await queryPersonHistory(toolInput.name_search as string);

      case "query_knowledge_base":
        return await queryKnowledgeBase(
          toolInput.query as string,
          toolInput.category as string | undefined
        );

      case "log_field_event":
        return await logFieldEvent(
          toolInput.event_type as string,
          toolInput.location as string,
          toolInput.cat_count as number | undefined,
          toolInput.eartipped_count as number | undefined,
          toolInput.notes as string | undefined
        );

      case "lookup_cat_appointment":
        return await lookupCatAppointment(
          toolInput.microchip as string | undefined,
          toolInput.cat_name as string | undefined,
          toolInput.owner_name as string | undefined,
          toolInput.owner_phone as string | undefined
        );

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Tool execution error (${toolName}):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Database query failed",
    };
  }
}

/**
 * Query cats at a specific place/address
 */
async function queryCatsAtPlace(addressSearch: string): Promise<ToolResult> {
  const results = await queryRows(
    `
    SELECT
      p.place_id,
      p.display_name as place_name,
      p.formatted_address as address,
      COUNT(DISTINCT c.cat_id) as total_cats,
      COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'Yes')) as altered_cats,
      COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status = 'intact' OR c.altered_status = 'No') as unaltered_cats
    FROM trapper.places p
    LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
    LEFT JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
    WHERE (p.display_name ILIKE $1 OR p.formatted_address ILIKE $1)
      AND p.merged_into_place_id IS NULL
    GROUP BY p.place_id, p.display_name, p.formatted_address
    ORDER BY COUNT(DISTINCT c.cat_id) DESC
    LIMIT 5
    `,
    [`%${addressSearch}%`]
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        message: `No places found matching "${addressSearch}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      places: results,
      summary: results.length === 1
        ? `Found ${results[0].total_cats} cats at ${results[0].place_name || results[0].address}`
        : `Found ${results.length} places matching "${addressSearch}"`,
    },
  };
}

/**
 * Query colony status for a place
 */
async function queryPlaceColonyStatus(addressSearch: string): Promise<ToolResult> {
  const result = await queryOne<{
    place_id: string;
    display_name: string | null;
    formatted_address: string | null;
    colony_estimate: number;
    verified_altered: number;
    verified_cats: number;
    completed_requests: number;
    active_requests: number;
    alteration_rate_pct: number | null;
    estimated_work_remaining: number;
  }>(
    `
    WITH place_match AS (
      SELECT place_id, display_name, formatted_address
      FROM trapper.places
      WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1)
        AND merged_into_place_id IS NULL
      ORDER BY
        CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END,
        display_name
      LIMIT 1
    ),
    ecology AS (
      SELECT
        pm.place_id,
        pm.display_name,
        pm.formatted_address,
        COALESCE(
          (SELECT total_cats FROM trapper.place_colony_estimates pce
           WHERE pce.place_id = pm.place_id
           ORDER BY observation_date DESC NULLS LAST LIMIT 1),
          (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pm.place_id)
        ) as colony_estimate,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr
         JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
         WHERE cpr.place_id = pm.place_id
         AND c.altered_status IN ('spayed', 'neutered', 'Yes')) as verified_altered,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = pm.place_id) as verified_cats,
        (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = pm.place_id AND r.status = 'completed') as completed_requests,
        (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.place_id = pm.place_id AND r.status NOT IN ('completed', 'cancelled')) as active_requests
      FROM place_match pm
    )
    SELECT
      place_id,
      display_name,
      formatted_address,
      colony_estimate,
      verified_altered,
      verified_cats,
      completed_requests,
      active_requests,
      CASE WHEN colony_estimate > 0
        THEN ROUND((verified_altered::numeric / colony_estimate) * 100, 1)
        ELSE NULL
      END as alteration_rate_pct,
      GREATEST(0, colony_estimate - verified_altered) as estimated_work_remaining
    FROM ecology
    `,
    [`%${addressSearch}%`]
  );

  if (!result) {
    return {
      success: true,
      data: {
        found: false,
        message: `No place found matching "${addressSearch}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      place: result,
      summary: `${result.display_name || result.formatted_address}: ~${result.colony_estimate} cats, ${result.verified_altered} altered (${result.alteration_rate_pct || 0}%), ${result.estimated_work_remaining} remaining`,
    },
  };
}

/**
 * Query request statistics
 */
async function queryRequestStats(
  filterType: string,
  area?: string
): Promise<ToolResult> {
  let result;

  switch (filterType) {
    case "recent":
      result = await queryRows(
        `
        SELECT r.status, COUNT(*) as count
        FROM trapper.sot_requests r
        ${area ? "LEFT JOIN trapper.places p ON r.place_id = p.place_id" : ""}
        WHERE r.created_at > NOW() - INTERVAL '30 days'
        ${area ? "AND p.formatted_address ILIKE $1" : ""}
        GROUP BY r.status
        ORDER BY count DESC
        `,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: {
          period: "Last 30 days",
          area: area || "All areas",
          by_status: result,
        },
      };

    case "by_status":
      result = await queryRows(
        `
        SELECT r.status, COUNT(*) as count
        FROM trapper.sot_requests r
        ${area ? "LEFT JOIN trapper.places p ON r.place_id = p.place_id WHERE p.formatted_address ILIKE $1" : ""}
        GROUP BY r.status
        ORDER BY count DESC
        `,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: {
          area: area || "All areas",
          by_status: result,
        },
      };

    case "by_area":
      result = await queryRows(
        `
        SELECT
          COALESCE(
            CASE
              WHEN p.formatted_address ILIKE '%santa rosa%' THEN 'Santa Rosa'
              WHEN p.formatted_address ILIKE '%petaluma%' THEN 'Petaluma'
              WHEN p.formatted_address ILIKE '%rohnert park%' THEN 'Rohnert Park'
              WHEN p.formatted_address ILIKE '%sebastopol%' THEN 'Sebastopol'
              WHEN p.formatted_address ILIKE '%healdsburg%' THEN 'Healdsburg'
              WHEN p.formatted_address ILIKE '%windsor%' THEN 'Windsor'
              WHEN p.formatted_address ILIKE '%sonoma%' THEN 'Sonoma'
              WHEN p.formatted_address ILIKE '%cotati%' THEN 'Cotati'
              WHEN p.formatted_address ILIKE '%cloverdale%' THEN 'Cloverdale'
              WHEN p.formatted_address ILIKE '%novato%' THEN 'Novato'
              ELSE 'Other'
            END,
            'Unknown'
          ) as area,
          COUNT(*) as count
        FROM trapper.sot_requests r
        LEFT JOIN trapper.places p ON r.place_id = p.place_id
        WHERE r.status NOT IN ('cancelled')
        GROUP BY area
        ORDER BY count DESC
        LIMIT 10
        `
      );
      return {
        success: true,
        data: { by_area: result },
      };

    case "pending":
      result = await queryOne(
        `
        SELECT
          COUNT(*) FILTER (WHERE r.status = 'new') as new_requests,
          COUNT(*) FILTER (WHERE r.status = 'triaged') as triaged,
          COUNT(*) FILTER (WHERE r.status = 'scheduled') as scheduled,
          COUNT(*) FILTER (WHERE r.status = 'in_progress') as in_progress,
          COUNT(*) as total_pending
        FROM trapper.sot_requests r
        ${area ? "LEFT JOIN trapper.places p ON r.place_id = p.place_id" : ""}
        WHERE r.status NOT IN ('completed', 'cancelled')
        ${area ? "AND p.formatted_address ILIKE $1" : ""}
        `,
        area ? [`%${area}%`] : []
      );
      return {
        success: true,
        data: {
          area: area || "All areas",
          pending: result,
        },
      };

    default:
      return { success: false, error: `Unknown filter type: ${filterType}` };
  }
}

/**
 * Query FFR impact metrics
 */
async function queryFfrImpact(
  area?: string,
  timePeriod?: string
): Promise<ToolResult> {
  let dateFilter = "";
  if (timePeriod === "this_year") {
    dateFilter = "AND a.appointment_date >= DATE_TRUNC('year', CURRENT_DATE)";
  } else if (timePeriod === "last_30_days") {
    dateFilter = "AND a.appointment_date > NOW() - INTERVAL '30 days'";
  }

  const areaFilter = area ? "AND p.formatted_address ILIKE $1" : "";
  const params = area ? [`%${area}%`] : [];

  const result = await queryOne(
    `
    WITH impact AS (
      SELECT
        COUNT(DISTINCT c.cat_id) as total_cats_helped,
        COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'Yes')) as cats_altered,
        COUNT(DISTINCT r.request_id) as total_requests,
        COUNT(DISTINCT r.request_id) FILTER (WHERE r.status = 'completed') as completed_requests,
        COUNT(DISTINCT p.place_id) as places_served
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
      LEFT JOIN trapper.places p ON p.place_id = a.place_id
      LEFT JOIN trapper.sot_requests r ON r.place_id = p.place_id
      WHERE 1=1 ${dateFilter} ${areaFilter}
    )
    SELECT
      total_cats_helped,
      cats_altered,
      total_requests,
      completed_requests,
      places_served,
      CASE WHEN total_cats_helped > 0
        THEN ROUND((cats_altered::numeric / total_cats_helped) * 100, 1)
        ELSE 0
      END as overall_alteration_rate
    FROM impact
    `,
    params
  );

  return {
    success: true,
    data: {
      area: area || "All areas",
      period: timePeriod || "all_time",
      impact: result,
      summary: `${result?.cats_altered || 0} cats fixed through our FFR program${area ? ` in ${area}` : ""}`,
    },
  };
}

/**
 * Regional name mappings for Sonoma County
 * Maps common regional names to their constituent cities/towns/neighborhoods
 * Based on local terminology used by FFSC staff and Sonoma County residents
 */
const REGIONAL_MAPPINGS: Record<string, string[]> = {
  // ============ WEST COUNTY / RUSSIAN RIVER ============
  // "West County" is the local nickname for Russian River towns - quirky, funky, off-beat communities
  "west county": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Occidental", "Graton", "Sebastopol", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande", "Freestone", "Twin Hills"],
  "west sonoma": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Occidental", "Graton", "Sebastopol", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande", "Freestone"],
  "russian river": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero", "Villa Grande"],
  "river": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Jenner", "Duncans Mills", "Camp Meeker", "Cazadero"],
  "river towns": ["Guerneville", "Forestville", "Monte Rio", "Rio Nido", "Duncans Mills"],
  "lower river": ["Guerneville", "Monte Rio", "Jenner", "Duncans Mills"],

  // ============ SONOMA VALLEY / THE VALLEY ============
  // Southeastern Sonoma County, home to historic town of Sonoma
  "sonoma valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "El Verano", "Eldridge", "Vineburg", "Agua Caliente", "Fetters Hot Springs", "Schellville"],
  "the valley": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "El Verano", "Eldridge", "Vineburg", "Agua Caliente", "Fetters Hot Springs"],
  "valley of the moon": ["Sonoma", "Glen Ellen", "Kenwood", "Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs"],

  // "The Springs" - Hot springs communities between Sonoma and Glen Ellen
  "the springs": ["Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs", "El Verano"],
  "springs": ["Boyes Hot Springs", "Agua Caliente", "Fetters Hot Springs", "El Verano"],
  "boyes": ["Boyes Hot Springs"],
  "fetters": ["Fetters Hot Springs"],
  "agua caliente": ["Agua Caliente"],

  // ============ NORTH COUNTY / NORTHERN SONOMA ============
  // Along Highway 101 corridor north of Santa Rosa
  "north county": ["Cloverdale", "Geyserville", "Healdsburg", "Windsor", "Asti"],
  "northern sonoma": ["Cloverdale", "Geyserville", "Healdsburg", "Windsor", "Asti", "Lytton"],
  "upper county": ["Cloverdale", "Geyserville", "Healdsburg"],

  // Wine valleys in North County
  "alexander valley": ["Geyserville", "Cloverdale", "Asti", "Jimtown", "Lytton"],
  "dry creek": ["Healdsburg", "Geyserville"],
  "dry creek valley": ["Healdsburg", "Geyserville"],

  // ============ SOUTH COUNTY / SOUTHERN SONOMA ============
  // Southern part of county near Marin border
  "south county": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove", "Two Rock", "Lakeville", "Bloomfield"],
  "southern sonoma": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove", "Two Rock", "Lakeville"],
  "south sonoma": ["Petaluma", "Cotati", "Rohnert Park", "Penngrove"],

  // Petaluma area specifics
  "east petaluma": ["Petaluma"],
  "west petaluma": ["Petaluma"],
  "penngrove": ["Penngrove"],
  "two rock": ["Two Rock"],

  // ============ COASTAL ============
  // Pacific coast communities
  "coast": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Annapolis", "Valley Ford", "Freestone", "Salmon Creek"],
  "coastal": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Annapolis", "Valley Ford"],
  "sonoma coast": ["Bodega Bay", "Bodega", "Jenner", "Sea Ranch", "Stewarts Point", "Valley Ford", "Salmon Creek"],
  "bodega": ["Bodega Bay", "Bodega"],

  // ============ SANTA ROSA NEIGHBORHOODS ============
  // Santa Rosa is the county seat and largest city
  "santa rosa": ["Santa Rosa", "Fountaingrove", "Coffey Park", "Bennett Valley", "Rincon Valley", "Roseland", "Montgomery Village", "Railroad Square", "Oakmont", "Skyhawk", "Spring Lake", "Junior College", "Northwest Santa Rosa", "South Park", "Downtown Santa Rosa"],

  // Specific Santa Rosa neighborhoods
  "fountaingrove": ["Fountaingrove", "Santa Rosa"],
  "coffey park": ["Coffey Park", "Santa Rosa"],
  "bennett valley": ["Bennett Valley", "Santa Rosa"],
  "rincon valley": ["Rincon Valley", "Santa Rosa"],
  "rincon": ["Rincon Valley", "Santa Rosa"],
  "roseland": ["Roseland", "Santa Rosa"],
  "montgomery village": ["Montgomery Village", "Santa Rosa"],
  "railroad square": ["Railroad Square", "Santa Rosa"],
  "oakmont": ["Oakmont", "Santa Rosa"],
  "skyhawk": ["Skyhawk", "Santa Rosa"],
  "junior college": ["Junior College", "Santa Rosa"],
  "jc area": ["Junior College", "Santa Rosa"],
  "south park": ["South Park", "Santa Rosa"],
  "downtown santa rosa": ["Downtown Santa Rosa", "Santa Rosa"],

  // Mark West / Larkfield-Wikiup area (unincorporated north of Santa Rosa)
  "mark west": ["Larkfield", "Wikiup", "Mark West", "Fulton"],
  "larkfield": ["Larkfield", "Wikiup", "Mark West"],
  "wikiup": ["Larkfield", "Wikiup"],
  "larkfield-wikiup": ["Larkfield", "Wikiup", "Mark West"],
  "fulton": ["Fulton"],

  // ============ ROHNERT PARK / COTATI AREA ============
  "rohnert park": ["Rohnert Park"],
  "cotati": ["Cotati"],
  "rp": ["Rohnert Park"],

  // ============ HEALDSBURG AREA ============
  "healdsburg": ["Healdsburg"],
  "windsor": ["Windsor"],

  // ============ WINE COUNTRY (broad term) ============
  "wine country": ["Santa Rosa", "Healdsburg", "Sonoma", "Glen Ellen", "Kenwood", "Sebastopol", "Windsor", "Geyserville"],

  // ============ CENTRAL COUNTY / HIGHWAY 101 CORRIDOR ============
  "central county": ["Santa Rosa", "Rohnert Park", "Cotati", "Windsor"],
  "101 corridor": ["Santa Rosa", "Rohnert Park", "Cotati", "Petaluma", "Windsor", "Healdsburg", "Cloverdale"],

  // ============ SURROUNDING COUNTIES ============
  // FFSC serves as the regional high-volume spay/neuter clinic for North Bay

  // Marin County (south of Sonoma)
  "marin": ["Novato", "San Rafael", "Petaluma", "Mill Valley", "Sausalito", "Corte Madera", "Larkspur", "San Anselmo", "Fairfax", "Ross", "Tiburon", "Belvedere", "Kentfield", "Greenbrae", "Terra Linda", "Lucas Valley", "Marinwood", "Ignacio", "Hamilton", "Strawberry", "Tamalpais Valley", "Marin City", "Stinson Beach", "Bolinas", "Point Reyes", "Inverness", "Olema", "Tomales"],
  "marin county": ["Novato", "San Rafael", "Mill Valley", "Sausalito", "Corte Madera", "Larkspur", "San Anselmo", "Fairfax", "Tiburon", "Kentfield", "Terra Linda", "Marinwood", "Ignacio"],
  "novato": ["Novato"],
  "san rafael": ["San Rafael", "Terra Linda", "Lucas Valley"],

  // Napa County (east of Sonoma)
  "napa": ["Napa", "American Canyon", "Calistoga", "St. Helena", "Yountville", "Angwin", "Deer Park", "Rutherford", "Oakville", "Pope Valley", "Lake Berryessa"],
  "napa county": ["Napa", "American Canyon", "Calistoga", "St. Helena", "Yountville", "Angwin"],
  "napa valley": ["Napa", "Yountville", "St. Helena", "Calistoga", "Rutherford", "Oakville"],
  "calistoga": ["Calistoga"],
  "st helena": ["St. Helena"],
  "american canyon": ["American Canyon"],

  // Lake County (north of Sonoma/Napa)
  "lake": ["Clearlake", "Lakeport", "Kelseyville", "Lower Lake", "Middletown", "Cobb", "Hidden Valley Lake", "Clearlake Oaks", "Nice", "Lucerne", "Upper Lake"],
  "lake county": ["Clearlake", "Lakeport", "Kelseyville", "Lower Lake", "Middletown", "Cobb", "Hidden Valley Lake"],
  "clearlake": ["Clearlake", "Clearlake Oaks"],
  "lakeport": ["Lakeport"],
  "middletown": ["Middletown", "Hidden Valley Lake"],

  // Mendocino County (north of Sonoma)
  "mendocino": ["Ukiah", "Fort Bragg", "Willits", "Mendocino", "Point Arena", "Hopland", "Boonville", "Philo", "Navarro", "Albion", "Elk", "Gualala", "Laytonville", "Covelo", "Redwood Valley", "Talmage"],
  "mendocino county": ["Ukiah", "Fort Bragg", "Willits", "Mendocino", "Point Arena", "Hopland", "Boonville"],
  "ukiah": ["Ukiah", "Redwood Valley", "Talmage"],
  "fort bragg": ["Fort Bragg"],
  "willits": ["Willits"],
  "anderson valley": ["Boonville", "Philo", "Navarro"],

  // Solano County (southeast)
  "solano": ["Vallejo", "Fairfield", "Vacaville", "Benicia", "Suisun City", "Dixon", "Rio Vista", "Green Valley"],
  "solano county": ["Vallejo", "Fairfield", "Vacaville", "Benicia", "Suisun City"],
  "vallejo": ["Vallejo"],
  "fairfield": ["Fairfield"],
  "benicia": ["Benicia"],

  // East Bay / Contra Costa / Alameda (occasionally serve)
  "east bay": ["Oakland", "Berkeley", "Richmond", "Concord", "Walnut Creek", "Fremont", "Hayward", "San Leandro", "Alameda", "El Cerrito", "Albany", "Emeryville", "Piedmont", "Orinda", "Lafayette", "Moraga", "Pleasant Hill", "Martinez", "Antioch", "Pittsburg", "Brentwood"],
  "contra costa": ["Richmond", "Concord", "Walnut Creek", "Martinez", "Antioch", "Pittsburg", "Brentwood", "Pleasant Hill", "Lafayette", "Orinda", "Moraga", "El Cerrito", "San Pablo", "Pinole", "Hercules"],
  "alameda county": ["Oakland", "Berkeley", "Fremont", "Hayward", "San Leandro", "Alameda", "Albany", "Emeryville", "Piedmont", "Newark", "Union City", "Castro Valley", "Livermore", "Pleasanton", "Dublin"],
  "oakland": ["Oakland"],
  "berkeley": ["Berkeley"],
  "richmond": ["Richmond", "El Cerrito", "San Pablo"],

  // San Francisco
  "san francisco": ["San Francisco"],
  "sf": ["San Francisco"],
  "the city": ["San Francisco"],

  // San Mateo / Peninsula (rare)
  "peninsula": ["San Mateo", "Daly City", "South San Francisco", "Redwood City", "Palo Alto", "Mountain View", "San Bruno", "Burlingame", "San Carlos", "Belmont", "Foster City", "Millbrae", "Pacifica", "Half Moon Bay"],
  "san mateo": ["San Mateo", "Daly City", "South San Francisco", "Redwood City", "San Bruno", "Burlingame"],

  // Regional groupings
  "north bay": ["Santa Rosa", "Petaluma", "Novato", "San Rafael", "Napa", "Vallejo", "Fairfield", "Sonoma", "Healdsburg"],
  "bay area": ["San Francisco", "Oakland", "San Jose", "Berkeley", "Fremont", "Santa Rosa", "Hayward", "Sunnyvale", "Concord", "Vallejo"],
  "greater sonoma": ["Santa Rosa", "Petaluma", "Sonoma", "Healdsburg", "Sebastopol", "Rohnert Park", "Windsor", "Cloverdale", "Novato", "Napa"],
  "out of county": ["Novato", "San Rafael", "Napa", "Vallejo", "Ukiah", "Clearlake", "Oakland", "San Francisco"],
  "out of area": ["Novato", "San Rafael", "Napa", "Vallejo", "Ukiah", "Clearlake", "Oakland", "San Francisco", "Sacramento", "Stockton"],
};

/**
 * Get search patterns for an area (handles regional names)
 */
function getAreaSearchPatterns(area: string): string[] {
  const normalizedArea = area.toLowerCase().trim();

  // Check if this is a regional name
  for (const [regionName, cities] of Object.entries(REGIONAL_MAPPINGS)) {
    if (normalizedArea.includes(regionName) || regionName.includes(normalizedArea)) {
      return cities;
    }
  }

  // Not a regional name, return the original area
  return [area];
}

/**
 * Query cats altered (spayed/neutered) in a specific area/city
 */
async function queryCatsAlteredInArea(area: string): Promise<ToolResult> {
  // Check if this is a regional name that maps to multiple cities
  const searchPatterns = getAreaSearchPatterns(area);
  const isRegionalSearch = searchPatterns.length > 1;

  // Build the WHERE clause for multiple patterns
  const patternPlaceholders = searchPatterns.map((_, i) => `p.formatted_address ILIKE $${i + 1}`).join(" OR ");
  const params = searchPatterns.map(p => `%${p}%`);

  // Query cats altered linked to places in this area
  const result = await queryOne<{
    total_cats_altered: number;
    via_cat_records: number;
    via_appointments: number;
    by_year: Array<{ year: number; count: number }>;
  }>(
    `
    WITH cat_place_altered AS (
      -- Cats marked as altered linked to places in the area
      SELECT DISTINCT c.cat_id
      FROM trapper.sot_cats c
      JOIN trapper.cat_place_relationships cpr ON c.cat_id = cpr.cat_id
      JOIN trapper.places p ON cpr.place_id = p.place_id
      WHERE (${patternPlaceholders})
        AND c.altered_status IN ('spayed', 'neutered', 'Yes')
    ),
    appointment_altered AS (
      -- Cats altered via appointments linked to places in the area
      SELECT DISTINCT a.cat_id
      FROM trapper.sot_appointments a
      JOIN trapper.places p ON a.place_id = p.place_id
      WHERE (${patternPlaceholders})
        AND (a.is_spay = true OR a.is_neuter = true OR a.service_is_spay = true OR a.service_is_neuter = true)
        AND a.cat_id IS NOT NULL
    ),
    combined AS (
      SELECT cat_id FROM cat_place_altered
      UNION
      SELECT cat_id FROM appointment_altered
    ),
    yearly AS (
      SELECT
        EXTRACT(YEAR FROM a.appointment_date)::int as year,
        COUNT(DISTINCT a.cat_id) as count
      FROM trapper.sot_appointments a
      JOIN trapper.places p ON a.place_id = p.place_id
      WHERE (${patternPlaceholders})
        AND (a.is_spay = true OR a.is_neuter = true OR a.service_is_spay = true OR a.service_is_neuter = true)
        AND a.cat_id IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM a.appointment_date)
      ORDER BY year
    )
    SELECT
      (SELECT COUNT(*) FROM combined) as total_cats_altered,
      (SELECT COUNT(*) FROM cat_place_altered) as via_cat_records,
      (SELECT COUNT(*) FROM appointment_altered) as via_appointments,
      (SELECT json_agg(json_build_object('year', year, 'count', count)) FROM yearly) as by_year
    `,
    params
  );

  if (!result || result.total_cats_altered === 0) {
    return {
      success: true,
      data: {
        found: false,
        area: area,
        searched_cities: isRegionalSearch ? searchPatterns : undefined,
        message: isRegionalSearch
          ? `No cats found altered in ${area} (searched: ${searchPatterns.join(", ")}). This may be outside FFSC's primary service area or the data hasn't been linked yet.`
          : `No cats found altered in ${area}. This may be outside FFSC's primary service area or the data hasn't been linked yet.`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      area: area,
      is_regional_search: isRegionalSearch,
      searched_cities: isRegionalSearch ? searchPatterns : undefined,
      total_cats_altered: result.total_cats_altered,
      by_year: result.by_year || [],
      summary: isRegionalSearch
        ? `${result.total_cats_altered} cats have been altered in ${area} (includes: ${searchPatterns.slice(0, 5).join(", ")}${searchPatterns.length > 5 ? ", and more" : ""})`
        : `${result.total_cats_altered} cats have been altered in ${area}`,
    },
  };
}

/**
 * Query person history
 */
async function queryPersonHistory(nameSearch: string): Promise<ToolResult> {
  const result = await queryOne(
    `
    WITH person_match AS (
      SELECT person_id, display_name, primary_email, entity_type
      FROM trapper.sot_people
      WHERE display_name ILIKE $1
        AND merged_into_person_id IS NULL
      ORDER BY
        CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END
      LIMIT 1
    ),
    person_stats AS (
      SELECT
        pm.person_id,
        pm.display_name,
        pm.primary_email,
        pm.entity_type,
        (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = pm.person_id) as requests_made,
        (SELECT COUNT(*) FROM trapper.request_trapper_assignments rta WHERE rta.person_id = pm.person_id) as requests_trapped,
        (SELECT string_agg(DISTINCT pr.role_name, ', ') FROM trapper.person_roles pr WHERE pr.person_id = pm.person_id) as roles
      FROM person_match pm
    )
    SELECT * FROM person_stats
    `,
    [`%${nameSearch}%`]
  );

  if (!result) {
    return {
      success: true,
      data: {
        found: false,
        message: `No person found matching "${nameSearch}"`,
      },
    };
  }

  return {
    success: true,
    data: {
      found: true,
      person: result,
      summary: `${result.display_name}: ${result.requests_made} requests made, ${result.requests_trapped} trapped${result.roles ? `, roles: ${result.roles}` : ""}`,
    },
  };
}

/**
 * Query knowledge base for procedures, training, FAQs, etc.
 */
async function queryKnowledgeBase(
  searchQuery: string,
  category?: string
): Promise<ToolResult> {
  // Use the database search function (assumes staff access level for Tippy)
  const results = await queryRows(
    `SELECT * FROM trapper.search_knowledge($1, $2, $3, $4)`,
    [searchQuery, "staff", category || null, 5]
  );

  if (!results || results.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        message: `No knowledge base articles found matching "${searchQuery}"${category ? ` in category "${category}"` : ""}. Try a different search term.`,
      },
    };
  }

  // Get full content for top 3 results
  const enrichedResults = [];
  for (const result of results.slice(0, 3)) {
    const fullArticle = await queryOne<{ content: string; keywords: string[] | null }>(
      `SELECT content, keywords FROM trapper.knowledge_articles WHERE article_id = $1`,
      [(result as { article_id: string }).article_id]
    );
    enrichedResults.push({
      ...(result as Record<string, unknown>),
      content: fullArticle?.content || "",
      keywords: fullArticle?.keywords || [],
    });
  }

  return {
    success: true,
    data: {
      found: true,
      articles: enrichedResults,
      total_results: results.length,
      summary: results.length === 1
        ? `Found 1 article: "${(results[0] as { title: string }).title}"`
        : `Found ${results.length} relevant articles`,
    },
  };
}

/**
 * Log a field event reported by staff
 * This creates an observation record tied to a place
 */
async function logFieldEvent(
  eventType: string,
  location: string,
  catCount?: number,
  eartippedCount?: number,
  notes?: string
): Promise<ToolResult> {
  // Map event types to source types for colony estimates
  const sourceTypeMap: Record<string, string> = {
    observation: "trapper_site_visit",
    trapping: "verified_cats",
    feeding: "trapper_site_visit",
    sighting: "trapper_site_visit",
    other: "trapper_site_visit",
  };

  const sourceType = sourceTypeMap[eventType] || "trapper_site_visit";

  // Try to find a matching place
  const place = await queryOne<{ place_id: string; display_name: string | null; formatted_address: string | null }>(
    `
    SELECT place_id, display_name, formatted_address
    FROM trapper.places
    WHERE (display_name ILIKE $1 OR formatted_address ILIKE $1)
      AND merged_into_place_id IS NULL
    ORDER BY
      CASE WHEN display_name ILIKE $1 THEN 0 ELSE 1 END,
      display_name
    LIMIT 1
    `,
    [`%${location}%`]
  );

  if (!place) {
    // Create a new place if not found (using find_or_create_place_deduped)
    const newPlace = await queryOne<{ place_id: string }>(
      `SELECT * FROM trapper.find_or_create_place_deduped($1, NULL, NULL, NULL, 'tippy_event')`,
      [location]
    );

    if (!newPlace) {
      return {
        success: false,
        error: `Could not find or create place for location: ${location}`,
      };
    }

    // Log the event as a colony estimate observation
    if (catCount && catCount > 0) {
      await queryOne(
        `
        INSERT INTO trapper.place_colony_estimates (
          place_id,
          total_cats,
          source_type,
          observation_date,
          source_system,
          notes
        ) VALUES ($1, $2, $3, NOW(), 'tippy_event', $4)
        RETURNING estimate_id
        `,
        [
          newPlace.place_id,
          catCount,
          sourceType,
          buildEventNotes(eventType, catCount, eartippedCount, notes),
        ]
      );
    }

    // Also log to journal_entries for audit trail
    await queryOne(
      `
      INSERT INTO trapper.journal_entries (
        entry_type,
        entry_date,
        place_id,
        content,
        source_system,
        created_by
      ) VALUES ($1, NOW(), $2, $3, 'tippy_event', 'tippy_ai')
      RETURNING entry_id
      `,
      [
        eventType,
        newPlace.place_id,
        buildEventNotes(eventType, catCount, eartippedCount, notes),
      ]
    );

    return {
      success: true,
      data: {
        logged: true,
        place_created: true,
        place_id: newPlace.place_id,
        event_type: eventType,
        cat_count: catCount,
        eartipped_count: eartippedCount,
        message: `Logged ${eventType} event at new location "${location}"${catCount ? ` - ${catCount} cats reported` : ""}`,
      },
    };
  }

  // Log to existing place
  if (catCount && catCount > 0) {
    await queryOne(
      `
      INSERT INTO trapper.place_colony_estimates (
        place_id,
        total_cats,
        source_type,
        observation_date,
        source_system,
        notes
      ) VALUES ($1, $2, $3, NOW(), 'tippy_event', $4)
      RETURNING estimate_id
      `,
      [
        place.place_id,
        catCount,
        sourceType,
        buildEventNotes(eventType, catCount, eartippedCount, notes),
      ]
    );
  }

  // Log to journal_entries for audit trail
  await queryOne(
    `
    INSERT INTO trapper.journal_entries (
      entry_type,
      entry_date,
      place_id,
      content,
      source_system,
      created_by
    ) VALUES ($1, NOW(), $2, $3, 'tippy_event', 'tippy_ai')
    RETURNING entry_id
    `,
    [
      eventType,
      place.place_id,
      buildEventNotes(eventType, catCount, eartippedCount, notes),
    ]
  );

  return {
    success: true,
    data: {
      logged: true,
      place_id: place.place_id,
      place_name: place.display_name || place.formatted_address,
      event_type: eventType,
      cat_count: catCount,
      eartipped_count: eartippedCount,
      message: `Logged ${eventType} event at "${place.display_name || place.formatted_address}"${catCount ? ` - ${catCount} cats reported${eartippedCount ? ` (${eartippedCount} eartipped)` : ""}` : ""}`,
    },
  };
}

/**
 * Build formatted notes string for event logging
 */
function buildEventNotes(
  eventType: string,
  catCount?: number,
  eartippedCount?: number,
  notes?: string
): string {
  const parts: string[] = [];

  const eventLabels: Record<string, string> = {
    observation: "Field observation",
    trapping: "Trapping event",
    feeding: "Feeding station check",
    sighting: "Cat sighting",
    other: "Other event",
  };

  parts.push(`[${eventLabels[eventType] || eventType}]`);

  if (catCount) {
    parts.push(`${catCount} cats`);
  }

  if (eartippedCount) {
    parts.push(`(${eartippedCount} eartipped)`);
  }

  if (notes) {
    parts.push(`- ${notes}`);
  }

  parts.push(`Logged via Tippy at ${new Date().toISOString()}`);

  return parts.join(" ");
}

/**
 * Look up cat appointment history by microchip, name, or owner info
 * Searches both verified Atlas records AND raw ClinicHQ data
 * Reports discrepancies and logs unmatched queries for review
 */
async function lookupCatAppointment(
  microchip?: string,
  catName?: string,
  ownerName?: string,
  ownerPhone?: string
): Promise<ToolResult> {
  if (!microchip && !catName && !ownerName && !ownerPhone) {
    return {
      success: false,
      error: "Please provide at least one search parameter: microchip, cat name, owner name, or owner phone",
    };
  }

  interface AtlasRecord {
    cat_id: string;
    cat_name: string;
    microchip: string | null;
    altered_status: string;
    appointment_count: number;
    last_appointment: string | null;
    last_service: string | null;
    owner_names: string[];
  }

  interface RawRecord {
    source_row_id: string;
    cat_name: string;
    microchip: string | null;
    owner_name: string | null;
    owner_phone: string | null;
    owner_address: string | null;
    appointment_date: string | null;
    service_type: string | null;
    is_processed: boolean;
  }

  // Search Atlas verified records (sot_cats + sot_appointments)
  let atlasResults: AtlasRecord[] = [];
  let rawResults: RawRecord[] = [];

  // Build Atlas query
  const atlasConditions: string[] = [];
  const atlasParams: (string | null)[] = [];
  let paramIndex = 1;

  if (microchip) {
    atlasConditions.push(`ci.id_value = $${paramIndex}`);
    atlasParams.push(microchip.replace(/\s/g, ""));
    paramIndex++;
  }
  if (catName) {
    atlasConditions.push(`c.display_name ILIKE $${paramIndex}`);
    atlasParams.push(`%${catName}%`);
    paramIndex++;
  }

  if (atlasConditions.length > 0) {
    atlasResults = await queryRows<AtlasRecord>(
      `
      SELECT DISTINCT ON (c.cat_id)
        c.cat_id,
        c.display_name as cat_name,
        ci.id_value as microchip,
        c.altered_status,
        (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id) as appointment_count,
        (SELECT MAX(appointment_date)::text FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id) as last_appointment,
        (SELECT service_type FROM trapper.sot_appointments a WHERE a.cat_id = c.cat_id ORDER BY appointment_date DESC LIMIT 1) as last_service,
        ARRAY(
          SELECT DISTINCT p.display_name
          FROM trapper.sot_appointments a
          JOIN trapper.sot_people p ON a.person_id = p.person_id
          WHERE a.cat_id = c.cat_id AND p.display_name IS NOT NULL
          LIMIT 5
        ) as owner_names
      FROM trapper.sot_cats c
      LEFT JOIN trapper.cat_identifiers ci ON c.cat_id = ci.cat_id AND ci.id_type = 'microchip'
      WHERE (${atlasConditions.join(" OR ")})
        AND c.merged_into_cat_id IS NULL
      ORDER BY c.cat_id, c.updated_at DESC
      LIMIT 10
      `,
      atlasParams
    );
  }

  // Build raw ClinicHQ query to search staged_records
  const rawConditions: string[] = [];
  const rawParams: (string | null)[] = [];
  paramIndex = 1;

  if (microchip) {
    rawConditions.push(`payload->>'Microchip Number' = $${paramIndex}`);
    rawParams.push(microchip.replace(/\s/g, ""));
    paramIndex++;
  }
  if (catName) {
    rawConditions.push(`payload->>'Patient Name' ILIKE $${paramIndex}`);
    rawParams.push(`%${catName}%`);
    paramIndex++;
  }
  if (ownerName) {
    rawConditions.push(`(payload->>'Client First Name' || ' ' || payload->>'Client Last Name') ILIKE $${paramIndex}`);
    rawParams.push(`%${ownerName}%`);
    paramIndex++;
  }
  if (ownerPhone) {
    const normalizedPhone = ownerPhone.replace(/\D/g, "");
    rawConditions.push(`REGEXP_REPLACE(payload->>'Phone', '[^0-9]', '', 'g') LIKE $${paramIndex}`);
    rawParams.push(`%${normalizedPhone}%`);
    paramIndex++;
  }

  if (rawConditions.length > 0) {
    rawResults = await queryRows<RawRecord>(
      `
      SELECT
        source_row_id,
        payload->>'Patient Name' as cat_name,
        payload->>'Microchip Number' as microchip,
        TRIM(COALESCE(payload->>'Client First Name', '') || ' ' || COALESCE(payload->>'Client Last Name', '')) as owner_name,
        payload->>'Phone' as owner_phone,
        TRIM(COALESCE(payload->>'Address', '') || ' ' || COALESCE(payload->>'City', '') || ' ' || COALESCE(payload->>'State', '')) as owner_address,
        payload->>'Appointment Date' as appointment_date,
        payload->>'Service' as service_type,
        is_processed
      FROM trapper.staged_records
      WHERE source_system = 'clinichq'
        AND (${rawConditions.join(" OR ")})
      ORDER BY (payload->>'Appointment Date')::date DESC NULLS LAST
      LIMIT 20
      `,
      rawParams
    );
  }

  // Analyze results and find discrepancies
  const inAtlas = atlasResults.length > 0;
  const inRaw = rawResults.length > 0;
  const rawUnprocessed = rawResults.filter(r => !r.is_processed);

  // If found in raw but not in Atlas, log for review
  if (inRaw && !inAtlas && rawResults.length > 0) {
    const firstRaw = rawResults[0];
    try {
      await queryOne(
        `
        INSERT INTO trapper.review_queue (
          entity_type,
          entity_id,
          reason,
          details,
          source_system,
          created_at
        ) VALUES (
          'unlinked_appointment',
          $1,
          'Tippy lookup found raw ClinicHQ record not linked to Atlas cat',
          $2,
          'tippy_lookup',
          NOW()
        )
        ON CONFLICT DO NOTHING
        `,
        [
          firstRaw.source_row_id,
          JSON.stringify({
            search_params: { microchip, catName, ownerName, ownerPhone },
            raw_record: firstRaw,
            searched_at: new Date().toISOString(),
          }),
        ]
      );
    } catch {
      // Ignore errors logging to review queue
    }
  }

  // Build response
  if (!inAtlas && !inRaw) {
    return {
      success: true,
      data: {
        found: false,
        in_atlas: false,
        in_raw_clinichq: false,
        message: `No records found for this search. The cat may not have visited the FFSC clinic, or the search terms don't match our records.`,
        suggestion: "Try searching with different spelling, or check the microchip number is correct.",
      },
    };
  }

  if (inAtlas && !inRaw) {
    const cat = atlasResults[0];
    return {
      success: true,
      data: {
        found: true,
        in_atlas: true,
        in_raw_clinichq: false,
        atlas_record: {
          cat_name: cat.cat_name,
          microchip: cat.microchip,
          altered_status: cat.altered_status,
          appointment_count: cat.appointment_count,
          last_appointment: cat.last_appointment,
          last_service: cat.last_service,
          known_owners: cat.owner_names,
        },
        message: `Found in Atlas: "${cat.cat_name}" (${cat.altered_status || "unknown status"}). ${cat.appointment_count} appointment(s) on record. Last visit: ${cat.last_appointment || "unknown"}.`,
        note: "This cat exists in Atlas but no matching raw ClinicHQ staged record was found (may have been cleaned up after processing).",
      },
    };
  }

  if (!inAtlas && inRaw) {
    const raw = rawResults[0];
    return {
      success: true,
      data: {
        found: true,
        in_atlas: false,
        in_raw_clinichq: true,
        raw_record: {
          cat_name: raw.cat_name,
          microchip: raw.microchip,
          owner_name: raw.owner_name,
          owner_phone: raw.owner_phone,
          owner_address: raw.owner_address,
          appointment_date: raw.appointment_date,
          service_type: raw.service_type,
          is_processed: raw.is_processed,
        },
        raw_record_count: rawResults.length,
        unprocessed_count: rawUnprocessed.length,
        message: `Found in raw ClinicHQ data but NOT linked in Atlas. Last appointment: ${raw.appointment_date || "unknown"} under name "${raw.owner_name}" for cat "${raw.cat_name}".`,
        discrepancy: {
          reason: "Record exists in ClinicHQ but not properly linked in Atlas",
          likely_causes: [
            "Name/address mismatch preventing identity linking",
            "Missing or invalid microchip number",
            "Processing pipeline hasn't run yet",
            raw.is_processed ? "Processed but entity linking failed" : "Record not yet processed",
          ],
          action: "This has been logged for review. A data admin should investigate the linking issue.",
        },
      },
    };
  }

  // Both Atlas and Raw found - compare
  const atlasRec = atlasResults[0];
  const rawRec = rawResults[0];
  const nameMatch = atlasRec.cat_name?.toLowerCase() === rawRec.cat_name?.toLowerCase();
  const chipMatch = atlasRec.microchip === rawRec.microchip;

  return {
    success: true,
    data: {
      found: true,
      in_atlas: true,
      in_raw_clinichq: true,
      atlas_record: {
        cat_name: atlasRec.cat_name,
        microchip: atlasRec.microchip,
        altered_status: atlasRec.altered_status,
        appointment_count: atlasRec.appointment_count,
        last_appointment: atlasRec.last_appointment,
        last_service: atlasRec.last_service,
        known_owners: atlasRec.owner_names,
      },
      raw_record: {
        cat_name: rawRec.cat_name,
        owner_name: rawRec.owner_name,
        appointment_date: rawRec.appointment_date,
        service_type: rawRec.service_type,
      },
      raw_record_count: rawResults.length,
      data_quality: {
        names_match: nameMatch,
        microchips_match: chipMatch,
        status: nameMatch && chipMatch ? "good" : "review_needed",
      },
      message: `Found in both Atlas and raw ClinicHQ. In Atlas as "${atlasRec.cat_name}" (${atlasRec.altered_status || "unknown"}), ${atlasRec.appointment_count} appointments. Raw ClinicHQ shows last booking under "${rawRec.owner_name}" for "${rawRec.cat_name}".`,
      summary: nameMatch && chipMatch
        ? "Records match well between Atlas and ClinicHQ."
        : `Note: Name in Atlas is "${atlasRec.cat_name}", in ClinicHQ booking it's "${rawRec.cat_name}". ${!chipMatch ? "Microchip numbers also differ." : ""}`,
    },
  };
}
