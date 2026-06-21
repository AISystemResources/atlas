/**
 * GET /api/v1/ticket-logics — list strategies the caller can see.
 *
 * Sprint 060D. Returns:
 *   - All strategies created by the caller (regardless of visibility)
 *   - PLUS all 'public' strategies created by others
 *
 * Query params:
 *   - scope:   "mine" | "public" | "all" (default "all")
 *   - status:  "draft" | "active" | "archived" (filter; default any)
 *   - limit:   1..200 (default 50)
 *
 * Unlisted strategies are intentionally NOT returned by list — they're only
 * fetchable via direct id at /api/v1/ticket-logics/[id] (so a shared link
 * works but listing doesn't leak them).
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const statusFilter = url.searchParams.get("status");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1),
    200,
  );

  const sb = getServiceClient();

  let query = sb
    .from("ticket_logics")
    .select(
      // Sprint 077A.8: include ticker + tags so the Settings strategy
      // picker can highlight strategies that match each watchlist row.
      "id, name, version, parent_version_id, forked_from_id, description, status, visibility, created_by_user_id, created_by, created_at, ticker, tags",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope === "mine") {
    query = query.eq("created_by_user_id", user.userId);
  } else if (scope === "public") {
    query = query.eq("visibility", "public");
  } else {
    // "all" = mine + public
    query = query.or(
      `created_by_user_id.eq.${user.userId},visibility.eq.public`,
    );
  }

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ strategies: data ?? [] });
}
