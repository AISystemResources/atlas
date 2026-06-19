import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MongoClient, ObjectId } from "mongodb";
import { getServiceClient } from "@/lib/supabase-server";
import { PortfolioPageClient } from "./PortfolioPageClient";

export default async function PortfolioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const sb = getServiceClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("tier, investment_philosophy, boundary_mode, scalper_strategy_id")
    .eq("id", userId)
    .maybeSingle();

  const p = profile as Record<string, unknown> | null;
  const VALID_TIERS = ["free", "pro", "max"] as const;
  const rawTier = String(p?.["tier"] ?? "free");
  const tier = (VALID_TIERS.includes(rawTier as typeof VALID_TIERS[number]) ? rawTier : "free") as "free" | "pro" | "max";
  const philosophy = String(p?.["investment_philosophy"] ?? "balanced");
  const boundaryMode = String(p?.["boundary_mode"] ?? "advisory");
  // Sprint 065: first-run prompt — banner shown when user hasn't selected a
  // strategy for the scalper to run. Without it, the scalper sits idle and
  // the user has no idea why.
  const needsScalperStrategy = p?.["scalper_strategy_id"] == null;

  // Light signals check for pending-approval banner only
  const { hasPending, pendingTicker } = await checkPendingSignals(userId);

  return (
    <PortfolioPageClient
      tier={tier}
      philosophy={philosophy}
      boundaryMode={boundaryMode}
      hasPendingConditional={hasPending}
      pendingTicker={pendingTicker}
      needsScalperStrategy={needsScalperStrategy}
    />
  );
}

async function checkPendingSignals(userId: string): Promise<{ hasPending: boolean; pendingTicker: string | null }> {
  const mongo = new MongoClient(process.env.MONGODB_URI!);
  try {
    await mongo.connect();
    const doc = await mongo
      .db(process.env.MONGODB_DB_NAME ?? "atlas")
      .collection("reasoning_traces")
      .findOne(
        {
          user_id: userId,
          $or: [
            { "execution.status": "awaiting_approval" },
            { boundary_mode: "conditional" },
          ],
        },
        { projection: { ticker: 1 } }
      );
    return { hasPending: !!doc, pendingTicker: doc ? String(doc.ticker ?? "") : null };
  } catch {
    return { hasPending: false, pendingTicker: null };
  } finally {
    await mongo.close();
  }
}
