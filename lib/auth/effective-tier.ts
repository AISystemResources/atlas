/**
 * Effective tier resolution — Sprint 075b.
 *
 * The base tier on `profiles.tier` is one of {'free', 'pro', 'max'} (max
 * is legacy from the original pricing, retained for migration safety).
 * `profiles.pro_trial_ends_at` is an override timestamp — when set and in
 * the future, the user has Pro access regardless of base tier.
 *
 * This separation means an invite-trial recipient (Sprint 075c) keeps
 * their base tier as 'free' and reverts cleanly when the trial expires —
 * no state mutation needed at expiry time.
 */

import { getServiceClient } from "@/lib/supabase-server";

export type EffectiveTier = "free" | "pro";

export interface EffectiveTierInfo {
  effective: EffectiveTier;
  base_tier: "free" | "pro" | "max";
  pro_trial_ends_at: string | null;
  on_trial: boolean;
}

export async function getEffectiveTier(userId: string): Promise<EffectiveTierInfo> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("profiles")
    .select("tier, pro_trial_ends_at")
    .eq("id", userId)
    .maybeSingle();
  const row = data as { tier: string | null; pro_trial_ends_at: string | null } | null;

  const baseRaw = (row?.tier ?? "free") as string;
  // Treat legacy 'max' as 'pro' for the purposes of access checks.
  const base_tier: "free" | "pro" | "max" =
    baseRaw === "pro" ? "pro" : baseRaw === "max" ? "max" : "free";

  const trialEndsAt = row?.pro_trial_ends_at ?? null;
  const on_trial =
    trialEndsAt !== null && new Date(trialEndsAt).getTime() > Date.now();

  const effective: EffectiveTier =
    base_tier === "pro" || base_tier === "max" || on_trial ? "pro" : "free";

  return { effective, base_tier, pro_trial_ends_at: trialEndsAt, on_trial };
}

export async function requireProTier(userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const info = await getEffectiveTier(userId);
  if (info.effective === "pro") return { ok: true };
  return {
    ok: false,
    reason:
      "This action requires the Pro plan. Authoring strategies via Claude / ChatGPT is a Pro feature — ask the Atlas founder for an invite code that grants a 14-day Pro trial.",
  };
}
