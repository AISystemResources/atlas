/**
 * Strategy sharing — Sprint 075a.
 *
 * GET    /v1/ticket-logics/:id/shares                — list emails granted access
 * POST   /v1/ticket-logics/:id/shares  { email }     — grant access
 * DELETE /v1/ticket-logics/:id/shares?email=...      — revoke
 *
 * Only the strategy owner can manage shares. Emails are normalised to
 * lowercase before insert. Sharing rows survive recipient signup — when
 * a new user logs in with a previously-granted email, access activates
 * automatically (the read path looks up shares by email, not user_id).
 */

import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

const ShareSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.trim().toLowerCase()),
});

async function assertOwner(strategyId: string, userId: string) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("ticket_logics")
    .select("created_by_user_id")
    .eq("id", strategyId)
    .maybeSingle();
  const row = data as { created_by_user_id: string | null } | null;
  if (!row) return { ok: false as const, status: 404, error: "strategy not found" };
  if (row.created_by_user_id !== userId) {
    return { ok: false as const, status: 403, error: "only the owner can manage shares" };
  }
  return { ok: true as const };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const check = await assertOwner(id, user.userId);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("strategy_shares")
    .select("email, granted_at")
    .eq("strategy_id", id)
    .order("granted_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ shares: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const check = await assertOwner(id, user.userId);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 422 });
  }
  const parsed = ShareSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const sb = getServiceClient();
  const { error: insErr } = await sb.from("strategy_shares").insert({
    strategy_id: id,
    email: parsed.data.email,
    granted_by_user_id: user.userId,
  });
  if (insErr) {
    // Unique-constraint violation = already shared, treat as idempotent success.
    if (insErr.code === "23505") {
      return Response.json({ ok: true, email: parsed.data.email, already_shared: true });
    }
    return Response.json({ error: insErr.message }, { status: 500 });
  }
  return Response.json({ ok: true, email: parsed.data.email });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const check = await assertOwner(id, user.userId);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  const url = new URL(req.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) return Response.json({ error: "email query param required" }, { status: 422 });

  const sb = getServiceClient();
  const { error } = await sb
    .from("strategy_shares")
    .delete()
    .eq("strategy_id", id)
    .eq("email", email);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, email });
}
