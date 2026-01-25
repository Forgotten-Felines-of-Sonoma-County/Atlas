import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne, query } from "@/lib/db";
import { requireRole, AuthError, getCurrentUser } from "@/lib/auth";
import { parseStringPromise } from "xml2js";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, readFile, rm } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

/**
 * Google Maps Sync API
 *
 * Follows the centralized ingest pipeline pattern:
 * 1. Upload KMZ → Parse placemarks → Stage in staged_google_maps_imports
 * 2. Enqueue for processing (or process immediately)
 * 3. Processing updates google_map_entries with icon data
 *
 * GET: Get sync status, import history, and icon style stats
 * POST: Upload KMZ file to stage for processing
 */

interface IconStats {
  icon_meaning: string;
  count: number;
}

interface ImportHistory {
  import_id: string;
  filename: string;
  status: string;
  placemark_count: number;
  updated_count: number | null;
  inserted_count: number | null;
  uploaded_at: string;
  processed_at: string | null;
}

function parseStyleId(styleUrl: string): {
  iconType: string | null;
  iconColor: string | null;
  styleId: string | null;
} {
  if (!styleUrl) return { iconType: null, iconColor: null, styleId: null };

  const match = styleUrl.match(/#?(icon-\d+)-([A-F0-9]+)/i);
  if (match) {
    return {
      iconType: match[1].toLowerCase(),
      iconColor: match[2].toUpperCase(),
      styleId: `${match[1].toLowerCase()}-${match[2].toUpperCase()}`,
    };
  }
  return { iconType: null, iconColor: null, styleId: styleUrl };
}

interface Placemark {
  name: string;
  description: string;
  lat: number;
  lng: number;
  styleUrl: string;
  folder: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlacemarks(node: any, folderName = ""): Placemark[] {
  const placemarks: Placemark[] = [];

  if (!node) return placemarks;

  // Handle Folder
  if (node.Folder) {
    const folders = Array.isArray(node.Folder) ? node.Folder : [node.Folder];
    for (const folder of folders) {
      const name = folder.name?.[0] || "";
      placemarks.push(...extractPlacemarks(folder, name));
    }
  }

  // Handle Placemark
  if (node.Placemark) {
    const pms = Array.isArray(node.Placemark) ? node.Placemark : [node.Placemark];
    for (const pm of pms) {
      const name = pm.name?.[0] || "";
      const description = pm.description?.[0] || "";
      const styleUrl = pm.styleUrl?.[0] || "";
      const coords = pm.Point?.coordinates?.[0] || "";

      const [lng, lat] = coords.split(",").map((s: string) => parseFloat(s.trim()));

      if (lat && lng) {
        placemarks.push({
          name,
          description,
          lat,
          lng,
          styleUrl,
          folder: folderName,
        });
      }
    }
  }

  // Handle Document
  if (node.Document) {
    const docs = Array.isArray(node.Document) ? node.Document : [node.Document];
    for (const doc of docs) {
      placemarks.push(...extractPlacemarks(doc, folderName));
    }
  }

  return placemarks;
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin", "staff"]);

    // Get icon meaning stats
    const stats = await queryRows<IconStats>(`
      SELECT
        COALESCE(icon_meaning, 'unknown') as icon_meaning,
        COUNT(*) as count
      FROM trapper.google_map_entries
      GROUP BY icon_meaning
      ORDER BY count DESC
    `);

    // Get total counts
    const totals = await queryRows<{ total: number; with_icons: number; synced: number }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE icon_type IS NOT NULL) as with_icons,
        COUNT(*) FILTER (WHERE synced_at IS NOT NULL) as synced
      FROM trapper.google_map_entries
    `);

    // Get last sync time
    const lastSync = await queryRows<{ last_synced_at: string }>(`
      SELECT MAX(synced_at)::text as last_synced_at
      FROM trapper.google_map_entries
      WHERE synced_at IS NOT NULL
    `);

    // Get import history (recent 10)
    const history = await queryRows<ImportHistory>(`
      SELECT
        import_id::text,
        filename,
        status,
        placemark_count,
        updated_count,
        inserted_count,
        uploaded_at::text,
        processed_at::text
      FROM trapper.staged_google_maps_imports
      ORDER BY uploaded_at DESC
      LIMIT 10
    `);

    return NextResponse.json({
      stats,
      totals: totals[0] || { total: 0, with_icons: 0, synced: 0 },
      lastSyncedAt: lastSync[0]?.last_synced_at || null,
      history,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Error fetching Google Maps sync status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);
    const user = await getCurrentUser(request);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isKmz = file.name.endsWith(".kmz");
    const isKml = file.name.endsWith(".kml");

    if (!isKmz && !isKml) {
      return NextResponse.json(
        { error: "File must be a .kmz or .kml file" },
        { status: 400 }
      );
    }

    // Create temp directory
    const tmpDir = path.join(os.tmpdir(), `google-maps-sync-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });

    let kmlContent: string;

    try {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      if (isKmz) {
        // Save KMZ and extract
        const kmzPath = path.join(tmpDir, "upload.kmz");
        await writeFile(kmzPath, buffer);
        await execAsync(`cd "${tmpDir}" && unzip -o upload.kmz`);
        kmlContent = await readFile(path.join(tmpDir, "doc.kml"), "utf-8");
      } else {
        kmlContent = buffer.toString("utf-8");
      }

      // Parse KML
      const result = await parseStringPromise(kmlContent);
      const placemarks = extractPlacemarks(result.kml);

      if (placemarks.length === 0) {
        return NextResponse.json(
          { error: "No placemarks found in the file. It may be a NetworkLink file - please download the full KMZ export." },
          { status: 400 }
        );
      }

      // Stage the import (centralized ingest pattern)
      const importResult = await queryOne<{ import_id: string }>(`
        INSERT INTO trapper.staged_google_maps_imports (
          filename,
          upload_method,
          placemarks,
          placemark_count,
          uploaded_by,
          status
        ) VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING import_id::text
      `, [
        file.name,
        'web_ui',
        JSON.stringify(placemarks),
        placemarks.length,
        user?.displayName || 'unknown',
      ]);

      if (!importResult) {
        throw new Error("Failed to stage import");
      }

      // Process the import (could be async via job queue, but processing immediately for now)
      const processResult = await queryOne<{ result: { success: boolean; updated: number; inserted: number; not_matched: number; error?: string } }>(`
        SELECT trapper.process_google_maps_import($1) as result
      `, [importResult.import_id]);

      if (!processResult?.result?.success) {
        return NextResponse.json(
          { error: processResult?.result?.error || "Processing failed" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        import_id: importResult.import_id,
        result: {
          updated: processResult.result.updated,
          inserted: processResult.result.inserted,
          notMatched: processResult.result.not_matched,
        },
        placemarksProcessed: placemarks.length,
      });
    } finally {
      // Cleanup temp directory
      try {
        await rm(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Error syncing Google Maps data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
