/**
 * GET /api/v1/spender-key
 *
 * Returns the caller's server-side spender address, creating one on first
 * call. This is what the client passes into wallet_grantPermissions as the
 * spender in the ERC-7715 grant.
 *
 * The private key never crosses this boundary — the server holds it,
 * encrypted at rest, and only decrypts in memory when signing a trade in
 * the auto-execute dispatcher (Phase 3).
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { getOrCreateSpenderKey } from "@/lib/execution/spender-key";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const record = await getOrCreateSpenderKey(user.userId);
    return Response.json({
      spender_address: record.spender_address,
      created_at: record.created_at,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "spender key error" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
