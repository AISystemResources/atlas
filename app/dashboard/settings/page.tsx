import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { SettingsTab } from "../DashboardClient";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .maybeSingle();

  const p = profile as Record<string, unknown> | null;
  const VALID_TIERS = ["free", "pro", "max"] as const;
  const rawTier = String(p?.["tier"] ?? "free");
  const tier = (VALID_TIERS.includes(rawTier as typeof VALID_TIERS[number]) ? rawTier : "free") as "free" | "pro" | "max";

  // Sprint 096: the AI Intervention Matrix UI was removed from Settings.
  // The EBC matrix is an execution-time choice the user makes per trade
  // when applying a strategy to their wallet — not a profile-level toggle.
  // It's surfaced on /dashboard/execution where it actually governs behavior.
  return (
    <div>
      <SettingsTab tier={tier} />
    </div>
  );
}
