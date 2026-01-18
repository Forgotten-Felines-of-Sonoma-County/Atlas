import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentStaff,
  changePassword,
  setStaffPassword,
  AuthError,
} from "@/lib/auth";

/**
 * PUT /api/auth/password
 *
 * Change the current user's password (requires current password).
 */
export async function PUT(request: NextRequest) {
  try {
    const staff = await getCurrentStaff(request);

    if (!staff) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: "New password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Attempt password change
    const result = await changePassword(
      staff.staff_id,
      currentPassword,
      newPassword
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Password change error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to change password" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/password
 *
 * Admin endpoint to set a user's password (no current password required).
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await getCurrentStaff(request);

    if (!staff) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    // Only admins can set passwords for other users
    if (staff.auth_role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { staffId, newPassword } = body;

    // Validate required fields
    if (!staffId || !newPassword) {
      return NextResponse.json(
        { success: false, error: "Staff ID and new password are required" },
        { status: 400 }
      );
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Set the password
    const updated = await setStaffPassword(staffId, newPassword);

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Staff member not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Set password error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to set password" },
      { status: 500 }
    );
  }
}
