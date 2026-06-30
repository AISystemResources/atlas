import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getEffectiveTier } from "@/lib/auth/effective-tier";
import { SettingsTab } from "../DashboardClient";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  // Sprint 101: tier collapsed to free | pro (legacy 'max' folds into 'pro'
  // via getEffectiveTier).
  // Sprint 096: the AI Intervention Matrix UI was removed from Settings.
  // The EBC matrix is an execution-time choice the user makes per trade
  // when applying a strategy to their wallet — not a profile-level toggle.
  const { effective: tier } = await getEffectiveTier(userId);

  return (
    <div>
      <SettingsTab tier={tier} />
    </div>
  );
}
