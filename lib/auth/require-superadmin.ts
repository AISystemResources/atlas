/**
 * Server-side superadmin gate — Sprint 067.
 *
 * Use at the top of a page that should be invisible to public users. Returns
 * Edmund's userId if they're superadmin; redirects to /dashboard otherwise.
 * Routes wrapped with this stay reachable for the academic / debug surface
 * (Agents, Insights, Backtests) without showing up in mom's navigation.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";

export async function requireSuperadmin(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data } = await sb
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role ?? "user";
  if (role !== "superadmin") redirect("/dashboard");

  return userId;
}
