import { NextRequest } from "next/server";

/**
 * User context for API endpoints
 *
 * Currently Atlas doesn't have authentication - this is an internal tool.
 * This module provides a consistent interface for getting user context,
 * making it easy to add real authentication later.
 *
 * Current behavior:
 * - Checks X-Staff-ID header (passed from frontend when staff member is known)
 * - Falls back to "app_user" for anonymous requests
 *
 * TODO: When adding authentication:
 * 1. Install auth library (e.g., next-auth, clerk, or supabase-auth)
 * 2. Update getCurrentUser() to extract user from session/token
 * 3. Add middleware to protect routes
 */

export interface UserContext {
  /** Display identifier for audit trails (staff name or "app_user") */
  displayName: string;
  /** Staff ID if known (UUID), null otherwise */
  staffId: string | null;
  /** Whether this is an authenticated staff member */
  isAuthenticated: boolean;
}

/**
 * Get the current user context from request headers
 *
 * The frontend can pass staff context via headers:
 * - X-Staff-ID: UUID of the staff member
 * - X-Staff-Name: Display name of the staff member
 *
 * @example
 * // In an API route:
 * const user = getCurrentUser(request);
 * console.log(user.displayName); // "Jami S." or "app_user"
 * console.log(user.staffId);     // "uuid-here" or null
 */
export function getCurrentUser(request: NextRequest): UserContext {
  const staffId = request.headers.get("X-Staff-ID");
  const staffName = request.headers.get("X-Staff-Name");

  if (staffId) {
    return {
      displayName: staffName || `staff:${staffId.slice(0, 8)}`,
      staffId,
      isAuthenticated: true,
    };
  }

  // No auth context - return anonymous user
  return {
    displayName: "app_user",
    staffId: null,
    isAuthenticated: false,
  };
}

/**
 * Get user context for non-request scenarios (e.g., cron jobs, scripts)
 */
export function getSystemUser(): UserContext {
  return {
    displayName: "system",
    staffId: null,
    isAuthenticated: false,
  };
}

/**
 * Get admin user context for admin-only operations
 * Used when an operation requires admin privileges but auth isn't implemented yet
 */
export function getAdminUser(): UserContext {
  return {
    displayName: "admin",
    staffId: null,
    isAuthenticated: true, // Treat admin endpoints as authenticated
  };
}
