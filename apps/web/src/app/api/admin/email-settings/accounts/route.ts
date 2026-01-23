import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getConnectedAccounts, disconnectAccount, isOutlookConfigured } from "@/lib/outlook";

/**
 * GET /api/admin/email-settings/accounts
 *
 * Get all connected Outlook email accounts.
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const configured = isOutlookConfigured();
    const accounts = configured ? await getConnectedAccounts() : [];

    return NextResponse.json({
      configured,
      accounts,
    });
  } catch (error) {
    console.error("Get email accounts error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json(
        { error: authError.message },
        { status: authError.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to get email accounts" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/email-settings/accounts
 *
 * Disconnect an Outlook email account.
 * Admin-only endpoint.
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireRole(request, ["admin"]);

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");

    if (!accountId) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    await disconnectAccount(accountId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Disconnect account error:", error);

    if (error instanceof Error && "statusCode" in error) {
      const authError = error as { message: string; statusCode: number };
      return NextResponse.json(
        { error: authError.message },
        { status: authError.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to disconnect account" },
      { status: 500 }
    );
  }
}
