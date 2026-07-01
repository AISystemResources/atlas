/**
 * GET  /api/v1/spend-permissions       — list caller's non-expired, non-revoked grants
 * POST /api/v1/spend-permissions       — record a new grant returned by wallet_grantPermissions
 * DELETE /api/v1/spend-permissions?id=<uuid> — soft-revoke a grant (sets revoked_at)
 *
 * Sprint 109 Phase 2: server records the grant metadata client-side observed
 * after wallet_grantPermissions succeeds. Auto-execute (Phase 3) reads the
 * active grant to decide whether to sign a trade.
 *
 * Note: soft-revoke here only marks the DB row; the on-chain permission
 * itself needs to be revoked separately through the wallet if the user
 * wants defence-in-depth. The DB flag alone is enough to stop Atlas from
 * signing.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("spend_permissions")
    .select("id, spender_address, token_address, contract_target, allowance_wei, period_seconds, grant_tx_hash, granted_at, expires_at, revoked_at")
    .eq("user_id", user.userId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("granted_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ permissions: data ?? [] });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const b = body as {
    spender_address?: string;
    token_address?: string;
    contract_target?: string;
    allowance_wei?: string;
    period_seconds?: number;
    grant_tx_hash?: string;
    expires_at?: string;
  };

  const required = ["spender_address", "token_address", "contract_target", "allowance_wei", "period_seconds", "grant_tx_hash", "expires_at"] as const;
  for (const k of required) {
    if (!b[k]) {
      return Response.json({ error: `${k} required` }, { status: 400 });
    }
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("spend_permissions")
    .insert({
      user_id: user.userId,
      spender_address: b.spender_address,
      token_address: b.token_address,
      contract_target: b.contract_target,
      allowance_wei: b.allowance_wei,
      period_seconds: b.period_seconds,
      grant_tx_hash: b.grant_tx_hash,
      expires_at: b.expires_at,
    })
    .select("id")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data.id });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const sb = getServiceClient();
  const { error } = await sb
    .from("spend_permissions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.userId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
