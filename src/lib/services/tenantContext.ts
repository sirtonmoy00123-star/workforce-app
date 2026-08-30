/**
 * Tenant Context — the single server-side source of truth for
 * "which business is the current user in?"
 *
 * Rules (from CLAUDE-SAAS-RULES.md):
 * - business_id is NEVER accepted from request body, query string, or form field.
 * - It is derived from the authenticated session + business_members table.
 * - This is the ONLY way server code learns which business the caller is in.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type MemberRole = "OWNER" | "ADMIN" | "EMPLOYEE";

export interface BusinessContext {
  /** The app-level user id (public.users.id) */
  userId: string;
  /** The Supabase Auth uid (auth.users.id) */
  authUserId: string;
  /** The business this user belongs to */
  businessId: string;
  /** The business_members row id */
  membershipId: string;
  /** The user's role within this business */
  role: MemberRole;
  /** The user's employee_id, if they are an EMPLOYEE (null for OWNER/ADMIN) */
  employeeId: string | null;
}

// ────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────

export class TenantError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 403) {
    super(message);
    this.name = "TenantError";
    this.statusCode = statusCode;
  }
}

// ────────────────────────────────────────────────────────────
// Main helper
// ────────────────────────────────────────────────────────────

/**
 * Resolves the current user's business context from the authenticated session.
 *
 * - Authenticates via Supabase session cookie.
 * - Looks up the user in public.users.
 * - Looks up their active membership in business_members.
 * - Verifies the business is ACTIVE (not SUSPENDED or ARCHIVED).
 *
 * Throws TenantError if anything is wrong (not authenticated, no membership,
 * business suspended, etc.).
 *
 * Currently assumes one business per user. The return shape (BusinessContext)
 * supports a future business switcher without rewrite — just add a
 * `targetBusinessId` parameter later.
 */
export async function getCurrentBusinessContext(): Promise<BusinessContext> {
  // 1. Authenticate
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new TenantError("Not authenticated. Please log in.", 401);
  }

  // 2. Look up app user + active membership + business in ONE query (saves a DB round-trip)
  const adminClient = createAdminClient();

  const { data: appUser, error: userError } = await adminClient
    .from("users")
    .select("id, business_id, role, account_status, business_members ( id, business_id, role, status, businesses ( id, status ) )")
    .eq("auth_user_id", authUser.id)
    .single();

  if (userError || !appUser) {
    throw new TenantError("User account not found.", 403);
  }

  if (appUser.account_status === "disabled") {
    throw new TenantError("Your account has been disabled. Contact your administrator.", 403);
  }

  // 3. Find the active membership from the joined data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberships = (appUser as any).business_members as any[];
  const membership = memberships?.find((m: { status: string }) => m.status === "ACTIVE");

  if (!membership) {
    throw new TenantError(
      "You do not have an active membership in any business. Contact your administrator.",
      403
    );
  }

  // 4. Verify the business is active (from joined data)
  const business = membership.businesses;

  if (!business) {
    throw new TenantError("Business not found.", 403);
  }

  if (business.status === "SUSPENDED") {
    throw new TenantError(
      "This business account has been suspended. Contact support for assistance.",
      403
    );
  }

  if (business.status === "ARCHIVED") {
    throw new TenantError(
      "This business account is no longer active.",
      403
    );
  }

  // 5. If employee, look up employee_id
  let employeeId: string | null = null;
  if (membership.role === "EMPLOYEE") {
    const { data: employee } = await adminClient
      .from("employees")
      .select("id")
      .eq("user_id", appUser.id)
      .eq("business_id", membership.business_id)
      .limit(1)
      .single();

    employeeId = employee?.id ?? null;
  }

  return {
    userId: appUser.id,
    authUserId: authUser.id,
    businessId: membership.business_id,
    membershipId: membership.id,
    role: membership.role as MemberRole,
    employeeId,
  };
}

// ────────────────────────────────────────────────────────────
// Role guard helpers
// ────────────────────────────────────────────────────────────

/**
 * Requires the user to have one of the specified roles.
 * Calls getCurrentBusinessContext() and throws if the role doesn't match.
 *
 * Usage:
 *   const ctx = await requireRole("OWNER", "ADMIN");
 *   // ctx.businessId is now safe to use
 */
export async function requireRole(
  ...allowedRoles: MemberRole[]
): Promise<BusinessContext> {
  const ctx = await getCurrentBusinessContext();

  if (!allowedRoles.includes(ctx.role)) {
    throw new TenantError(
      "You do not have permission to perform this action.",
      403
    );
  }

  return ctx;
}

/**
 * Shorthand: require OWNER or ADMIN role (the common case for admin pages).
 */
export async function requireAdmin(): Promise<BusinessContext> {
  return requireRole("OWNER", "ADMIN");
}

/**
 * Shorthand: require any authenticated member (OWNER, ADMIN, or EMPLOYEE).
 * Use for routes that any logged-in business member can access.
 */
export async function requireMember(): Promise<BusinessContext> {
  return getCurrentBusinessContext();
}

// ────────────────────────────────────────────────────────────
// Platform admin guard
// ────────────────────────────────────────────────────────────

export interface PlatformAdminContext {
  /** The app-level user id (public.users.id) */
  userId: string;
  /** The Supabase Auth uid (auth.users.id) */
  authUserId: string;
}

/**
 * Requires the caller to be a Platform Admin.
 * Platform Admin is NOT a business role — it's a separate flag on the users table.
 * Platform Admins manage businesses, not business data.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new TenantError("Not authenticated. Please log in.", 401);
  }

  const adminClient = createAdminClient();

  const { data: appUser, error: userError } = await adminClient
    .from("users")
    .select("id, is_platform_admin, account_status")
    .eq("auth_user_id", authUser.id)
    .single();

  if (userError || !appUser) {
    throw new TenantError("User account not found.", 403);
  }

  if (appUser.account_status === "disabled") {
    throw new TenantError("Your account has been disabled.", 403);
  }

  if (!appUser.is_platform_admin) {
    throw new TenantError("Platform admin access required.", 403);
  }

  return {
    userId: appUser.id,
    authUserId: authUser.id,
  };
}

// ────────────────────────────────────────────────────────────
// Error response helper
// ────────────────────────────────────────────────────────────

/**
 * Catches TenantError and returns a proper NextResponse.
 * Use in route catch blocks:
 *
 *   catch (err) {
 *     return handleTenantError(err);
 *   }
 */
export function handleTenantError(err: unknown): NextResponse {
  if (err instanceof TenantError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode });
  }
  console.error("Unexpected error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
