import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { getEffectiveTier } from "@/lib/auth/effective-tier";
import { DashboardShell } from "./DashboardShell";
import type { UserRole } from "@/lib/api";
import type { ReactNode } from "react";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const role = ((profile as Record<string, unknown> | null)?.["role"] ?? null) as UserRole | null;

  // Sprint 101: tier model collapsed to free | pro at the UI boundary.
  // getEffectiveTier folds legacy 'max' into 'pro' so downstream components
  // don't have to handle the deprecated tier.
  const { effective: tier } = await getEffectiveTier(userId);

  return (
    <DashboardShell role={role} tier={tier}>
      {children}
    </DashboardShell>
  );
}
