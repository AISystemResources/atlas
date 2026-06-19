import { MongoClient, ObjectId } from "mongodb";
import { AgentsClient } from "./AgentsClient";
import type { Signal } from "../DashboardClient";
import { requireSuperadmin } from "@/lib/auth/require-superadmin";

export default async function AgentsPage() {
  // Sprint 067: legacy multi-agent surface, hidden from public users.
  // Data preserved for the academic record.
  const userId = await requireSuperadmin();

  const signals = await fetchSignals(userId);

  return <AgentsClient signals={signals} />;
}

async function fetchSignals(userId: string): Promise<Signal[]> {
  const mongo = new MongoClient(process.env.MONGODB_URI!);
  try {
    await mongo.connect();
    const docs = await mongo
      .db(process.env.MONGODB_DB_NAME ?? "atlas")
      .collection("reasoning_traces")
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();

    return docs.map((d) => {
      const run = (d.pipeline_run ?? {}) as Record<string, unknown>;
      const decision = (run.final_decision ?? {}) as Record<string, unknown>;
      const exec = (d.execution ?? {}) as Record<string, unknown>;
      return {
        id: d._id instanceof ObjectId ? d._id.toHexString() : String(d._id),
        ticker: String(d.ticker ?? ""),
        action: String(decision.action ?? "HOLD") as Signal["action"],
        confidence: Number(decision.confidence ?? 0),
        reasoning: String(decision.reasoning ?? ""),
        boundary_mode: String(d.boundary_mode ?? run.boundary_mode ?? "advisory"),
        risk: (run.risk ?? {}) as Signal["risk"],
        created_at:
          d.created_at instanceof Date
            ? d.created_at.toISOString()
            : String(d.created_at ?? new Date().toISOString()),
        status: (exec.status ?? "signal") as Signal["status"],
        execution: d.execution as Signal["execution"],
        shares: Number(exec.shares ?? 0) || null,
        price: Number(exec.price ?? 0) || null,
      };
    });
  } catch {
    return [];
  } finally {
    await mongo.close();
  }
}
