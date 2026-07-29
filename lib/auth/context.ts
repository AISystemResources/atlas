import { auth } from "@clerk/nextjs/server";
import { getServiceClient } from "@/lib/supabase-server";

export interface AuthUser {
  userId: string;
}

/**
 * Extracts the authenticated user from the current request context.
 * Works with @clerk/nextjs v7+ server-side auth().
 *
 * Returns null if the request is unauthenticated.
 */
export async function getUserFromRequest(
  _req?: Request
): Promise<AuthUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return { userId };
}

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, max: 2 };

/**
 * Checks that the authenticated user meets the minimum tier requirement.
 * Returns { userId } on success, or a 403/401 Response on failure.
 */
export async function requireTier(
  req: Request,
  minTier: "pro" | "max"
): Promise<{ userId: string } | Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", user.userId)
    .maybeSingle();

  const tier = (data as Record<string, unknown> | null)?.["tier"] as string ?? "free";
  if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[minTier] ?? 1)) {
    return Response.json(
      { error: "Pro plan required" },
      { status: 403 }
    );
  }

  return { userId: user.userId };
}
