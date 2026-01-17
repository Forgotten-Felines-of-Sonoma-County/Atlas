import { NextRequest, NextResponse } from "next/server";
import { sendOutOfCountyEmail } from "@/lib/email";

// Send out-of-county email for a specific submission
// POST /api/emails/send-out-of-county
// Body: { submission_id: string }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { submission_id } = body;

    if (!submission_id) {
      return NextResponse.json(
        { error: "submission_id is required" },
        { status: 400 }
      );
    }

    const result = await sendOutOfCountyEmail(submission_id);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: "Out-of-county email sent successfully",
        email_id: result.emailId,
        external_id: result.externalId,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 400 }
      );
    }
  } catch (err) {
    console.error("Error sending out-of-county email:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
