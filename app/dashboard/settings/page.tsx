import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { SettingsTab } from "../DashboardClient";
import { AutonomySection } from "./AutonomySection";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("tier, investment_philosophy")
    .eq("id", userId)
    .maybeSingle();

  const p = profile as Record<string, unknown> | null;
  const VALID_TIERS = ["free", "pro", "max"] as const;
  const rawTier = String(p?.["tier"] ?? "free");
  const tier = (VALID_TIERS.includes(rawTier as typeof VALID_TIERS[number]) ? rawTier : "free") as "free" | "pro" | "max";
  const philosophy = String(p?.["investment_philosophy"] ?? "balanced") as Parameters<typeof SettingsTab>[0]["initialPhilosophy"];

  return (
    <div>
      <AutonomySection />
      <SettingsTab
        tier={tier}
        initialPhilosophy={philosophy}
      />
    </div>
  );
}
