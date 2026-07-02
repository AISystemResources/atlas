/**
 * GET /api/v1/ticket-logics/[id] — fetch one strategy by id.
 *
 * Sprint 060D. Ownership / visibility check:
 *   - If created_by_user_id == caller: always allowed
 *   - If visibility == 'public' or 'unlisted': allowed (unlisted requires
 *     knowing the id — discovery via list is not possible)
 *   - Otherwise: 404 (we lie with 'not found' to avoid leaking existence)
 *
 * Returns: full row including body so the detail UI can render the rules.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

interface RowShape {
  id: string;
  created_by_user_id: string | null;
  visibility: "private" | "unlisted" | "public";
  // ... other fields returned as-is
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("ticket_logics")
    .select(
      "id, name, version, parent_version_id, forked_from_id, description, body, status, visibility, created_by_user_id, created_by, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "not found" }, { status: 404 });

  const row = data as unknown as RowShape;
  const isOwner = row.created_by_user_id === user.userId;
  const isReadable =
    row.visibility === "public" || row.visibility === "unlisted";

  if (!isOwner && !isReadable) {
    // Private and not the owner — lie with 404
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({ strategy: data });
}

/**
 * PATCH /api/v1/ticket-logics/[id] — owner-gated update of mutable fields.
 * Sprint 129: initial scope is visibility only. Values: 'private' | 'unlisted' | 'public'.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { visibility?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const visibility = body.visibility;
  if (
    visibility !== "private" &&
    visibility !== "unlisted" &&
    visibility !== "public"
  ) {
    return Response.json(
      { error: "visibility must be private | unlisted | public" },
      { status: 400 },
    );
  }

  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("ticket_logics")
    .select("id, created_by_user_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return Response.json({ error: "not found" }, { status: 404 });
  const row = existing as { id: string; created_by_user_id: string | null };
  if (row.created_by_user_id !== user.userId) {
    // Non-owner — lie with 404 as elsewhere in this file
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const { error: updateError } = await sb
    .from("ticket_logics")
    .update({ visibility })
    .eq("id", id);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({ ok: true, visibility });
}
