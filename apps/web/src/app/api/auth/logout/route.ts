import { NextRequest, NextResponse } from "next/server";
import {
  getSessionToken,
  invalidateSession,
  clearSessionCookie,
} from "@/lib/auth";

/**
 * POST /api/auth/logout
 *
 * Log out the current user by invalidating their session.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getSessionToken(request);

    // Create response first
    const response = NextResponse.json({ success: true });

    // Clear the cookie regardless of whether we have a token
    clearSessionCookie(response);

    // If we have a token, invalidate the session in the database
    if (token) {
      await invalidateSession(token, "logout");
    }

    return response;
  } catch (error) {
    console.error("Logout error:", error);

    // Still return success and clear cookie even on error
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  }
}
