import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
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
 * GET: Get sync status and icon style stats
 * POST: Upload KMZ file to sync icon styles
 */

interface IconStats {
  icon_meaning: string;
  count: number;
}

interface SyncResult {
  updated: number;
  inserted: number;
  notMatched: number;
  iconDistribution: Record<string, number>;
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
  iconType: string | null;
  iconColor: string | null;
  styleId: string | null;
  folderName: string;
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
        const { iconType, iconColor, styleId } = parseStyleId(styleUrl);
        placemarks.push({
          name,
          description,
          lat,
          lng,
          iconType,
          iconColor,
          styleId,
          folderName,
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

    return NextResponse.json({
      stats,
      totals: totals[0] || { total: 0, with_icons: 0, synced: 0 },
      lastSyncedAt: lastSync[0]?.last_synced_at || null,
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mode = formData.get("mode") as string | null; // 'update' or 'sync'

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

      // Process placemarks
      const syncMode = mode === "sync";
      let updated = 0;
      let inserted = 0;
      let notMatched = 0;
      const iconDistribution: Record<string, number> = {};

      for (const pm of placemarks) {
        // Track icon distribution
        const key = `${pm.iconType}-${pm.iconColor}`;
        iconDistribution[key] = (iconDistribution[key] || 0) + 1;

        if (syncMode) {
          // Sync mode: update existing or insert new
          const updateResult = await query(
            `UPDATE trapper.google_map_entries
             SET
               icon_type = $1,
               icon_color = $2,
               icon_style_id = $3,
               kml_folder = COALESCE($4, kml_folder),
               kml_name = COALESCE($5, kml_name),
               original_content = COALESCE($6, original_content),
               synced_at = NOW()
             WHERE
               ROUND(lat::numeric, 5) = ROUND($7::numeric, 5)
               AND ROUND(lng::numeric, 5) = ROUND($8::numeric, 5)
             RETURNING entry_id`,
            [pm.iconType, pm.iconColor, pm.styleId, pm.folderName, pm.name, pm.description, pm.lat, pm.lng]
          );

          if (updateResult.rowCount && updateResult.rowCount > 0) {
            updated += updateResult.rowCount;
          } else {
            // Insert new entry
            try {
              await query(
                `INSERT INTO trapper.google_map_entries
                 (kml_name, original_content, lat, lng, icon_type, icon_color, icon_style_id, kml_folder, synced_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [pm.name, pm.description, pm.lat, pm.lng, pm.iconType, pm.iconColor, pm.styleId, pm.folderName]
              );
              inserted++;
            } catch {
              notMatched++;
            }
          }
        } else {
          // Update mode: only update entries missing icon data
          const result = await query(
            `UPDATE trapper.google_map_entries
             SET
               icon_type = $1,
               icon_color = $2,
               icon_style_id = $3,
               kml_folder = COALESCE(kml_folder, $4),
               synced_at = NOW()
             WHERE
               ROUND(lat::numeric, 5) = ROUND($5::numeric, 5)
               AND ROUND(lng::numeric, 5) = ROUND($6::numeric, 5)
               AND icon_type IS NULL
             RETURNING entry_id`,
            [pm.iconType, pm.iconColor, pm.styleId, pm.folderName, pm.lat, pm.lng]
          );

          if (result.rowCount && result.rowCount > 0) {
            updated += result.rowCount;
          } else {
            notMatched++;
          }
        }
      }

      // Derive icon meanings for updated entries
      const derivedResult = await query(`
        UPDATE trapper.google_map_entries
        SET icon_meaning = trapper.derive_icon_meaning(icon_type, icon_color)
        WHERE icon_type IS NOT NULL AND icon_meaning IS NULL
        RETURNING entry_id
      `);

      const syncResult: SyncResult = {
        updated,
        inserted,
        notMatched,
        iconDistribution,
      };

      return NextResponse.json({
        success: true,
        result: syncResult,
        placemarksProcessed: placemarks.length,
        meaningsDerived: derivedResult.rowCount || 0,
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
