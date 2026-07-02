/**
 * /api/v1/sub-accounts — Sprint 118 · Coinbase Smart Sub-Accounts.
 *
 * GET  → current user's sub-account (or 404 if none)
 * POST → record a newly-created sub-account (called by AutoExecutePanel
 *        after wallet_addSubAccount returns client-side)
 * DELETE → soft-revoke (sets revoked_at). Doesn't touch the on-chain
 *          account — user can also just empty it out.
 *
 * Replaces the ERC-7715 spend_permissions endpoints. Those are left in
 * place for now (auditability) but no new code writes to them.
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getServiceClient } from "@/lib/supabase-server";

interface SubAccountRow {
  user_id: string;
  sub_account_address: string;
  spender_address: string;
  factory: string | null;
  factory_data: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("user_sub_accounts")
    .select(
      "user_id, sub_account_address, spender_address, factory, factory_data, created_at, revoked_at",
    )
    .eq("user_id", user.userId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ sub_account: null });

  const row = data as SubAccountRow;
  return Response.json({
    sub_account: {
      address: row.sub_account_address,
      spender_address: row.spender_address,
      factory: row.factory,
      factory_data: row.factory_data,
      created_at: row.created_at,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    sub_account_address?: unknown;
    spender_address?: unknown;
    factory?: unknown;
    factory_data?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const subAddr =
    typeof body.sub_account_address === "string"
      ? body.sub_account_address.trim().toLowerCase()
      : null;
  const spenderAddr =
    typeof body.spender_address === "string"
      ? body.spender_address.trim().toLowerCase()
      : null;
  const factory =
    typeof body.factory === "string" ? body.factory.trim().toLowerCase() : null;
  const factoryData =
    typeof body.factory_data === "string" ? body.factory_data.trim() : null;

  if (!subAddr || !/^0x[0-9a-f]{40}$/.test(subAddr)) {
    return Response.json(
      { error: "sub_account_address must be a 0x-prefixed 40-hex EVM address" },
      { status: 400 },
    );
  }
  if (!spenderAddr || !/^0x[0-9a-f]{40}$/.test(spenderAddr)) {
    return Response.json(
      { error: "spender_address must be a 0x-prefixed 40-hex EVM address" },
      { status: 400 },
    );
  }

  const sb = getServiceClient();

  // Cross-check: the spender_address the client claims MUST match the
  // one we stored server-side under user_spender_keys. Otherwise a
  // malicious client could register a sub-account owned by a key we
  // don't control, then trick the dispatcher into signing garbage.
  const { data: spenderRow } = await sb
    .from("user_spender_keys")
    .select("spender_address")
    .eq("user_id", user.userId)
    .maybeSingle();

  if (!spenderRow) {
    return Response.json(
      {
        error:
          "no spender key on file — call /api/v1/spender-key first, then retry",
      },
      { status: 400 },
    );
  }
  const storedSpender = (spenderRow as { spender_address: string })
    .spender_address.toLowerCase();
  if (storedSpender !== spenderAddr) {
    return Response.json(
      {
        error: `spender_address mismatch: request says ${spenderAddr}, but user_spender_keys has ${storedSpender}`,
      },
      { status: 400 },
    );
  }

  // Upsert — allow re-registration on the same user (idempotent). A user
  // who revoked and creates a new one gets the new row via ON CONFLICT.
  const { error: insErr } = await sb.from("user_sub_accounts").upsert(
    {
      user_id: user.userId,
      sub_account_address: subAddr,
      spender_address: spenderAddr,
      factory,
      factory_data: factoryData,
      revoked_at: null,
    },
    { onConflict: "user_id" },
  );

  if (insErr) return Response.json({ error: insErr.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const { error } = await sb
    .from("user_sub_accounts")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.userId)
    .is("revoked_at", null);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
