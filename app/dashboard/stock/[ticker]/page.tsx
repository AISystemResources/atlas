import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MongoClient } from "mongodb";
import { type DecisionLogEntry } from "@/lib/api";
import { getTickerMetadata } from "@/lib/market/ticker-metadata";
import { StockLogClient, type StockMetadataView } from "./StockLogClient";

export default async function StockLogPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const [entries, metadata] = await Promise.all([
    fetchDecisionLog(userId, ticker, 20),
    getTickerMetadata(ticker),
  ]);

  const metaView: StockMetadataView | null = metadata
    ? {
        kind: metadata.kind,
        display_name: metadata.display_name,
        has_fundamental_data: metadata.has_fundamental_data,
        has_sentiment_data: metadata.has_sentiment_data,
        has_technical_data: metadata.has_technical_data,
        exchange: metadata.exchange,
        description: metadata.description,
      }
    : null;

  return <StockLogClient ticker={ticker} entries={entries} metadata={metaView} />;
}

async function fetchDecisionLog(
  userId: string,
  ticker: string,
  limit: number,
): Promise<DecisionLogEntry[]> {
  const mongo = new MongoClient(process.env.MONGODB_URI!);
  try {
    await mongo.connect();
    const docs = await mongo
      .db(process.env.MONGODB_DB_NAME ?? "atlas")
      .collection("reasoning_traces")
      .find(
        { user_id: userId, ticker },
        {
          projection: {
            created_at: 1,
            "pipeline_run.final_decision.action": 1,
            "pipeline_run.final_decision.confidence": 1,
            "pipeline_run.final_decision.reasoning": 1,
            execution: 1,
          },
          sort: { created_at: -1 },
          limit,
        },
      )
      .toArray();

    return docs.map((doc): DecisionLogEntry => {
      const run = (doc.pipeline_run ?? {}) as Record<string, unknown>;
      const decision = (run.final_decision ?? {}) as Record<string, unknown>;
      const exec = (doc.execution ?? {}) as Record<string, unknown>;

      const rawAction = String(decision.action ?? "HOLD").toUpperCase();
      const action: DecisionLogEntry["action"] =
        rawAction === "BUY" || rawAction === "SELL" ? rawAction : "HOLD";

      return {
        action,
        confidence: Number(decision.confidence ?? 0),
        reasoning: String(decision.reasoning ?? ""),
        created_at:
          doc.created_at instanceof Date
            ? doc.created_at.toISOString()
            : String(doc.created_at ?? ""),
        trace_id: doc._id?.toHexString?.() ?? null,
        executed: exec.status === "executed",
        shares: exec.shares != null ? Number(exec.shares) : null,
        price: exec.price != null ? Number(exec.price) : null,
      };
    });
  } catch {
    return [];
  } finally {
    await mongo.close();
  }
}
