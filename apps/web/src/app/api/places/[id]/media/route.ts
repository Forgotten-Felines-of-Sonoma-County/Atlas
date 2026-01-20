import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

interface MediaRow {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  cat_description: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/places/[id]/media - List all media for a place
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const media = await queryRows<MediaRow>(
      `SELECT
        media_id,
        media_type::TEXT,
        original_filename,
        storage_path,
        caption,
        cat_description,
        uploaded_by,
        uploaded_at
       FROM trapper.request_media
       WHERE place_id = $1
         AND NOT is_archived
       ORDER BY uploaded_at DESC`,
      [id]
    );

    return NextResponse.json({ media });
  } catch (error) {
    console.error("Error fetching place media:", error);
    return NextResponse.json(
      { error: "Failed to fetch media" },
      { status: 500 }
    );
  }
}
