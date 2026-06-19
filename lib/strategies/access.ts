/**
 * Strategy access control — Sprint 075a.
 *
 * Centralises the "who can read this strategy" check so the same rules
 * apply across the dashboard, the MCP read tools, the fork endpoint, and
 * any future surfaces.
 *
 * A strategy is readable by user X if ANY of:
 *   - X is the owner (created_by_user_id = X.userId)
 *   - visibility = 'public'
 *   - visibility = 'unlisted' (anyone with the id)
 *   - a strategy_shares row exists for (strategy_id, X.email)
 *
 * For listing (e.g. /dashboard/strategies, list_ticket_logics), we
 * pre-fetch the user's email + the set of shared strategy_ids in a
 * single query and pass them as a hint to avoid N+1 lookups.
 */

import { getServiceClient } from "@/lib/supabase-server";

export interface VisibleStrategyInputs {
  created_by_user_id: string | null;
  visibility: "private" | "unlisted" | "public";
}

export interface AccessContext {
  userId: string;
  email: string | null;
  sharedStrategyIds: Set<string>;
}

/** Pure decision — no I/O. */
export function canRead(
  s: VisibleStrategyInputs & { id: string },
  ctx: AccessContext,
): boolean {
  if (s.created_by_user_id === ctx.userId) return true;
  if (s.visibility === "public") return true;
  if (s.visibility === "unlisted") return true;
  if (ctx.sharedStrategyIds.has(s.id)) return true;
  return false;
}

/** Fetch everything needed to make access decisions for this user. */
export async function buildAccessContext(userId: string): Promise<AccessContext> {
  const sb = getServiceClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const email = ((profile as { email: string | null } | null)?.email ?? null)?.toLowerCase() ?? null;

  let sharedStrategyIds = new Set<string>();
  if (email) {
    const { data: rows } = await sb
      .from("strategy_shares")
      .select("strategy_id")
      .eq("email", email);
    sharedStrategyIds = new Set(
      ((rows ?? []) as Array<{ strategy_id: string }>).map((r) => r.strategy_id),
    );
  }

  return { userId, email, sharedStrategyIds };
}
