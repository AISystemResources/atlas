/**
 * POST /api/v1/redeem-invite — Sprint 075c.
 *
 * Called by the dashboard the first time a freshly-signed-up user lands.
 * Reads the `atlas_invite_code` cookie (set by /invite/[code]), validates,
 * idempotently records the redemption, and bumps the caller's
 * pro_trial_ends_at = max(existing, now + trial_days).
 *
 * Idempotent: if (code, user_id) already exists in referral_redemptions,
 * the trial is NOT re-extended. This prevents double-grant on retries.
 */

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const jar = await cookies();
  const code = jar.get("atlas_invite_code")?.value?.trim() ?? "";
  if (!code) return Response.json({ ok: true, no_code: true });

  const sb = getServiceClient();

  // Look up code.
  const { data: codeData } = await sb
    .from("referral_codes")
    .select("code, trial_days, max_uses, expires_at")
    .eq("code", code)
    .maybeSingle();
  const codeRow = codeData as
    | { code: string; trial_days: number; max_uses: number | null; expires_at: string | null }
    | null;
  if (!codeRow) {
    jar.delete("atlas_invite_code");
    return Response.json({ ok: false, reason: "code_not_found" });
  }
  if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() < Date.now()) {
    jar.delete("atlas_invite_code");
    return Response.json({ ok: false, reason: "code_expired" });
  }

  // Idempotency: already redeemed?
  const { data: existing } = await sb
    .from("referral_redemptions")
    .select("redeemed_at")
    .eq("code", code)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    jar.delete("atlas_invite_code");
    return Response.json({ ok: true, already_redeemed: true });
  }

  // Max-uses enforcement.
  if (codeRow.max_uses != null) {
    const { count } = await sb
      .from("referral_redemptions")
      .select("*", { count: "exact", head: true })
      .eq("code", code);
    if ((count ?? 0) >= codeRow.max_uses) {
      jar.delete("atlas_invite_code");
      return Response.json({ ok: false, reason: "code_exhausted" });
    }
  }

  // Insert redemption row.
  const { error: insErr } = await sb
    .from("referral_redemptions")
    .insert({ code, user_id: userId });
  if (insErr) {
    // Unique-constraint collision means a parallel call won the race;
    // treat as success and don't re-extend.
    if (insErr.code === "23505") {
      jar.delete("atlas_invite_code");
      return Response.json({ ok: true, already_redeemed: true });
    }
    return Response.json({ ok: false, reason: insErr.message }, { status: 500 });
  }

  // Grant trial — max(existing, now + trial_days) so an already-on-trial
  // user gets extended rather than shortened.
  const { data: profile } = await sb
    .from("profiles")
    .select("pro_trial_ends_at")
    .eq("id", userId)
    .maybeSingle();
  const existingEnd =
    (profile as { pro_trial_ends_at: string | null } | null)?.pro_trial_ends_at ?? null;

  const newEnd = new Date(Date.now() + codeRow.trial_days * 24 * 3600 * 1000);
  const finalEnd =
    existingEnd && new Date(existingEnd).getTime() > newEnd.getTime()
      ? existingEnd
      : newEnd.toISOString();

  await sb
    .from("profiles")
    .update({ pro_trial_ends_at: finalEnd })
    .eq("id", userId);

  jar.delete("atlas_invite_code");
  return Response.json({
    ok: true,
    granted_trial_days: codeRow.trial_days,
    pro_trial_ends_at: finalEnd,
  });
}
