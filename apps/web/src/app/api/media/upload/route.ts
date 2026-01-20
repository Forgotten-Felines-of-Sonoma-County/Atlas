import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { createHash } from "crypto";
import { uploadFile, isStorageAvailable, getPublicUrl } from "@/lib/supabase";

// Unified media upload endpoint
// Supports uploading to: requests, cats, places

type EntityType = "request" | "cat" | "place";

interface UploadResult {
  media_id: string;
  storage_path: string;
  stored_filename: string;
}

// Entity validation queries
const entityQueries: Record<EntityType, string> = {
  request: "SELECT request_id FROM trapper.sot_requests WHERE request_id = $1",
  cat: "SELECT cat_id FROM trapper.sot_cats WHERE cat_id = $1",
  place: "SELECT place_id FROM trapper.places WHERE place_id = $1",
};

// Storage path prefixes
const storagePathPrefix: Record<EntityType, string> = {
  request: "requests",
  cat: "cats",
  place: "places",
};

// POST /api/media/upload - Upload media to any entity
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Required fields
    const file = formData.get("file") as File | null;
    const entityType = formData.get("entity_type") as EntityType | null;
    const entityId = formData.get("entity_id") as string | null;

    // Optional fields
    const mediaType = formData.get("media_type") as string || "site_photo";
    const caption = formData.get("caption") as string || null;
    const notes = formData.get("notes") as string || null;
    const catDescription = formData.get("cat_description") as string || null;
    const uploadedBy = formData.get("uploaded_by") as string || "app_user";

    // Validation
    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!entityType || !["request", "cat", "place"].includes(entityType)) {
      return NextResponse.json(
        { error: "Invalid entity_type. Must be 'request', 'cat', or 'place'" },
        { status: 400 }
      );
    }

    if (!entityId) {
      return NextResponse.json(
        { error: "entity_id is required" },
        { status: 400 }
      );
    }

    // Validate media type
    const validMediaTypes = ["cat_photo", "site_photo", "evidence", "map_screenshot", "document", "other"];
    if (!validMediaTypes.includes(mediaType)) {
      return NextResponse.json(
        { error: "Invalid media_type" },
        { status: 400 }
      );
    }

    // Verify entity exists
    const entityExists = await queryOne<Record<string, string>>(
      entityQueries[entityType],
      [entityId]
    );

    if (!entityExists) {
      return NextResponse.json(
        { error: `${entityType} not found` },
        { status: 404 }
      );
    }

    // Check storage availability
    if (!isStorageAvailable()) {
      return NextResponse.json(
        { error: "Storage not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    // Read file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate storage filename
    const timestamp = Date.now();
    const hash = createHash("sha256").update(buffer).digest("hex").substring(0, 8);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const storedFilename = `${entityId}_${timestamp}_${hash}.${ext}`;

    // Determine MIME type
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      pdf: "application/pdf",
    };
    const mimeType = mimeTypes[ext] || "application/octet-stream";

    // Storage path in bucket: {entity_type}s/{entity_id}/{filename}
    const storagePath = `${storagePathPrefix[entityType]}/${entityId}/${storedFilename}`;

    // Upload to Supabase Storage
    const uploadResult = await uploadFile(storagePath, buffer, mimeType);
    if (!uploadResult.success) {
      return NextResponse.json(
        { error: uploadResult.error || "Failed to upload to storage" },
        { status: 500 }
      );
    }
    const publicUrl = uploadResult.url || getPublicUrl(storagePath);

    // Build the INSERT query based on entity type
    const insertColumns = [
      "media_type",
      "original_filename",
      "stored_filename",
      "file_size_bytes",
      "mime_type",
      "storage_provider",
      "storage_path",
      "caption",
      "notes",
      "cat_description",
      "uploaded_by",
    ];

    const insertValues = [
      mediaType,
      file.name,
      storedFilename,
      buffer.length,
      mimeType,
      "supabase",
      publicUrl,
      caption,
      notes,
      catDescription,
      uploadedBy,
    ];

    // Add entity-specific column
    let entityColumn: string;
    switch (entityType) {
      case "request":
        entityColumn = "request_id";
        break;
      case "cat":
        entityColumn = "direct_cat_id";
        break;
      case "place":
        entityColumn = "place_id";
        break;
    }

    insertColumns.unshift(entityColumn);
    insertValues.unshift(entityId);

    const placeholders = insertValues.map((_, i) => {
      // Handle media_type enum cast (second placeholder after entity column)
      if (i === 1) return `$${i + 1}::trapper.media_type`;
      return `$${i + 1}`;
    });

    const sql = `
      INSERT INTO trapper.request_media (${insertColumns.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING media_id
    `;

    const result = await queryOne<{ media_id: string }>(sql, insertValues);

    if (!result) {
      return NextResponse.json(
        { error: "Failed to save media record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      media_id: result.media_id,
      stored_filename: storedFilename,
      storage_path: publicUrl,
    } as UploadResult & { success: true });
  } catch (error) {
    console.error("Error uploading media:", error);
    return NextResponse.json(
      { error: "Failed to upload media", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
