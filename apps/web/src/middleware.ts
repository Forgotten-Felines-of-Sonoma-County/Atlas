import { NextRequest, NextResponse } from "next/server";

/**
 * Atlas Authentication Middleware
 *
 * Protects routes based on authentication status and role.
 * Currently configured for gradual rollout - auth is optional by default.
 *
 * Route protection levels:
 * - Public: No auth required (login, public API)
 * - Auth Required: Must be logged in (most of the app)
 * - Admin Only: Must be logged in with admin role
 */

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/intake/public",
  "/api/version",
  "/api/health",
  "/_next",
  "/favicon.ico",
];

// Routes that require admin role
const ADMIN_PATHS = [
  "/admin",
  "/api/admin",
];

// API paths that are public (for webhooks, cron, etc.)
const PUBLIC_API_PATHS = [
  "/api/cron",
  "/api/webhook",
  "/api/intake/submit",
];

/**
 * Check if a path matches any of the given patterns
 */
function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("*")) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern || pathname.startsWith(pattern + "/");
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for public paths
  if (matchesPath(pathname, PUBLIC_PATHS)) {
    return NextResponse.next();
  }

  // Skip middleware for public API paths
  if (matchesPath(pathname, PUBLIC_API_PATHS)) {
    return NextResponse.next();
  }

  // Get session cookie
  const sessionToken = request.cookies.get("atlas_session")?.value;

  // For now, during gradual rollout, we allow unauthenticated access
  // but set a header indicating the user is not authenticated
  // This allows the UI to show a "login" button
  if (!sessionToken) {
    // Check if this is an API request that explicitly requires auth
    // For now, we're allowing most requests through during rollout
    // TODO: Uncomment the redirect when ready to enforce auth

    // if (pathname.startsWith("/api/") && matchesPath(pathname, ADMIN_PATHS)) {
    //   return NextResponse.json(
    //     { error: "Authentication required" },
    //     { status: 401 }
    //   );
    // }

    // if (!pathname.startsWith("/api/")) {
    //   const loginUrl = new URL("/login", request.url);
    //   loginUrl.searchParams.set("redirect", pathname);
    //   return NextResponse.redirect(loginUrl);
    // }

    const response = NextResponse.next();
    response.headers.set("X-Auth-Status", "unauthenticated");
    return response;
  }

  // Validate the session by calling the auth check endpoint
  // This is done asynchronously to avoid blocking
  // The actual validation happens in the API routes that need it

  // For admin paths, we need to validate the role
  // TODO: Enable when ready to enforce admin-only routes
  // if (matchesPath(pathname, ADMIN_PATHS)) {
  //   // We'd need to validate the session here
  //   // For now, we trust the cookie exists
  // }

  const response = NextResponse.next();
  response.headers.set("X-Auth-Status", "authenticated");
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
