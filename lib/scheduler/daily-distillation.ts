/**
 * Daily Distillation — Sprint 044.
 *
 * Server-side fallback for users without Claude Desktop MCP. For each user with
 * trades on the given trading date, calls Groq Llama 3.3 70B with the day's
 * trades + matching reasoning_traces, produces a structured reflection, and
 * writes to `daily_learnings` with source='groq'.
 *
 * MCP priority: if a row with source='mcp' already exists for (user_id, trading_date)
 * we skip — user's own AI subscription already did better than we can.
 *
 * Idempotent: re-running for the same date is safe. Existing 'groq' rows are
 * overwritten with the latest run (in case earlier runs hit transient errors).
 */

import { createClient } from "@supabase/supabase-js";
import { MongoClient, ObjectId } from "mongodb";
import { getLlm } from "@/lib/agents/llm";
import { getNyTradingDayBounds, getNyTodayDate } from "@/lib/mcp-atlas/utils";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
const MONGO_URI = process.env.MONGODB_URI!;
const MONGO_DB = process.env.MONGODB_DB_NAME ?? "atlas";

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

export interface DistillationResult {
  user_id: string;
  trading_date: string;
  skipped: boolean;
  reason?: string;
  trade_count?: number;
}

interface DistilledOutput {
  summary: string;
  key_observations: string[];
  recommendations: string[];
}

const SYSTEM_PROMPT = `You are an end-of-day trading reflection assistant for the Atlas AI trading system.

Your job is to review one trading day's executed trades and AI reasoning, then produce a structured reflection.

You MUST respond with ONLY valid JSON in this exact shape:
{
  "summary": "1-3 sentence specific takeaway from the day. Be concrete (e.g. 'tech sector underperformed on rate-hike news; sentiment lagged price action ~15min'). Avoid platitudes ('be more cautious').",
  "key_observations": ["1-10 concrete pattern observations, each 10-400 chars. Reference specific tickers, signals, or timings."],
  "recommendations": ["1-10 specific actions for tomorrow, each 10-400 chars. Each must be actionable (e.g. 'reduce tech exposure', not 'be careful')."]
}

Rules:
- BE SPECIFIC. Reference tickers, prices, signal strengths, time windows.
- DO NOT include any text outside the JSON.
- Empty arrays are NOT allowed — if you have nothing for a category, return ["No significant patterns observed for the day."] etc.
- Avoid generic trading wisdom. The user reads this every day; repetition is useless.`;

function buildUserPrompt(trades: unknown[], traces: unknown[], date: string): string {
  return `Trading date: ${date} (US/Eastern)
Trades executed: ${trades.length}
Reasoning traces available: ${traces.length}

TRADES (compact JSON):
${JSON.stringify(trades, null, 2)}

REASONING TRACES (AI's pre-trade analysis for each signal_id):
${JSON.stringify(traces, null, 2)}

Produce your structured reflection now.`;
}

/**
 * Run distillation for one user on one trading date.
 * Returns skipped=true if MCP entry exists or no trades for the day.
 */
export async function distillUserDay(
  userId: string,
  tradingDate: string,
): Promise<DistillationResult> {
  const sb = getServiceClient();

  // Skip if MCP entry already exists — user's Claude Desktop got there first
  const { data: existing } = await sb
    .from("daily_learnings")
    .select("source")
    .eq("user_id", userId)
    .eq("trading_date", tradingDate)
    .maybeSingle();

  if (existing && existing.source === "mcp") {
    return { user_id: userId, trading_date: tradingDate, skipped: true, reason: "mcp_entry_exists" };
  }

  // Fetch trades for the day
  const { dayStart, dayEnd } = getNyTradingDayBounds(tradingDate);
  const { data: trades, error: tradesErr } = await sb
    .from("trades")
    .select("ticker, action, shares, price, status, strategy, signal_id, realized_pnl, executed_at")
    .eq("user_id", userId)
    .gte("executed_at", dayStart)
    .lt("executed_at", dayEnd)
    .order("executed_at", { ascending: true });

  if (tradesErr) {
    return { user_id: userId, trading_date: tradingDate, skipped: true, reason: `trades_error: ${tradesErr.message}` };
  }

  const tradesList = trades ?? [];
  if (tradesList.length === 0) {
    return { user_id: userId, trading_date: tradingDate, skipped: true, reason: "no_trades", trade_count: 0 };
  }

  // Pull reasoning_traces from MongoDB
  const signalIds = tradesList
    .map((t: { signal_id?: string | null }) => t.signal_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const oids: ObjectId[] = [];
  for (const sid of signalIds) {
    try {
      oids.push(new ObjectId(sid));
    } catch {
      // Skip invalid ObjectIds (scalper trades have signal_id=null anyway)
    }
  }

  const mongo = new MongoClient(MONGO_URI);
  let traces: unknown[] = [];
  try {
    await mongo.connect();
    const col = mongo.db(MONGO_DB).collection("reasoning_traces");
    if (oids.length > 0) {
      traces = await col
        .find({ _id: { $in: oids }, user_id: userId }, {
          projection: { ticker: 1, current_price: 1, portfolio_decision: 1, synthesis: 1, risk: 1 },
        })
        .toArray();
    }
  } finally {
    await mongo.close();
  }

  // Call Groq for distillation
  const llm = await getLlm("deep", {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
  });

  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(buildUserPrompt(tradesList, traces, tradingDate)),
  ]);

  const raw = typeof response.content === "string"
    ? response.content
    : Array.isArray(response.content)
      ? response.content.map((c) => (typeof c === "string" ? c : "")).join("")
      : String(response.content);

  let parsed: DistilledOutput;
  try {
    // Groq sometimes wraps in markdown — strip fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
    parsed = JSON.parse(cleaned) as DistilledOutput;
  } catch (err) {
    return {
      user_id: userId,
      trading_date: tradingDate,
      skipped: true,
      reason: `parse_error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // Validate structure
  if (
    typeof parsed.summary !== "string" ||
    parsed.summary.length < 20 ||
    !Array.isArray(parsed.key_observations) ||
    parsed.key_observations.length === 0 ||
    !Array.isArray(parsed.recommendations) ||
    parsed.recommendations.length === 0
  ) {
    return { user_id: userId, trading_date: tradingDate, skipped: true, reason: "invalid_llm_output" };
  }

  const filledTrades = tradesList.filter((t: { status: string }) => t.status === "filled");
  const winCount = filledTrades.filter(
    (t: { realized_pnl?: number | null }) =>
      typeof t.realized_pnl === "number" && t.realized_pnl > 0,
  ).length;

  // Upsert with source='groq' (will overwrite a prior 'groq' row, never 'mcp')
  await sb.from("daily_learnings").upsert(
    {
      user_id: userId,
      trading_date: tradingDate,
      trade_count: filledTrades.length,
      win_count: winCount,
      learnings_summary: parsed.summary,
      key_observations: parsed.key_observations,
      recommendations: parsed.recommendations,
      source: "groq",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,trading_date" },
  );

  return {
    user_id: userId,
    trading_date: tradingDate,
    skipped: false,
    trade_count: filledTrades.length,
  };
}

/**
 * Find all users who had trades today and run distillation for each.
 * Uses default trading date = today in NY tz.
 */
export async function runDailyDistillation(
  tradingDate?: string,
): Promise<DistillationResult[]> {
  const date = tradingDate ?? getNyTodayDate();
  const sb = getServiceClient();
  const { dayStart, dayEnd } = getNyTradingDayBounds(date);

  // Find users with at least one trade on this date
  const { data: traders, error } = await sb
    .from("trades")
    .select("user_id")
    .gte("executed_at", dayStart)
    .lt("executed_at", dayEnd);

  if (error) {
    console.error("[daily-distillation] traders query failed:", error.message);
    return [];
  }

  const uniqueUserIds = Array.from(
    new Set(((traders ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );

  if (uniqueUserIds.length === 0) {
    console.info(`[daily-distillation] no traders for ${date}, skipping all`);
    return [];
  }

  const results: DistillationResult[] = [];
  for (const userId of uniqueUserIds) {
    try {
      results.push(await distillUserDay(userId, date));
    } catch (err) {
      results.push({
        user_id: userId,
        trading_date: date,
        skipped: true,
        reason: `exception: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}
